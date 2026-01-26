import os
import tempfile
from datetime import datetime
from typing import Optional, Dict, Any, List
import json
import shutil
import base64
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Body
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import Session

from api.users.auth import get_current_active_user
from api.users.patients import get_patient_by_id
from domain.models import User, Patient, PatientVideo, RespiratoryAnalysis
from infrastructure.async_db import get_db, AsyncSessionLocal, get_sync_db, sync_engine, SyncSessionLocal
from services.respiratory_analysis import RespiratoryAnalysisService
from domain.schemas import (
    RespiratoryAnalysisCreate,
    RespiratoryAnalysisResponse,
    RespiratoryAnalysisDetailResponse,
    LineResultDetail
)

router = APIRouter(prefix="/respiratory-analysis", tags=["Respiratory Analysis"])


PROJECT_ROOT = Path.cwd().parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"

if not FRONTEND_DIR.exists():
    for parent in Path.cwd().parents:
        frontend_check = parent / "frontend"
        if frontend_check.exists():
            FRONTEND_DIR = frontend_check
            break
    else:
        FRONTEND_DIR = PROJECT_ROOT / "frontend"
        print(f"Frontend директория не найдена, будет создана: {FRONTEND_DIR}")

FRONTEND_PLOTS_DIR = FRONTEND_DIR / "analysis_plots"
FRONTEND_PLOTS_DIR.mkdir(parents=True, exist_ok=True)

print(f"Директория для графиков: {FRONTEND_PLOTS_DIR}")

STATIC_PLOTS_DIR = Path("static/analysis_plots")
STATIC_PLOTS_DIR.mkdir(parents=True, exist_ok=True)

_analysis_progress: Dict[int, Dict[str, Any]] = {}


def get_plots_directory(patient_id: int, analysis_id: int) -> Path:
    """Получить путь к директории с графиками для анализа в frontend"""
    return FRONTEND_PLOTS_DIR / str(patient_id) / str(analysis_id)


def get_static_plots_directory(patient_id: int, analysis_id: int) -> Path:
    """Получить путь к директории с графиками для анализа в static (backup)"""
    return STATIC_PLOTS_DIR / str(patient_id) / str(analysis_id)


def get_patient_plots_directory(patient_id: int) -> Path:
    """Получить путь к директории с графиками для пациента"""
    return


def update_analysis_progress(analysis_id: int, stage: str, progress: float,
                             frames_processed: int = None, total_frames: int = None):
    """Обновить прогресс анализа"""
    _analysis_progress[analysis_id] = {
        "stage": stage,
        "progress": progress,
        "frames_processed": frames_processed,
        "total_frames": total_frames,
        "last_update": datetime.now().timestamp()
    }


def get_analysis_progress(analysis_id: int) -> Optional[Dict[str, Any]]:
    """Получить прогресс анализа"""
    return _analysis_progress.get(analysis_id)


def clear_analysis_progress(analysis_id: int):
    """Очистить прогресс анализа"""
    if analysis_id in _analysis_progress:
        del _analysis_progress[analysis_id]


async def get_video_path(db: AsyncSession, video_id: int, patient_id: int, user_id: int) -> str:
    """Получить путь к видео по ID с проверкой прав"""
    result = await db.execute(
        select(Patient).where(
            Patient.id == patient_id,
            Patient.doctor_id == user_id
        )
    )
    patient = result.scalars().first()

    if not patient:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this patient"
        )

    result = await db.execute(
        select(PatientVideo.s3_path).where(
            PatientVideo.id == video_id,
            PatientVideo.patient_id == patient_id
        )
    )
    video_path = result.scalar_one_or_none()

    if not video_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video not found"
        )

    if not os.path.exists(video_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video file not found on server"
        )

    return str(video_path)


async def get_analysis_by_id(db: AsyncSession, analysis_id: int, user_id: int) -> RespiratoryAnalysis:
    """Получить анализ по ID с проверкой прав"""
    result = await db.execute(
        select(RespiratoryAnalysis)
        .join(Patient)
        .where(
            RespiratoryAnalysis.id == analysis_id,
            Patient.doctor_id == user_id
        )
    )
    analysis = result.scalars().first()

    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found or access denied"
        )

    return analysis


