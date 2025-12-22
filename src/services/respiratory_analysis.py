import cv2
import numpy as np
from collections import deque
from typing import List, Optional, Tuple, Dict, Any
import matplotlib

# Устанавливаем бэкенд ДО импорта pyplot
matplotlib.use('Agg')  # Неинтерактивный бэкенд
from scipy import signal
from scipy.ndimage import uniform_filter1d
import base64
import io
import os
import tempfile
import uuid
from datetime import datetime
import json
from sklearn.cluster import KMeans
import sys
from pathlib import Path


class RespiratoryAnalysisService:
    """Сервис для анализа дыхательных движений"""

    # Счетчик обработанных видео
    _processed_videos_count = 0

    # Цветовые диапазоны в HSV
    COLOR_RANGES = {
        "red": {
            "lower1": np.array([0, 150, 100], dtype=np.uint8),
            "upper1": np.array([10, 255, 255], dtype=np.uint8),
            "lower2": np.array([170, 120, 70], dtype=np.uint8),
            "upper2": np.array([180, 255, 255], dtype=np.uint8)
        },
        "blue": {
            "lower1": np.array([100, 80, 40], dtype=np.uint8),
            "upper1": np.array([140, 255, 255], dtype=np.uint8),
            "lower2": np.array([90, 50, 30], dtype=np.uint8),
            "upper2": np.array([120, 255, 200], dtype=np.uint8)
        },
        "green": {
            "lower1": np.array([40, 50, 50], dtype=np.uint8),
            "upper1": np.array([80, 255, 255], dtype=np.uint8),
            "lower2": None,
            "upper2": None
        }
    }

    @classmethod
    def get_processed_videos_count(cls) -> int:
        """Получить количество обработанных видео"""
        return cls._processed_videos_count

    @classmethod
    def increment_processed_count(cls):
        """Увеличить счетчик обработанных видео"""
        cls._processed_videos_count += 1
        cls._log(f"\n{'=' * 60}")
        cls._log(f"ОБРАБОТАНО ВИДЕО: {cls._processed_videos_count}")
        cls._log(f"{'=' * 60}")

    @classmethod
    def _log(cls, message: str):
        """Логирование с принудительной очисткой буфера"""
        print(message, flush=True)

    @classmethod
    def segment_person_kmeans(cls, frame: np.ndarray) -> np.ndarray:
        """Сегментация человека с помощью K-means"""
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        h, w = lab.shape[:2]
        lab_2d = lab.reshape(-1, 3)

        kmeans = KMeans(n_clusters=2, random_state=42, n_init=10)
        labels = kmeans.fit_predict(lab_2d)
        centers = kmeans.cluster_centers_

        bg_label = 0 if np.sum(centers[0]) < np.sum(centers[1]) else 1
        person_mask = (labels != bg_label).astype(np.uint8).reshape(h, w)

        kernel = np.ones((5, 5), np.uint8)
        person_mask = cv2.morphologyEx(person_mask, cv2.MORPH_OPEN, kernel, iterations=2)
        return cv2.morphologyEx(person_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    @classmethod
    def detect_markers(cls, frame: np.ndarray, color: str) -> List[Tuple]:
        """Обнаружение маркеров указанного цвета"""
        if color not in cls.COLOR_RANGES:
            raise ValueError(f"Неподдерживаемый цвет: {color}")

        config = cls.COLOR_RANGES[color]
        lower1, upper1 = config["lower1"], config["upper1"]
        lower2, upper2 = config["lower2"], config["upper2"]

        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask1 = cv2.inRange(hsv, lower1, upper1)

        if lower2 is not None and upper2 is not None:
            mask2 = cv2.inRange(hsv, lower2, upper2)
            mask = cv2.bitwise_or(mask1, mask2)
        else:
            mask = mask1

        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        markers = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 25:
                continue

            x, y, w, h = cv2.boundingRect(cnt)
            aspect_ratio = float(w) / h
            if 0.7 < aspect_ratio < 1.4:
                markers.append((x, y, w, h, x + w // 2, y + h // 2))

        return markers

    @staticmethod
    def get_contour_edges_at_y(contour: np.ndarray, y_pos: int, img_shape: Tuple[int, int]) -> Tuple[
        Optional[int], Optional[int]]:
        """Получить границы контура на заданной высоте"""
        mask = np.zeros(img_shape[:2], dtype=np.uint8)
        cv2.drawContours(mask, [contour], -1, 255, -1)

        if y_pos >= img_shape[0]:
            return None, None

        row = mask[y_pos, :]
        left = np.argmax(row > 0)
        right = len(row) - np.argmax(row[::-1] > 0) - 1

        if left >= right:
            return None, None

        return left, right

    @classmethod
    def analyze_video(
            cls,
            video_path: str,
            marker_color: str = "red",
            marker_size_mm: float = 18.0,
            progress_callback=None,
            patient_id: Optional[int] = None,
            analysis_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """Основной метод анализа видео"""
        # Импортируем matplotlib внутри функции
        import matplotlib.pyplot as plt

        # Увеличиваем счетчик и выводим информацию
        cls.increment_processed_count()
        cls._log(f"Начата обработка видео: {video_path}")
        cls._log(f"Параметры анализа:")
        cls._log(f"  Цвет маркера: {marker_color}")
        cls._log(f"  Размер маркера: {marker_size_mm} мм")
        if patient_id is not None:
            cls._log(f"  ID пациента: {patient_id}")
        if analysis_id is not None:
            cls._log(f"  ID анализа: {analysis_id}")

        if progress_callback:
            progress_callback("Инициализация", 5, 0, 0)

        start_time = datetime.now()

        class ScaleConverter:
            def __init__(self, marker_size_mm: float = 18.0):
                self.pixels_per_mm = None
                self.reference_size_mm = marker_size_mm

            def update_scale(self, square_width_px: float):
                if square_width_px > 0:
                    self.pixels_per_mm = square_width_px / self.reference_size_mm

            def px_to_mm(self, px: float) -> Optional[float]:
                if self.pixels_per_mm is None:
                    return None
                return px / self.pixels_per_mm

        class MarkerTracker:
            def __init__(self, max_missing_frames: int = 5):
                self.next_id = 0
                self.markers = {}
                self.max_missing_frames = max_missing_frames

            def update(self, detected_markers: List[Tuple]) -> List[Tuple]:
                for marker_id in list(self.markers.keys()):
                    if self.markers[marker_id]['missing'] > self.max_missing_frames:
                        del self.markers[marker_id]

                if len(detected_markers) == 0:
                    return []

                if len(self.markers) == 0:
                    for marker in detected_markers:
                        self._add_marker(marker)
                    return [(m[0], m[1], m[2], m[3], m[4], m[5], i) for i, m in enumerate(detected_markers)]

                matched_ids = []
                matched_markers = []

                for marker in detected_markers:
                    min_dist = float('inf')
                    best_match_id = None

                    for marker_id, data in self.markers.items():
                        if marker_id in matched_ids:
                            continue

                        last_pos = data['positions'][-1]
                        dist = np.sqrt((marker[4] - last_pos[0]) ** 2 + (marker[5] - last_pos[1]) ** 2)

                        if dist < 30 and dist < min_dist:
                            min_dist = dist
                            best_match_id = marker_id

                    if best_match_id is not None:
                        self.markers[best_match_id]['positions'].append((marker[4], marker[5]))
                        self.markers[best_match_id]['missing'] = 0
                        matched_ids.append(best_match_id)
                        matched_markers.append(
                            (marker[0], marker[1], marker[2], marker[3], marker[4], marker[5], best_match_id))
                    else:
                        self._add_marker(marker)
                        matched_markers.append(
                            (marker[0], marker[1], marker[2], marker[3], marker[4], marker[5], self.next_id - 1))

                for marker_id in self.markers:
                    if marker_id not in matched_ids:
                        self.markers[marker_id]['missing'] += 1

                return matched_markers

            def _add_marker(self, marker: Tuple):
                self.markers[self.next_id] = {
                    'positions': deque([(marker[4], marker[5])]),
                    'missing': 0
                }
                self.next_id += 1

        class RespiratoryAnalyzer:
            def __init__(self, num_lines: int = 3, max_history: int = 1000, fps: float = 30):
                self.width_history = [deque(maxlen=max_history) for _ in range(num_lines)]
                self.time_history = deque(maxlen=max_history)
                self.frame_count = 0
                self.fps = fps

                # Сохраняем все сырые данные для расчета amplitude_mm
                self.raw_width_history = [deque(maxlen=max_history) for _ in range(num_lines)]

                self.parameters = {
                    'lines': [{} for _ in range(num_lines)],
                    'global': {}
                }

                # Статистика обработки
                self.markers_detected = 0
                self.frames_with_markers = 0
                self.frames_without_markers = 0

            def update(self, widths_mm: List[Optional[float]]):
                self.frame_count += 1
                current_time = self.frame_count / self.fps
                self.time_history.append(current_time)

                for i, width in enumerate(widths_mm):
                    if width is not None:
                        self.width_history[i].append(width)
                        self.raw_width_history[i].append(width)  # Сохраняем сырые данные
                    else:
                        if len(self.width_history[i]) > 0:
                            last_value = self.width_history[i][-1]
                            self.width_history[i].append(last_value)
                            self.raw_width_history[i].append(last_value)
                        else:
                            self.width_history[i].append(np.nan)
                            self.raw_width_history[i].append(np.nan)

                # Обновляем статистику
                if any(w is not None for w in widths_mm):
                    self.frames_with_markers += 1
                else:
                    self.frames_without_markers += 1

                if self.frame_count % 10 == 0 and len(self.time_history) > 30:
                    self._calculate_parameters()

            def print_progress(self):
                """Вывод прогресса обработки"""
                if self.frame_count % 100 == 0:
                    cls._log(f"Обработано кадров: {self.frame_count}")
                    cls._log(f"Кадры с маркерами: {self.frames_with_markers}")
                    cls._log(f"Кадры без маркеров: {self.frames_without_markers}")
                    if self.frames_with_markers > 0:
                        success_rate = (self.frames_with_markers / self.frame_count) * 100
                        cls._log(f"Успешность обнаружения: {success_rate:.1f}%")

            def _calculate_parameters(self):
                for i, history in enumerate(self.width_history):
                    if len(history) < 30:
                        continue

                    data = np.array(history)
                    time_data = np.array(self.time_history)

                    valid_mask = ~np.isnan(data)
                    if np.sum(valid_mask) < 30:
                        continue

                    clean_data = data[valid_mask]
                    clean_time = time_data[valid_mask]

                    mean_width = np.mean(clean_data)
                    std_width = np.std(clean_data)
                    max_width = np.max(clean_data)
                    min_width = np.min(clean_data)
                    amplitude = max_width - min_width

                    breathing_params = self._analyze_breathing_pattern(clean_data, clean_time)
                    detrended_data = signal.detrend(clean_data)

                    # ВЫЧИСЛЯЕМ amplitude_mm ДЛЯ КАЖДОЙ ТОЧКИ
                    amplitude_mm = clean_data - mean_width

                    # Находим пики и впадины
                    peaks, _ = signal.find_peaks(detrended_data,
                                                 height=np.std(detrended_data),
                                                 distance=int(self.fps / 2))

                    troughs, _ = signal.find_peaks(-detrended_data,
                                                   height=np.std(detrended_data),
                                                   distance=int(self.fps / 2))

                    self.parameters['lines'][i] = {
                        'statistical': {
                            'mean_mm': float(mean_width),
                            'std_mm': float(std_width),
                            'max_mm': float(max_width),
                            'min_mm': float(min_width),
                            'amplitude_mm': float(amplitude),  # Скалярное значение
                        },
                        'breathing': breathing_params,
                        'signal_quality': {
                            'snr_db': self._calculate_snr(detrended_data),
                            'valid_samples': int(np.sum(valid_mask)),
                            'missing_rate': float(np.sum(~valid_mask) / len(data) * 100)
                        },
                        # Массив amplitude_mm для каждой точки
                        'amplitude_mm': amplitude_mm.tolist(),
                        'peaks': peaks.tolist(),
                        'troughs': troughs.tolist(),
                        'timestamps': clean_time.tolist(),
                        'normalized_width': (clean_data / mean_width).tolist()
                    }

                    # ДЕБАГ: выводим информацию о amplitude_mm
                    cls._log(
                        f"Линия {i + 1}: amplitude_mm длина={len(amplitude_mm)}, первые 3={amplitude_mm[:3] if len(amplitude_mm) > 2 else []}")

                self._calculate_global_parameters()

            def _analyze_breathing_pattern(self, data: np.ndarray, time_data: np.ndarray) -> Dict[str, Any]:
                if len(data) < 30:
                    return {}

                detrended = signal.detrend(data)
                sampling_rate = self.fps
                n = len(detrended)

                window = np.hanning(n)
                windowed_data = detrended * window

                fft_result = np.fft.rfft(windowed_data)
                frequencies = np.fft.rfftfreq(n, 1 / sampling_rate)
                magnitudes = np.abs(fft_result) / n * 2

                breathing_range = (frequencies >= 0.1) & (frequencies <= 2.0)
                if np.any(breathing_range):
                    breathing_freqs = frequencies[breathing_range]
                    breathing_mags = magnitudes[breathing_range]

                    if len(breathing_mags) > 0:
                        peak_idx = np.argmax(breathing_mags)
                        dominant_freq = breathing_freqs[peak_idx]
                        breathing_rate_bpm = dominant_freq * 60
                        breathing_amplitude = np.std(detrended) * 2

                        peaks, _ = signal.find_peaks(detrended,
                                                     height=np.std(detrended),
                                                     distance=int(sampling_rate / 2))

                        regularity = 0
                        if len(peaks) > 2:
                            intervals = np.diff(time_data[peaks])
                            regularity = float(np.std(intervals) / np.mean(intervals))

                        return {
                            'rate_bpm': float(breathing_rate_bpm),
                            'frequency_hz': float(dominant_freq),
                            'amplitude_mm': float(breathing_amplitude),
                            'regularity_index': float(regularity),
                            'peak_count': len(peaks)
                        }

                return {}

            def _calculate_snr(self, signal_data: np.ndarray) -> float:
                if len(signal_data) < 10:
                    return 0

                try:
                    b, a = signal.butter(3, [0.1, 2.0], btype='band', fs=self.fps)
                    filtered = signal.filtfilt(b, a, signal_data)
                    noise = signal_data - filtered
                    signal_power = np.mean(filtered ** 2)
                    noise_power = np.mean(noise ** 2)

                    if noise_power > 0:
                        return float(10 * np.log10(signal_power / noise_power))
                except:
                    pass

                return 0

            def _calculate_global_parameters(self):
                all_breathing_rates = []
                all_amplitudes = []

                for i, line_data in enumerate(self.parameters['lines']):
                    if 'breathing' in line_data and 'rate_bpm' in line_data['breathing']:
                        all_breathing_rates.append(line_data['breathing']['rate_bpm'])
                        all_amplitudes.append(line_data['breathing']['amplitude_mm'])

                if all_breathing_rates:
                    self.parameters['global'] = {
                        'breathing_rate_mean_bpm': float(np.mean(all_breathing_rates)),
                        'breathing_rate_std_bpm': float(np.std(all_breathing_rates)),
                        'amplitude_mean_mm': float(np.mean(all_amplitudes)),
                        'amplitude_std_mm': float(np.std(all_amplitudes)),
                        'synchronization_index': self._calculate_sync_index(),
                        'analysis_duration_seconds': float(self.time_history[-1] - self.time_history[0])
                        if len(self.time_history) > 1 else 0
                    }
                else:
                    self.parameters['global'] = {}

            def _calculate_sync_index(self) -> float:
                if len(self.width_history) < 2:
                    return 0

                correlations = []
                for i in range(len(self.width_history) - 1):
                    data1 = np.array(self.width_history[i])
                    data2 = np.array(self.width_history[i + 1])

                    valid_mask = ~np.isnan(data1) & ~np.isnan(data2)
                    if np.sum(valid_mask) > 30:
                        corr = np.corrcoef(data1[valid_mask], data2[valid_mask])[0, 1]
                        if not np.isnan(corr):
                            correlations.append(corr)

                return float(np.mean(correlations)) if correlations else 0

            def get_results(self) -> Dict[str, Any]:
                # Форматируем результаты для возврата
                formatted_results = {
                    'lines': [],
                    'global': self.parameters['global']
                }

                for i, line_data in enumerate(self.parameters['lines']):
                    if line_data:  # Если есть данные
                        formatted_line_data = {
                            'statistical': line_data.get('statistical', {}),
                            'breathing': line_data.get('breathing', {}),
                            'signal_quality': line_data.get('signal_quality', {}),
                            'amplitude_mm': line_data.get('amplitude_mm', []),  # Массив значений
                            'peaks': line_data.get('peaks', []),
                            'troughs': line_data.get('troughs', []),
                            'timestamps': line_data.get('timestamps', []),
                            'normalized_width': line_data.get('normalized_width', [])
                        }
                        formatted_results['lines'].append(formatted_line_data)

                return formatted_results

        # Инициализация компонентов
        scale_converter = ScaleConverter(marker_size_mm=marker_size_mm)
        respiratory_analyzer = RespiratoryAnalyzer(num_lines=3, max_history=1000)
        marker_tracker = MarkerTracker()

        # Открытие видео
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            cls._log(f"ОШИБКА: Не удалось открыть видео файл: {video_path}")
            raise ValueError(f"Не удалось открыть видео файл: {video_path}")

        # Определение FPS
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if fps > 0:
            respiratory_analyzer.fps = fps

        if progress_callback:
            progress_callback("Загрузка видео", 10, 0, total_frames)

        cls._log(f"Информация о видео:")
        cls._log(f"  FPS: {fps:.1f}")
        cls._log(f"  Всего кадров: {total_frames}")
        if fps > 0:
            cls._log(f"  Примерная длительность: {total_frames / fps:.1f} секунд")
        else:
            cls._log(f"  Примерная длительность: N/A")

        frame_count = 0
        cls._log("\nНачата обработка кадров...")

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_count += 1

            # Обновляем прогресс каждые 10 кадров
            if progress_callback and frame_count % 10 == 0:
                progress = min(10 + (frame_count / total_frames) * 70, 80)
                progress_callback("Обработка видео", progress, frame_count, total_frames)

            # Вывод прогресса каждые 100 кадров
            if frame_count % 100 == 0:
                progress = (frame_count / total_frames) * 100
                cls._log(f"Прогресс: {frame_count}/{total_frames} кадров ({progress:.1f}%)")
                respiratory_analyzer.print_progress()

            # 1. Сегментация человека
            person_mask = cls.segment_person_kmeans(frame)
            contours, _ = cv2.findContours(person_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            if not contours:
                respiratory_analyzer.update([None, None, None])
                continue

            person_contour = max(contours, key=cv2.contourArea)

            # 2. Обнаружение маркеров
            markers = cls.detect_markers(frame, marker_color)
            body_markers = []

            for (x, y, w, h, cX, cY) in markers:
                if cv2.pointPolygonTest(person_contour, (cX, cY), False) >= 0:
                    body_markers.append((x, y, w, h, cX, cY))

            # Фильтрация по размеру
            if body_markers:
                median_size = np.median([max(w, h) for (x, y, w, h, cX, cY) in body_markers])
                body_markers = [m for m in body_markers
                                if 0.5 * median_size < max(m[2], m[3]) < 1.5 * median_size]
                scale_converter.update_scale(median_size)

            # Трекинг маркеров
            tracked_markers = marker_tracker.update(body_markers)

            # Сортировка
            tracked_markers.sort(key=lambda m: (m[5], m[4]))

            current_widths = [None, None, None]

            # 3. Измерение ширины
            for i, (x, y, w, h, cX, cY, marker_id) in enumerate(tracked_markers[:3]):
                left, right = cls.get_contour_edges_at_y(
                    person_contour, cY, frame.shape
                )

                if left and right and scale_converter.pixels_per_mm:
                    line_width_mm = scale_converter.px_to_mm(right - left)
                    current_widths[i] = line_width_mm

            # Обновление анализатора
            respiratory_analyzer.update(current_widths)

        cap.release()

        if progress_callback:
            progress_callback("Анализ данных", 85, frame_count, total_frames)

        processing_time = (datetime.now() - start_time).total_seconds()

        cls._log(f"\nОбработка видео завершена!")
        cls._log(f"Всего обработано кадров: {frame_count}")
        cls._log(f"Время обработки: {processing_time:.1f} секунд")
        if processing_time > 0:
            cls._log(f"Скорость обработки: {frame_count / processing_time:.1f} кадров/сек")
        else:
            cls._log(f"Скорость обработки: N/A")

        # Получение результатов
        results = respiratory_analyzer.get_results()

        # Вывод статистики по линиям
        cls._log("\nСТАТИСТИКА ПО ЛИНИЯМ:")
        for i, line_data in enumerate(results.get('lines', [])):
            if line_data:
                stats = line_data.get('statistical', {})
                breathing = line_data.get('breathing', {})
                amplitude_mm = line_data.get('amplitude_mm', [])

                cls._log(f"Линия {i + 1}:")
                mean_width = stats.get('mean_mm')
                if mean_width is not None:
                    cls._log(f"  Средняя ширина: {mean_width:.1f} мм")
                else:
                    cls._log(f"  Средняя ширина: N/A")

                if 'rate_bpm' in breathing:
                    rate_bpm = breathing.get('rate_bpm')
                    if rate_bpm is not None:
                        cls._log(f"  Частота дыхания: {rate_bpm:.1f} вдох/мин")
                    else:
                        cls._log(f"  Частота дыхания: N/A")

                # Информация об amplitude_mm
                if amplitude_mm:
                    cls._log(f"  amplitude_mm: {len(amplitude_mm)} значений")
                    if len(amplitude_mm) > 5:
                        cls._log(f"  Первые 5 значений: {[round(x, 2) for x in amplitude_mm[:5]]}")
            else:
                cls._log(f"Линия {i + 1}: Нет данных")

        # Вывод глобальных результатов
        if 'global' in results and results['global']:
            global_data = results['global']
            cls._log(f"\nОБЩИЕ РЕЗУЛЬТАТЫ:")

            breathing_rate = global_data.get('breathing_rate_mean_bpm')
            if breathing_rate is not None:
                cls._log(f"  Средняя частота дыхания: {breathing_rate:.1f} вдох/мин")
            else:
                cls._log(f"  Средняя частота дыхания: N/A")

            amplitude = global_data.get('amplitude_mean_mm')
            if amplitude is not None:
                cls._log(f"  Средняя амплитуда дыхания: {amplitude:.1f} мм")
            else:
                cls._log(f"  Средняя амплитуда дыхания: N/A")

            sync_index = global_data.get('synchronization_index')
            if sync_index is not None:
                cls._log(f"  Индекс синхронизации: {sync_index:.3f}")
            else:
                cls._log(f"  Индекс синхронизации: N/A")
        else:
            cls._log(f"\nОБЩИЕ РЕЗУЛЬТАТЫ: Нет данных")

        # Создание графиков и сохранение их в файлы
        cls._log("Создание графиков...")
        try:
            if progress_callback:
                progress_callback("Создание графиков", 90, frame_count, total_frames)

            # Определяем путь для сохранения графиков
            if patient_id is not None and analysis_id is not None:
                # Сохраняем прямо в структуру patient_id/analysis_id в frontend
                plots_dir = cls._get_frontend_plots_directory(patient_id, analysis_id)
            else:
                # Старый способ - временная директория в static
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                analysis_dir_name = f"analysis_{timestamp}_{uuid.uuid4().hex[:8]}"
                plots_dir = os.path.join("static", "analysis_plots", analysis_dir_name)

            # Создаем директории если их нет
            os.makedirs(plots_dir, exist_ok=True)

            plots = cls._create_plots(respiratory_analyzer, plots_dir)
        except Exception as e:
            cls._log(f"Ошибка при создании графиков: {str(e)}")
            plots = {}
            plots_dir = ""

        # Создание текстового отчета
        try:
            if progress_callback:
                progress_callback("Генерация отчета", 95, frame_count, total_frames)

            text_report = cls._create_text_report(results)
        except Exception as e:
            cls._log(f"Ошибка при создании отчета: {str(e)}")
            text_report = "Ошибка при создании отчета"

        # Медицинская оценка
        try:
            medical_assessment = cls._get_medical_assessment(results)
        except Exception as e:
            cls._log(f"Ошибка при создании медицинской оценки: {str(e)}")
            medical_assessment = "Ошибка при создании медицинской оценки"

        if progress_callback:
            progress_callback("Завершение", 100, frame_count, total_frames)

        cls._log(f"\nМедицинская оценка: {medical_assessment}")
        if plots_dir:
            cls._log(f"Графики сохранены в папке: {plots_dir}")
        cls._log(f"{'=' * 60}")

        return {
            "results": results,
            "plots": plots,
            "text_report": text_report,
            "medical_assessment": medical_assessment,
            "total_frames": frame_count,
            "processing_time_seconds": processing_time,
            "plots_directory": plots_dir
        }

    @classmethod
    def _get_frontend_plots_directory(cls, patient_id: int, analysis_id: int) -> str:
        """Получить путь к директории для графиков в frontend"""
        current_dir = Path(__file__).resolve().parent

        for parent in current_dir.parents:
            frontend_check = parent / "frontend"
            if frontend_check.exists():
                frontend_dir = frontend_check
                break
        else:
            cls._log(f"Предупреждение: frontend директория не найдена, используем static")
            frontend_dir = Path("static")

        plots_dir = frontend_dir / "analysis_plots" / str(patient_id) / str(analysis_id)
        return str(plots_dir)

    @classmethod
    def _create_plots(cls, analyzer, output_dir: str) -> Dict[str, str]:
        """Создать графики и сохранить их как PNG файлы"""
        import matplotlib.pyplot as plt

        cls._log("Создание графиков...")
        plots = {}

        os.makedirs(output_dir, exist_ok=True)

        # График для каждой линии
        for i, history in enumerate(analyzer.width_history):
            if len(history) < 10:
                continue

            try:
                plt.figure(figsize=(12, 6))
                time_data = list(analyzer.time_history)[-len(history):]

                clean_history = []
                for val in history:
                    if isinstance(val, (int, float)) and not np.isnan(val):
                        clean_history.append(float(val))
                    else:
                        clean_history.append(None)

                plt.plot(time_data, clean_history, linewidth=2, label=f'Линия {i + 1}')

                if len(clean_history) > 30:
                    valid_indices = [idx for idx, val in enumerate(clean_history) if val is not None]
                    if valid_indices:
                        valid_history = [clean_history[idx] for idx in valid_indices]
                        valid_time = [time_data[idx] for idx in valid_indices]

                        window_size = min(30, len(valid_history) // 10)
                        if window_size > 1:
                            smoothed = uniform_filter1d(valid_history, size=window_size)
                            plt.plot(valid_time, smoothed, '--', linewidth=1.5,
                                     label=f'Сглаженное (окно {window_size} кадров)', alpha=0.7)

                plt.xlabel('Время (секунды)')
                plt.ylabel('Ширина (мм)')
                plt.title(f'Динамика изменения ширины тела (линия {i + 1})')
                plt.legend()
                plt.grid(True, linestyle='--', alpha=0.7)

                filename = f"width_line_{i + 1}.png"
                filepath = os.path.join(output_dir, filename)
                plt.savefig(filepath, format='png', dpi=150, bbox_inches='tight')
                plots[f'width_line_{i + 1}'] = filepath
                plt.close()
                cls._log(f"  Сохранен график: {filename}")

            except Exception as e:
                cls._log(f"Ошибка при создании графика для линии {i + 1}: {str(e)}")

        # Сводный график
        if any(len(h) > 10 for h in analyzer.width_history):
            try:
                plt.figure(figsize=(12, 6))
                colors = ['blue', 'green', 'red', 'purple', 'orange', 'brown']

                for i, history in enumerate(analyzer.width_history):
                    if len(history) > 10:
                        time_data = list(analyzer.time_history)[-len(history):]
                        clean_history = []
                        for val in history:
                            if isinstance(val, (int, float)) and not np.isnan(val):
                                clean_history.append(float(val))
                            else:
                                clean_history.append(None)

                        plt.plot(time_data, clean_history, color=colors[i % len(colors)],
                                 linewidth=1.5, label=f'Линия {i + 1}')

                plt.xlabel('Время (секунды)')
                plt.ylabel('Ширина (мм)')
                plt.title('Сводный график изменения ширины тела')
                plt.legend()
                plt.grid(True, alpha=0.3)

                if analyzer.parameters.get('global', {}).get('breathing_rate_mean_bpm'):
                    rate = analyzer.parameters['global']['breathing_rate_mean_bpm']
                    plt.figtext(0.02, 0.98, f'Средняя частота дыхания: {rate:.1f} вдох/мин',
                                fontsize=10, verticalalignment='top',
                                bbox=dict(boxstyle='round', facecolor='lightblue', alpha=0.8))

                filename = "summary_plot.png"
                filepath = os.path.join(output_dir, filename)
                plt.savefig(filepath, format='png', dpi=150, bbox_inches='tight')
                plots['summary_plot'] = filepath
                plt.close()
                cls._log(f"  Сохранен график: {filename}")

            except Exception as e:
                cls._log(f"Ошибка при создании сводного графика: {str(e)}")

        cls._log(f"Создано графиков: {len(plots)}")

        return plots

    @staticmethod
    def _create_text_report(results: Dict[str, Any]) -> str:
        """Создать текстовый отчет"""
        report = "ОТЧЕТ ПО АНАЛИЗУ ДЫХАТЕЛЬНЫХ ДВИЖЕНИЙ\n"
        report += "=" * 50 + "\n\n"

        if 'global' in results and results['global']:
            global_data = results['global']
            report += "ОБЩАЯ ИНФОРМАЦИЯ:\n"

            duration = global_data.get('analysis_duration_seconds')
            if duration is not None:
                report += f"Длительность анализа: {duration:.1f} сек\n"
            else:
                report += f"Длительность анализа: N/A\n"

            breathing_rate = global_data.get('breathing_rate_mean_bpm')
            if breathing_rate is not None:
                report += f"Средняя частота дыхания: {breathing_rate:.1f} вдох/мин\n"
            else:
                report += f"Средняя частота дыхания: N/A\n"

            breathing_std = global_data.get('breathing_rate_std_bpm')
            if breathing_std is not None:
                report += f"Вариабельность частоты: {breathing_std:.1f} вдох/мин\n"
            else:
                report += f"Вариабельность частоты: N/A\n"

            sync_index = global_data.get('synchronization_index')
            if sync_index is not None:
                report += f"Индекс синхронизации: {sync_index:.3f}\n"
            else:
                report += f"Индекс синхронизации: N/A\n\n"
        else:
            report += "Нет глобальных данных для отчета\n\n"

        for i, line_data in enumerate(results.get('lines', [])):
            report += f"ЛИНИЯ {i + 1}:\n"
            report += "-" * 30 + "\n"

            stats = line_data.get('statistical', {})
            breathing = line_data.get('breathing', {})
            quality = line_data.get('signal_quality', {})
            amplitude_mm = line_data.get('amplitude_mm', [])

            report += f"  Статистика:\n"
            mean_width = stats.get('mean_mm')
            if mean_width is not None:
                report += f"    Средняя ширина: {mean_width:.1f} мм\n"
            else:
                report += f"    Средняя ширина: N/A\n"

            std_width = stats.get('std_mm')
            if std_width is not None:
                report += f"    Стандартное отклонение: {std_width:.1f} мм\n"
            else:
                report += f"    Стандартное отклонение: N/A\n"

            amplitude = stats.get('amplitude_mm')
            if amplitude is not None:
                report += f"    Амплитуда вариаций: {amplitude:.1f} мм\n\n"
            else:
                report += f"    Амплитуда вариаций: N/A\n\n"

            report += f"  Дыхательные параметры:\n"
            rate_bpm = breathing.get('rate_bpm')
            if rate_bpm is not None:
                report += f"    Частота: {rate_bpm:.1f} вдох/мин\n"
            else:
                report += f"    Частота: N/A\n"

            breathing_amplitude = breathing.get('amplitude_mm')
            if breathing_amplitude is not None:
                report += f"    Амплитуда дыхания: {breathing_amplitude:.1f} мм\n"
            else:
                report += f"    Амплитуда дыхания: N/A\n"

            regularity = breathing.get('regularity_index')
            if regularity is not None:
                report += f"    Индекс регулярности: {regularity:.3f}\n\n"
            else:
                report += f"    Индекс регулярности: N/A\n\n"

            report += f"  Качество сигнала:\n"
            snr = quality.get('snr_db')
            if snr is not None:
                report += f"    SNR: {snr:.1f} дБ\n"
            else:
                report += f"    SNR: N/A\n"

            valid_samples = quality.get('valid_samples', 0)
            report += f"    Валидные отсчеты: {valid_samples}\n"

            missing_rate = quality.get('missing_rate', 0)
            report += f"    Процент пропусков: {missing_rate:.1f}%\n\n"

            if amplitude_mm and len(amplitude_mm) > 0:
                report += f"  Амплитуды по точкам:\n"
                report += f"    Количество точек: {len(amplitude_mm)}\n"
                if len(amplitude_mm) > 5:
                    report += f"    Первые 5 значений: {[round(x, 2) for x in amplitude_mm[:5]]}\n"
                    report += f"    Среднее значение: {round(np.mean(amplitude_mm), 2)} мм\n"
                    report += f"    Максимальное: {round(np.max(amplitude_mm), 2)} мм\n"
                    report += f"    Минимальное: {round(np.min(amplitude_mm), 2)} мм\n\n"
            else:
                report += f"  Амплитуды по точкам: Нет данных\n\n"

        return report

    @staticmethod
    def _get_medical_assessment(results: Dict[str, Any]) -> str:
        """Создать медицинскую оценку"""
        if not results.get('global') or not results['global']:
            return "Недостаточно данных для оценки"

        rate = results['global'].get('breathing_rate_mean_bpm', 0)

        if rate == 0 or rate is None:
            return "Не удалось определить частоту дыхания"
        elif 12 <= rate <= 20:
            return "Нормальное дыхание"
        elif rate < 12:
            return "Брадипноэ (редкое дыхание)"
        else:
            return "Тахипноэ (частое дыхание)"

