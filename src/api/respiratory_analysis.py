import os
import shutil
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from api.users.auth import get_current_active_user
from api.users.patients import get_patient_by_id
from domain.models import User, Patient, PatientVideo, RespiratoryAnalysis
from infrastructure.async_db import get_db, SyncSessionLocal
from services.analysis_module import RespiratoryAnalysisService
from domain.schemas import (
    RespiratoryAnalysisCreate,
    RespiratoryAnalysisResponse,
    RespiratoryAnalysisDetailResponse,
    LineResultDetail,
    AnalysisStatusResponse
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

FRONTEND_PLOTS_DIR = FRONTEND_DIR / "analysis_plots"
FRONTEND_PLOTS_DIR.mkdir(parents=True, exist_ok=True)

_analysis_progress: Dict[int, Dict[str, Any]] = {}


def get_plots_directory(patient_id: int, analysis_id: int) -> Path:
    """Получить путь к директории с графиками для анализа в frontend"""
    return FRONTEND_PLOTS_DIR / str(patient_id) / str(analysis_id)


def update_analysis_progress(
        analysis_id: int,
        stage: str,
        progress: float,
        frames_processed: int = None,
        total_frames: int = None
):
    """Обновить прогресс анализа"""
    _analysis_progress[analysis_id] = {
        "stage": stage,
        "progress": progress,
        "frames_processed": frames_processed,
        "total_frames": total_frames,
        "last_update": datetime.now().timestamp()
    }

    if frames_processed is not None and total_frames is not None:
        print(f"Анализ {analysis_id}: {stage} - {progress:.1f}% ({frames_processed}/{total_frames} кадров)")
    else:
        print(f"Анализ {analysis_id}: {stage} - {progress:.1f}%")


def get_analysis_progress(analysis_id: int) -> Optional[Dict[str, Any]]:
    """Получить прогресс анализа"""
    return _analysis_progress.get(analysis_id)


def clear_analysis_progress(analysis_id: int):
    """Очистить прогресс анализа"""
    if analysis_id in _analysis_progress:
        del _analysis_progress[analysis_id]


async def get_video_path(
        db: AsyncSession,
        video_id: int,
        patient_id: int,
        user_id: int
) -> str:
    """Получить путь к видео по ID с проверкой прав"""
    result = await db.execute(
        select(Patient.id).where(
            Patient.id == patient_id,
            Patient.doctor_id == user_id
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this patient"
        )

    result = await db.execute(
        select(PatientVideo.file_path).where(
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


async def get_patient_info(
        db: AsyncSession,
        patient_id: int,
        user_id: int
) -> Dict[str, Any]:
    """
    Явная загрузка скалярных полей пациента.
    Возвращает простой словарь без ORM объектов.
    Исправляет MissingGreenlet при передаче данных в фоновую задачу.
    """
    result = await db.execute(
        select(
            Patient.id,
            Patient.name,
            Patient.surname,
            Patient.gender,
            Patient.age,
        ).where(
            Patient.id == patient_id,
            Patient.doctor_id == user_id,
        )
    )
    row = result.first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    full_name = " ".join(filter(None, [row.name, row.surname])) or "Не указано"

    return {
        "id":        row.id,
        "full_name": full_name,
        "gender":    row.gender or "Не указан",
        "age":       row.age,
    }


async def get_analysis_by_id(
        db: AsyncSession,
        analysis_id: int,
        user_id: int
) -> RespiratoryAnalysis:
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

    patient_info = await get_patient_info(db, patient_id, current_user.id)

    video_path = await get_video_path(
        db, analysis_request.video_id, patient_id, current_user.id
    )

    analysis = RespiratoryAnalysis(
        patient_id=patient_id,
        video_id=analysis_request.video_id,
        marker_color=analysis_request.marker_color.value,
        marker_size_mm=analysis_request.marker_size_mm,
        status="processing"
    )

    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)

    update_analysis_progress(analysis.id, "Инициализация", 0)

    get_plots_directory(patient_id, analysis.id).mkdir(parents=True, exist_ok=True)

    background_tasks.add_task(
        process_respiratory_analysis_sync,
        analysis_id=analysis.id,
        patient_id=patient_id,
        video_path=video_path,
        marker_color=analysis_request.marker_color.value,
        marker_size_mm=analysis_request.marker_size_mm,
        patient_name=patient_info["full_name"],
        patient_gender=patient_info["gender"],
        patient_age=patient_info["age"],
    )

    return RespiratoryAnalysisResponse.model_validate(analysis)


def process_respiratory_analysis_sync(
        analysis_id: int,
        patient_id: int,
        video_path: str,
        marker_color: str,
        marker_size_mm: float,
        patient_name: str = "Не указано",
        patient_gender: str = "Не указан",
        patient_age: Any = None,
):
    start_time = datetime.now()

    def progress_callback(
            stage: str,
            progress: float,
            frames_processed: int = None,
            total_frames: int = None
    ):
        update_analysis_progress(analysis_id, stage, progress, frames_processed, total_frames)

    try:
        results = RespiratoryAnalysisService.analyze_video(
            video_path=video_path,
            marker_color=marker_color,
            marker_size_mm=marker_size_mm,
            progress_callback=lambda stage, progress, frames_processed, total_frames:
            progress_callback(stage, progress, frames_processed, total_frames),
            patient_id=patient_id,
            analysis_id=analysis_id,
            patient_name=patient_name,
            patient_gender=patient_gender,
            patient_age=patient_age,
        )

        save_analysis_results_sync(analysis_id, patient_id, results, start_time)

    except Exception as e:
        save_analysis_error_sync(analysis_id, str(e), start_time)
    finally:
        clear_analysis_progress(analysis_id)

def save_analysis_results_sync(
        analysis_id: int,
        patient_id: int,
        results: dict,
        start_time: datetime
):
    session = SyncSessionLocal()

    try:
        analysis = session.query(RespiratoryAnalysis).filter(
            RespiratoryAnalysis.id == analysis_id
        ).first()

        if not analysis:
            return

        global_results = results.get("results", {}).get("global", {})

        analysis.breathing_rate_mean_bpm = global_results.get("breathing_rate_mean_bpm")
        analysis.amplitude_mean_mm = global_results.get("amplitude_mean_mm")
        analysis.total_frames = results.get("total_frames")
        analysis.medical_assessment = (
                results.get("medical_assessment")
                or global_results.get("medical_assessment")
        )

        save_plots_to_frontend(analysis, patient_id, analysis_id, results)
        save_analysis_data(analysis, results)

        analysis.text_report = results.get("text_report")
        analysis.status = "completed"
        analysis.completed_at = datetime.now()
        analysis.processing_time_seconds = (datetime.now() - start_time).total_seconds()

        session.commit()

    except Exception as e:
        session.rollback()
        save_analysis_error_sync(
            analysis_id,
            f"Ошибка сохранения результатов: {str(e)}",
            start_time
        )
    finally:
        session.close()


def save_plots_to_frontend(
        analysis: RespiratoryAnalysis,
        patient_id: int,
        analysis_id: int,
        results: dict
):
    """Сохранить графики в frontend директорию и обновить ссылки в БД"""
    frontend_plots_dir = get_plots_directory(patient_id, analysis_id)

    plots = results.get("plots", {})
    service_plots_dir = results.get("plots_directory", "")

    def copy_plot_to_frontend(
            source_path: str,
            plot_name: str,
            analysis_field: str
    ) -> bool:
        try:
            filename = f"{plot_name}_{analysis_id}.png"
            frontend_dest_path = frontend_plots_dir / filename
            shutil.copy2(source_path, frontend_dest_path)
            setattr(analysis, analysis_field, str(frontend_dest_path))
            return True
        except Exception:
            return False

    def save_plot(plot_key: str, plot_name: str, analysis_field: str) -> bool:
        if plot_key in plots:
            source_path = plots[plot_key]
            if source_path and os.path.exists(source_path):
                return copy_plot_to_frontend(source_path, plot_name, analysis_field)

        if service_plots_dir:
            for filename in [
                f"{plot_name}.png",
                f"{plot_key}.png",
                f"{plot_name}_{analysis_id}.png"
            ]:
                source_path = os.path.join(service_plots_dir, filename)
                if os.path.exists(source_path):
                    return copy_plot_to_frontend(source_path, plot_name, analysis_field)

        return False

    plots_to_save = [
        ("width_line_1", "width_line_1", "width_line_1_plot"),
        ("width_line_2", "width_line_2", "width_line_2_plot"),
        ("width_line_3", "width_line_3", "width_line_3_plot"),
        ("summary_plot", "summary_plot", "summary_plot"),
    ]

    plots_saved = []
    for plot_key, plot_name, field_name in plots_to_save:
        if save_plot(plot_key, plot_name, field_name):
            plots_saved.append(plot_key)

    # Fallback — ищем по паттернам в именах файлов
    # Нужно для графиков MedicalVideoAnalyzer
    if service_plots_dir and os.path.exists(service_plots_dir):
        pattern_map = [
            (['marker_1_detail', 'marker1'], 'width_line_1', 'width_line_1_plot'),
            (['marker_2_detail', 'marker2'], 'width_line_2', 'width_line_2_plot'),
            (['marker_3_detail', 'marker3'], 'width_line_3', 'width_line_3_plot'),
            (['dashboard', 'summary', 'overview'], 'summary_plot', 'summary_plot'),
        ]

        for filename in os.listdir(service_plots_dir):
            if not filename.endswith('.png'):
                continue

            fname_lower = filename.lower()

            for patterns, plot_name, field_name in pattern_map:
                plot_key = field_name.replace('_plot', '')
                if plot_key in plots_saved:
                    continue
                if any(p in fname_lower for p in patterns):
                    source_path = os.path.join(service_plots_dir, filename)
                    if copy_plot_to_frontend(source_path, plot_name, field_name):
                        plots_saved.append(plot_key)
                    break


def save_analysis_data(analysis: RespiratoryAnalysis, results: dict):
    """Сохранить данные анализа в формате JSON"""
    analysis_results = results.get("results", {})

    if not analysis_results:
        return

    analysis.parameters_json = json.dumps(
        analysis_results, ensure_ascii=False, indent=2
    )

    if 'lines' in analysis_results:
        line_results_dict = {}
        for i, line_data in enumerate(analysis_results['lines']):
            breathing   = line_data.get('breathing',   {})
            statistical = line_data.get('statistical', {})

            line_results_dict[f"line_{i + 1}"] = {
                'breathing_rate_mean_bpm': breathing.get('rate_bpm'),
                'amplitude_mean_mm':       breathing.get('amplitude_mm'),
                'amplitude_mm':            line_data.get('amplitude_mm',     []),
                'peaks':                   line_data.get('peaks',            []),
                'troughs':                 line_data.get('troughs',          []),
                'timestamps':              line_data.get('timestamps',       []),
                'normalized_width':        line_data.get('normalized_width', []),
                'statistical':             statistical,
                'breathing':               breathing,
                'signal_quality':          line_data.get('signal_quality',   {}),
            }

        analysis.line_results_json = json.dumps(
            line_results_dict, ensure_ascii=False, indent=2
        )


def save_analysis_error_sync(
        analysis_id: int,
        error_message: str,
        start_time: datetime
):
    """Сохранить ошибку анализа в БД (синхронно)"""
    session = SyncSessionLocal()
    try:
        analysis = session.query(RespiratoryAnalysis).filter(
            RespiratoryAnalysis.id == analysis_id
        ).first()

        if analysis:
            analysis.status = "failed"
            analysis.error_message = error_message[:1000]
            analysis.processing_time_seconds = (
                    datetime.now() - start_time
            ).total_seconds()
            session.commit()
    finally:
        session.close()


@router.get("/{analysis_id}/status", response_model=AnalysisStatusResponse)
async def get_analysis_status(
        analysis_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить статус анализа"""
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

    return AnalysisStatusResponse(
        id=analysis.id,
        progress_percent=round(progress_percent, 1)
    )


@router.get("/{analysis_id}", response_model=RespiratoryAnalysisDetailResponse)
async def get_analysis_results(
        analysis_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить результаты анализа"""
    analysis = await get_analysis_by_id(db, analysis_id, current_user.id)

    return RespiratoryAnalysisDetailResponse(
        id=analysis.id,
        patient_id=analysis.patient_id,
        video_id=analysis.video_id,
        marker_color=analysis.marker_color,
        marker_size_mm=analysis.marker_size_mm,
        status=analysis.status,
        breathing_rate_mean_bpm=analysis.breathing_rate_mean_bpm,
        amplitude_mean_mm=analysis.amplitude_mean_mm,
        total_frames=analysis.total_frames,
        medical_assessment=analysis.medical_assessment,
        created_at=analysis.created_at,
        completed_at=analysis.completed_at,
        processing_time_seconds=analysis.processing_time_seconds,
        error_message=analysis.error_message,
        text_report=analysis.text_report,
        width_line_1_plot=analysis.width_line_1_plot,
        width_line_2_plot=analysis.width_line_2_plot,
        width_line_3_plot=analysis.width_line_3_plot,
        summary_plot=analysis.summary_plot
    )


def parse_line_results(
        line_results_json: Optional[str]
) -> Optional[Dict[str, LineResultDetail]]:
    """Парсить JSON с результатами линий"""
    if not line_results_json:
        return None

    try:
        data = json.loads(line_results_json)
        line_results = {}

        if isinstance(data, dict):
            for key, line_data in data.items():
                if isinstance(line_data, dict):
                    line_results[key] = create_line_result_detail(line_data)
        elif isinstance(data, list):
            for i, line_data in enumerate(data):
                if isinstance(line_data, dict):
                    line_results[f"line_{i + 1}"] = create_line_result_detail(line_data)

        return line_results

    except (json.JSONDecodeError, Exception):
        return None


def parse_parameters(parameters_json: Optional[str]) -> Optional[Dict]:
    """Парсить JSON с параметрами анализа"""
    if not parameters_json:
        return None
    try:
        return json.loads(parameters_json)
    except json.JSONDecodeError:
        return None


def create_line_result_detail(line_data: Dict) -> LineResultDetail:
    """Создать объект LineResultDetail из словаря"""
    return LineResultDetail(
        breathing_rate_mean_bpm=line_data.get('breathing_rate_mean_bpm'),
        amplitude_mean_mm=line_data.get('amplitude_mean_mm'),
        amplitude_mm=line_data.get('amplitude_mm', []),
        peaks=line_data.get('peaks', []),
        troughs=line_data.get('troughs', []),
        timestamps=line_data.get('timestamps', []),
        normalized_width=line_data.get('normalized_width', [])
    )


@router.get("/patient/{patient_id}/analyses", response_model=List[RespiratoryAnalysisResponse])
async def get_patient_analyses(
        patient_id: int,
        include_plots: bool = False,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить все анализы пациента"""
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
        analysis_data = RespiratoryAnalysisResponse.model_validate(analysis)
        response_dict = analysis_data.model_dump()

        if include_plots and analysis.status == "completed" and analysis.summary_plot:
            response_dict["summary_plot_url"] = (
                f"/respiratory-analysis/{analysis.id}/plot/summary_plot"
            )

        response.append(response_dict)

    return response


@router.get("/{analysis_id}/plots-urls")
async def get_all_plots_urls(
        analysis_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить все URL графиков анализа"""
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
        "status":      analysis.status,
        "plots_urls":  plots_urls,
        "plot_count":  len(plots_urls)
    }


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
        deleted_files = []

        if frontend_plots_dir.exists():
            for plot_file in frontend_plots_dir.glob("*"):
                try:
                    os.remove(plot_file)
                    deleted_files.append(str(plot_file))
                except Exception as e:
                    raise e
            try:
                frontend_plots_dir.rmdir()
                deleted_files.append(f"Директория: {frontend_plots_dir}")
            except Exception as e:
                raise e

        await db.delete(analysis)
        await db.commit()

        return {
            "message":       "Analysis deleted successfully",
            "deleted_files": deleted_files,
            "analysis_id":   analysis_id
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


@router.get("/video/{video_id}/analyses", response_model=List[RespiratoryAnalysisResponse])
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

    response = []
    for analysis in analyses:
        analysis_data = RespiratoryAnalysisResponse.model_validate(analysis)
        response.append(analysis_data.model_dump())

    return response