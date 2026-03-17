import sys
from pathlib import Path
import pytest
from unittest.mock import AsyncMock, MagicMock
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone
from fastapi import UploadFile
from io import BytesIO

src_path = str(Path(__file__).parent.parent)
if src_path not in sys.path:
    sys.path.insert(0, src_path)
    print(f"Added {src_path} to sys.path")

from domain import models
from infrastructure.async_db import Base
import api.users.file_views as file_views_module


@pytest.fixture
def mock_db():
    """Фикстура для мока базы данных"""
    db = AsyncMock(spec=AsyncSession)

    # Настраиваем основные методы
    db.execute = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.rollback = AsyncMock()
    db.close = AsyncMock()

    mock_result = MagicMock()
    mock_result.scalars.return_value.first = MagicMock(return_value=None)
    mock_result.scalars.return_value.all = MagicMock(return_value=[])
    db.execute.return_value = mock_result

    return db


@pytest.fixture
def mock_user():
    """Фикстура для мока пользователя"""
    user = MagicMock(spec=models.User)
    user.id = 1
    user.email = "test@example.com"
    user.name = "Test"
    user.surname = "User"
    user.hashed_password = "$2b$12$KIXZQYxVjXQYxVjXQYxVjXQYxVjXQYxVjXQYxVjXQYxVjXQYxVjX"
    user.is_active = True
    user.is_doctor = True
    user.created_at = datetime.now(timezone.utc)
    user.updated_at = datetime.now(timezone.utc)

    return user


@pytest.fixture
def mock_patient():
    """Фикстура для мока пациента"""
    patient = MagicMock(spec=models.Patient)
    patient.id = 1
    patient.user_id = 1
    patient.name = "Test"
    patient.surname = "Patient"
    patient.age = 30
    patient.height = 175.5
    patient.weight = 70.5
    patient.smoking_years = 5
    patient.created_at = datetime.now(timezone.utc)
    patient.updated_at = datetime.now(timezone.utc)

    return patient


@pytest.fixture
def mock_video():
    """Фикстура для мока видео пациента"""
    video = MagicMock(spec=models.PatientVideo)
    video.id = 1
    video.patient_id = 1
    video.title = "Test Video"
    video.filename = "test_video.mp4"
    video.file_path = "/fake/path/test_video.mp4"
    video.file_size = 1024 * 1024  # 1 MB
    video.created_at = datetime.now(timezone.utc)
    video.updated_at = datetime.now(timezone.utc)
    return video


@pytest.fixture
def mock_upload_file():
    """Фикстура для мока UploadFile"""

    class SimpleUploadFile:
        def __init__(self):
            self.filename = "test_video.mp4"
            self.content_type = "video/mp4"
            self.file = BytesIO(b"fake video content for testing")

        async def read(self):
            return self.file.getvalue()

        def seek(self, pos, whence=0):
            return self.file.seek(pos, whence)

        def tell(self):
            return self.file.tell()

        async def close(self):
            self.file.close()

    return SimpleUploadFile()


@pytest.fixture
def mock_large_upload_file():
    """Фикстура для мока большого файла (>500MB)"""

    class LargeUploadFile:
        def __init__(self):
            self.filename = "large_video.mp4"
            self.content_type = "video/mp4"
            self.file = BytesIO(b"x" * 1024)  # маленький файл для теста
            self._tell_count = 0
            self._positions = [0, 600 * 1024 * 1024, 600 * 1024 * 1024]  # эмулируем большой размер

        async def read(self):
            return self.file.getvalue()

        def seek(self, pos, whence=0):
            return None

        def tell(self):
            current = self._positions[self._tell_count % len(self._positions)]
            self._tell_count += 1
            return current

        async def close(self):
            self.file.close()

    return LargeUploadFile()


@pytest.fixture
def mock_invalid_upload_file():
    """Фикстура для мока файла с неподдерживаемым типом"""

    class InvalidUploadFile:
        def __init__(self):
            self.filename = "document.pdf"
            self.content_type = "application/pdf"
            self.file = BytesIO(b"fake pdf content")

        async def read(self):
            return self.file.getvalue()

        def seek(self, pos, whence=0):
            return self.file.seek(pos, whence)

        def tell(self):
            return self.file.tell()

        async def close(self):
            self.file.close()

    return InvalidUploadFile()


@pytest.fixture
def override_base_video_dir(monkeypatch, tmp_path):
    """Переопределяем BASE_VIDEO_DIR на временную директорию"""
    test_video_dir = tmp_path / "patient_videos"
    test_video_dir.mkdir(exist_ok=True)

    monkeypatch.setattr(file_views_module, "BASE_VIDEO_DIR", str(test_video_dir))

    return test_video_dir


@pytest.fixture
def mock_patient_video_dir(tmp_path):
    """Фикстура для создания временной директории с видео"""
    video_dir = tmp_path / "patient_videos" / "1"
    video_dir.mkdir(parents=True, exist_ok=True)

    # Создаем тестовые видео файлы
    video_file1 = video_dir / "test_video_1.mp4"
    video_file1.write_bytes(b"x" * 1024 * 1024)  # 1 MB

    video_file2 = video_dir / "test_video_2.mp4"
    video_file2.write_bytes(b"x" * 512 * 1024)  # 0.5 MB

    return tmp_path


@pytest.fixture
def mock_video_file_path(mock_patient_video_dir):
    """Фикстура для получения пути к тестовому видео файлу"""
    return str(mock_patient_video_dir / "patient_videos" / "1" / "test_video_1.mp4")


@pytest.fixture
def mock_get_patient_by_id_success(mock_patient):
    """Фикстура для успешного получения пациента"""

    async def _mock_get_patient_by_id(db, patient_id, user_id):
        return mock_patient

    return _mock_get_patient_by_id


@pytest.fixture
def mock_get_patient_by_id_not_found():
    """Фикстура для случая, когда пациент не найден"""

    async def _mock_get_patient_by_id(db, patient_id, user_id):
        return None

    return _mock_get_patient_by_id


@pytest.fixture
def mock_db_result_with_video(mock_video):
    """Фикстура для результата БД с одним видео"""

    def _create_result(with_video=True):
        mock_result = MagicMock()
        if with_video:
            mock_result.scalars.return_value.first.return_value = mock_video
            mock_result.scalars.return_value.all.return_value = [mock_video]
        else:
            mock_result.scalars.return_value.first.return_value = None
            mock_result.scalars.return_value.all.return_value = []
        return mock_result

    return _create_result


@pytest.fixture
def auth_headers():
    """Фикстура для заголовков авторизации"""
    return {"Authorization": "Bearer test_token"}


@pytest.fixture
def mock_current_user(mock_user):
    """Фикстура для мока текущего пользователя"""
    return mock_user

