"""
services/analysis_module.py
Сервис анализа дыхательных движений.
Содержит всю логику из medical_tracker.py + компьютерное зрение.
"""

import cv2
import numpy as np
import os
import uuid
import shutil
import json
import logging
import traceback
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

import scipy.stats as stats
from scipy.signal import find_peaks, savgol_filter, butter, filtfilt
from scipy.fft import fft, fftfreq
from sklearn.cluster import KMeans

# ──────────────────────────────────────────────────────────────
# ЛОГИРОВАНИЕ
# ──────────────────────────────────────────────────────────────

logger = logging.getLogger("analysis_module")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter(
        "[%(asctime)s] [%(levelname)s] %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    ))
    logger.addHandler(_h)


# ══════════════════════════════════════════════════════════════
# КЛАСС АНАЛИЗАТОРА (был medical_tracker.py)
# ══════════════════════════════════════════════════════════════

class MedicalVideoAnalyzer:
    """
    Анализатор дыхательной динамики по видео с цветными маркерами.
    Собирает данные, считает метрики, строит графики.
    """

    def __init__(self, num_lines: int = 3, max_history: int = 2000):
        self.num_lines = num_lines
        self.width_history = [deque(maxlen=max_history) for _ in range(num_lines)]
        self.time_history  = [deque(maxlen=max_history) for _ in range(num_lines)]
        self.raw_history   = [deque(maxlen=max_history) for _ in range(num_lines)]
        self.raw_time      = [deque(maxlen=max_history) for _ in range(num_lines)]

        self.patient_data = {
            'patient_id':        'UNKNOWN',
            'patient_name':      'Не указано',
            'patient_gender':    'Не указан',
            'patient_age':       'Не указан',
            'recording_date':    datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'video_duration':    0,
            'total_frames':      0,
            'fps':               30,
            'analysis_timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }

        self.frame_counter  = 0
        self.sample_every_n = 3

        self.marker_names  = ['Грудь', 'Живот/Талия', 'Таз/Бёдра']
        self.marker_colors = ['#FF6B6B', '#4ECDC4', '#45B7D1']

    # ──────────────────────────────────────────────────────────
    # УСТАНОВКА ДАННЫХ
    # ──────────────────────────────────────────────────────────

    def set_patient_info(
        self,
        patient_id: str,
        patient_name: str = None,
        patient_gender: str = None,
        patient_age=None,
        recording_date: str = None,
        video_duration: float = 0,
        total_frames: int = 0,
        fps: float = 30,
    ):
        self.patient_data.update({
            'patient_id':        patient_id,
            'patient_name':      patient_name  or 'Не указано',
            'patient_gender':    patient_gender or 'Не указан',
            'patient_age':       patient_age    or 'Не указан',
            'recording_date':    recording_date or datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'video_duration':    video_duration,
            'total_frames':      total_frames,
            'fps':               fps,
            'analysis_timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        })

    def update(self, widths_mm: List[Optional[float]], frame_time: float = None):
        """Обновление данных с кадра."""
        self.frame_counter += 1

        for i, width in enumerate(widths_mm):
            if width is not None and width > 0:
                self.raw_history[i].append(width)
                self.raw_time[i].append(
                    frame_time or self.frame_counter / 30.0
                )

        if self.frame_counter % self.sample_every_n == 0:
            for i, width in enumerate(widths_mm):
                if width is not None and width > 0:
                    self.width_history[i].append(width)
                    self.time_history[i].append(
                        frame_time or self.frame_counter / 30.0
                    )

    # ──────────────────────────────────────────────────────────
    # ФИЛЬТРАЦИЯ
    # ──────────────────────────────────────────────────────────

    def _smooth_savgol(
        self, data: np.ndarray, window: int = 11, poly: int = 3
    ) -> np.ndarray:
        if len(data) < window:
            window = max(5, len(data) if len(data) % 2 != 0 else len(data) - 1)
        if window < 3:
            return data
        try:
            return savgol_filter(data, window, poly)
        except Exception:
            return data

    def _butter_lowpass(
        self,
        data: np.ndarray,
        cutoff: float = 0.5,
        fs: float = 10.0,
        order: int = 4,
    ) -> np.ndarray:
        if len(data) < 15:
            return data
        try:
            nyq = 0.5 * fs
            normal_cutoff = min(cutoff / nyq, 0.99)
            b, a = butter(order, normal_cutoff, btype='low', analog=False)
            return filtfilt(b, a, data)
        except Exception:
            return self._smooth_savgol(data)

    def _remove_outliers(self, data: np.ndarray, sigma: float = 2.5) -> np.ndarray:
        if len(data) < 5:
            return data
        z = np.abs(stats.zscore(data))
        mask = z < sigma
        if mask.sum() < 5:
            return data
        result = data.copy()
        result[~mask] = np.interp(
            np.where(~mask)[0],
            np.where(mask)[0],
            data[mask],
        )
        return result

    # ──────────────────────────────────────────────────────────
    # FFT АНАЛИЗ
    # ──────────────────────────────────────────────────────────

    def _fft_analysis(self, data: np.ndarray, fs: float = 10.0) -> Dict:
        if len(data) < 20:
            return {}
        try:
            signal_data = data - np.mean(data)
            window      = np.hanning(len(signal_data))
            windowed    = signal_data * window

            n        = len(windowed)
            fft_vals = np.abs(fft(windowed))[:n // 2]
            freqs    = fftfreq(n, d=1.0 / fs)[:n // 2]

            breath_mask = (freqs >= 0.1) & (freqs <= 0.8)
            if not np.any(breath_mask):
                return {}

            breath_freqs = freqs[breath_mask]
            breath_fft   = fft_vals[breath_mask]

            dom_idx   = np.argmax(breath_fft)
            dom_freq  = breath_freqs[dom_idx]
            dom_power = breath_fft[dom_idx]

            total_power  = np.sum(fft_vals ** 2)
            breath_power = np.sum(breath_fft ** 2)
            ratio        = breath_power / (total_power + 1e-10)
            noise_power  = total_power - breath_power
            snr          = 10 * np.log10(breath_power / (noise_power + 1e-10))

            return {
                'fft_freqs':          freqs.tolist(),
                'fft_vals':           fft_vals.tolist(),
                'breath_freqs':       breath_freqs.tolist(),
                'breath_fft':         breath_fft.tolist(),
                'dominant_freq_hz':   float(dom_freq),
                'dominant_freq_bpm':  float(dom_freq * 60),
                'dominant_power':     float(dom_power),
                'breath_power_ratio': float(ratio),
                'snr_db':             float(snr),
            }
        except Exception as e:
            logger.debug("FFT ошибка: %s", e)
            return {}

    # ──────────────────────────────────────────────────────────
    # ФАЗЫ ДЫХАНИЯ
    # ──────────────────────────────────────────────────────────

    def _detect_breath_phases(
        self, data: np.ndarray, times: np.ndarray
    ) -> Dict:
        if len(data) < 20:
            return {}
        try:
            smoothed = self._smooth_savgol(data, window=11)
            std_val  = np.std(smoothed)

            if std_val < 0.5:
                return {'апноэ_обнаружено': True, 'причина': 'минимальная_амплитуда'}

            min_distance = max(5, len(data) // 20)
            prominence   = std_val * 0.4

            peaks,   _ = find_peaks(smoothed,  prominence=prominence,
                                    distance=min_distance, width=2)
            valleys, _ = find_peaks(-smoothed, prominence=prominence,
                                    distance=min_distance, width=2)

            if len(peaks) < 2 or len(valleys) < 2:
                return {
                    'циклы_обнаружены':    False,
                    'количество_пиков':    len(peaks),
                    'количество_впадин':   len(valleys),
                }

            cycles = []
            for i in range(min(len(peaks), len(valleys))):
                amp = smoothed[peaks[i]] - smoothed[valleys[i]]
                if amp > 0:
                    cycles.append({
                        'peak_idx':   int(peaks[i]),
                        'valley_idx': int(valleys[i]),
                        'peak_val':   float(smoothed[peaks[i]]),
                        'valley_val': float(smoothed[valleys[i]]),
                        'amplitude':  float(amp),
                    })

            amplitudes = np.array([c['amplitude'] for c in cycles])

            if len(times) > max(peaks) if len(peaks) > 0 else True:
                peak_intervals = np.diff(times[peaks])
            else:
                peak_intervals = np.diff(peaks / 10.0)

            period_mean = float(np.mean(peak_intervals)) if len(peak_intervals) > 0 else 0
            period_std  = float(np.std(peak_intervals))  if len(peak_intervals) > 0 else 0

            apnea_thr    = period_mean * 2.0
            apnea_events = int(np.sum(peak_intervals > apnea_thr)) if len(peak_intervals) > 0 else 0
            rmssd        = float(np.sqrt(np.mean(np.diff(peak_intervals) ** 2))) \
                           if len(peak_intervals) > 1 else 0

            ie_ratio     = self._calculate_ie_ratio(smoothed, peaks, valleys)

            return {
                'циклы_обнаружены':           True,
                'количество_циклов':          len(cycles),
                'количество_пиков':           len(peaks),
                'количество_впадин':          len(valleys),
                'амплитуда_среднее_мм':       float(np.mean(amplitudes)),
                'амплитуда_медиана_мм':       float(np.median(amplitudes)),
                'амплитуда_максимум_мм':      float(np.max(amplitudes)),
                'амплитуда_минимум_мм':       float(np.min(amplitudes)),
                'амплитуда_std_мм':           float(np.std(amplitudes)),
                'амплитуда_cv_проц':          float(
                    np.std(amplitudes) / np.mean(amplitudes) * 100
                ) if np.mean(amplitudes) > 0 else 0,
                'период_среднее_сек':         period_mean,
                'период_std_сек':             period_std,
                'частота_bpm':                float(60.0 / period_mean) if period_mean > 0 else 0,
                'rmssd_вариабельность':       rmssd,
                'индекс_регулярности':        self._calculate_regularity_index(peaks),
                'апноэ_обнаружено':           apnea_events > 0,
                'количество_апноэ_событий':   apnea_events,
                'порог_апноэ_сек':            float(apnea_thr),
                'ie_ratio':                   ie_ratio,
                'пиковые_значения':           [float(smoothed[p]) for p in peaks],
                'впадинные_значения':         [float(smoothed[v]) for v in valleys],
                'индексы_пиков':              peaks.tolist(),
                'индексы_впадин':             valleys.tolist(),
            }
        except Exception as e:
            logger.debug("Ошибка детекции фаз: %s", e)
            return {}

    def _calculate_ie_ratio(
        self, data: np.ndarray, peaks: np.ndarray, valleys: np.ndarray
    ) -> float:
        if len(peaks) < 2 or len(valleys) < 2:
            return 0.0
        try:
            inhale, exhale = [], []
            for i in range(min(len(peaks), len(valleys)) - 1):
                v, p = valleys[i], peaks[i]
                if v < p:
                    inhale.append(p - v)
                    if i + 1 < len(valleys) and p < valleys[i + 1]:
                        exhale.append(valleys[i + 1] - p)
            if inhale and exhale:
                return float(np.mean(inhale) / np.mean(exhale))
            return 0.0
        except Exception:
            return 0.0

    def _calculate_regularity_index(self, peaks: np.ndarray) -> float:
        if len(peaks) < 3:
            return 0.0
        try:
            intervals = np.diff(peaks)
            cv = np.std(intervals) / (np.mean(intervals) + 1e-10)
            return float(max(0.0, 1.0 - cv))
        except Exception:
            return 0.0

    # ──────────────────────────────────────────────────────────
    # ВРЕМЕННОЙ АНАЛИЗ
    # ──────────────────────────────────────────────────────────

    def _temporal_analysis(
        self, data: np.ndarray, times: np.ndarray
    ) -> Dict:
        if len(data) < 5:
            return {}
        deriv  = np.diff(data)
        deriv2 = np.diff(deriv) if len(deriv) > 1 else np.array([0])
        half   = len(data) // 2
        return {
            'нестабильность_cv_проц':           float(np.std(data) / np.mean(data) * 100)
                                                if np.mean(data) > 0 else 0,
            'макс_скорость_мм_сек':             float(np.max(np.abs(deriv)))    if len(deriv) > 0 else 0,
            'средн_скорость_мм_сек':            float(np.mean(np.abs(deriv)))   if len(deriv) > 0 else 0,
            'дисперсия_ускорения':              float(np.var(deriv2)),
            'стабильность_первая_половина_std': float(np.std(data[:half]))  if half > 2 else 0,
            'стабильность_вторая_половина_std': float(np.std(data[half:]))  if half > 2 else 0,
            'изменение_стабильности':           float(np.std(data[half:]) - np.std(data[:half]))
                                                if half > 2 else 0,
            'тренд_наклон':                     self._linear_trend(data),
            'осцилляционная_частота_гц':        self._dominant_oscillation_freq(data),
        }

    def _dominant_oscillation_freq(self, data: np.ndarray) -> float:
        if len(data) < 10:
            return 0.0
        try:
            sig      = data - np.mean(data)
            fft_vals = np.abs(fft(sig))
            freqs    = fftfreq(len(sig), d=0.1)
            pos      = freqs > 0
            if not np.any(pos):
                return 0.0
            return float(freqs[pos][np.argmax(fft_vals[pos])])
        except Exception:
            return 0.0

    # ──────────────────────────────────────────────────────────
    # СТАТИСТИКА
    # ──────────────────────────────────────────────────────────

    def _full_statistics(
        self,
        raw: np.ndarray,
        clean: np.ndarray,
        smoothed: np.ndarray,
        label: str,
    ) -> Dict:
        return {
            'название':                 label,
            'количество_измерений':     len(raw),
            'среднее_мм':               float(np.mean(clean)),
            'медиана_мм':               float(np.median(clean)),
            'std_мм':                   float(np.std(clean)),
            'мин_мм':                   float(np.min(clean)),
            'макс_мм':                  float(np.max(clean)),
            'диапазон_мм':              float(np.max(clean) - np.min(clean)),
            'p5_мм':                    float(np.percentile(clean, 5)),
            'p10_мм':                   float(np.percentile(clean, 10)),
            'p25_мм':                   float(np.percentile(clean, 25)),
            'p75_мм':                   float(np.percentile(clean, 75)),
            'p90_мм':                   float(np.percentile(clean, 90)),
            'p95_мм':                   float(np.percentile(clean, 95)),
            'iqr_мм':                   float(np.percentile(clean, 75) - np.percentile(clean, 25)),
            'асимметрия':               float(stats.skew(clean))     if len(clean) > 2 else 0,
            'эксцесс':                  float(stats.kurtosis(clean)) if len(clean) > 3 else 0,
            'cv_проц':                  float(np.std(clean) / np.mean(clean) * 100)
                                        if np.mean(clean) > 0 else 0,
            'сглаженное_среднее_мм':    float(np.mean(smoothed)),
            'сглаженный_диапазон_мм':   float(np.max(smoothed) - np.min(smoothed)),
            'нормальность_p_value':     self._normality_test(clean),
            'тренд_наклон':             self._linear_trend(clean),
            'тренд_r2':                 self._trend_r2(clean),
        }

    def _normality_test(self, data: np.ndarray) -> float:
        if len(data) < 8:
            return 1.0
        try:
            _, p = stats.shapiro(data[:min(len(data), 5000)])
            return float(p)
        except Exception:
            return 0.0

    def _linear_trend(self, data: np.ndarray) -> float:
        if len(data) < 2:
            return 0.0
        try:
            slope, *_ = stats.linregress(np.arange(len(data)), data)
            return float(slope)
        except Exception:
            return 0.0

    def _trend_r2(self, data: np.ndarray) -> float:
        if len(data) < 2:
            return 0.0
        try:
            _, _, r, *_ = stats.linregress(np.arange(len(data)), data)
            return float(r ** 2)
        except Exception:
            return 0.0

    # ──────────────────────────────────────────────────────────
    # ГЛАВНЫЙ МЕТОД МЕТРИК
    # ──────────────────────────────────────────────────────────

    def calculate_comprehensive_metrics(self) -> Dict:
        logger.info("Начало расчёта метрик...")

        metrics = {
            'patient_info':                self.patient_data,
            'клинические_индикаторы':      {},
            'статистические_метрики':      {},
            'пространственные_характеристики': {},
            'дыхательная_динамика':        {},
            'временной_анализ':            {},
            'per_marker':                  {},
            'fft_анализ':                  {},
            'фазы_дыхания':                {},
            'сравнительный_анализ':        {},
        }

        total = sum(len(h) for h in self.width_history)
        if total == 0:
            logger.warning("Нет данных для анализа!")
            return metrics

        valid_markers = []
        for i in range(self.num_lines):
            if len(self.width_history[i]) < 10:
                continue

            raw   = np.array(list(self.width_history[i]))
            times = np.array(list(self.time_history[i]))

            fs = (1.0 / np.mean(np.diff(times))) if len(times) > 1 and np.mean(np.diff(times)) > 0 else 10.0

            clean    = self._remove_outliers(raw)
            smoothed = self._butter_lowpass(clean, cutoff=0.5, fs=fs)

            key = f'маркер_{i + 1}_{self.marker_names[i]}'

            mstat   = self._full_statistics(raw, clean, smoothed, key)
            fft_d   = self._fft_analysis(clean, fs=fs)
            phases  = self._detect_breath_phases(clean, times)
            temporal = self._temporal_analysis(clean, times)

            metrics['per_marker'][key] = {
                'статистика': mstat,
                'fft':        fft_d,
                'фазы':       phases,
                'временной':  temporal,
            }
            metrics['fft_анализ'][key]    = fft_d
            metrics['фазы_дыхания'][key]  = phases

            valid_markers.append({
                'index':    i,
                'key':      key,
                'raw':      raw,
                'clean':    clean,
                'smoothed': smoothed,
                'stats':    mstat,
                'fft':      fft_d,
                'phases':   phases,
                'fs':       fs,
            })

        if not valid_markers:
            logger.warning("Недостаточно данных по маркерам!")
            return metrics

        metrics['пространственные_характеристики'] = self._aggregate_spatial(valid_markers)
        metrics['дыхательная_динамика']            = self._aggregate_breathing(valid_markers)
        metrics['временной_анализ']                = self._aggregate_temporal(valid_markers)
        metrics['статистические_метрики']          = self._calculate_statistical_metrics()
        metrics['клинические_индикаторы']          = self._calculate_clinical_indicators(valid_markers)
        metrics['сравнительный_анализ']            = self._comparative_analysis(valid_markers)

        logger.info("Расчёт метрик завершён!")
        return metrics

    # ──────────────────────────────────────────────────────────
    # АГРЕГАЦИЯ
    # ──────────────────────────────────────────────────────────

    def _aggregate_spatial(self, valid_markers: List[Dict]) -> Dict:
        result = {}
        for m in valid_markers:
            s = m['stats']
            p = f"маркер{m['index'] + 1}"
            for field in ('среднее_мм', 'мин_мм', 'макс_мм', 'диапазон_мм',
                          'std_мм', 'медиана_мм', 'p25_мм', 'p75_мм', 'iqr_мм'):
                result[f'{p}_{field}'] = s.get(field, 0)
        means = [m['stats'].get('среднее_мм', 0) for m in valid_markers]
        result['глобальное_среднее_мм'] = float(np.mean(means))
        result['глобальный_std_мм']     = float(np.std(means))
        return result

    def _aggregate_breathing(self, valid_markers: List[Dict]) -> Dict:
        result     = {}
        bpm_values = []
        for m in valid_markers:
            phases = m['phases']
            fft_d  = m['fft']
            p      = f"маркер{m['index'] + 1}"
            if phases.get('циклы_обнаружены'):
                for field in ('частота_bpm', 'амплитуда_среднее_мм', 'амплитуда_максимум_мм',
                              'амплитуда_минимум_мм', 'амплитуда_std_мм',
                              'индекс_регулярности', 'ie_ratio',
                              'количество_апноэ_событий', 'rmssd_вариабельность',
                              'количество_циклов'):
                    result[f'{p}_{field}'] = phases.get(field, 0)
                bpm = phases.get('частота_bpm', 0)
                if bpm > 0:
                    bpm_values.append(bpm)
            if fft_d.get('dominant_freq_bpm'):
                result[f'{p}_fft_частота_bpm']      = fft_d['dominant_freq_bpm']
                result[f'{p}_fft_мощность_дыхания'] = fft_d.get('breath_power_ratio', 0)
                result[f'{p}_fft_snr_db']           = fft_d.get('snr_db', 0)
        if bpm_values:
            result['среднее_bpm_все_маркеры'] = float(np.mean(bpm_values))
            result['std_bpm_все_маркеры']     = float(np.std(bpm_values))
        result['дыхание_обнаружено'] = len(bpm_values) > 0
        return result

    def _aggregate_temporal(self, valid_markers: List[Dict]) -> Dict:
        result = {}
        for m in valid_markers:
            raw = m['raw']
            p   = f"маркер{m['index'] + 1}"
            if len(raw) > 1:
                deriv = np.diff(raw)
                result[f'{p}_макс_скорость_мм']    = float(np.max(np.abs(deriv)))
                result[f'{p}_средн_скорость_мм']   = float(np.mean(np.abs(deriv)))
                result[f'{p}_нестабильность_cv']   = (
                    float(np.std(raw) / np.mean(raw) * 100) if np.mean(raw) > 0 else 0
                )
        return result

    def _calculate_statistical_metrics(self) -> Dict:
        all_data = []
        for h in self.width_history:
            all_data.extend(list(h))
        if not all_data:
            return {}
        arr = np.array(all_data)
        return {
            'всего_измерений':                    len(arr),
            'глобальное_среднее_мм':              float(np.mean(arr)),
            'глобальная_медиана_мм':              float(np.median(arr)),
            'глобальный_std_мм':                  float(np.std(arr)),
            'глобальный_мин_мм':                  float(np.min(arr)),
            'глобальный_макс_мм':                 float(np.max(arr)),
            'глобальный_диапазон_мм':             float(np.max(arr) - np.min(arr)),
            'глобальный_cv_проц':                 float(np.std(arr) / np.mean(arr) * 100)
                                                  if np.mean(arr) > 0 else 0,
            'доверительный_интервал_95_нижний':   float(np.percentile(arr, 2.5)),
            'доверительный_интервал_95_верхний':  float(np.percentile(arr, 97.5)),
            'надежность_индекс':                  self._calculate_reliability_score(),
            'качество_данных_индекс':             self._calculate_data_quality(),
        }

    def _calculate_clinical_indicators(self, valid_markers: List[Dict]) -> Dict:
        indicators = {}
        means = [np.mean(m['clean']) for m in valid_markers]

        if len(means) >= 2:
            indicators['соотношение_маркер1_маркер2'] = self._safe_divide(means[0], means[1])
        if len(means) >= 3:
            indicators['соотношение_маркер1_маркер3'] = self._safe_divide(means[0], means[2])
            indicators['соотношение_маркер2_маркер3'] = self._safe_divide(means[1], means[2])

        if len(valid_markers) >= 2:
            vars_ = [np.var(m['clean']) for m in valid_markers]
            indicators['доминирование_первого_маркера'] = self._safe_divide(vars_[0], sum(vars_))
            indicators['координация_маркеров_1_2'] = self._correlation_between(
                valid_markers[0]['clean'], valid_markers[1]['clean']
            )
        if len(valid_markers) >= 3:
            indicators['координация_маркеров_1_3'] = self._correlation_between(
                valid_markers[0]['clean'], valid_markers[2]['clean']
            )
            indicators['координация_маркеров_2_3'] = self._correlation_between(
                valid_markers[1]['clean'], valid_markers[2]['clean']
            )

        amplitudes = [
            m['phases']['амплитуда_среднее_мм']
            for m in valid_markers
            if m['phases'].get('амплитуда_среднее_мм')
        ]
        if amplitudes:
            indicators['средняя_амплитуда_дыхания_мм']     = float(np.mean(amplitudes))
            indicators['максимальная_амплитуда_дыхания_мм'] = float(np.max(amplitudes))
            indicators['минимальная_амплитуда_дыхания_мм'] = float(np.min(amplitudes))

        return indicators

    def _comparative_analysis(self, valid_markers: List[Dict]) -> Dict:
        if len(valid_markers) < 2:
            return {}
        result = {}
        for i in range(len(valid_markers)):
            for j in range(i + 1, len(valid_markers)):
                m1  = valid_markers[i]
                m2  = valid_markers[j]
                key = f"маркер{m1['index'] + 1}_vs_маркер{m2['index'] + 1}"

                result[f'{key}_корреляция'] = self._correlation_between(
                    m1['clean'], m2['clean']
                )
                result[f'{key}_разница_средних_мм'] = float(
                    abs(np.mean(m1['clean']) - np.mean(m2['clean']))
                )
                bpm1 = m1['phases'].get('частота_bpm', 0)
                bpm2 = m2['phases'].get('частота_bpm', 0)
                if bpm1 > 0 and bpm2 > 0:
                    result[f'{key}_разница_bpm'] = float(abs(bpm1 - bpm2))

                amp1 = m1['phases'].get('амплитуда_среднее_мм', 0)
                amp2 = m2['phases'].get('амплитуда_среднее_мм', 0)
                if amp1 > 0 and amp2 > 0:
                    result[f'{key}_разница_амплитуд_мм'] = float(abs(amp1 - amp2))

                result[f'{key}_фазовый_сдвиг_кадров'] = self._phase_shift(
                    m1['clean'], m2['clean']
                )
        return result

    # ──────────────────────────────────────────────────────────
    # УТИЛИТЫ
    # ──────────────────────────────────────────────────────────

    def _correlation_between(self, d1: np.ndarray, d2: np.ndarray) -> float:
        try:
            n = min(len(d1), len(d2))
            if n < 5:
                return 0.0
            c = np.corrcoef(d1[:n], d2[:n])[0, 1]
            return float(c) if not np.isnan(c) else 0.0
        except Exception:
            return 0.0

    def _phase_shift(self, d1: np.ndarray, d2: np.ndarray) -> float:
        try:
            n  = min(len(d1), len(d2))
            if n < 10:
                return 0.0
            s1 = d1[:n] - np.mean(d1[:n])
            s2 = d2[:n] - np.mean(d2[:n])
            cc = np.correlate(s1, s2, mode='full')
            return float(int(np.argmax(cc) - (n - 1)))
        except Exception:
            return 0.0

    def _safe_divide(self, num: float, denom: float) -> float:
        return float(num / denom) if denom != 0 else 0.0

    def _calculate_reliability_score(self) -> float:
        scores = []
        for h in self.width_history:
            if len(h) > 10:
                d  = np.array(list(h))
                cv = np.std(d) / (np.mean(d) + 1e-10)
                scores.append(max(0.0, 1.0 - cv))
        return float(np.mean(scores)) if scores else 0.0

    def _calculate_data_quality(self) -> float:
        q = [min(1.0, len(h) / 200.0) for h in self.width_history if len(h) > 0]
        return float(np.mean(q)) if q else 0.0

    # ──────────────────────────────────────────────────────────
    # ГРАФИКИ
    # ──────────────────────────────────────────────────────────

    def plot_patient_graphs(self, output_dir: str = 'medical_reports') -> List[str]:
        os.makedirs(output_dir, exist_ok=True)
        pid   = self.patient_data['patient_id']
        saved = []

        valid_data = [
            (i, np.array(list(h)))
            for i, h in enumerate(self.width_history)
            if len(h) >= 10
        ]
        if not valid_data:
            logger.warning("Недостаточно данных для графиков")
            return saved

        for fn in (
            self._plot_overview,
            self._plot_fft_spectra,
        ):
            p = fn(valid_data, pid, output_dir)
            if p:
                saved.append(p)

        for i, data in valid_data:
            p = self._plot_marker_detail(i, data, pid, output_dir)
            if p:
                saved.append(p)

        if valid_data:
            p = self._plot_frame_sampling_comparison(
                valid_data[0][0], pid, output_dir
            )
            if p:
                saved.append(p)

        if len(valid_data) >= 2:
            p = self._plot_comparative(valid_data, pid, output_dir)
            if p:
                saved.append(p)

        p = self._plot_dashboard(valid_data, pid, output_dir)
        if p:
            saved.append(p)

        logger.info("Сохранено %d графиков", len(saved))
        return saved

    # -- Обзорный --

    def _plot_overview(self, valid_data, pid, output_dir):
        try:
            fig, axes = plt.subplots(
                len(valid_data), 1,
                figsize=(16, 4 * len(valid_data)),
                sharex=False,
            )
            if len(valid_data) == 1:
                axes = [axes]

            fig.suptitle(
                f'Анализ дыхательной динамики — {pid}\n'
                f'Пациент: {self.patient_data["patient_name"]} | '
                f'Дата: {self.patient_data["recording_date"][:10]}',
                fontsize=14, fontweight='bold', y=1.02,
            )

            for ax, (i, raw) in zip(axes, valid_data):
                color   = self.marker_colors[i]
                frames  = np.arange(len(raw))
                clean   = self._remove_outliers(raw)
                smoothed = self._smooth_savgol(clean)
                mean_val = np.mean(clean)

                ax.fill_between(frames, mean_val, smoothed,
                                where=(smoothed >= mean_val),
                                alpha=0.3, color=color)
                ax.fill_between(frames, mean_val, smoothed,
                                where=(smoothed < mean_val),
                                alpha=0.3, color='lightblue')
                ax.plot(frames, raw, color=color, alpha=0.2, linewidth=0.8)
                ax.plot(frames, smoothed, color=color, linewidth=2.0,
                        label=f'{self.marker_names[i]} (сглаженный)')
                ax.axhline(mean_val, color='black', linestyle='--',
                           linewidth=1.2, alpha=0.7,
                           label=f'Среднее: {mean_val:.1f} мм')
                ax.axhline(np.min(clean), color='blue', linestyle=':',
                           linewidth=1.0, alpha=0.6,
                           label=f'Мин: {np.min(clean):.1f} мм')
                ax.axhline(np.max(clean), color='red', linestyle=':',
                           linewidth=1.0, alpha=0.6,
                           label=f'Макс: {np.max(clean):.1f} мм')

                phases = self._detect_breath_phases(
                    clean, frames.astype(float)
                )
                if phases.get('индексы_пиков'):
                    pk = [p for p in phases['индексы_пиков']  if p < len(smoothed)]
                    vl = [v for v in phases['индексы_впадин'] if v < len(smoothed)]
                    ax.scatter(pk, smoothed[pk], color='red',  zorder=5,
                               s=40, marker='^', label=f'Вдохи ({len(pk)})')
                    ax.scatter(vl, smoothed[vl], color='blue', zorder=5,
                               s=40, marker='v', label=f'Выдохи ({len(vl)})')

                ax.set_ylabel('Ширина, мм', fontsize=10)
                ax.set_title(f'Маркер {i + 1}: {self.marker_names[i]}', fontsize=11)
                ax.legend(loc='upper right', fontsize=8, ncol=3)
                ax.grid(True, linestyle='--', alpha=0.5)
                ax.text(0.01, 0.02,
                        f'n={len(raw)} | μ={mean_val:.1f} | '
                        f'σ={np.std(clean):.1f} | '
                        f'[{np.min(clean):.1f}; {np.max(clean):.1f}]',
                        transform=ax.transAxes, fontsize=8,
                        color='gray', verticalalignment='bottom')

            axes[-1].set_xlabel('Номер измерения', fontsize=10)
            plt.tight_layout()
            path = f'{output_dir}/{pid}_overview.png'
            plt.savefig(path, dpi=150, bbox_inches='tight')
            plt.close()
            return path
        except Exception as e:
            logger.error("Ошибка обзорного графика: %s", e)
            plt.close('all')
            return None

    # -- Детальный --

    def _plot_marker_detail(self, marker_idx, raw, pid, output_dir):
        try:
            fig = plt.figure(figsize=(16, 10))
            gs  = gridspec.GridSpec(3, 3, figure=fig, hspace=0.4, wspace=0.4)

            color    = self.marker_colors[marker_idx]
            name     = self.marker_names[marker_idx]
            frames   = np.arange(len(raw))
            clean    = self._remove_outliers(raw)
            smoothed = self._smooth_savgol(clean)

            # Основной сигнал
            ax_main = fig.add_subplot(gs[0, :])
            ax_main.plot(frames, raw,      color=color, alpha=0.3, linewidth=0.8, label='Исходный')
            ax_main.plot(frames, smoothed, color=color, linewidth=2.0,            label='Сглаженный')

            phases = self._detect_breath_phases(clean, frames.astype(float))
            if phases.get('индексы_пиков') and phases.get('индексы_впадин'):
                pk = [p for p in phases['индексы_пиков']  if p < len(smoothed)]
                vl = [v for v in phases['индексы_впадин'] if v < len(smoothed)]
                ax_main.scatter(pk, smoothed[pk], color='red',  s=50, zorder=5,
                                label=f'Вдохи ({len(pk)})', marker='^')
                ax_main.scatter(vl, smoothed[vl], color='blue', s=50, zorder=5,
                                label=f'Выдохи ({len(vl)})', marker='v')

            mean_v = np.mean(clean)
            std_v  = np.std(clean)
            ax_main.axhline(mean_v, color='black', linestyle='--',
                            linewidth=1.5, label=f'Среднее: {mean_v:.2f} мм')
            ax_main.fill_between(frames, mean_v - std_v, mean_v + std_v,
                                 alpha=0.1, color='gray', label=f'±σ ({std_v:.2f} мм)')
            ax_main.set_title(f'Маркер {marker_idx + 1}: {name} — {pid}',
                              fontsize=12, fontweight='bold')
            ax_main.set_xlabel('Измерение')
            ax_main.set_ylabel('Ширина, мм')
            ax_main.legend(fontsize=8, ncol=4, loc='upper right')
            ax_main.grid(True, linestyle='--', alpha=0.4)

            # Гистограмма
            ax_hist = fig.add_subplot(gs[1, 0])
            ax_hist.hist(clean, bins=30, color=color, alpha=0.7, edgecolor='white')
            ax_hist.axvline(mean_v,          color='red',    linestyle='--',
                            linewidth=1.5, label=f'μ={mean_v:.1f}')
            ax_hist.axvline(np.median(clean), color='orange', linestyle='-.',
                            linewidth=1.5, label=f'Md={np.median(clean):.1f}')
            ax_hist.set_title('Распределение', fontsize=10)
            ax_hist.legend(fontsize=8)
            ax_hist.grid(True, alpha=0.3)

            # Box plot
            ax_box = fig.add_subplot(gs[1, 1])
            ax_box.boxplot(clean, patch_artist=True,
                           boxprops=dict(facecolor=color, alpha=0.6),
                           medianprops=dict(color='black', linewidth=2))
            p25, p50, p75 = np.percentile(clean, [25, 50, 75])
            ax_box.text(1.1, p25, f'P25: {p25:.1f}', fontsize=8, va='center')
            ax_box.text(1.1, p50, f'P50: {p50:.1f}', fontsize=8, va='center')
            ax_box.text(1.1, p75, f'P75: {p75:.1f}', fontsize=8, va='center')
            ax_box.set_title('Box Plot', fontsize=10)
            ax_box.grid(True, alpha=0.3)

            # Производная
            ax_deriv = fig.add_subplot(gs[1, 2])
            deriv = np.diff(smoothed)
            ax_deriv.plot(deriv, color='purple', linewidth=1.0, alpha=0.8)
            ax_deriv.axhline(0, color='black', linestyle='--', linewidth=1)
            ax_deriv.fill_between(range(len(deriv)), 0, deriv,
                                  where=(np.array(deriv) > 0),
                                  alpha=0.3, color='red', label='Вдох')
            ax_deriv.fill_between(range(len(deriv)), 0, deriv,
                                  where=(np.array(deriv) < 0),
                                  alpha=0.3, color='blue', label='Выдох')
            ax_deriv.set_title('Скорость изменения', fontsize=10)
            ax_deriv.legend(fontsize=8)
            ax_deriv.grid(True, alpha=0.3)

            # Таблица
            ax_table = fig.add_subplot(gs[2, :])
            ax_table.axis('off')
            table_data = [
                ['Параметр', 'Значение', 'Параметр', 'Значение'],
                ['Среднее',   f'{mean_v:.2f} мм',
                 'Мин',       f'{np.min(clean):.2f} мм'],
                ['Медиана',   f'{np.median(clean):.2f} мм',
                 'Макс',      f'{np.max(clean):.2f} мм'],
                ['Std (σ)',   f'{std_v:.2f} мм',
                 'Диапазон',  f'{np.max(clean) - np.min(clean):.2f} мм'],
                ['CV (%)',    f'{std_v / mean_v * 100:.1f}%',
                 'IQR',       f'{np.percentile(clean, 75) - np.percentile(clean, 25):.2f} мм'],
                ['Асимметрия', f'{stats.skew(clean):.3f}',
                 'Эксцесс',   f'{stats.kurtosis(clean):.3f}'],
                ['P5',        f'{np.percentile(clean, 5):.2f} мм',
                 'P95',       f'{np.percentile(clean, 95):.2f} мм'],
                ['Измерений', str(len(raw)),
                 'Тренд',     f'{self._linear_trend(clean):.4f}'],
            ]
            if phases.get('циклы_обнаружены'):
                table_data += [
                    ['Частота (BPM)', f'{phases.get("частота_bpm", 0):.1f}',
                     'Амплитуда',    f'{phases.get("амплитуда_среднее_мм", 0):.2f} мм'],
                    ['I:E ratio',    f'{phases.get("ie_ratio", 0):.2f}',
                     'Регулярность', f'{phases.get("индекс_регулярности", 0):.3f}'],
                    ['Амп. МАКС',   f'{phases.get("амплитуда_максимум_мм", 0):.2f} мм',
                     'Амп. МИН',    f'{phases.get("амплитуда_минимум_мм", 0):.2f} мм'],
                ]
            tbl = ax_table.table(
                cellText=table_data[1:], colLabels=table_data[0],
                cellLoc='center', loc='center', bbox=[0, 0, 1, 1],
            )
            tbl.auto_set_font_size(False)
            tbl.set_fontsize(9)
            for j in range(4):
                tbl[0, j].set_facecolor('#2196F3')
                tbl[0, j].set_text_props(color='white', fontweight='bold')
            for r in range(1, len(table_data)):
                for c in range(4):
                    if r % 2 == 0:
                        tbl[r, c].set_facecolor('#F5F5F5')
            ax_table.set_title('Статистическая сводка', fontsize=10, fontweight='bold')

            path = f'{output_dir}/{pid}_marker_{marker_idx + 1}_detail.png'
            plt.savefig(path, dpi=150, bbox_inches='tight')
            plt.close()
            return path
        except Exception as e:
            logger.error("Ошибка детального графика маркера %d: %s", marker_idx, e)
            plt.close('all')
            return None

    # -- FFT --

    def _plot_fft_spectra(self, valid_data, pid, output_dir):
        try:
            n    = len(valid_data)
            fig, axes = plt.subplots(n, 1, figsize=(14, 4 * n))
            if n == 1:
                axes = [axes]
            fig.suptitle(f'FFT Частотный анализ — {pid}',
                         fontsize=14, fontweight='bold')

            for ax, (i, raw) in zip(axes, valid_data):
                color   = self.marker_colors[i]
                clean   = self._remove_outliers(raw)
                fft_d   = self._fft_analysis(clean, fs=10.0)

                if not fft_d:
                    ax.text(0.5, 0.5, 'Недостаточно данных',
                            ha='center', va='center', transform=ax.transAxes)
                    continue

                freqs    = np.array(fft_d['fft_freqs'])
                fft_vals = np.array(fft_d['fft_vals'])
                mask     = (freqs > 0) & (freqs <= 2.0)

                ax.plot(freqs[mask] * 60, fft_vals[mask], color=color, linewidth=1.5)
                ax.fill_between(freqs[mask] * 60, 0, fft_vals[mask], alpha=0.3, color=color)
                ax.axvspan(6, 48, alpha=0.1, color='green', label='Зона дыхания (6-48 вд/мин)')

                dom = fft_d.get('dominant_freq_bpm', 0)
                if dom > 0:
                    ax.axvline(dom, color='red', linestyle='--', linewidth=2,
                               label=f'Доминирующая: {dom:.1f} вд/мин')

                snr   = fft_d.get('snr_db', 0)
                ratio = fft_d.get('breath_power_ratio', 0)
                ax.text(0.02, 0.95,
                        f'SNR: {snr:.1f} dB | Дых. мощность: {ratio * 100:.1f}%',
                        transform=ax.transAxes, fontsize=9, verticalalignment='top',
                        bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

                ax.set_title(f'Маркер {i + 1}: {self.marker_names[i]}', fontsize=11)
                ax.set_xlabel('Частота (вдохов/мин)')
                ax.set_ylabel('Амплитуда')
                ax.legend(fontsize=9, loc='upper right')
                ax.grid(True, linestyle='--', alpha=0.5)
                ax.set_xlim(0, 60)

            plt.tight_layout()
            path = f'{output_dir}/{pid}_fft_spectra.png'
            plt.savefig(path, dpi=150, bbox_inches='tight')
            plt.close()
            return path
        except Exception as e:
            logger.error("Ошибка FFT графика: %s", e)
            plt.close('all')
            return None

    # -- Сравнительный --

    def _plot_comparative(self, valid_data, pid, output_dir):
        try:
            fig, axes = plt.subplots(2, 2, figsize=(16, 10))
            fig.suptitle(f'Сравнительный анализ маркеров — {pid}',
                         fontsize=14, fontweight='bold')

            # Нормализованные сигналы
            ax = axes[0, 0]
            for i, raw in valid_data:
                clean    = self._remove_outliers(raw)
                smoothed = self._smooth_savgol(clean)
                norm     = (smoothed - smoothed.min()) / (smoothed.max() - smoothed.min() + 1e-10)
                ax.plot(norm, color=self.marker_colors[i], linewidth=1.5, alpha=0.8,
                        label=f'М{i + 1}: {self.marker_names[i]}')
            ax.set_title('Нормализованные сигналы')
            ax.legend(fontsize=9)
            ax.grid(True, alpha=0.4)

            # Scatter
            ax = axes[0, 1]
            if len(valid_data) >= 2:
                i1, d1 = valid_data[0]
                i2, d2 = valid_data[1]
                n      = min(len(d1), len(d2))
                c1     = self._remove_outliers(d1[:n])
                c2     = self._remove_outliers(d2[:n])
                sc     = ax.scatter(c1, c2, c=range(n), cmap='viridis', alpha=0.5, s=10)
                plt.colorbar(sc, ax=ax, label='Время (кадр)')
                corr   = self._correlation_between(c1, c2)
                ax.set_title(f'М{i1 + 1} vs М{i2 + 1} (r={corr:.3f})')
                ax.grid(True, alpha=0.4)

            # Box plots
            ax = axes[1, 0]
            data_b  = [self._remove_outliers(d) for _, d in valid_data]
            labels_b = [f'М{i + 1}' for i, _ in valid_data]
            bp = ax.boxplot(data_b, patch_artist=True, labels=labels_b)
            for patch, (i, _) in zip(bp['boxes'], valid_data):
                patch.set_facecolor(self.marker_colors[i])
                patch.set_alpha(0.7)
            ax.set_title('Box Plot сравнение')
            ax.grid(True, alpha=0.4)

            # Амплитуды
            ax = axes[1, 1]
            amps, amp_labels = [], []
            for i, raw in valid_data:
                clean  = self._remove_outliers(raw)
                phases = self._detect_breath_phases(
                    clean, np.arange(len(clean), dtype=float)
                )
                if phases.get('амплитуда_среднее_мм'):
                    amps.append([
                        phases['амплитуда_минимум_мм'],
                        phases['амплитуда_среднее_мм'],
                        phases['амплитуда_максимум_мм'],
                    ])
                    amp_labels.append(f'М{i + 1}: {self.marker_names[i]}')
            if amps:
                x     = np.arange(len(amps))
                means = [a[1] for a in amps]
                mins  = [a[0] for a in amps]
                maxs  = [a[2] for a in amps]
                bars  = ax.bar(x, means,
                               color=[self.marker_colors[valid_data[j][0]] for j in range(len(x))],
                               alpha=0.7)
                ax.errorbar(x, means,
                            yerr=[np.array(means) - np.array(mins),
                                  np.array(maxs)  - np.array(means)],
                            fmt='none', color='black', capsize=5, linewidth=2)
                ax.set_xticks(x)
                ax.set_xticklabels(amp_labels, rotation=15, fontsize=8)
                ax.set_title('Амплитуды дыхания')
                ax.set_ylabel('Амплитуда, мм')
                ax.grid(True, alpha=0.4, axis='y')
                for bar, mean in zip(bars, means):
                    ax.text(bar.get_x() + bar.get_width() / 2,
                            bar.get_height() + 0.5,
                            f'{mean:.1f}', ha='center', va='bottom', fontsize=9)

            plt.tight_layout()
            path = f'{output_dir}/{pid}_comparative.png'
            plt.savefig(path, dpi=150, bbox_inches='tight')
            plt.close()
            return path
        except Exception as e:
            logger.error("Ошибка сравнительного графика: %s", e)
            plt.close('all')
            return None

    # -- Дашборд --

    def _plot_dashboard(self, valid_data, pid, output_dir):
        try:
            fig = plt.figure(figsize=(20, 14))
            gs  = gridspec.GridSpec(4, 4, figure=fig, hspace=0.5, wspace=0.4)
            fig.patch.set_facecolor('#1E1E2E')

            fig.suptitle(
                f'МЕДИЦИНСКИЙ ОТЧЁТ — АНАЛИЗ ДЫХАНИЯ\n'
                f'Пациент: {self.patient_data["patient_name"]} | '
                f'ID: {pid} | '
                f'Дата: {self.patient_data["recording_date"][:10]}',
                fontsize=13, fontweight='bold', color='white', y=0.98,
            )

            # Сигналы
            ax_sig = fig.add_subplot(gs[0, :3])
            ax_sig.set_facecolor('#2A2A3E')
            for i, raw in valid_data:
                clean  = self._remove_outliers(raw)
                smooth = self._smooth_savgol(clean)
                ax_sig.plot(smooth, color=self.marker_colors[i], linewidth=1.5,
                            alpha=0.9, label=f'М{i + 1}: {self.marker_names[i]}')
            ax_sig.set_title('Дыхательные сигналы (сглаженные)', color='white', fontsize=11)
            ax_sig.legend(fontsize=9, facecolor='#2A2A3E', labelcolor='white')
            ax_sig.grid(True, alpha=0.2, color='gray')
            ax_sig.tick_params(colors='gray')
            for sp in ax_sig.spines.values():
                sp.set_edgecolor('#444')

            # KPI
            kpi_ax = fig.add_subplot(gs[0, 3])
            kpi_ax.set_facecolor('#2A2A3E')
            kpi_ax.axis('off')
            kpi_bpm = kpi_amp = kpi_cycles = 0
            for i, raw in valid_data:
                clean  = self._remove_outliers(raw)
                phases = self._detect_breath_phases(
                    clean, np.arange(len(clean), dtype=float)
                )
                if phases.get('частота_bpm', 0) > 0:
                    kpi_bpm    = phases['частота_bpm']
                    kpi_amp    = phases.get('амплитуда_среднее_мм', 0)
                    kpi_cycles = phases.get('количество_циклов', 0)
                    break
            kpi_ax.text(0.5, 0.92, 'KPI', ha='center', va='top',
                        fontsize=12, color='white', fontweight='bold',
                        transform=kpi_ax.transAxes)
            for idx, (lbl, val, col) in enumerate([
                ('BPM',       f'{kpi_bpm:.1f}',     '#FF6B6B'),
                ('Амплитуда', f'{kpi_amp:.1f} мм',  '#4ECDC4'),
                ('Циклов',    str(kpi_cycles),       '#45B7D1'),
                ('Маркеров',  str(len(valid_data)),  '#FFA07A'),
                ('Измерений', str(sum(len(list(h)) for h in self.width_history)), '#98FB98'),
            ]):
                y = 0.78 - idx * 0.17
                kpi_ax.text(0.1, y, lbl, ha='left', color='gray', fontsize=9,
                            transform=kpi_ax.transAxes)
                kpi_ax.text(0.9, y, val, ha='right', color=col,
                            fontsize=12, fontweight='bold', transform=kpi_ax.transAxes)

            # FFT строка
            for idx, (i, raw) in enumerate(valid_data[:3]):
                ax_fft = fig.add_subplot(gs[1, idx])
                ax_fft.set_facecolor('#2A2A3E')
                clean = self._remove_outliers(raw)
                fft_d = self._fft_analysis(clean, fs=10.0)
                if fft_d:
                    freqs = np.array(fft_d['fft_freqs'])
                    vals  = np.array(fft_d['fft_vals'])
                    mask  = (freqs > 0) & (freqs <= 1.0)
                    ax_fft.plot(freqs[mask] * 60, vals[mask],
                                color=self.marker_colors[i], linewidth=1.5)
                    ax_fft.fill_between(freqs[mask] * 60, 0, vals[mask],
                                        alpha=0.3, color=self.marker_colors[i])
                    dom = fft_d.get('dominant_freq_bpm', 0)
                    if dom > 0:
                        ax_fft.axvline(dom, color='white', linestyle='--',
                                       linewidth=1, label=f'{dom:.1f} вд/мин')
                ax_fft.set_title(f'FFT М{i + 1}', color='white', fontsize=9)
                ax_fft.tick_params(colors='gray', labelsize=7)
                ax_fft.legend(fontsize=7, facecolor='#2A2A3E', labelcolor='white')
                ax_fft.grid(True, alpha=0.2, color='gray')
                for sp in ax_fft.spines.values():
                    sp.set_edgecolor('#444')

            # Глобальная статистика
            ax_gs = fig.add_subplot(gs[1, 3])
            ax_gs.set_facecolor('#2A2A3E')
            ax_gs.axis('off')
            all_v = [v for h in self.width_history for v in list(h)]
            if all_v:
                arr = np.array(all_v)
                ax_gs.text(0.5, 0.95, 'Глоб. статистика', ha='center', va='top',
                           fontsize=9, color='white', fontweight='bold',
                           transform=ax_gs.transAxes)
                for idx, (lbl, val) in enumerate([
                    ('Глоб. среднее', f'{np.mean(arr):.1f} мм'),
                    ('Глоб. std',     f'{np.std(arr):.1f} мм'),
                    ('Глоб. мин',     f'{np.min(arr):.1f} мм'),
                    ('Глоб. макс',    f'{np.max(arr):.1f} мм'),
                    ('Всего изм.',    str(len(arr))),
                ]):
                    y = 0.82 - idx * 0.16
                    ax_gs.text(0.1, y, lbl, ha='left', color='gray', fontsize=8,
                               transform=ax_gs.transAxes)
                    ax_gs.text(0.9, y, val, ha='right', color='#4ECDC4',
                               fontsize=9, fontweight='bold', transform=ax_gs.transAxes)

            # Мини-бары по маркерам
            for idx, (i, raw) in enumerate(valid_data[:3]):
                ax_d = fig.add_subplot(gs[2, idx])
                ax_d.set_facecolor('#2A2A3E')
                clean = self._remove_outliers(raw)
                lbls  = ['Мин', 'P25', 'Ср', 'P75', 'Макс']
                vals  = [np.min(clean), np.percentile(clean, 25),
                         np.mean(clean), np.percentile(clean, 75), np.max(clean)]
                cols  = ['#FF6B6B', '#FFA07A', '#4ECDC4', '#FFA07A', '#FF6B6B']
                bars  = ax_d.bar(lbls, vals, color=cols, alpha=0.8)
                for bar, v in zip(bars, vals):
                    ax_d.text(bar.get_x() + bar.get_width() / 2,
                              bar.get_height() + 0.2,
                              f'{v:.1f}', ha='center', va='bottom',
                              fontsize=7, color='white')
                ax_d.set_title(f'М{i + 1}: {self.marker_names[i]}',
                               color='white', fontsize=9)
                ax_d.tick_params(colors='gray', labelsize=7)
                ax_d.grid(True, alpha=0.2, color='gray', axis='y')
                for sp in ax_d.spines.values():
                    sp.set_edgecolor('#444')

            # Амплитуды
            ax_amp = fig.add_subplot(gs[2, 3])
            ax_amp.set_facecolor('#2A2A3E')
            amp_data, amp_labels = [], []
            for i, raw in valid_data:
                clean  = self._remove_outliers(raw)
                phases = self._detect_breath_phases(
                    clean, np.arange(len(clean), dtype=float)
                )
                if phases.get('амплитуда_среднее_мм'):
                    amp_data.append((
                        phases['амплитуда_минимум_мм'],
                        phases['амплитуда_среднее_мм'],
                        phases['амплитуда_максимум_мм'],
                    ))
                    amp_labels.append(f'М{i + 1}')
            if amp_data:
                x_a   = np.arange(len(amp_data))
                means = [a[1] for a in amp_data]
                mins  = [a[0] for a in amp_data]
                maxs  = [a[2] for a in amp_data]
                ax_amp.bar(x_a, means,
                           color=[self.marker_colors[valid_data[j][0]] for j in range(len(x_a))],
                           alpha=0.7)
                ax_amp.errorbar(x_a, means,
                                yerr=[np.array(means) - np.array(mins),
                                      np.array(maxs) - np.array(means)],
                                fmt='none', color='white', capsize=4, linewidth=1.5)
                ax_amp.set_xticks(x_a)
                ax_amp.set_xticklabels(amp_labels, color='gray')
                ax_amp.set_title('Амплитуды\n(мин-среднее-макс)', color='white', fontsize=9)
                ax_amp.tick_params(colors='gray', labelsize=8)
                ax_amp.grid(True, alpha=0.2, color='gray', axis='y')
                for sp in ax_amp.spines.values():
                    sp.set_edgecolor('#444')

            # Производные
            for idx, (i, raw) in enumerate(valid_data[:3]):
                ax_t = fig.add_subplot(gs[3, idx])
                ax_t.set_facecolor('#2A2A3E')
                clean = self._remove_outliers(raw)
                smooth = self._smooth_savgol(clean)
                deriv  = np.diff(smooth)
                ax_t.fill_between(range(len(deriv)), 0, deriv,
                                  where=(np.array(deriv) >= 0),
                                  alpha=0.7, color='#FF6B6B', label='Вдох')
                ax_t.fill_between(range(len(deriv)), 0, deriv,
                                  where=(np.array(deriv) < 0),
                                  alpha=0.7, color='#45B7D1', label='Выдох')
                ax_t.axhline(0, color='white', linewidth=0.8, alpha=0.5)
                ax_t.set_title(f'М{i + 1}: Вдох/Выдох', color='white', fontsize=9)
                ax_t.tick_params(colors='gray', labelsize=7)
                ax_t.legend(fontsize=7, facecolor='#2A2A3E', labelcolor='white')
                ax_t.grid(True, alpha=0.2, color='gray')
                for sp in ax_t.spines.values():
                    sp.set_edgecolor('#444')

            # Корреляции
            ax_corr = fig.add_subplot(gs[3, 3])
            ax_corr.set_facecolor('#2A2A3E')
            n = len(valid_data)
            if n >= 2:
                cleaned = [self._remove_outliers(d) for _, d in valid_data]
                C = np.eye(n)
                for r in range(n):
                    for c in range(n):
                        if r != c:
                            C[r, c] = self._correlation_between(cleaned[r], cleaned[c])
                im = ax_corr.imshow(C, cmap='RdYlGn', vmin=-1, vmax=1, aspect='auto')
                plt.colorbar(im, ax=ax_corr, fraction=0.046, pad=0.04)
                lbls = [f'М{i + 1}' for i, _ in valid_data]
                ax_corr.set_xticks(range(n))
                ax_corr.set_yticks(range(n))
                ax_corr.set_xticklabels(lbls, color='gray', fontsize=8)
                ax_corr.set_yticklabels(lbls, color='gray', fontsize=8)
                for r in range(n):
                    for c in range(n):
                        ax_corr.text(c, r, f'{C[r, c]:.2f}',
                                     ha='center', va='center',
                                     fontsize=9, color='black', fontweight='bold')
            ax_corr.set_title('Корреляции\nмаркеров', color='white', fontsize=9)
            for sp in ax_corr.spines.values():
                sp.set_edgecolor('#444')

            path = f'{output_dir}/{pid}_dashboard.png'
            plt.savefig(path, dpi=150, bbox_inches='tight',
                        facecolor=fig.get_facecolor())
            plt.close()
            return path
        except Exception as e:
            logger.error("Ошибка дашборда: %s", e)
            plt.close('all')
            return None

    # -- Сравнение частот дискретизации --

    def _plot_frame_sampling_comparison(self, marker_idx, pid, output_dir):
        try:
            if len(self.raw_history[marker_idx]) < 30:
                return None

            raw_data  = np.array(list(self.raw_history[marker_idx]))
            raw_time  = np.array(list(self.raw_time[marker_idx]))
            fps       = self.patient_data.get('fps', 30.0)
            frame_nos = (raw_time * fps).astype(int) if len(raw_time) > 1 else np.arange(len(raw_data))
            clean     = self._remove_outliers(raw_data)

            sampling_rates = [
                {'skip': 3,  'color': '#2ECC71', 'label': 'Каждый 3-й  (10 Hz)'},
                {'skip': 4,  'color': '#F1C40F', 'label': 'Каждый 4-й  (7.5 Hz)'},
                {'skip': 6,  'color': '#E67E22', 'label': 'Каждый 6-й  (5 Hz)'},
                {'skip': 8,  'color': '#E74C3C', 'label': 'Каждый 8-й  (3.75 Hz)'},
                {'skip': 10, 'color': '#C0392B', 'label': 'Каждый 10-й (3 Hz)'},
            ]

            fig, axes = plt.subplots(
                len(sampling_rates), 1,
                figsize=(18, 3 * len(sampling_rates)),
                sharex=True,
            )
            fig.suptitle(
                f'Влияние частоты дискретизации\n'
                f'Пациент: {self.patient_data["patient_name"]} | '
                f'Маркер: {self.marker_names[marker_idx]} | ID: {pid}',
                fontsize=14, fontweight='bold', y=0.995,
            )

            ref_phases = self._detect_breath_phases(clean, frame_nos.astype(float))
            ref_cycles = ref_phases.get('количество_циклов', 0)

            for ax, sr in zip(axes, sampling_rates):
                skip    = sr['skip']
                color   = sr['color']
                label   = sr['label']
                idxs    = np.arange(0, len(clean), skip)
                s_data  = clean[idxs]
                s_frames = frame_nos[idxs]

                phases   = self._detect_breath_phases(s_data, s_frames.astype(float))
                detected = phases.get('количество_циклов', 0)
                missed   = max(0, ref_cycles - detected)

                ax.scatter(s_frames, s_data, color=color, s=20, alpha=0.6)
                ax.plot(s_frames, s_data, color=color, linewidth=1.5, alpha=0.8)
                ax.axhline(np.mean(s_data), color='black', linestyle='--',
                           linewidth=1.0, alpha=0.5)

                if phases.get('индексы_пиков'):
                    pk = [p for p in phases['индексы_пиков']  if p < len(s_data)]
                    vl = [v for v in phases['индексы_впадин'] if v < len(s_data)]
                    if pk:
                        ax.scatter(s_frames[pk], s_data[pk], color='red',  s=80, marker='^')
                    if vl:
                        ax.scatter(s_frames[vl], s_data[vl], color='blue', s=80, marker='v')

                eff_freq = fps / skip
                ax.set_title(
                    f'{label} — {len(s_data)} точек | '
                    f'эфф. частота: {eff_freq:.2f} Hz | '
                    f'циклов: {detected}/{ref_cycles}',
                    fontsize=10, fontweight='bold', color=color,
                )
                ax.set_facecolor('#FFF5F5' if missed > 0 else '#F0FFF0')
                ax.set_ylabel('мм')
                ax.grid(True, linestyle=':', alpha=0.4)

            axes[-1].set_xlabel('Номер кадра')
            plt.tight_layout()
            path = (
                f'{output_dir}/{pid}_frame_sampling_comparison'
                f'_marker{marker_idx + 1}.png'
            )
            plt.savefig(path, dpi=150, bbox_inches='tight')
            plt.close()
            return path
        except Exception as e:
            logger.error("Ошибка сравнения частот: %s", e)
            plt.close('all')
            return None


_COLOR_RANGES = {
    "red": {
        "lower1": np.array([0,   150, 100], dtype=np.uint8),
        "upper1": np.array([10,  255, 255], dtype=np.uint8),
        "lower2": np.array([170, 120,  70], dtype=np.uint8),
        "upper2": np.array([180, 255, 255], dtype=np.uint8),
    },
    "blue": {
        "lower1": np.array([100, 80,  40], dtype=np.uint8),
        "upper1": np.array([140, 255, 255], dtype=np.uint8),
        "lower2": np.array([90,  50,  30], dtype=np.uint8),
        "upper2": np.array([120, 255, 200], dtype=np.uint8),
    },
    "green": {
        "lower1": np.array([40,  50,  50], dtype=np.uint8),
        "upper1": np.array([80,  255, 255], dtype=np.uint8),
        "lower2": None,
        "upper2": None,
    },
}


class _ScaleConverter:
    def __init__(self, marker_size_mm: float, window: int = 30):
        self.marker_size_mm = marker_size_mm
        self._history: deque = deque(maxlen=window)
        self.pixels_per_mm: Optional[float] = None

    def update(self, sq_width_px: float):
        if sq_width_px > 0:
            self._history.append(sq_width_px / self.marker_size_mm)
            self.pixels_per_mm = float(np.mean(self._history))

    def px_to_mm(self, px: float) -> Optional[float]:
        if not self.pixels_per_mm:
            return None
        return px / self.pixels_per_mm

    @property
    def ready(self) -> bool:
        return self.pixels_per_mm is not None


class _MarkerTracker:
    def __init__(self, max_missing: int = 5, max_dist: int = 30):
        self.next_id   = 0
        self.markers: Dict[int, Dict] = {}
        self.max_miss  = max_missing
        self.max_dist  = max_dist

    def update(self, detected: List[Tuple]) -> List[Tuple]:
        for mid in [k for k, v in self.markers.items() if v['miss'] > self.max_miss]:
            del self.markers[mid]

        if not detected:
            for d in self.markers.values():
                d['miss'] += 1
            return []

        if not self.markers:
            res = []
            for m in detected:
                self._add(m)
                res.append((*m[:6], self.next_id - 1))
            return res

        ids   = list(self.markers.keys())
        D     = np.full((len(detected), len(ids)), 1e9)
        for i, m in enumerate(detected):
            for j, mid in enumerate(ids):
                p = self.markers[mid]['pos']
                D[i, j] = np.hypot(m[4] - p[0], m[5] - p[1])

        matched_d, matched_t = set(), set()
        result = []
        while True:
            flat = np.argmin(D)
            i, j = np.unravel_index(flat, D.shape)
            if D[i, j] > self.max_dist:
                break
            mid = ids[j]
            self.markers[mid]['pos']  = (detected[i][4], detected[i][5])
            self.markers[mid]['miss'] = 0
            matched_d.add(i)
            matched_t.add(j)
            result.append((*detected[i][:6], mid))
            D[i, :] = 1e9
            D[:, j] = 1e9

        for i, m in enumerate(detected):
            if i not in matched_d:
                self._add(m)
                result.append((*m[:6], self.next_id - 1))
        for j, mid in enumerate(ids):
            if j not in matched_t:
                self.markers[mid]['miss'] += 1
        return result

    def _add(self, m):
        self.markers[self.next_id] = {'pos': (m[4], m[5]), 'miss': 0}
        self.next_id += 1


class RespiratoryAnalysisService:
    """
    Сервис: читает видео, детектирует маркеры,
    передаёт данные в MedicalVideoAnalyzer,
    возвращает метрики и пути к графикам.
    """

    _processed_count = 0

    @classmethod
    def _inc(cls):
        cls._processed_count += 1

    @staticmethod
    def _segment_person(frame: np.ndarray) -> np.ndarray:
        lab  = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        h, w = lab.shape[:2]
        km   = KMeans(n_clusters=2, random_state=42, n_init=5)
        lbl  = km.fit_predict(lab.reshape(-1, 3).astype(np.float32))
        centers = km.cluster_centers_
        bg   = 0 if centers[0].sum() < centers[1].sum() else 1
        mask = (lbl != bg).astype(np.uint8).reshape(h, w)
        k    = np.ones((5, 5), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  k, iterations=2)
        return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)

    @staticmethod
    def _detect_markers(frame, color, min_area=25, ar_min=0.7, ar_max=1.4):
        cfg  = _COLOR_RANGES[color]
        hsv  = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, cfg["lower1"], cfg["upper1"])
        if cfg["lower2"] is not None:
            mask = cv2.bitwise_or(mask, cv2.inRange(hsv, cfg["lower2"], cfg["upper2"]))
        k    = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  k, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out = []
        for cnt in cnts:
            if cv2.contourArea(cnt) < min_area:
                continue
            x, y, ww, hh = cv2.boundingRect(cnt)
            if ar_min < ww / hh < ar_max:
                out.append((x, y, ww, hh, x + ww // 2, y + hh // 2))
        return out

    @staticmethod
    def _body_width(contour, y, img_shape):
        if y >= img_shape[0]:
            return None, None
        mask = np.zeros(img_shape[:2], dtype=np.uint8)
        cv2.drawContours(mask, [contour], -1, 255, -1)
        nz = np.nonzero(mask[y])[0]
        if len(nz) < 2:
            return None, None
        return int(nz[0]), int(nz[-1])

    @classmethod
    def analyze_video(
        cls,
        video_path: str,
        marker_color: str = "red",
        marker_size_mm: float = 18.0,
        progress_callback=None,
        patient_id: Optional[int] = None,
        analysis_id: Optional[int] = None,
        patient_name: str = "Не указано",
        patient_gender: str = "Не указан",
        patient_age=None,
    ) -> Dict[str, Any]:

        cls._inc()
        start = datetime.now()

        if not os.path.exists(video_path):
            raise ValueError(f"Файл не найден: {video_path}")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Не удалось открыть: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_fr = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_fr / fps

        pid_str  = str(patient_id) if patient_id else f"tmp_{uuid.uuid4().hex[:8]}"
        rec_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        med = MedicalVideoAnalyzer(num_lines=3, max_history=2000)
        med.set_patient_info(
            patient_id=pid_str,
            patient_name=patient_name,
            patient_gender=patient_gender,
            patient_age=patient_age,
            recording_date=rec_date,
            video_duration=duration,
            total_frames=total_fr,
            fps=fps,
        )

        scale   = _ScaleConverter(marker_size_mm, window=30)
        tracker = _MarkerTracker(max_missing=5, max_dist=30)
        frame_count = 0

        if progress_callback:
            progress_callback("Загрузка видео", 10, 0, total_fr)

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                frame_count += 1
                frame_time = frame_count / fps

                # Уменьшаем разрешение для скорости
                h, w = frame.shape[:2]
                if max(h, w) > 1280:
                    sf    = 1280 / max(h, w)
                    frame = cv2.resize(frame, (int(w * sf), int(h * sf)),
                                       interpolation=cv2.INTER_AREA)

                if progress_callback and frame_count % 15 == 0:
                    pct = min(10 + (frame_count / total_fr) * 70, 80)
                    progress_callback("Обработка видео", pct, frame_count, total_fr)

                # Сегментация
                try:
                    person_mask = cls._segment_person(frame)
                except Exception:
                    med.update([None, None, None], frame_time)
                    continue

                cnts, _ = cv2.findContours(
                    person_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
                )
                if not cnts:
                    med.update([None, None, None], frame_time)
                    continue

                person_cnt = max(cnts, key=cv2.contourArea)

                # Маркеры
                raw_m = cls._detect_markers(frame, marker_color)
                body_m = [
                    m for m in raw_m
                    if cv2.pointPolygonTest(
                        person_cnt, (float(m[4]), float(m[5])), False
                    ) >= 0
                ]

                if body_m:
                    med_sz = float(np.median([max(m[2], m[3]) for m in body_m]))
                    body_m = [m for m in body_m
                              if 0.5 * med_sz < max(m[2], m[3]) < 1.5 * med_sz]
                    scale.update(med_sz)

                tracked = tracker.update(body_m)
                tracked.sort(key=lambda m: (m[5], m[4]))

                widths: List[Optional[float]] = [None, None, None]
                for idx, m in enumerate(tracked[:3]):
                    _, _, _, _, cX, cY, _ = m
                    left, right = cls._body_width(person_cnt, cY, frame.shape)
                    if left is not None and right is not None and scale.ready:
                        widths[idx] = scale.px_to_mm(right - left)

                med.update(widths, frame_time)

        except Exception as e:
            logger.error("Ошибка цикла кадров: %s\n%s", e, traceback.format_exc())
            raise
        finally:
            cap.release()

        if progress_callback:
            progress_callback("Анализ данных", 82, frame_count, total_fr)

        med.set_patient_info(
            patient_id=pid_str,
            patient_name=patient_name,
            patient_gender=patient_gender,
            patient_age=patient_age,
            recording_date=rec_date,
            video_duration=frame_count / fps,
            total_frames=frame_count,
            fps=fps,
        )

        if patient_id is not None and analysis_id is not None:
            plots_dir = cls._plots_dir(patient_id, analysis_id)
        else:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            plots_dir = os.path.join(
                "static", "analysis_plots",
                f"analysis_{ts}_{uuid.uuid4().hex[:8]}"
            )
        os.makedirs(plots_dir, exist_ok=True)

        if progress_callback:
            progress_callback("Создание графиков", 87, frame_count, total_fr)

        graph_paths: List[str] = []
        try:
            graph_paths = med.plot_patient_graphs(output_dir=plots_dir)
        except Exception as e:
            logger.error("Ошибка графиков: %s", e)

        if progress_callback:
            progress_callback("Расчёт метрик", 92, frame_count, total_fr)

        try:
            metrics = med.calculate_comprehensive_metrics()
        except Exception as e:
            logger.error("Ошибка метрик: %s", e)
            metrics = {}

        plots = cls._map_plots(graph_paths)
        results = cls._build_results(metrics, med)

        if progress_callback:
            progress_callback("Генерация отчёта", 95, frame_count, total_fr)

        text_report = cls._text_report(results, metrics)
        medical_assessment = cls._medical_assessment(results)

        if progress_callback:
            progress_callback("Завершение", 100, frame_count, total_fr)

        g = results.get("global", {})
        return {
            "results":                  results,
            "plots":                    plots,
            "text_report":              text_report,
            "medical_assessment":       medical_assessment,
            "total_frames":             frame_count,
            "processing_time_seconds":  (datetime.now() - start).total_seconds(),
            "plots_directory":          plots_dir,
            "breathing_rate_mean_bpm":  g.get("breathing_rate_mean_bpm"),
            "amplitude_mean_mm":        g.get("amplitude_mean_mm"),
            "width_line_1_plot":        plots.get("width_line_1"),
            "width_line_2_plot":        plots.get("width_line_2"),
            "width_line_3_plot":        plots.get("width_line_3"),
            "summary_plot":             plots.get("summary_plot") or plots.get("dashboard"),
        }

    @staticmethod
    def _plots_dir(patient_id, analysis_id) -> str:
        cur = Path(__file__).resolve().parent
        for p in cur.parents:
            fe = p / "frontend"
            if fe.exists():
                return str(fe / "analysis_plots" / str(patient_id) / str(analysis_id))
        return str(Path("static") / "analysis_plots" / str(patient_id) / str(analysis_id))

    @staticmethod
    def _map_plots(graph_paths: List[str]) -> Dict[str, str]:
        plots: Dict[str, str] = {}
        patterns = [
            ("dashboard",       "dashboard"),
            ("overview",        "overview"),
            ("marker_1_detail", "width_line_1"),
            ("marker_2_detail", "width_line_2"),
            ("marker_3_detail", "width_line_3"),
            ("fft",             "fft_spectra"),
            ("comparative",     "comparative"),
            ("sampling",        "sampling_comparison"),
        ]
        for path in sorted(graph_paths):
            fname = os.path.basename(path).lower()
            for pattern, key in patterns:
                if pattern in fname and key not in plots:
                    plots[key] = path
                    break
        if "summary_plot" not in plots:
            for fb in ("dashboard", "overview"):
                if fb in plots:
                    plots["summary_plot"] = plots[fb]
                    break
        return plots

    @staticmethod
    def _build_results(metrics: Dict, analyzer: MedicalVideoAnalyzer) -> Dict:
        dyn  = metrics.get("дыхательная_динамика", {})
        stat = metrics.get("статистические_метрики", {})
        clin = metrics.get("клинические_индикаторы", {})

        global_data = {
            "breathing_rate_mean_bpm":   dyn.get("среднее_bpm_все_маркеры"),
            "breathing_rate_std_bpm":    dyn.get("std_bpm_все_маркеры"),
            "amplitude_mean_mm":         clin.get("средняя_амплитуда_дыхания_мм"),
            "amplitude_max_mm":          clin.get("максимальная_амплитуда_дыхания_мм"),
            "amplitude_min_mm":          clin.get("минимальная_амплитуда_дыхания_мм"),
            "synchronization_index":     clin.get("координация_маркеров_1_2", 0),
            "analysis_duration_seconds": analyzer.patient_data.get("video_duration", 0),
            "total_measurements":        stat.get("всего_измерений", 0),
            "data_quality_index":        stat.get("качество_данных_индекс", 0),
            "reliability_index":         stat.get("надежность_индекс", 0),
        }

        per_marker = metrics.get("per_marker", {})
        lines = []
        for i, hist in enumerate(analyzer.width_history):
            if len(hist) < 5:
                continue
            key   = f"маркер_{i + 1}_{analyzer.marker_names[i]}"
            md    = per_marker.get(key, {})
            ms    = md.get("статистика", {})
            mp    = md.get("фазы", {})
            mf    = md.get("fft", {})

            arr   = np.array(list(hist))
            clean = analyzer._remove_outliers(arr)
            times = np.array(list(analyzer.time_history[i]))
            mean_v = float(np.mean(clean)) if len(clean) > 0 else 0.0

            lines.append({
                "statistical": {
                    "mean_mm":       ms.get("среднее_мм",   mean_v),
                    "std_mm":        ms.get("std_мм",       float(np.std(clean))),
                    "max_mm":        ms.get("макс_мм",      float(np.max(clean))),
                    "min_mm":        ms.get("мин_мм",       float(np.min(clean))),
                    "amplitude_mm":  ms.get("диапазон_мм",  float(np.ptp(clean))),
                    "p25_mm":        ms.get("p25_мм",       float(np.percentile(clean, 25))),
                    "p75_mm":        ms.get("p75_мм",       float(np.percentile(clean, 75))),
                    "cv_percent":    ms.get("cv_проц",      0),
                    "skewness":      ms.get("асимметрия",   0),
                },
                "breathing": {
                    "rate_bpm":         mp.get("частота_bpm",            0),
                    "frequency_hz":     mf.get("dominant_freq_hz",       0),
                    "amplitude_mm":     mp.get("амплитуда_среднее_мм",   0),
                    "amplitude_max_mm": mp.get("амплитуда_максимум_мм",  0),
                    "amplitude_min_mm": mp.get("амплитуда_минимум_мм",   0),
                    "regularity_index": mp.get("индекс_регулярности",    0),
                    "ie_ratio":         mp.get("ie_ratio",                0),
                    "rmssd":            mp.get("rmssd_вариабельность",    0),
                    "peak_count":       len(mp.get("индексы_пиков", [])),
                    "cycle_count":      mp.get("количество_циклов",       0),
                    "apnea_detected":   mp.get("апноэ_обнаружено",       False),
                    "apnea_events":     mp.get("количество_апноэ_событий",0),
                },
                "signal_quality": {
                    "snr_db":             mf.get("snr_db",            0),
                    "breath_power_ratio": mf.get("breath_power_ratio",0),
                    "valid_samples":      ms.get("количество_измерений", len(clean)),
                    "missing_rate":       0.0,
                },
                "amplitude_mm":      (clean - mean_v).tolist(),
                "peaks":             mp.get("индексы_пиков",  []),
                "troughs":           mp.get("индексы_впадин", []),
                "timestamps":        times.tolist(),
                "normalized_width":  (clean / mean_v).tolist() if mean_v > 0 else [],
            })

        return {"global": global_data, "lines": lines}

    @staticmethod
    def _text_report(results: Dict, metrics: Dict) -> str:
        sep = "=" * 65
        sub = "-" * 45
        g   = results.get("global", {})
        out = [sep, "  ОТЧЁТ ПО АНАЛИЗУ ДЫХАТЕЛЬНЫХ ДВИЖЕНИЙ", sep, ""]

        if g:
            out += ["ГЛОБАЛЬНЫЕ ПОКАЗАТЕЛИ:", sub]
            if g.get("breathing_rate_mean_bpm") is not None:
                out.append(f"  Частота дыхания:    {g['breathing_rate_mean_bpm']:.1f} вдох/мин")
            if g.get("breathing_rate_std_bpm") is not None:
                out.append(f"  Вариабельность:     {g['breathing_rate_std_bpm']:.1f} вдох/мин")
            if g.get("amplitude_mean_mm") is not None:
                out.append(f"  Амплитуда (среднее):{g['amplitude_mean_mm']:.2f} мм")
            if g.get("synchronization_index") is not None:
                out.append(f"  Синхронизация:      {g['synchronization_index']:.3f}")
            if g.get("data_quality_index") is not None:
                out.append(f"  Качество данных:    {g['data_quality_index']:.3f}")
            out.append("")

        for i, line in enumerate(results.get("lines", [])):
            s = line.get("statistical", {})
            b = line.get("breathing", {})
            q = line.get("signal_quality", {})
            out += [f"МАРКЕР {i + 1}:", sub]
            if s:
                out += [
                    "  Статистика:",
                    f"    Среднее:   {s.get('mean_mm', 0):.2f} мм",
                    f"    Std:       {s.get('std_mm', 0):.2f} мм",
                    f"    Диапазон:  {s.get('min_mm', 0):.1f} – {s.get('max_mm', 0):.1f} мм",
                    f"    Амплитуда: {s.get('amplitude_mm', 0):.2f} мм",
                    f"    CV:        {s.get('cv_percent', 0):.1f}%", "",
                ]
            if b:
                out += [
                    "  Дыхание:",
                    f"    Частота:      {b.get('rate_bpm', 0):.1f} вдох/мин",
                    f"    Амплитуда:    {b.get('amplitude_mm', 0):.2f} мм",
                    f"    I:E ratio:    {b.get('ie_ratio', 0):.2f}",
                    f"    Регулярность: {b.get('regularity_index', 0):.3f}",
                    f"    Циклов:       {b.get('cycle_count', 0)}",
                    f"    Апноэ:        {'Да' if b.get('apnea_detected') else 'Нет'} "
                    f"({b.get('apnea_events', 0)} событий)",
                    f"    RMSSD:        {b.get('rmssd', 0):.3f}", "",
                ]
            if q:
                out += [
                    "  Качество:",
                    f"    SNR:           {q.get('snr_db', 0):.1f} дБ",
                    f"    Дых. мощность: {q.get('breath_power_ratio', 0) * 100:.1f}%",
                    f"    Отсчётов:      {q.get('valid_samples', 0)}", "",
                ]

        clin = metrics.get("клинические_индикаторы", {})
        if clin:
            out += ["КЛИНИЧЕСКИЕ ИНДИКАТОРЫ:", sub]
            for k, v in clin.items():
                out.append(f"  {k}: {v:.4f}" if isinstance(v, float) else f"  {k}: {v}")
            out.append("")

        out += [sep, "Конец отчёта", sep]
        return "\n".join(out)

    @staticmethod
    def _medical_assessment(results: Dict) -> str:
        rate = results.get("global", {}).get("breathing_rate_mean_bpm")
        if rate is None:
            return "Недостаточно данных для оценки"
        if 12 <= rate <= 20:
            return "Нормальное дыхание"
        elif rate < 12:
            return f"Брадипноэ (редкое дыхание): {rate:.1f} вдох/мин"
        return f"Тахипноэ (частое дыхание): {rate:.1f} вдох/мин"

