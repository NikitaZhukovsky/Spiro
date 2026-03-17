import sys
from pathlib import Path
import pytest
import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, Mock, patch
from fastapi import HTTPException, status, BackgroundTasks

src_path = str(Path(__file__).parent.parent)
if src_path not in sys.path:
    sys.path.insert(0, src_path)

from api.respiratory_analysis import (
    analyze_respiratory_movements, get_analysis_status,
    get_analysis_results, get_patient_analyses, delete_analysis,
    get_analysis_report, get_video_analyses, get_all_plots_urls,
    get_video_path, get_analysis_by_id, update_analysis_progress,
    get_analysis_progress, clear_analysis_progress, get_plots_directory,
    process_respiratory_analysis_sync, save_analysis_results_sync,
    save_analysis_error_sync, parse_line_results, create_line_result_detail,
    _analysis_progress
)
from domain import models, schemas
from services.analysis_module import RespiratoryAnalysisService


@pytest.fixture
def mock_respiratory_analysis():
    """Фикстура для мока анализа дыхания"""
    analysis = MagicMock(spec=models.RespiratoryAnalysis)
    analysis.id = 1
    analysis.patient_id = 1
    analysis.video_id = 1
    analysis.marker_color = "red"
    analysis.marker_size_mm = 10.0
    analysis.status = "completed"
    analysis.breathing_rate_mean_bpm = 15.5
    analysis.amplitude_mean_mm = 25.3
    analysis.total_frames = 300
    analysis.medical_assessment = "Normal breathing pattern"
    analysis.text_report = "Detailed report text"
    analysis.width_line_1_plot = "/path/to/plot1.png"
    analysis.width_line_2_plot = "/path/to/plot2.png"
    analysis.width_line_3_plot = "/path/to/plot3.png"
    analysis.summary_plot = "/path/to/summary.png"
    analysis.parameters_json = json.dumps({"test": "data"})
    analysis.line_results_json = json.dumps({"line_1": {"test": "data"}})
    analysis.error_message = None
    analysis.created_at = datetime.now(timezone.utc)
    analysis.completed_at = datetime.now(timezone.utc)
    analysis.processing_time_seconds = 15.5
    return analysis


@pytest.fixture
def mock_patient():
    """Фикстура для мока пациента"""
    patient = MagicMock(spec=models.Patient)
    patient.id = 1
    patient.doctor_id = 1
    patient.name = "Test"
    patient.surname = "Patient"
    return patient


@pytest.fixture
def mock_patient_video():
    """Фикстура для мока видео пациента"""
    video = MagicMock(spec=models.PatientVideo)
    video.id = 1
    video.patient_id = 1
    video.file_path = "/fake/path/video.mp4"
    return video


@pytest.fixture
def mock_analysis_request():
    """Фикстура для запроса анализа"""
    return schemas.RespiratoryAnalysisCreate(
        video_id=1,
        marker_color=schemas.MarkerColor.red,
        marker_size_mm=10.0
    )


@pytest.fixture
def mock_analysis_progress():
    """Фикстура для мока прогресса анализа"""
    progress = {
        "stage": "Processing",
        "progress": 50.0,
        "frames_processed": 150,
        "total_frames": 300,
        "last_update": datetime.now().timestamp()
    }
    return progress


@pytest.fixture
def mock_analysis_results():
    """Фикстура для результатов анализа"""
    return {
        "results": {
            "global": {
                "breathing_rate_mean_bpm": 15.5,
                "amplitude_mean_mm": 25.3,
                "medical_assessment": "Normal"
            },
            "lines": [
                {
                    "breathing": {"rate_bpm": 15.0, "amplitude_mm": 24.0},
                    "statistical": {"mean": 24.0, "std": 2.0},
                    "amplitude_mm": [24.0, 25.0, 26.0],
                    "peaks": [10, 20, 30],
                    "troughs": [5, 15, 25],
                    "timestamps": [0.1, 0.2, 0.3],
                    "normalized_width": [1.0, 1.1, 1.0],
                    "signal_quality": {"snr": 20.0}
                }
            ]
        },
        "total_frames": 300,
        "medical_assessment": "Normal",
        "text_report": "Detailed report",
        "plots": {
            "width_line_1": "/path/to/line1.png",
            "width_line_2": "/path/to/line2.png",
            "width_line_3": "/path/to/line3.png",
            "summary_plot": "/path/to/summary.png"
        },
        "plots_directory": "/path/to/plots"
    }


