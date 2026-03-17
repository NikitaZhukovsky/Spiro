import os
import sys
from pathlib import Path
import pytest
from unittest.mock import AsyncMock, MagicMock, Mock, patch
from fastapi import HTTPException, status
from fastapi.responses import FileResponse

src_path = str(Path(__file__).parent.parent)
if src_path not in sys.path:
    sys.path.insert(0, src_path)

from api.users.file_views import (
    upload_patient_video, list_patient_videos, get_patient_video_info,
    download_patient_video, stream_patient_video, delete_patient_video,
    get_patient_storage_info, save_video_to_disk, delete_video_from_disk,
    get_video_mime_type, ensure_video_directories, ALLOWED_VIDEO_TYPES
)


class TestVideoUtils:
    """Тесты для вспомогательных функций"""

    def test_get_video_mime_type(self):
        """Тест определения MIME типа видео"""
        assert get_video_mime_type("video.mp4") == "video/mp4"
        assert get_video_mime_type("video.avi") == "video/x-msvideo"
        assert get_video_mime_type("video.mov") == "video/quicktime"
        assert get_video_mime_type("video.wmv") == "video/x-ms-wmv"
        assert get_video_mime_type("video.flv") == "video/x-flv"
        assert get_video_mime_type("video.webm") == "video/webm"
        assert get_video_mime_type("video.mkv") == "video/x-matroska"
        assert get_video_mime_type("video.unknown") == "video/mp4"

    def test_ensure_video_directories(self, tmp_path, monkeypatch):
        """Тест создания директорий для видео"""
        # Переопределяем BASE_VIDEO_DIR
        test_dir = tmp_path / "test_videos"
        monkeypatch.setattr("api.users.file_views.BASE_VIDEO_DIR", str(test_dir))

        ensure_video_directories()
        assert test_dir.exists()
        assert test_dir.is_dir()

    @pytest.mark.asyncio
    async def test_save_video_to_disk(self, mock_upload_file, override_base_video_dir):
        """Тест сохранения видео на диск"""
        file_path = await save_video_to_disk(
            mock_upload_file,
            patient_id="1",
            filename="test_video.mp4"
        )

        assert file_path is not None
        assert "patient_videos/1/test_video.mp4" in file_path or "patient_videos\\1\\test_video.mp4" in file_path
        assert os.path.exists(file_path)

    @pytest.mark.asyncio
    async def test_delete_video_from_disk(self, tmp_path):
        """Тест удаления видео с диска"""
        test_file = tmp_path / "test_video.mp4"
        test_file.write_text("test content")

        test_dir = tmp_path / "patient_dir"
        test_dir.mkdir()
        test_file_in_dir = test_dir / "video.mp4"
        test_file_in_dir.write_text("test content")

        await delete_video_from_disk(str(test_file))
        assert not test_file.exists()

        await delete_video_from_disk(str(test_file_in_dir))
        assert not test_file_in_dir.exists()
        assert not test_dir.exists()

        await delete_video_from_disk("/nonexistent/path/file.mp4")