@router.post("/analyze/{patient_id}", response_model=RespiratoryAnalysisResponse)
async def analyze_respiratory_movements(
        patient_id: int,
        analysis_request: RespiratoryAnalysisCreate = Body(...),
        background_tasks: BackgroundTasks = BackgroundTasks(),
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Запустить анализ дыхательных движений для видео"""
    patient = await get_patient_by_id(db, patient_id, current_user.id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    video_path = await get_video_path(db, analysis_request.video_id, patient_id, current_user.id)

    analysis = RespiratoryAnalysis(
        patient_id=patient_id,
        video_id=analysis_request.video_id,
        marker_color=analysis_request.marker_color.value if hasattr(analysis_request.marker_color,
                                                                    'value') else analysis_request.marker_color,
        marker_size_mm=analysis_request.marker_size_mm,
        status="processing"
    )

    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)

    update_analysis_progress(analysis.id, "Инициализация", 0)

    plots_dir = get_plots_directory(patient_id, analysis.id)
    plots_dir.mkdir(parents=True, exist_ok=True)

    static_plots_dir = get_static_plots_directory(patient_id, analysis.id)
    static_plots_dir.mkdir(parents=True, exist_ok=True)

    print(f"Создана директория для графиков: {plots_dir}")
    print(f"Создана backup директория: {static_plots_dir}")

    background_tasks.add_task(
        process_respiratory_analysis_sync,
        analysis_id=analysis.id,
        patient_id=patient_id,
        video_path=video_path,
        marker_color=analysis_request.marker_color.value if hasattr(analysis_request.marker_color,
                                                                    'value') else analysis_request.marker_color,
        marker_size_mm=analysis_request.marker_size_mm
    )

    return analysis


def process_respiratory_analysis_sync(
        analysis_id: int,
        patient_id: int,
        video_path: str,
        marker_color: str,
        marker_size_mm: float
):
    """Синхронная фоновая задача для обработки анализа"""
    start_time = datetime.now()

    def progress_callback(stage: str, progress: float, frames_processed: int = None, total_frames: int = None):
        """Callback для обновления прогресса анализа"""
        update_analysis_progress(analysis_id, stage, progress, frames_processed, total_frames)
        print(f"Прогресс анализа {analysis_id}: {stage} - {progress:.1f}%", flush=True)

    try:
        results = RespiratoryAnalysisService.analyze_video(
            video_path=video_path,
            marker_color=marker_color,
            marker_size_mm=marker_size_mm,
            progress_callback=lambda stage, progress, frames_processed, total_frames:
            progress_callback(stage, progress, frames_processed, total_frames),
            patient_id=patient_id,
            analysis_id=analysis_id
        )

        save_analysis_results_sync(analysis_id, patient_id, results, start_time)

    except Exception as e:
        save_analysis_error_sync(analysis_id, str(e), start_time)
    finally:
        clear_analysis_progress(analysis_id)


def save_analysis_results_sync(analysis_id: int, patient_id: int, results: dict, start_time: datetime):
    """Сохранить результаты анализа в БД (синхронно)"""
    session = SyncSessionLocal()

    try:
        analysis = session.query(RespiratoryAnalysis).filter(
            RespiratoryAnalysis.id == analysis_id
        ).first()

        if not analysis:
            print(f"Анализ {analysis_id} не найден в БД", flush=True)
            return

        global_results = results.get("results", {}).get("global", {})

        analysis.breathing_rate_mean_bpm = global_results.get("breathing_rate_mean_bpm")
        analysis.breathing_rate_std_bpm = global_results.get("breathing_rate_std_bpm")
        analysis.amplitude_mean_mm = global_results.get("amplitude_mean_mm")
        analysis.amplitude_std_mm = global_results.get("amplitude_std_mm")
        analysis.synchronization_index = global_results.get("synchronization_index")
        analysis.analysis_duration_seconds = global_results.get("analysis_duration_seconds")
        analysis.total_frames = results.get("total_frames")

        frontend_plots_dir = get_plots_directory(patient_id, analysis_id)
        static_plots_dir = get_static_plots_directory(patient_id, analysis_id)

        print(f"Сохраняем графики в frontend: {frontend_plots_dir}", flush=True)
        print(f"Сохраняем графики в static: {static_plots_dir}", flush=True)

        plots = results.get("plots", {})
        service_plots_dir = results.get("plots_directory", "")

        def save_plot(plot_key: str, plot_name: str, analysis_field: str) -> bool:
            try:
                if plot_key in plots:
                    source_path = plots[plot_key]
                    if source_path and os.path.exists(source_path):
                        return copy_and_save_plot(source_path, plot_name, analysis_field)

                if service_plots_dir:
                    possible_filenames = [
                        f"{plot_name}.png",
                        f"{plot_key}.png",
                        f"{plot_name}_{analysis_id}.png"
                    ]

                    for filename in possible_filenames:
                        source_path = os.path.join(service_plots_dir, filename)
                        if os.path.exists(source_path):
                            print(f"Найден файл по пути: {source_path}", flush=True)
                            return copy_and_save_plot(source_path, plot_name, analysis_field)

                print(f"График {plot_key} не найден", flush=True)
                return False

            except Exception as e:
                print(f"Ошибка сохранения графика {plot_key}: {e}", flush=True)
                return False

        def copy_and_save_plot(source_path: str, plot_name: str, analysis_field: str) -> bool:
            try:
                filename = f"{plot_name}_{analysis_id}.png"

                frontend_dest_path = frontend_plots_dir / filename
                shutil.copy2(source_path, frontend_dest_path)

                static_dest_path = static_plots_dir / filename
                shutil.copy2(source_path, static_dest_path)

                setattr(analysis, analysis_field, str(frontend_dest_path))
                print(f"График сохранен: {frontend_dest_path}", flush=True)
                return True
            except Exception as e:
                print(f"Ошибка копирования графика {source_path}: {e}", flush=True)
                return False

        plots_saved = []
        plots_to_save = [
            ("width_line_1", "width_line_1", "width_line_1_plot"),
            ("width_line_2", "width_line_2", "width_line_2_plot"),
            ("width_line_3", "width_line_3", "width_line_3_plot"),
            ("summary_plot", "summary_plot", "summary_plot")
        ]

        for plot_key, plot_name, field_name in plots_to_save:
            if save_plot(plot_key, plot_name, field_name):
                plots_saved.append(plot_key)

        print(f"Сохранено графиков: {len(plots_saved)}", flush=True)

        if not plots_saved and service_plots_dir and os.path.exists(service_plots_dir):
            print(f"Сканируем директорию сервиса: {service_plots_dir}", flush=True)

            for filename in os.listdir(service_plots_dir):
                if filename.endswith('.png'):
                    source_path = os.path.join(service_plots_dir, filename)

                    plot_type = None
                    field_name = None

                    if 'width_line_1' in filename or 'line_1' in filename:
                        plot_type = 'width_line_1'
                        field_name = 'width_line_1_plot'
                    elif 'width_line_2' in filename or 'line_2' in filename:
                        plot_type = 'width_line_2'
                        field_name = 'width_line_2_plot'
                    elif 'width_line_3' in filename or 'line_3' in filename:
                        plot_type = 'width_line_3'
                        field_name = 'width_line_3_plot'
                    elif 'summary' in filename:
                        plot_type = 'summary_plot'
                        field_name = 'summary_plot'

                    if plot_type and field_name and plot_type not in plots_saved:
                        if copy_and_save_plot(source_path, plot_type, field_name):
                            plots_saved.append(plot_type)

        print(f"Итого сохранено графиков: {len(plots_saved)}", flush=True)

        # КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: Сохраняем полные результаты анализа
        analysis_results = results.get("results", {})

        if analysis_results:
            # ДЕБАГ: Проверяем структуру данных перед сохранением
            print(f"\n{'=' * 60}")
            print(f"ДЕБАГ: Сохранение результатов для анализа {analysis_id}")
            print(f"Тип results: {type(results)}")
            print(f"Тип analysis_results: {type(analysis_results)}")

            if 'lines' in analysis_results:
                lines_data = analysis_results['lines']
                print(f"Тип lines_data: {type(lines_data)}")
                print(f"Количество линий: {len(lines_data)}")

                if lines_data and len(lines_data) > 0:
                    for i, line in enumerate(lines_data[:3]):  # Покажем только первые 3
                        print(f"\nЛиния {i + 1}:")
                        print(f"  Тип: {type(line)}")
                        print(f"  Ключи: {list(line.keys())}")
                        if 'amplitude_mm' in line:
                            amp_data = line['amplitude_mm']
                            print(
                                f"  amplitude_mm тип: {type(amp_data)}, длина: {len(amp_data) if isinstance(amp_data, list) else 'не список'}")
                            if isinstance(amp_data, list) and len(amp_data) > 0:
                                print(f"  Первые 3 значения: {amp_data[:3]}")
            print(f"{'=' * 60}\n")

            # Сохраняем полные параметры анализа
            analysis.parameters_json = json.dumps(analysis_results, ensure_ascii=False, indent=2)
            print(f"Параметры сохранены в parameters_json", flush=True)

            # Также сохраняем line_results отдельно для удобства
            if 'lines' in analysis_results:
                line_results_dict = {}
                for i, line_data in enumerate(analysis_results['lines']):
                    line_key = f"line_{i + 1}"

                    # Извлекаем все необходимые данные
                    statistical = line_data.get('statistical', {})
                    breathing = line_data.get('breathing', {})

                    # Получаем amplitude_mm (массив значений)
                    amplitude_mm = line_data.get('amplitude_mm', [])

                    line_results_dict[line_key] = {
                        'breathing_rate_mean_bpm': breathing.get('rate_bpm'),
                        'breathing_rate_std_bpm': None,
                        'amplitude_mean_mm': breathing.get('amplitude_mm'),
                        'amplitude_std_mm': None,
                        'amplitude_mm': amplitude_mm,  # Сохраняем массив
                        'peaks': line_data.get('peaks', []),
                        'troughs': line_data.get('troughs', []),
                        'timestamps': line_data.get('timestamps', []),
                        'normalized_width': line_data.get('normalized_width', []),
                        'statistical': statistical,
                        'breathing': breathing,
                        'signal_quality': line_data.get('signal_quality', {})
                    }

                analysis.line_results_json = json.dumps(line_results_dict, ensure_ascii=False, indent=2)
                print(f"Line results сохранены: {len(line_results_dict)} линий", flush=True)

        analysis.text_report = results.get("text_report")
        analysis.medical_assessment = results.get("medical_assessment")

        analysis.status = "completed"
        analysis.completed_at = datetime.now()
        analysis.processing_time_seconds = (datetime.now() - start_time).total_seconds()

        session.commit()
        print(f"Анализ {analysis_id} успешно сохранен", flush=True)

    except Exception as e:
        session.rollback()
        save_analysis_error_sync(analysis_id, f"Ошибка сохранения результатов: {str(e)}", start_time)
    finally:
        session.close()


def save_analysis_error_sync(analysis_id: int, error_message: str, start_time: datetime):
    """Сохранить ошибку анализа в БД (синхронно)"""
    session = SyncSessionLocal()

    try:
        analysis = session.query(RespiratoryAnalysis).filter(
            RespiratoryAnalysis.id == analysis_id
        ).first()

        if analysis:
            analysis.status = "failed"
            analysis.error_message = error_message[:1000]
            analysis.processing_time_seconds = (datetime.now() - start_time).total_seconds()
            session.commit()
            print(f"Ошибка сохранена для анализа {analysis_id}", flush=True)
    finally:
        session.close()


def file_to_base64(filepath: str) -> Optional[str]:
    """Конвертировать файл в base64 строку"""
    if not filepath or not os.path.exists(filepath):
        return None

    try:
        with open(filepath, 'rb') as f:
            file_data = f.read()
            base64_data = base64.b64encode(file_data).decode('utf-8')
            return f"data:image/png;base64,{base64_data}"
    except Exception as e:
        print(f"Ошибка конвертации файла в base64: {e}")
        return None


@router.get("/{analysis_id}/status")
async def get_analysis_status(
        analysis_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить статус анализа (только ID и прогресс в процентах)"""
    result = await db.execute(
        select(RespiratoryAnalysis)
        .join(Patient)
        .where(
            RespiratoryAnalysis.id == analysis_id,
            Patient.doctor_id == current_user.id
        )
    )
    analysis = result.scalars().first()

    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found or access denied"
        )

    progress_percent = 0

    if analysis.status == "completed":
        progress_percent = 100
    elif analysis.status == "failed":
        progress_percent = 0
    elif analysis.status == "processing":
        progress_data = get_analysis_progress(analysis_id)
        if progress_data:
            progress_percent = progress_data.get("progress", 0)
            if progress_percent > 99.9:
                progress_percent = 99.9
        else:
            progress_percent = 5

    return {
        "id": analysis.id,
        "progress_percent": round(progress_percent, 1)
    }