@pytest.fixture
def cleanup_analysis_progress():
    """Очистка прогресса анализов после тестов"""
    yield
    _analysis_progress.clear()


class TestRespiratoryAnalysisUtils:
    """Тесты для вспомогательных функций"""

    def test_get_plots_directory(self, tmp_path, monkeypatch):
        """Тест получения директории для графиков"""
        monkeypatch.setattr("api.respiratory_analysis.FRONTEND_PLOTS_DIR", tmp_path)

        plots_dir = get_plots_directory(patient_id=1, analysis_id=1)

        expected_path = tmp_path / "1" / "1"
        assert plots_dir == expected_path

    def test_update_and_get_analysis_progress(self, cleanup_analysis_progress):
        """Тест обновления и получения прогресса анализа"""
        analysis_id = 1

        update_analysis_progress(
            analysis_id=analysis_id,
            stage="Processing",
            progress=50.0,
            frames_processed=150,
            total_frames=300
        )

        progress = get_analysis_progress(analysis_id)

        assert progress is not None
        assert progress["stage"] == "Processing"
        assert progress["progress"] == 50.0
        assert progress["frames_processed"] == 150
        assert progress["total_frames"] == 300
        assert "last_update" in progress

    def test_clear_analysis_progress(self, cleanup_analysis_progress):
        """Тест очистки прогресса анализа"""
        analysis_id = 1

        update_analysis_progress(analysis_id, "Test", 10.0)
        assert get_analysis_progress(analysis_id) is not None

        clear_analysis_progress(analysis_id)
        assert get_analysis_progress(analysis_id) is None

    def test_parse_line_results_valid_json(self):
        """Тест парсинга JSON с результатами линий"""
        line_data = {
            "line_1": {
                "breathing_rate_mean_bpm": 15.0,
                "amplitude_mean_mm": 24.0,
                "amplitude_mm": [24.0, 25.0],
                "peaks": [10, 20],
                "troughs": [5, 15],
                "timestamps": [0.1, 0.2],
                "normalized_width": [1.0, 1.1]
            }
        }
        line_json = json.dumps(line_data)

        result = parse_line_results(line_json)

        assert result is not None
        assert "line_1" in result
        assert result["line_1"].breathing_rate_mean_bpm == 15.0
        assert result["line_1"].amplitude_mean_mm == 24.0

    def test_parse_line_results_invalid_json(self):
        """Тест парсинга невалидного JSON"""
        result = parse_line_results("invalid json")
        assert result is None

    def test_parse_line_results_empty(self):
        """Тест парсинга пустого JSON"""
        result = parse_line_results(None)
        assert result is None

    def test_create_line_result_detail(self):
        """Тест создания объекта LineResultDetail"""
        line_data = {
            "breathing_rate_mean_bpm": 15.0,
            "amplitude_mean_mm": 24.0,
            "amplitude_mm": [24.0, 25.0],
            "peaks": [10, 20],
            "troughs": [5, 15],
            "timestamps": [0.1, 0.2],
            "normalized_width": [1.0, 1.1]
        }

        result = create_line_result_detail(line_data)

        assert result.breathing_rate_mean_bpm == 15.0
        assert result.amplitude_mean_mm == 24.0
        assert result.amplitude_mm == [24.0, 25.0]
        assert result.peaks == [10, 20]
        assert result.troughs == [5, 15]


