import cv2
import numpy as np
from collections import deque
from typing import List, Optional, Tuple, Dict, Any
import matplotlib
from scipy import signal
from scipy.ndimage import uniform_filter1d
import os
import uuid
from datetime import datetime
from sklearn.cluster import KMeans
from pathlib import Path
import matplotlib.pyplot as plt

matplotlib.use('Agg')


class RespiratoryAnalysisService:
    """
    Сервис для анализа дыхательных движений по видео.
    """

    _processed_videos_count = 0

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
    def increment_processed_count(cls):
        """Инкрементировать счетчик обработанных видео"""
        cls._processed_videos_count += 1

    @classmethod
    def segment_person_kmeans(cls, frame: np.ndarray) -> np.ndarray:
        """
        Сегментация человека с помощью K-means.
        Использует пространство LAB для лучшего разделения цветов.

        Args:
            frame: Входное изображение BGR

        Returns:
            Бинарная маска человека
        """
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        h, w = lab.shape[:2]
        lab_2d = lab.reshape(-1, 3)

        kmeans = KMeans(n_clusters=2, random_state=42, n_init=5)
        labels = kmeans.fit_predict(lab_2d)
        centers = kmeans.cluster_centers_

        bg_label = 0 if np.sum(centers[0]) < np.sum(centers[1]) else 1
        person_mask = (labels != bg_label).astype(np.uint8).reshape(h, w)

        kernel = np.ones((5, 5), np.uint8)
        person_mask = cv2.morphologyEx(person_mask, cv2.MORPH_OPEN, kernel, iterations=2)
        return cv2.morphologyEx(person_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    @classmethod
    def detect_markers(cls, frame: np.ndarray, color: str) -> List[Tuple[int, int, int, int, int, int]]:
        """
        Обнаружение цветных маркеров на изображении.

        Args:
            frame: Входное изображение BGR
            color: Цвет маркера ('red', 'blue', 'green')

        Returns:
            Список обнаруженных маркеров (x, y, w, h, center_x, center_y)
        """
        if color not in cls.COLOR_RANGES:
            raise ValueError(f"Неподдерживаемый цвет: {color}")

        config = cls.COLOR_RANGES[color]

        # Конвертация в HSV для цветовой сегментации
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        mask1 = cv2.inRange(hsv, config["lower1"], config["upper1"])

        if config["lower2"] is not None and config["upper2"] is not None:
            mask2 = cv2.inRange(hsv, config["lower2"], config["upper2"])
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
            if area < 25:  # Фильтрация по площади
                continue

            x, y, w, h = cv2.boundingRect(cnt)
            aspect_ratio = float(w) / h

            if 0.7 < aspect_ratio < 1.4:
                markers.append((x, y, w, h, x + w // 2, y + h // 2))

        return markers

    @staticmethod
    def get_contour_edges_at_y(contour: np.ndarray, y_pos: int, img_shape: Tuple[int, int]) -> Tuple[
        Optional[int], Optional[int]]:
        """
        Определение левой и правой границ контура на заданной высоте.

        Args:
            contour: Контур человека
            y_pos: Y-координата для измерения
            img_shape: Размеры изображения

        Returns:
            Кортеж (левая_граница, правая_граница) или (None, None) если нет пересечения
        """
        # Создаем маску контура
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
        """
        Основной метод анализа видео с дыхательными движениями.

        Args:
            video_path: Путь к видеофайлу
            marker_color: Цвет маркера для отслеживания
            marker_size_mm: Физический размер маркера для калибровки
            progress_callback: Функция для обновления прогресса
            patient_id: ID пациента (для сохранения графиков)
            analysis_id: ID анализа

        Returns:
            Словарь с результатами анализа, графиками и отчетом
        """
        cls.increment_processed_count()
        start_time = datetime.now()

        class ScaleConverter:
            """Конвертер пикселей в миллиметры на основе размера маркера"""

            def __init__(self, marker_size_mm: float = 18.0):
                self.pixels_per_mm = None
                self.reference_size_mm = marker_size_mm

            def update_scale(self, square_width_px: float):
                """Обновление масштаба на основе размера маркера в пикселях"""
                if square_width_px > 0:
                    self.pixels_per_mm = square_width_px / self.reference_size_mm

            def px_to_mm(self, px: float) -> Optional[float]:
                """Конвертация пикселей в миллиметры"""
                if self.pixels_per_mm is None:
                    return None
                return px / self.pixels_per_mm

        class MarkerTracker:
            """Трекинг маркеров между кадрами"""

            def __init__(self, max_missing_frames: int = 5):
                self.next_id = 0
                self.markers = {}
                self.max_missing_frames = max_missing_frames

            def update(self, detected_markers: List[Tuple]) -> List[Tuple]:
                """Обновление трекеров на основе новых обнаружений"""
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
                        matched_markers.append((marker[0], marker[1], marker[2], marker[3],
                                                marker[4], marker[5], best_match_id))
                    else:
                        self._add_marker(marker)
                        matched_markers.append((marker[0], marker[1], marker[2], marker[3],
                                                marker[4], marker[5], self.next_id - 1))

                for marker_id in self.markers:
                    if marker_id not in matched_ids:
                        self.markers[marker_id]['missing'] += 1

                return matched_markers

            def _add_marker(self, marker: Tuple):
                """Добавление нового маркера в трекер"""
                self.markers[self.next_id] = {
                    'positions': deque([(marker[4], marker[5])]),
                    'missing': 0
                }
                self.next_id += 1

        class RespiratoryAnalyzer:
            """Анализатор дыхательных движений"""

            def __init__(self, num_lines: int = 3, max_history: int = 1000, fps: float = 30):
                self.width_history = [deque(maxlen=max_history) for _ in range(num_lines)]
                self.time_history = deque(maxlen=max_history)
                self.frame_count = 0
                self.fps = fps

                self.raw_width_history = [deque(maxlen=max_history) for _ in range(num_lines)]

                self.parameters = {
                    'lines': [{} for _ in range(num_lines)],
                    'global': {}
                }

                # Статистика
                self.frames_with_markers = 0
                self.frames_without_markers = 0

            def update(self, widths_mm: List[Optional[float]]):
                """Обновление данных анализатора новыми измерениями"""
                self.frame_count += 1
                current_time = self.frame_count / self.fps
                self.time_history.append(current_time)

                for i, width in enumerate(widths_mm):
                    if width is not None:
                        self.width_history[i].append(width)
                        self.raw_width_history[i].append(width)
                    else:
                        if len(self.width_history[i]) > 0:
                            last_value = self.width_history[i][-1]
                            self.width_history[i].append(last_value)
                            self.raw_width_history[i].append(last_value)
                        else:
                            self.width_history[i].append(np.nan)
                            self.raw_width_history[i].append(np.nan)

                if any(w is not None for w in widths_mm):
                    self.frames_with_markers += 1
                else:
                    self.frames_without_markers += 1

                if self.frame_count % 10 == 0 and len(self.time_history) > 30:
                    self._calculate_parameters()

            def _calculate_parameters(self):
                """Расчет параметров для каждой линии измерения"""
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

                    # Базовые статистики
                    mean_width = np.mean(clean_data)
                    std_width = np.std(clean_data)
                    max_width = np.max(clean_data)
                    min_width = np.min(clean_data)
                    amplitude = max_width - min_width

                    # Анализ дыхательного паттерна
                    breathing_params = self._analyze_breathing_pattern(clean_data, clean_time)
                    detrended_data = signal.detrend(clean_data)

                    # Амплитуда для каждой точки относительно среднего
                    amplitude_mm = clean_data - mean_width

                    # Поиск пиков и впадин
                    peaks, _ = signal.find_peaks(detrended_data,
                                                 height=np.std(detrended_data),
                                                 distance=int(self.fps / 2))

                    troughs, _ = signal.find_peaks(-detrended_data,
                                                   height=np.std(detrended_data),
                                                   distance=int(self.fps / 2))

                    # Сохранение параметров
                    self.parameters['lines'][i] = {
                        'statistical': {
                            'mean_mm': float(mean_width),
                            'std_mm': float(std_width),
                            'max_mm': float(max_width),
                            'min_mm': float(min_width),
                            'amplitude_mm': float(amplitude),
                        },
                        'breathing': breathing_params,
                        'signal_quality': {
                            'snr_db': self._calculate_snr(detrended_data),
                            'valid_samples': int(np.sum(valid_mask)),
                            'missing_rate': float(np.sum(~valid_mask) / len(data) * 100)
                        },
                        'amplitude_mm': amplitude_mm.tolist(),
                        'peaks': peaks.tolist(),
                        'troughs': troughs.tolist(),
                        'timestamps': clean_time.tolist(),
                        'normalized_width': (clean_data / mean_width).tolist()
                    }

                self._calculate_global_parameters()

            def _analyze_breathing_pattern(self, data: np.ndarray, time_data: np.ndarray) -> Dict[str, Any]:
                """Анализ дыхательного паттерна с помощью Фурье-анализа"""
                if len(data) < 30:
                    return {}

                detrended = signal.detrend(data)
                sampling_rate = self.fps
                n = len(detrended)

                # FFT анализ для определения частоты дыхания
                window = np.hanning(n)
                windowed_data = detrended * window

                fft_result = np.fft.rfft(windowed_data)
                frequencies = np.fft.rfftfreq(n, 1 / sampling_rate)
                magnitudes = np.abs(fft_result) / n * 2

                # Диапазон частот дыхания (0.1-2.0 Гц ≈ 6-120 вдохов/мин)
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
                """Расчет отношения сигнал/шум"""
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
                """Расчет глобальных параметров по всем линиям"""
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
                """Расчет индекса синхронизации между линиями"""
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
                """Получение форматированных результатов"""
                formatted_results = {
                    'lines': [],
                    'global': self.parameters['global']
                }

                for i, line_data in enumerate(self.parameters['lines']):
                    if line_data:
                        formatted_line_data = {
                            'statistical': line_data.get('statistical', {}),
                            'breathing': line_data.get('breathing', {}),
                            'signal_quality': line_data.get('signal_quality', {}),
                            'amplitude_mm': line_data.get('amplitude_mm', []),
                            'peaks': line_data.get('peaks', []),
                            'troughs': line_data.get('troughs', []),
                            'timestamps': line_data.get('timestamps', []),
                            'normalized_width': line_data.get('normalized_width', [])
                        }
                        formatted_results['lines'].append(formatted_line_data)

                return formatted_results

        scale_converter = ScaleConverter(marker_size_mm=marker_size_mm)
        respiratory_analyzer = RespiratoryAnalyzer(num_lines=3, max_history=1000)
        marker_tracker = MarkerTracker()

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Не удалось открыть видео файл: {video_path}")

        # Получение параметров видео
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if fps > 0:
            respiratory_analyzer.fps = fps

        if progress_callback:
            progress_callback("Загрузка видео", 10, 0, total_frames)

        frame_count = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_count += 1

            if progress_callback and frame_count % 10 == 0:
                progress = min(10 + (frame_count / total_frames) * 70, 80)
                progress_callback("Обработка видео", progress, frame_count, total_frames)

            person_mask = cls.segment_person_kmeans(frame)
            contours, _ = cv2.findContours(person_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            if not contours:
                respiratory_analyzer.update([None, None, None])
                continue

            person_contour = max(contours, key=cv2.contourArea)

            markers = cls.detect_markers(frame, marker_color)
            body_markers = []

            for (x, y, w, h, cX, cY) in markers:
                if cv2.pointPolygonTest(person_contour, (cX, cY), False) >= 0:
                    body_markers.append((x, y, w, h, cX, cY))

            # Фильтрация по размеру и калибровка масштаба
            if body_markers:
                median_size = np.median([max(w, h) for (x, y, w, h, cX, cY) in body_markers])
                body_markers = [m for m in body_markers
                                if 0.5 * median_size < max(m[2], m[3]) < 1.5 * median_size]
                scale_converter.update_scale(median_size)

            tracked_markers = marker_tracker.update(body_markers)
            tracked_markers.sort(key=lambda m: (m[5], m[4]))

            current_widths = [None, None, None]
            for i, (x, y, w, h, cX, cY, marker_id) in enumerate(tracked_markers[:3]):
                left, right = cls.get_contour_edges_at_y(person_contour, cY, frame.shape)

                if left and right and scale_converter.pixels_per_mm:
                    line_width_mm = scale_converter.px_to_mm(right - left)
                    current_widths[i] = line_width_mm

            respiratory_analyzer.update(current_widths)

        cap.release()

        if progress_callback:
            progress_callback("Анализ данных", 85, frame_count, total_frames)

        processing_time = (datetime.now() - start_time).total_seconds()

        results = respiratory_analyzer.get_results()

        try:
            if progress_callback:
                progress_callback("Создание графиков", 90, frame_count, total_frames)

            if patient_id is not None and analysis_id is not None:
                # Структура каталогов для фронтенда
                plots_dir = cls._get_frontend_plots_directory(patient_id, analysis_id)
            else:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                analysis_dir_name = f"analysis_{timestamp}_{uuid.uuid4().hex[:8]}"
                plots_dir = os.path.join("static", "analysis_plots", analysis_dir_name)

            os.makedirs(plots_dir, exist_ok=True)
            plots = cls._create_plots(respiratory_analyzer, plots_dir)
        except Exception as e:
            plots = {}
            plots_dir = ""

        try:
            if progress_callback:
                progress_callback("Генерация отчета", 95, frame_count, total_frames)

            text_report = cls._create_text_report(results)
        except Exception as e:
            text_report = "Ошибка при создании отчета"

        try:
            medical_assessment = cls._get_medical_assessment(results)
        except Exception as e:
            medical_assessment = "Ошибка при создании медицинской оценки"

        if progress_callback:
            progress_callback("Завершение", 100, frame_count, total_frames)

        return {
            "results": results,
            "plots": plots,
            "text_report": text_report,
            "medical_assessment": medical_assessment,
            "total_frames": frame_count,
            "processing_time_seconds": processing_time,
            "plots_directory": plots_dir,

            "breathing_rate_mean_bpm": results.get('global', {}).get('breathing_rate_mean_bpm'),
            "amplitude_mean_mm": results.get('global', {}).get('amplitude_mean_mm'),
            "total_frames": frame_count,


            "width_line_1_plot": plots.get('width_line_1'),
            "width_line_2_plot": plots.get('width_line_2'),
            "width_line_3_plot": plots.get('width_line_3'),
            "summary_plot": plots.get('summary_plot'),
        }

    @classmethod
    def _get_frontend_plots_directory(cls, patient_id: int, analysis_id: int) -> str:
        """Создание структуры каталогов для сохранения графиков"""
        current_dir = Path(__file__).resolve().parent

        # Поиск директории frontend
        for parent in current_dir.parents:
            frontend_check = parent / "frontend"
            if frontend_check.exists():
                frontend_dir = frontend_check
                break
        else:
            frontend_dir = Path("static")

        plots_dir = frontend_dir / "analysis_plots" / str(patient_id) / str(analysis_id)
        return str(plots_dir)

    @classmethod
    def _create_plots(cls, analyzer, output_dir: str) -> Dict[str, str]:
        """Создание графиков на основе данных анализа"""
        plots = {}
        os.makedirs(output_dir, exist_ok=True)

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

            except Exception:
                continue

        if any(len(h) > 10 for h in analyzer.width_history):
            try:
                plt.figure(figsize=(12, 6))
                colors = ['blue', 'green', 'red']

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
            except Exception:
                pass

        return plots

    @staticmethod
    def _create_text_report(results: Dict[str, Any]) -> str:
        """Создание текстового отчета с результатами анализа"""
        report = "ОТЧЕТ ПО АНАЛИЗУ ДЫХАТЕЛЬНЫХ ДВИЖЕНИЙ\n"
        report += "=" * 50 + "\n\n"

        if 'global' in results and results['global']:
            global_data = results['global']
            report += "ОБЩАЯ ИНФОРМАЦИЯ:\n"

            duration = global_data.get('analysis_duration_seconds')
            if duration is not None:
                report += f"Длительность анализа: {duration:.1f} сек\n"

            breathing_rate = global_data.get('breathing_rate_mean_bpm')
            if breathing_rate is not None:
                report += f"Средняя частота дыхания: {breathing_rate:.1f} вдох/мин\n"

            breathing_std = global_data.get('breathing_rate_std_bpm')
            if breathing_std is not None:
                report += f"Вариабельность частоты: {breathing_std:.1f} вдох/мин\n"

            sync_index = global_data.get('synchronization_index')
            if sync_index is not None:
                report += f"Индекс синхронизации: {sync_index:.3f}\n\n"
        else:
            report += "Нет глобальных данных для отчета\n\n"

        for i, line_data in enumerate(results.get('lines', [])):
            report += f"ЛИНИЯ {i + 1}:\n"
            report += "-" * 30 + "\n"

            stats = line_data.get('statistical', {})
            breathing = line_data.get('breathing', {})
            quality = line_data.get('signal_quality', {})

            report += f"  Статистика:\n"
            mean_width = stats.get('mean_mm')
            if mean_width is not None:
                report += f"    Средняя ширина: {mean_width:.1f} мм\n"

            std_width = stats.get('std_mm')
            if std_width is not None:
                report += f"    Стандартное отклонение: {std_width:.1f} мм\n"

            amplitude = stats.get('amplitude_mm')
            if amplitude is not None:
                report += f"    Амплитуда вариаций: {amplitude:.1f} мм\n\n"

            report += f"  Дыхательные параметры:\n"
            rate_bpm = breathing.get('rate_bpm')
            if rate_bpm is not None:
                report += f"    Частота: {rate_bpm:.1f} вдох/мин\n"

            breathing_amplitude = breathing.get('amplitude_mm')
            if breathing_amplitude is not None:
                report += f"    Амплитуда дыхания: {breathing_amplitude:.1f} мм\n"

            regularity = breathing.get('regularity_index')
            if regularity is not None:
                report += f"    Индекс регулярности: {regularity:.3f}\n\n"

            report += f"  Качество сигнала:\n"
            snr = quality.get('snr_db')
            if snr is not None:
                report += f"    SNR: {snr:.1f} дБ\n"

            valid_samples = quality.get('valid_samples', 0)
            report += f"    Валидные отсчеты: {valid_samples}\n"

            missing_rate = quality.get('missing_rate', 0)
            report += f"    Процент пропусков: {missing_rate:.1f}%\n\n"

        return report

    @staticmethod
    def _get_medical_assessment(results: Dict[str, Any]) -> str:
        """Медицинская оценка на основе частоты дыхания"""
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