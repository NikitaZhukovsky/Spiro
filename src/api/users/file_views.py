import os
import shutil
from typing import List
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import uuid

from api.users.auth import get_current_user
from domain.models import User, UserVideo
from infrastructure.async_db import get_db

router = APIRouter(prefix="/user/videos", tags=["Videos"])

ALLOWED_VIDEO_TYPES = [
    "video/mp4",
    "video/avi",
    "video/mov",
    "video/wmv",
    "video/flv",
    "video/webm",
    "video/mkv"
]

# Базовая директория для хранения видео
BASE_VIDEO_DIR = "user_videos"


def ensure_video_directories():
    """Создает необходимые директории для хранения видео"""
    os.makedirs(BASE_VIDEO_DIR, exist_ok=True)


async def save_video_to_disk(file: UploadFile, user_id: str, filename: str) -> str:
    """Сохранение видео на диск"""
    ensure_video_directories()

    # Создаем путь для пользователя
    user_dir = os.path.join(BASE_VIDEO_DIR, str(user_id))
    os.makedirs(user_dir, exist_ok=True)

    # Полный путь к файлу
    file_path = os.path.join(user_dir, filename)

    # Сохраняем файл
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return file_path


async def delete_video_from_disk(file_path: str):
    """Удаление видео с диска"""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)

            # Удаляем директорию пользователя если она пустая
            user_dir = os.path.dirname(file_path)
            if os.path.exists(user_dir) and not os.listdir(user_dir):
                os.rmdir(user_dir)
    except Exception as e:
        print(f"Ошибка при удалении файла {file_path}: {str(e)}")


def get_video_mime_type(filename: str) -> str:
    """Определяет MIME тип видео по расширению файла"""
    ext = os.path.splitext(filename)[1].lower()
    mime_types = {
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska'
    }
    return mime_types.get(ext, 'video/mp4')


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_video(
        file: UploadFile = File(...),
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    # Проверяем тип файла
    if file.content_type not in ALLOWED_VIDEO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Недопустимый тип файла. Разрешены: {', '.join(ALLOWED_VIDEO_TYPES)}"
        )

    # Проверяем размер файла (максимум 500MB)
    max_size = 500 * 1024 * 1024
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)

    if file_size > max_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Файл слишком большой. Максимальный размер: 500MB"
        )

    # Создаем уникальное имя файла
    file_extension = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4().hex}{file_extension}"

    try:
        # Сохраняем на диск
        file_path = await save_video_to_disk(file, str(current_user.id), unique_filename)

        # Сохраняем информацию в базу данных
        video = UserVideo(
            user_id=current_user.id,
            filename=file.filename,  # оригинальное имя
            s3_path=file_path,  # теперь храним локальный путь
            file_size=file_size
        )

        db.add(video)
        await db.commit()
        await db.refresh(video)

        return {
            "message": "Видео успешно загружено",
            "video_id": video.id,
            "file_path": file_path,
            "original_filename": file.filename,
            "file_size": file_size
        }

    except Exception as e:
        await db.rollback()
        # Удаляем файл если была ошибка при сохранении в БД
        try:
            file_path = os.path.join(BASE_VIDEO_DIR, str(current_user.id), unique_filename)
            if os.path.exists(file_path):
                os.remove(file_path)
        except:
            pass

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка при загрузке видео: {str(e)}"
        )


@router.get("/download/{video_id}")
async def download_video(
        video_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    """Скачивание видео файла"""
    result = await db.execute(
        select(UserVideo).where(
            UserVideo.id == video_id,
            UserVideo.user_id == current_user.id
        )
    )
    video = result.scalars().first()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Видео не найдено"
        )

    # Проверяем существование файла
    if not os.path.exists(video.s3_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл видео не найден на сервере"
        )

    media_type = get_video_mime_type(video.filename)

    return FileResponse(
        path=video.s3_path,
        filename=video.filename,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={video.filename}"}
    )


@router.get("/stream/{video_id}")
async def stream_video(
        video_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    """Стриминг видео для воспроизведения в браузере"""
    result = await db.execute(
        select(UserVideo).where(
            UserVideo.id == video_id,
            UserVideo.user_id == current_user.id
        )
    )
    video = result.scalars().first()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Видео не найдено"
        )

    if not os.path.exists(video.s3_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл видео не найден на сервере"
        )

    media_type = get_video_mime_type(video.filename)

    # Для стриминга используем FileResponse с правильными заголовками
    return FileResponse(
        path=video.s3_path,
        filename=video.filename,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": f"inline; filename={video.filename}"
        }
    )


@router.get("/")
async def list_user_videos(
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
) -> List[dict]:
    """Получить список всех видео пользователя"""
    result = await db.execute(
        select(UserVideo).where(UserVideo.user_id == current_user.id)
    )
    videos = result.scalars().all()

    response = []
    for video in videos:
        video_data = {
            "id": video.id,
            "filename": video.filename,
            "file_size": video.file_size,
            "file_exists": os.path.exists(video.s3_path),
            "created_at": video.created_at.isoformat() if video.created_at else None,
            "s3_path": video.s3_path
        }
        response.append(video_data)

    return response


@router.get("/{video_id}")
async def get_video_info(
        video_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    """Получить информацию о конкретном видео"""
    result = await db.execute(
        select(UserVideo).where(
            UserVideo.id == video_id,
            UserVideo.user_id == current_user.id
        )
    )
    video = result.scalars().first()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Видео не найдено"
        )

    return {
        "id": video.id,
        "filename": video.filename,
        "file_size": video.file_size,
        "file_exists": os.path.exists(video.s3_path),
        "created_at": video.created_at.isoformat() if video.created_at else None,
        "s3_path": video.s3_path
    }


@router.delete("/{video_id}")
async def delete_video(
        video_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    """Удалить видео пользователя"""
    result = await db.execute(
        select(UserVideo).where(
            UserVideo.id == video_id,
            UserVideo.user_id == current_user.id
        )
    )
    video = result.scalars().first()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Видео не найдено"
        )

    try:
        # Удаляем файл с диска
        await delete_video_from_disk(video.s3_path)

        # Удаляем из базы данных
        await db.delete(video)
        await db.commit()

        return {"message": "Видео успешно удалено"}

    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка при удалении видео: {str(e)}"
        )


@router.get("/storage-info")
async def get_storage_info(
        current_user: User = Depends(get_current_user),
):
    """Получить информацию о хранилище пользователя"""
    user_dir = os.path.join(BASE_VIDEO_DIR, str(current_user.id))
    total_size = 0
    file_count = 0

    if os.path.exists(user_dir):
        for filename in os.listdir(user_dir):
            file_path = os.path.join(user_dir, filename)
            if os.path.isfile(file_path):
                total_size += os.path.getsize(file_path)
                file_count += 1

    return {
        "user_id": current_user.id,
        "storage_used_bytes": total_size,
        "storage_used_mb": round(total_size / (1024 * 1024), 2),
        "file_count": file_count,
        "storage_path": user_dir
    }


@router.get("/test-connection")
async def test_storage_connection():
    """Тест подключения к локальному хранилищу"""
    try:
        ensure_video_directories()

        # Проверяем возможность записи
        test_file = os.path.join(BASE_VIDEO_DIR, "test.txt")
        with open(test_file, "w") as f:
            f.write("test")
        os.remove(test_file)

        return {
            "status": "success",
            "message": "Локальное хранилище работает корректно",
            "storage_path": os.path.abspath(BASE_VIDEO_DIR),
            "writable": True
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка доступа к локальному хранилищу: {str(e)}"
        )