@pytest.mark.asyncio
class TestUploadPatientVideo:
    """Тесты для эндпоинта загрузки видео"""

    async def test_upload_video_success(self, mock_db, mock_patient, mock_upload_file, override_base_video_dir):
        """Тест успешной загрузки видео"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            with patch('api.users.file_views.save_video_to_disk', new_callable=AsyncMock) as mock_save:
                mock_save.return_value = str(override_base_video_dir / "1" / "test_video.mp4")

                mock_db.add = Mock()
                mock_db.commit = AsyncMock()
                mock_db.refresh = AsyncMock()

                mock_video = MagicMock()
                mock_video.id = 1
                mock_video.title = "Test Video Title"
                mock_db.refresh.return_value = mock_video

                result = await upload_patient_video(
                    patient_id=1,
                    file=mock_upload_file,
                    title="Test Video Title",
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

                assert result["message"] == "Видео успешно загружено"
                assert result["patient_id"] == 1
                assert result["title"] == "Test Video Title"
                assert "video_id" in result

    async def test_upload_video_without_title(self, mock_db, mock_patient, mock_upload_file, override_base_video_dir):
        """Тест загрузки видео без указания названия"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            with patch('api.users.file_views.save_video_to_disk', new_callable=AsyncMock) as mock_save:
                mock_save.return_value = str(override_base_video_dir / "1" / "test_video.mp4")

                result = await upload_patient_video(
                    patient_id=1,
                    file=mock_upload_file,
                    title=None,
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

                assert result["title"] == "test_video"

    async def test_upload_video_patient_not_found(self, mock_db, mock_upload_file):
        """Тест загрузки видео для несуществующего пациента"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = None

            with pytest.raises(HTTPException) as exc_info:
                await upload_patient_video(
                    patient_id=999,
                    file=mock_upload_file,
                    title="Test",
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert exc_info.value.detail == "Patient not found"

    async def test_upload_video_invalid_file_type(self, mock_db, mock_patient, mock_invalid_upload_file):
        """Тест загрузки файла неподдерживаемого типа"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            with pytest.raises(HTTPException) as exc_info:
                await upload_patient_video(
                    patient_id=1,
                    file=mock_invalid_upload_file,
                    title="Test",
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

            assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
            assert "Invalid file type" in exc_info.value.detail

    async def test_upload_video_too_large(self, mock_db, mock_patient):
        """Тест загрузки слишком большого файла"""
        mock_file = MagicMock()
        mock_file.filename = "large_video.mp4"
        mock_file.content_type = "video/mp4"

        mock_file_inner = MagicMock()

        mock_file_inner.tell.side_effect = [600 * 1024 * 1024, 0]
        mock_file_inner.seek = MagicMock()

        mock_file.file = mock_file_inner

        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            with pytest.raises(HTTPException) as exc_info:
                await upload_patient_video(
                    patient_id=1,
                    file=mock_file,
                    title="Test",
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

            assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
            assert "File too large" in exc_info.value.detail

    async def test_upload_video_db_error(self, mock_db, mock_patient, mock_upload_file, override_base_video_dir):
        """Тест ошибки БД при загрузке видео"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            with patch('api.users.file_views.save_video_to_disk', new_callable=AsyncMock) as mock_save:
                mock_save.return_value = str(override_base_video_dir / "1" / "test_video.mp4")

                mock_db.commit = AsyncMock(side_effect=Exception("DB Error"))
                mock_db.rollback = AsyncMock()

                with patch('os.remove', Mock()) as mock_remove:
                    with pytest.raises(HTTPException) as exc_info:
                        await upload_patient_video(
                            patient_id=1,
                            file=mock_upload_file,
                            title="Test",
                            db=mock_db,
                            current_user=MagicMock(id=1)
                        )

                    assert exc_info.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
                    assert "Error uploading video" in exc_info.value.detail
                    mock_db.rollback.assert_called_once()


@pytest.mark.asyncio
class TestGetPatientVideoInfo:
    """Тесты для получения информации о видео"""

    async def test_get_video_info_success(self, mock_db, mock_patient, mock_video):
        """Тест успешного получения информации о видео"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            mock_result = MagicMock()
            mock_result.scalars.return_value.first.return_value = mock_video
            mock_db.execute.return_value = mock_result

            with patch('os.path.exists', return_value=True):
                result = await get_patient_video_info(
                    patient_id=1,
                    video_id=1,
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

            assert result["id"] == mock_video.id
            assert result["title"] == mock_video.title
            assert result["file_exists"] is True

    async def test_get_video_info_not_found(self, mock_db, mock_patient):
        """Тест получения информации о несуществующем видео"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            mock_result = MagicMock()
            mock_result.scalars.return_value.first.return_value = None
            mock_db.execute.return_value = mock_result

            with pytest.raises(HTTPException) as exc_info:
                await get_patient_video_info(
                    patient_id=1,
                    video_id=999,
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert exc_info.value.detail == "Video not found"


@pytest.mark.asyncio
class TestDownloadPatientVideo:
    """Тесты для скачивания видео"""

    async def test_download_video_success(self, mock_db, mock_patient, mock_video):
        """Тест успешного скачивания видео"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            mock_result = MagicMock()
            mock_result.scalars.return_value.first.return_value = mock_video
            mock_db.execute.return_value = mock_result

            with patch('os.path.exists', return_value=True):
                result = await download_patient_video(
                    patient_id=1,
                    video_id=1,
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

            assert isinstance(result, FileResponse)
            assert result.filename == mock_video.filename
            assert result.media_type == "video/mp4"

    async def test_download_video_file_not_found(self, mock_db, mock_patient, mock_video):
        """Тест скачивания видео, когда файл отсутствует на диске"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            mock_result = MagicMock()
            mock_result.scalars.return_value.first.return_value = mock_video
            mock_db.execute.return_value = mock_result

            with patch('os.path.exists', return_value=False):
                with pytest.raises(HTTPException) as exc_info:
                    await download_patient_video(
                        patient_id=1,
                        video_id=1,
                        db=mock_db,
                        current_user=MagicMock(id=1)
                    )

                assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
                assert exc_info.value.detail == "Video file not found on server"


@pytest.mark.asyncio
class TestStreamPatientVideo:
    """Тесты для стриминга видео"""

    async def test_stream_video_success(self, mock_db, mock_patient, mock_video):
        """Тест успешного стриминга видео"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            mock_result = MagicMock()
            mock_result.scalars.return_value.first.return_value = mock_video
            mock_db.execute.return_value = mock_result

            with patch('os.path.exists', return_value=True):
                result = await stream_patient_video(
                    patient_id=1,
                    video_id=1,
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

            assert isinstance(result, FileResponse)
            assert result.filename == mock_video.filename
            assert result.media_type == "video/mp4"
            assert "Accept-Ranges" in result.headers


@pytest.mark.asyncio
class TestDeletePatientVideo:
    """Тесты для удаления видео"""

    async def test_delete_video_success(self, mock_db, mock_patient, mock_video):
        """Тест успешного удаления видео"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            mock_result = MagicMock()
            mock_result.scalars.return_value.first.return_value = mock_video
            mock_db.execute.return_value = mock_result

            mock_db.delete = AsyncMock()
            mock_db.commit = AsyncMock()

            with patch('api.users.file_views.delete_video_from_disk', new_callable=AsyncMock) as mock_delete:
                result = await delete_patient_video(
                    patient_id=1,
                    video_id=1,
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

            assert result["message"] == "Видео успешно удалено"
            mock_delete.assert_called_once_with(mock_video.file_path)
            mock_db.delete.assert_called_once_with(mock_video)
            mock_db.commit.assert_called_once()

    async def test_delete_video_not_found(self, mock_db, mock_patient):
        """Тест удаления несуществующего видео"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            mock_result = MagicMock()
            mock_result.scalars.return_value.first.return_value = None
            mock_db.execute.return_value = mock_result

            with pytest.raises(HTTPException) as exc_info:
                await delete_patient_video(
                    patient_id=1,
                    video_id=999,
                    db=mock_db,
                    current_user=MagicMock(id=1)
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert exc_info.value.detail == "Video not found"


@pytest.mark.asyncio
class TestGetPatientStorageInfo:
    """Тесты для получения информации о хранилище"""

    async def test_get_storage_info_success(self, mock_db, mock_patient, override_base_video_dir):
        """Тест успешного получения информации о хранилище"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            # Создаем тестовые файлы
            patient_dir = override_base_video_dir / "1"
            patient_dir.mkdir(parents=True, exist_ok=True)

            file1 = patient_dir / "video1.mp4"
            file1.write_bytes(b"x" * 1024 * 1024)  # 1 MB

            file2 = patient_dir / "video2.mp4"
            file2.write_bytes(b"x" * 512 * 1024)  # 0.5 MB

            result = await get_patient_storage_info(
                patient_id=1,
                db=mock_db,
                current_user=MagicMock(id=1)
            )

            assert result["patient_id"] == 1
            assert result["file_count"] == 2
            assert result["storage_used_bytes"] == 1024 * 1024 + 512 * 1024
            assert result["storage_used_mb"] == 1.5

    async def test_get_storage_info_no_files(self, mock_db, mock_patient, override_base_video_dir):
        """Тест получения информации о хранилище без файлов"""
        with patch('api.users.file_views.get_patient_by_id', new_callable=AsyncMock) as mock_get_patient:
            mock_get_patient.return_value = mock_patient

            result = await get_patient_storage_info(
                patient_id=1,
                db=mock_db,
                current_user=MagicMock(id=1)
            )

            assert result["patient_id"] == 1
            assert result["file_count"] == 0
            assert result["storage_used_bytes"] == 0
            assert result["storage_used_mb"] == 0