@pytest.mark.asyncio
class TestGetVideoPath:
    """Тесты для функции получения пути к видео"""

    async def test_get_video_path_success(self, mock_db, mock_patient, mock_patient_video):
        """Тест успешного получения пути к видео"""
        patient_result = MagicMock()
        patient_result.scalars.return_value.first.return_value = mock_patient
        mock_db.execute.return_value = patient_result

        video_result = MagicMock()
        video_result.scalar_one_or_none.return_value = "/fake/path/video.mp4"
        mock_db.execute.return_value = video_result

        with patch('os.path.exists', return_value=True):
            result = await get_video_path(
                db=mock_db,
                video_id=1,
                patient_id=1,
                user_id=1
            )

        assert result == "/fake/path/video.mp4"

    async def test_get_video_path_patient_not_found(self, mock_db):
        """Тест получения пути к видео для несуществующего пациента"""
        patient_result = MagicMock()
        patient_result.scalars.return_value.first.return_value = None
        mock_db.execute.return_value = patient_result

        with pytest.raises(HTTPException) as exc_info:
            await get_video_path(
                db=mock_db,
                video_id=1,
                patient_id=999,
                user_id=1
            )

        assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
        assert "Access denied" in exc_info.value.detail

    async def test_get_video_path_video_not_found(self, mock_db, mock_patient):
        """Тест получения пути к несуществующему видео"""
        patient_result = MagicMock()
        patient_result.scalars.return_value.first.return_value = mock_patient
        mock_db.execute.return_value = patient_result

        video_result = MagicMock()
        video_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = video_result

        with pytest.raises(HTTPException) as exc_info:
            await get_video_path(
                db=mock_db,
                video_id=999,
                patient_id=1,
                user_id=1
            )

        assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
        assert "Video not found" in exc_info.value.detail

    async def test_get_video_path_file_not_found(self, mock_db, mock_patient, mock_patient_video):
        """Тест получения пути к видео, когда файл отсутствует"""
        patient_result = MagicMock()
        patient_result.scalars.return_value.first.return_value = mock_patient
        mock_db.execute.return_value = patient_result

        video_result = MagicMock()
        video_result.scalar_one_or_none.return_value = "/fake/path/video.mp4"
        mock_db.execute.return_value = video_result

        with patch('os.path.exists', return_value=False):
            with pytest.raises(HTTPException) as exc_info:
                await get_video_path(
                    db=mock_db,
                    video_id=1,
                    patient_id=1,
                    user_id=1
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert "Video file not found" in exc_info.value.detail


@pytest.mark.asyncio
class TestGetAnalysisById:
    """Тесты для функции получения анализа по ID"""

    async def test_get_analysis_by_id_success(self, mock_db, mock_respiratory_analysis):
        """Тест успешного получения анализа"""
        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = mock_respiratory_analysis
        mock_db.execute.return_value = mock_result

        analysis = await get_analysis_by_id(
            db=mock_db,
            analysis_id=1,
            user_id=1
        )

        assert analysis == mock_respiratory_analysis

    async def test_get_analysis_by_id_not_found(self, mock_db):
        """Тест получения несуществующего анализа"""
        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = None
        mock_db.execute.return_value = mock_result

        with pytest.raises(HTTPException) as exc_info:
            await get_analysis_by_id(
                db=mock_db,
                analysis_id=999,
                user_id=1
            )

        assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
        assert "Analysis not found" in exc_info.value.detail


@pytest.mark.asyncio
class TestAnalyzeRespiratoryMovements:
    """Тесты для запуска анализа"""

    async def test_analyze_success(
            self, mock_db, mock_user, mock_patient,
            mock_analysis_request, mock_patient_video
    ):
        """Тест успешного запуска анализа"""
        with patch('api.respiratory_analysis.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            with patch('api.respiratory_analysis.get_video_path', new_callable=AsyncMock) as mock_get_video:
                mock_get_video.return_value = "/fake/path/video.mp4"

                mock_db.add = Mock()
                mock_db.commit = AsyncMock()
                mock_db.refresh = AsyncMock()

                created_analysis = models.RespiratoryAnalysis(
                    id=1,
                    patient_id=1,
                    video_id=1,
                    marker_color="red",
                    marker_size_mm=10.0,
                    status="processing",
                    created_at=datetime.now(timezone.utc)
                )

                async def refresh_side_effect(analysis):
                    analysis.id = created_analysis.id
                    analysis.patient_id = created_analysis.patient_id
                    analysis.video_id = created_analysis.video_id
                    analysis.marker_color = created_analysis.marker_color
                    analysis.marker_size_mm = created_analysis.marker_size_mm
                    analysis.status = created_analysis.status
                    analysis.created_at = created_analysis.created_at

                mock_db.refresh.side_effect = refresh_side_effect

                with patch('api.respiratory_analysis.get_plots_directory') as mock_plots_dir:
                    mock_plots_dir.return_value = MagicMock()
                    mock_plots_dir.return_value.mkdir = Mock()

                    background_tasks = MagicMock(spec=BackgroundTasks)

                    with patch('api.respiratory_analysis.update_analysis_progress'):
                        result = await analyze_respiratory_movements(
                            patient_id=1,
                            analysis_request=mock_analysis_request,
                            background_tasks=background_tasks,
                            db=mock_db,
                            current_user=mock_user
                        )

                        assert result.id == 1
                        assert result.patient_id == 1
                        assert result.video_id == 1
                        assert result.status == "processing"
                        assert result.created_at is not None

                        mock_get_patient.assert_called_once_with(mock_db, 1, mock_user.id)
                        mock_get_video.assert_called_once_with(mock_db, 1, 1, mock_user.id)
                        mock_db.add.assert_called_once()
                        mock_db.commit.assert_called_once()
                        background_tasks.add_task.assert_called_once()

    async def test_analyze_patient_not_found(self, mock_db, mock_user, mock_analysis_request):
        """Тест запуска анализа для несуществующего пациента"""
        with patch('api.respiratory_analysis.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = None

            background_tasks = MagicMock(spec=BackgroundTasks)

            with pytest.raises(HTTPException) as exc_info:
                await analyze_respiratory_movements(
                    patient_id=999,
                    analysis_request=mock_analysis_request,
                    background_tasks=background_tasks,
                    db=mock_db,
                    current_user=mock_user
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert "Patient not found" in exc_info.value.detail


@pytest.mark.asyncio
class TestGetAnalysisStatus:
    """Тесты для получения статуса анализа"""

    async def test_get_status_completed(self, mock_db, mock_user, mock_respiratory_analysis):
        """Тест получения статуса завершенного анализа"""
        mock_respiratory_analysis.status = "completed"

        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = mock_respiratory_analysis
        mock_db.execute.return_value = mock_result

        result = await get_analysis_status(
            analysis_id=1,
            db=mock_db,
            current_user=mock_user
        )

        assert result.id == 1
        assert result.progress_percent == 100.0

    async def test_get_status_processing(self, mock_db, mock_user, mock_respiratory_analysis):
        """Тест получения статуса анализа в обработке"""
        mock_respiratory_analysis.status = "processing"

        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = mock_respiratory_analysis
        mock_db.execute.return_value = mock_result

        with patch('api.respiratory_analysis.get_analysis_progress') as mock_progress:
            mock_progress.return_value = {"progress": 50.0}

            result = await get_analysis_status(
                analysis_id=1,
                db=mock_db,
                current_user=mock_user
            )

            assert result.id == 1
            assert result.progress_percent == 50.0

    async def test_get_status_failed(self, mock_db, mock_user, mock_respiratory_analysis):
        """Тест получения статуса анализа с ошибкой"""
        mock_respiratory_analysis.status = "failed"

        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = mock_respiratory_analysis
        mock_db.execute.return_value = mock_result

        result = await get_analysis_status(
            analysis_id=1,
            db=mock_db,
            current_user=mock_user
        )

        assert result.id == 1
        assert result.progress_percent == 0.0

    async def test_get_status_not_found(self, mock_db, mock_user):
        """Тест получения статуса несуществующего анализа"""
        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = None
        mock_db.execute.return_value = mock_result

        with pytest.raises(HTTPException) as exc_info:
            await get_analysis_status(
                analysis_id=999,
                db=mock_db,
                current_user=mock_user
            )

        assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
        assert "Analysis not found" in exc_info.value.detail


@pytest.mark.asyncio
class TestGetAnalysisResults:
    """Тесты для получения результатов анализа"""

    async def test_get_results_success(self, mock_db, mock_user, mock_respiratory_analysis):
        """Тест успешного получения результатов"""
        with patch('api.respiratory_analysis.get_analysis_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_respiratory_analysis

            result = await get_analysis_results(
                analysis_id=1,
                db=mock_db,
                current_user=mock_user
            )

            assert result.id == mock_respiratory_analysis.id
            assert result.patient_id == mock_respiratory_analysis.patient_id
            assert result.status == mock_respiratory_analysis.status

    async def test_get_results_not_found(self, mock_db, mock_user):
        """Тест получения результатов несуществующего анализа"""
        with patch('api.respiratory_analysis.get_analysis_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Analysis not found"
            )

            with pytest.raises(HTTPException) as exc_info:
                await get_analysis_results(
                    analysis_id=999,
                    db=mock_db,
                    current_user=mock_user
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
class TestGetPatientAnalyses:
    """Тесты для получения списка анализов пациента"""

    async def test_get_patient_analyses_success(self, mock_db, mock_user, mock_patient, mock_respiratory_analysis):
        """Тест успешного получения списка анализов"""
        with patch('api.respiratory_analysis.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            mock_result = MagicMock()
            mock_result.scalars.return_value.all.return_value = [mock_respiratory_analysis, mock_respiratory_analysis]
            mock_db.execute.return_value = mock_result

            result = await get_patient_analyses(
                patient_id=1,
                include_plots=False,
                db=mock_db,
                current_user=mock_user
            )

            assert len(result) == 2
            assert result[0]["id"] == mock_respiratory_analysis.id

    async def test_get_patient_analyses_with_plots(self, mock_db, mock_user, mock_patient, mock_respiratory_analysis):
        """Тест получения списка анализов с графиками"""
        mock_respiratory_analysis.status = "completed"
        mock_respiratory_analysis.summary_plot = "/path/to/plot.png"

        with patch('api.respiratory_analysis.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            mock_result = MagicMock()
            mock_result.scalars.return_value.all.return_value = [mock_respiratory_analysis]
            mock_db.execute.return_value = mock_result

            result = await get_patient_analyses(
                patient_id=1,
                include_plots=True,
                db=mock_db,
                current_user=mock_user
            )

            assert len(result) == 1
            assert "summary_plot_url" in result[0]

    async def test_get_patient_analyses_patient_not_found(self, mock_db, mock_user):
        """Тест получения анализов для несуществующего пациента"""
        with patch('api.respiratory_analysis.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = None

            with pytest.raises(HTTPException) as exc_info:
                await get_patient_analyses(
                    patient_id=999,
                    include_plots=False,
                    db=mock_db,
                    current_user=mock_user
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert "Patient not found" in exc_info.value.detail


@pytest.mark.asyncio
class TestGetAllPlotsUrls:
    """Тесты для получения всех URL графиков"""

    async def test_get_all_plots_urls_success(self, mock_db, mock_user, mock_respiratory_analysis):
        """Тест успешного получения URL всех графиков"""
        mock_respiratory_analysis.status = "completed"

        with patch('api.respiratory_analysis.get_analysis_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_respiratory_analysis

            with patch('os.path.exists', return_value=True):
                result = await get_all_plots_urls(
                    analysis_id=1,
                    db=mock_db,
                    current_user=mock_user
                )

                assert result["analysis_id"] == 1
                assert result["status"] == "completed"
                assert "plots_urls" in result
                assert result["plot_count"] == 4

    async def test_get_all_plots_urls_analysis_not_completed(self, mock_db, mock_user, mock_respiratory_analysis):
        """Тест получения графиков для незавершенного анализа"""
        mock_respiratory_analysis.status = "processing"

        with patch('api.respiratory_analysis.get_analysis_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_respiratory_analysis

            with pytest.raises(HTTPException) as exc_info:
                await get_all_plots_urls(
                    analysis_id=1,
                    db=mock_db,
                    current_user=mock_user
                )

            assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
            assert "not completed" in exc_info.value.detail


@pytest.mark.asyncio
class TestDeleteAnalysis:
    """Тесты для удаления анализа"""

    async def test_delete_analysis_success(self, mock_db, mock_user, mock_respiratory_analysis, tmp_path):
        """Тест успешного удаления анализа"""
        mock_respiratory_analysis.patient_id = 1

        with patch('api.respiratory_analysis.get_analysis_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_respiratory_analysis

            with patch('api.respiratory_analysis.get_plots_directory') as mock_plots_dir:
                mock_plots_dir.return_value = tmp_path

                test_file = tmp_path / "test.png"
                test_file.write_text("test")

                mock_db.delete = AsyncMock()
                mock_db.commit = AsyncMock()

                result = await delete_analysis(
                    analysis_id=1,
                    db=mock_db,
                    current_user=mock_user
                )

                assert result["message"] == "Analysis deleted successfully"
                assert result["analysis_id"] == 1
                mock_db.delete.assert_called_once_with(mock_respiratory_analysis)
                mock_db.commit.assert_called_once()

    async def test_delete_analysis_not_found(self, mock_db, mock_user):
        """Тест удаления несуществующего анализа"""
        with patch('api.respiratory_analysis.get_analysis_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Analysis not found"
            )

            with pytest.raises(HTTPException) as exc_info:
                await delete_analysis(
                    analysis_id=999,
                    db=mock_db,
                    current_user=mock_user
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
class TestGetAnalysisReport:
    """Тесты для получения отчета анализа"""

    async def test_get_report_success(self, mock_db, mock_user, mock_respiratory_analysis):
        """Тест успешного получения отчета"""
        mock_respiratory_analysis.text_report = "Test report"

        with patch('api.respiratory_analysis.get_analysis_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_respiratory_analysis

            result = await get_analysis_report(
                analysis_id=1,
                db=mock_db,
                current_user=mock_user
            )

            assert result["report"] == "Test report"

    async def test_get_report_not_found(self, mock_db, mock_user, mock_respiratory_analysis):
        """Тест получения отсутствующего отчета"""
        mock_respiratory_analysis.text_report = None

        with patch('api.respiratory_analysis.get_analysis_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_respiratory_analysis

            with pytest.raises(HTTPException) as exc_info:
                await get_analysis_report(
                    analysis_id=1,
                    db=mock_db,
                    current_user=mock_user
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert "Report not found" in exc_info.value.detail


@pytest.mark.asyncio
class TestGetVideoAnalyses:
    """Тесты для получения анализов видео"""

    async def test_get_video_analyses_success(self, mock_db, mock_user, mock_patient_video, mock_respiratory_analysis):
        """Тест успешного получения анализов видео"""
        video_result = MagicMock()
        video_result.scalars.return_value.first.return_value = mock_patient_video
        mock_db.execute.return_value = video_result

        analyses_result = MagicMock()
        analyses_result.scalars.return_value.all.return_value = [mock_respiratory_analysis, mock_respiratory_analysis]
        mock_db.execute.return_value = analyses_result

        result = await get_video_analyses(
            video_id=1,
            db=mock_db,
            current_user=mock_user
        )

        assert len(result) == 2
        assert result[0]["id"] == mock_respiratory_analysis.id

    async def test_get_video_analyses_video_not_found(self, mock_db, mock_user):
        """Тест получения анализов для несуществующего видео"""
        video_result = MagicMock()
        video_result.scalars.return_value.first.return_value = None
        mock_db.execute.return_value = video_result

        with pytest.raises(HTTPException) as exc_info:
            await get_video_analyses(
                video_id=999,
                db=mock_db,
                current_user=mock_user
            )

        assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
        assert "Video not found" in exc_info.value.detail


class TestSyncFunctions:
    """Тесты для синхронных функций"""

    def test_process_respiratory_analysis_sync_success(
            self, mock_analysis_results, cleanup_analysis_progress
    ):
        """Тест успешной синхронной обработки анализа"""
        analysis_id = 1
        patient_id = 1
        video_path = "/fake/path/video.mp4"
        marker_color = "red"
        marker_size_mm = 10.0

        with patch('services.analysis_module.RespiratoryAnalysisService.analyze_video') as mock_analyze:
            mock_analyze.return_value = mock_analysis_results

            with patch('api.respiratory_analysis.save_analysis_results_sync') as mock_save:
                process_respiratory_analysis_sync(
                    analysis_id=analysis_id,
                    patient_id=patient_id,
                    video_path=video_path,
                    marker_color=marker_color,
                    marker_size_mm=marker_size_mm
                )

                mock_analyze.assert_called_once()
                mock_save.assert_called_once()

    def test_process_respiratory_analysis_sync_error(
            self, cleanup_analysis_progress
    ):
        """Тест обработки анализа с ошибкой"""
        analysis_id = 1
        patient_id = 1
        video_path = "/fake/path/video.mp4"
        marker_color = "red"
        marker_size_mm = 10.0

        with patch('services.analysis_module.RespiratoryAnalysisService.analyze_video') as mock_analyze:
            mock_analyze.side_effect = Exception("Test error")

            with patch('api.respiratory_analysis.save_analysis_error_sync') as mock_save_error:
                process_respiratory_analysis_sync(
                    analysis_id=analysis_id,
                    patient_id=patient_id,
                    video_path=video_path,
                    marker_color=marker_color,
                    marker_size_mm=marker_size_mm
                )

                mock_analyze.assert_called_once()
                mock_save_error.assert_called_once()

    def test_save_analysis_error_sync(self):
        """Тест сохранения ошибки анализа"""
        analysis_id = 1
        error_message = "Test error"
        start_time = datetime.now()

        mock_session = MagicMock()
        mock_analysis = MagicMock()

        mock_query = MagicMock()
        mock_filter = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.filter.return_value = mock_filter
        mock_filter.first.return_value = mock_analysis

        with patch('api.respiratory_analysis.SyncSessionLocal', return_value=mock_session):
            save_analysis_error_sync(analysis_id, error_message, start_time)

            assert mock_analysis.status == "failed"
            assert mock_analysis.error_message == error_message
            assert mock_analysis.processing_time_seconds is not None

            mock_session.commit.assert_called_once()
            mock_session.close.assert_called_once()