@router.get("/{analysis_id}", response_model=RespiratoryAnalysisDetailResponse)
async def get_analysis_results(
        analysis_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """
    Получить результаты анализа
    """
    analysis = await get_analysis_by_id(db, analysis_id, current_user.id)

    # Парсим JSON данные
    line_results = None
    parameters = None

    # ПРИОРИТЕТ 1: Используем line_results_json если есть
    if analysis.line_results_json:
        try:
            line_results_data = json.loads(analysis.line_results_json)

            # Преобразуем данные в формат LineResultDetail
            line_results = {}

            if isinstance(line_results_data, dict):
                # Формат словаря: {"line_1": {...}, "line_2": {...}, ...}
                for line_key, line_data in line_results_data.items():
                    if isinstance(line_data, dict):
                        # Извлекаем amplitude_mm
                        amplitude_mm = line_data.get('amplitude_mm', [])

                        # Создаем объект LineResultDetail
                        line_result = LineResultDetail(
                            breathing_rate_mean_bpm=line_data.get('breathing_rate_mean_bpm'),
                            breathing_rate_std_bpm=line_data.get('breathing_rate_std_bpm'),
                            amplitude_mean_mm=line_data.get('amplitude_mean_mm'),
                            amplitude_std_mm=line_data.get('amplitude_std_mm'),
                            amplitude_mm=amplitude_mm,
                            peaks=line_data.get('peaks', []),
                            troughs=line_data.get('troughs', []),
                            timestamps=line_data.get('timestamps', []),
                            normalized_width=line_data.get('normalized_width', []),
                            statistical=line_data.get('statistical', {}),
                            breathing=line_data.get('breathing', {}),
                            signal_quality=line_data.get('signal_quality', {})
                        )
                        line_results[line_key] = line_result

            elif isinstance(line_results_data, list):
                # Формат списка: [{...}, {...}, ...]
                for i, line_data in enumerate(line_results_data):
                    if isinstance(line_data, dict):
                        line_key = f"line_{i + 1}"
                        amplitude_mm = line_data.get('amplitude_mm', [])

                        line_result = LineResultDetail(
                            breathing_rate_mean_bpm=line_data.get('breathing_rate_mean_bpm'),
                            breathing_rate_std_bpm=line_data.get('breathing_rate_std_bpm'),
                            amplitude_mean_mm=line_data.get('amplitude_mean_mm'),
                            amplitude_std_mm=line_data.get('amplitude_std_mm'),
                            amplitude_mm=amplitude_mm,
                            peaks=line_data.get('peaks', []),
                            troughs=line_data.get('troughs', []),
                            timestamps=line_data.get('timestamps', []),
                            normalized_width=line_data.get('normalized_width', []),
                            statistical=line_data.get('statistical', {}),
                            breathing=line_data.get('breathing', {}),
                            signal_quality=line_data.get('signal_quality', {})
                        )
                        line_results[line_key] = line_result

            print(f"Загружено line_results из line_results_json: {len(line_results)} линий")

        except json.JSONDecodeError as e:
            print(f"Ошибка парсинга line_results_json: {e}")
            line_results = None
        except Exception as e:
            print(f"Неожиданная ошибка при обработке line_results: {e}")
            line_results = None

    # ПРИОРИТЕТ 2: Если нет line_results, используем parameters_json
    if not line_results and analysis.parameters_json:
        try:
            parameters_data = json.loads(analysis.parameters_json)

            if isinstance(parameters_data, dict) and 'lines' in parameters_data:
                line_results = {}
                lines_list = parameters_data.get('lines', [])

                for i, line_data in enumerate(lines_list):
                    if isinstance(line_data, dict):
                        line_key = f"line_{i + 1}"

                        # Извлекаем данные
                        statistical = line_data.get('statistical', {})
                        breathing = line_data.get('breathing', {})

                        # Ищем amplitude_mm в различных местах
                        amplitude_mm = line_data.get('amplitude_mm', [])

                        line_result = LineResultDetail(
                            breathing_rate_mean_bpm=breathing.get('rate_bpm'),
                            breathing_rate_std_bpm=None,
                            amplitude_mean_mm=breathing.get('amplitude_mm'),
                            amplitude_std_mm=None,
                            amplitude_mm=amplitude_mm,
                            peaks=line_data.get('peaks', []),
                            troughs=line_data.get('troughs', []),
                            timestamps=line_data.get('timestamps', []),
                            normalized_width=line_data.get('normalized_width', []),
                            statistical=statistical,
                            breathing=breathing,
                            signal_quality=line_data.get('signal_quality', {})
                        )
                        line_results[line_key] = line_result

                print(f"Загружено line_results из parameters_json: {len(line_results)} линий")

            parameters = parameters_data

        except json.JSONDecodeError as e:
            print(f"Ошибка парсинга parameters_json: {e}")
            parameters = None

    # Создаем словарь с данными анализа
    response_data = {
        "id": analysis.id,
        "patient_id": analysis.patient_id,
        "video_id": analysis.video_id,
        "marker_color": analysis.marker_color,
        "marker_size_mm": analysis.marker_size_mm,
        "status": analysis.status,
        "breathing_rate_mean_bpm": analysis.breathing_rate_mean_bpm,
        "breathing_rate_std_bpm": analysis.breathing_rate_std_bpm,
        "amplitude_mean_mm": analysis.amplitude_mean_mm,
        "amplitude_std_mm": analysis.amplitude_std_mm,
        "synchronization_index": analysis.synchronization_index,
        "analysis_duration_seconds": analysis.analysis_duration_seconds,
        "total_frames": analysis.total_frames,
        "medical_assessment": analysis.medical_assessment,
        "created_at": analysis.created_at,
        "completed_at": analysis.completed_at,
        "processing_time_seconds": analysis.processing_time_seconds,
        "error_message": analysis.error_message,
        "text_report": analysis.text_report,

        # Пути к графикам из БД
        "width_line_1_plot": analysis.width_line_1_plot,
        "width_line_2_plot": analysis.width_line_2_plot,
        "width_line_3_plot": analysis.width_line_3_plot,
        "summary_plot": analysis.summary_plot,

        # Добавляем line_results и parameters_json
        "line_results": line_results,
        "parameters_json": parameters
    }

    return response_data


@router.get("/{analysis_id}/plot/{plot_type}")
async def get_analysis_plot(
        analysis_id: int,
        plot_type: str,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """
    Получить график анализа как файл PNG
    Для фронтенда: <img src="/respiratory-analysis/{analysis_id}/plot/summary_plot" />
    """
    analysis = await get_analysis_by_id(db, analysis_id, current_user.id)

    file_path = None
    field_name = None

    if plot_type == "width_line_1":
        file_path = analysis.width_line_1_plot
        field_name = "width_line_1_plot"
    elif plot_type == "width_line_2":
        file_path = analysis.width_line_2_plot
        field_name = "width_line_2_plot"
    elif plot_type == "width_line_3":
        file_path = analysis.width_line_3_plot
        field_name = "width_line_3_plot"
    elif plot_type == "summary_plot":
        file_path = analysis.summary_plot
        field_name = "summary_plot"
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown plot type: {plot_type}"
        )

    # Проверяем существование файла
    if not file_path or not os.path.exists(file_path):
        print(f"Файл не найден по пути из БД: {file_path}")

        if field_name and analysis.id:
            expected_path = get_plots_directory(analysis.patient_id, analysis.id) / f"{plot_type}_{analysis.id}.png"
            if expected_path.exists():
                file_path = str(expected_path)
                print(f"Файл найден по ожидаемому пути: {file_path}")
            else:
                static_path = get_static_plots_directory(analysis.patient_id,
                                                         analysis.id) / f"{plot_type}_{analysis.id}.png"
                if static_path.exists():
                    file_path = str(static_path)
                    print(f"Файл найден в static директории: {file_path}")

        if not file_path or not os.path.exists(file_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Plot file not found. Expected at: {file_path}"
            )

    return FileResponse(
        path=file_path,
        media_type='image/png',
        filename=f"{plot_type}_{analysis_id}.png"
    )


@router.get("/{analysis_id}/plots-urls")
async def get_all_plots_urls(
        analysis_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """
    Получить все URL графиков анализа
    Для фронтенда: удобный метод для получения всех URL одним запросом
    """
    analysis = await get_analysis_by_id(db, analysis_id, current_user.id)

    if analysis.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Analysis not completed yet"
        )

    plots_urls = {}

    if analysis.width_line_1_plot and os.path.exists(analysis.width_line_1_plot):
        plots_urls["width_line_1"] = f"/respiratory-analysis/{analysis_id}/plot/width_line_1"
    if analysis.width_line_2_plot and os.path.exists(analysis.width_line_2_plot):
        plots_urls["width_line_2"] = f"/respiratory-analysis/{analysis_id}/plot/width_line_2"
    if analysis.width_line_3_plot and os.path.exists(analysis.width_line_3_plot):
        plots_urls["width_line_3"] = f"/respiratory-analysis/{analysis_id}/plot/width_line_3"
    if analysis.summary_plot and os.path.exists(analysis.summary_plot):
        plots_urls["summary_plot"] = f"/respiratory-analysis/{analysis_id}/plot/summary_plot"

    return {
        "analysis_id": analysis.id,
        "status": analysis.status,
        "plots_urls": plots_urls,
        "plot_count": len(plots_urls)
    }


@router.get("/{analysis_id}/plots-base64")
async def get_all_plots_base64(
        analysis_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """
    Получить все графики анализа в формате base64
    Для фронтенда: для отображения графиков без дополнительных запросов
    """
    analysis = await get_analysis_by_id(db, analysis_id, current_user.id)

    if analysis.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Analysis not completed yet"
        )

    plots_data = {}

    if analysis.width_line_1_plot and os.path.exists(analysis.width_line_1_plot):
        base64_data = file_to_base64(analysis.width_line_1_plot)
        if base64_data:
            plots_data["width_line_1"] = base64_data

    if analysis.width_line_2_plot and os.path.exists(analysis.width_line_2_plot):
        base64_data = file_to_base64(analysis.width_line_2_plot)
        if base64_data:
            plots_data["width_line_2"] = base64_data

    if analysis.width_line_3_plot and os.path.exists(analysis.width_line_3_plot):
        base64_data = file_to_base64(analysis.width_line_3_plot)
        if base64_data:
            plots_data["width_line_3"] = base64_data

    if analysis.summary_plot and os.path.exists(analysis.summary_plot):
        base64_data = file_to_base64(analysis.summary_plot)
        if base64_data:
            plots_data["summary_plot"] = base64_data

    if not plots_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No plots found for this analysis"
        )

    return {
        "analysis_id": analysis.id,
        "plots_data": plots_data,
        "plot_count": len(plots_data)
    }


@router.get("/patient/{patient_id}/analyses", response_model=List[RespiratoryAnalysisResponse])
async def get_patient_analyses(
        patient_id: int,
        include_plots: bool = False,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """
    Получить все анализы пациента
    Для фронтенда: можно запросить краткую информацию о всех анализах пациента
    """
    patient = await get_patient_by_id(db, patient_id, current_user.id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    result = await db.execute(
        select(RespiratoryAnalysis)
        .where(RespiratoryAnalysis.patient_id == patient_id)
        .order_by(RespiratoryAnalysis.created_at.desc())
    )
    analyses = result.scalars().all()

    response = []
    for analysis in analyses:
        analysis_data = {
            "id": analysis.id,
            "patient_id": analysis.patient_id,
            "video_id": analysis.video_id,
            "marker_color": analysis.marker_color,
            "marker_size_mm": analysis.marker_size_mm,
            "status": analysis.status,
            "breathing_rate_mean_bpm": analysis.breathing_rate_mean_bpm,
            "amplitude_mean_mm": analysis.amplitude_mean_mm,
            "synchronization_index": analysis.synchronization_index,
            "medical_assessment": analysis.medical_assessment,
            "created_at": analysis.created_at,
            "completed_at": analysis.completed_at,
            "error_message": analysis.error_message,
        }

        if include_plots and analysis.status == "completed":
            analysis_data["summary_plot_url"] = f"/respiratory-analysis/{analysis.id}/plot/summary_plot"

        response.append(analysis_data)

    return response


@router.delete("/{analysis_id}")
async def delete_analysis(
        analysis_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Удалить анализ и все связанные файлы"""
    analysis = await get_analysis_by_id(db, analysis_id, current_user.id)

    try:
        frontend_plots_dir = get_plots_directory(analysis.patient_id, analysis_id)
        static_plots_dir = get_static_plots_directory(analysis.patient_id, analysis_id)

        deleted_files = []

        if frontend_plots_dir.exists():
            for plot_file in frontend_plots_dir.glob("*"):
                try:
                    os.remove(plot_file)
                    deleted_files.append(str(plot_file))
                except Exception as e:
                    print(f"Ошибка при удалении файла {plot_file}: {str(e)}")

            try:
                frontend_plots_dir.rmdir()
                deleted_files.append(f"Директория: {frontend_plots_dir}")
            except Exception as e:
                print(f"Ошибка при удалении директории {frontend_plots_dir}: {str(e)}")

        if static_plots_dir.exists():
            for plot_file in static_plots_dir.glob("*"):
                try:
                    os.remove(plot_file)
                    deleted_files.append(str(plot_file))
                except Exception as e:
                    print(f"Ошибка при удалении файла {plot_file}: {str(e)}")

            try:
                static_plots_dir.rmdir()
                deleted_files.append(f"Директория: {static_plots_dir}")
            except Exception as e:
                print(f"Ошибка при удалении директории {static_plots_dir}: {str(e)}")

        await db.delete(analysis)
        await db.commit()

        return {
            "message": "Analysis deleted successfully",
            "deleted_files": deleted_files,
            "analysis_id": analysis_id
        }

    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting analysis: {str(e)}"
        )


@router.get("/{analysis_id}/report")
async def get_analysis_report(
        analysis_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить текстовый отчет анализа"""
    analysis = await get_analysis_by_id(db, analysis_id, current_user.id)

    if not analysis.text_report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )

    return {"report": analysis.text_report}


@router.get("/video/{video_id}/analyses", response_model=list[RespiratoryAnalysisResponse])
async def get_video_analyses(
        video_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить все анализы для видео"""
    result = await db.execute(
        select(PatientVideo)
        .join(Patient)
        .where(
            PatientVideo.id == video_id,
            Patient.doctor_id == current_user.id
        )
    )
    video = result.scalars().first()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video not found or access denied"
        )

    result = await db.execute(
        select(RespiratoryAnalysis)
        .where(RespiratoryAnalysis.video_id == video_id)
        .order_by(RespiratoryAnalysis.created_at.desc())
    )
    analyses = result.scalars().all()

    return analyses


@router.get("/patient/{patient_id}/plots-info")
async def get_patient_plots_info(
        patient_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """
    Получить информацию о всех графиках пациента
    Для фронтенда: для отображения списка всех анализов с превью
    """
    patient = await get_patient_by_id(db, patient_id, current_user.id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    result = await db.execute(
        select(RespiratoryAnalysis)
        .where(
            RespiratoryAnalysis.patient_id == patient_id,
            RespiratoryAnalysis.status == "completed"
        )
        .order_by(RespiratoryAnalysis.created_at.desc())
    )
    analyses = result.scalars().all()

    response = []
    for analysis in analyses:
        analysis_info = {
            "id": analysis.id,
            "created_at": analysis.created_at,
            "breathing_rate_mean_bpm": analysis.breathing_rate_mean_bpm,
            "amplitude_mean_mm": analysis.amplitude_mean_mm,
            "summary_plot_url": f"/respiratory-analysis/{analysis.id}/plot/summary_plot",
            "summary_plot_thumbnail_url": f"/respiratory-analysis/{analysis.id}/plot/summary_plot",
        }

        if analysis.summary_plot and os.path.exists(analysis.summary_plot):
            analysis_info["has_summary_plot"] = True
            try:
                analysis_info["summary_plot_size"] = os.path.getsize(analysis.summary_plot)
            except:
                analysis_info["summary_plot_size"] = 0
        else:
            analysis_info["has_summary_plot"] = False

        response.append(analysis_info)

    return {
        "patient_id": patient_id,
        "analyses_count": len(response),
        "analyses": response
    }


@router.get("/plot-file/{patient_id}/{analysis_id}/{filename}")
async def get_plot_file(
        patient_id: int,
        analysis_id: int,
        filename: str,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить файл графика"""
    try:
        patient = await get_patient_by_id(db, patient_id, current_user.id)
        if not patient:
            raise HTTPException(404, "Patient not found or access denied")

        analysis = await get_analysis_by_id(db, analysis_id, current_user.id)
        if not analysis or analysis.patient_id != patient_id:
            raise HTTPException(404, "Analysis not found or access denied")

        plots_dir = get_plots_directory(patient_id, analysis_id)
        file_path = plots_dir / filename

        if not file_path.exists():
            raise HTTPException(404, f"File not found: {filename}")

        content_type = "image/png" if filename.endswith(".png") else "application/octet-stream"

        return FileResponse(
            path=str(file_path),
            media_type=content_type,
            filename=filename
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error serving file: {str(e)}")


@router.get("/{analysis_id}/debug-data")
async def debug_analysis_data(
        analysis_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Эндпоинт для отладки - показывает сырые данные из БД"""
    analysis = await get_analysis_by_id(db, analysis_id, current_user.id)

    result = {
        "analysis_id": analysis.id,
        "status": analysis.status,
        "db_fields": {
            "breathing_rate_mean_bpm": analysis.breathing_rate_mean_bpm,
            "amplitude_mean_mm": analysis.amplitude_mean_mm,
            "synchronization_index": analysis.synchronization_index,
        }
    }

    if analysis.line_results_json:
        try:
            line_results = json.loads(analysis.line_results_json)
            result["line_results_type"] = type(line_results).__name__
            result["line_results_sample"] = line_results

            # Проверяем структуру
            if isinstance(line_results, dict):
                result["line_results_keys"] = list(line_results.keys())
                for key, value in line_results.items():
                    if isinstance(value, dict):
                        if 'amplitude_mm' in value:
                            amp_data = value['amplitude_mm']
                            result[f"{key}_amplitude_mm_type"] = type(amp_data).__name__
                            result[f"{key}_amplitude_mm_length"] = len(amp_data) if isinstance(amp_data,
                                                                                               list) else "не список"
        except Exception as e:
            result["line_results_error"] = str(e)

    if analysis.parameters_json:
        try:
            parameters = json.loads(analysis.parameters_json)
            result["parameters_type"] = type(parameters).__name__

            if isinstance(parameters, dict):
                result["parameters_keys"] = list(parameters.keys())

                if 'lines' in parameters:
                    lines_data = parameters['lines']
                    result["lines_count"] = len(lines_data) if isinstance(lines_data, list) else "не список"

                    if isinstance(lines_data, list) and len(lines_data) > 0:
                        for i, line in enumerate(lines_data[:3]):  # Покажем только первые 3
                            if isinstance(line, dict):
                                result[f"line_{i + 1}_keys"] = list(line.keys())
                                if 'amplitude_mm' in line:
                                    amp_data = line['amplitude_mm']
                                    result[f"line_{i + 1}_amplitude_mm_type"] = type(amp_data).__name__
                                    result[f"line_{i + 1}_amplitude_mm_length"] = len(amp_data) if isinstance(amp_data,
                                                                                                              list) else "не список"
        except Exception as e:
            result["parameters_error"] = str(e)

    return result