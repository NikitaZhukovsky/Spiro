import os
import shutil
from typing import List, Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import uuid

from api.users.auth import get_current_active_user
from api.users.patients import get_patient_by_id
from domain.models import User, Patient, PatientVideo
from infrastructure.async_db import get_db

router = APIRouter(prefix="/patients", tags=["Patient Videos"])

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
BASE_VIDEO_DIR = "patient_videos"


def ensure_video_directories():
    """Создает необходимые директории для хранения видео"""
    os.makedirs(BASE_VIDEO_DIR, exist_ok=True)


async def save_video_to_disk(file: UploadFile, patient_id: str, filename: str) -> str:
    """Сохранение видео на диск"""
    ensure_video_directories()

    # Создаем путь для пациента
    patient_dir = os.path.join(BASE_VIDEO_DIR, str(patient_id))
    os.makedirs(patient_dir, exist_ok=True)

    # Полный путь к файлу
    file_path = os.path.join(patient_dir, filename)

    # Сохраняем файл
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return file_path


async def delete_video_from_disk(file_path: str):
    """Удаление видео с диска"""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"Файл успешно удален: {file_path}")

            # Удаляем директорию пациента если она пустая
            patient_dir = os.path.dirname(file_path)
            if os.path.exists(patient_dir) and not os.listdir(patient_dir):
                os.rmdir(patient_dir)
                print(f"Директория пациента удалена: {patient_dir}")

    except Exception as e:
        print(f"Ошибка при удалении файла {file_path}: {str(e)}")
        raise e


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


@router.post("/{patient_id}/videos/", status_code=status.HTTP_201_CREATED)
async def upload_patient_video(
        patient_id: int,
        file: UploadFile = File(...),
        title: Optional[str] = Form(None),
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Загрузить видео для пациента"""
    # Проверяем существование пациента и принадлежность врачу
    patient = await get_patient_by_id(db, patient_id, current_user.id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    # Проверяем тип файла
    if file.content_type not in ALLOWED_VIDEO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_VIDEO_TYPES)}"
        )

    max_size = 500 * 1024 * 1024
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)

    if file_size > max_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large. Maximum size: 500MB"
        )

    file_extension = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4().hex}{file_extension}"

    try:
        file_path = await save_video_to_disk(file, str(patient_id), unique_filename)

        # Если title не указан, используем имя файла без расширения
        if not title:
            title = os.path.splitext(file.filename)[0]

        video = PatientVideo(
            patient_id=patient_id,
            title=title,
            filename=file.filename,
            s3_path=file_path,
            file_size=file_size
        )

        db.add(video)
        await db.commit()
        await db.refresh(video)

        return {
            "message": "Видео успешно загружено",
            "video_id": video.id,
            "patient_id": patient_id,
            "title": video.title,
            "file_path": file_path,
            "original_filename": file.filename,
            "file_size": file_size
        }

    except Exception as e:
        await db.rollback()
        # Удаляем файл если была ошибка при сохранении в БД
        try:
            file_path = os.path.join(BASE_VIDEO_DIR, str(patient_id), unique_filename)
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"Файл удален после ошибки: {file_path}")
        except Exception as delete_error:
            print(f"Ошибка при удалении файла после ошибки: {delete_error}")
            pass

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error uploading video: {str(e)}"
        )


@router.get("/{patient_id}/videos/", response_model=List[dict])
async def list_patient_videos(
        patient_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить список видео пациента"""
    # Проверяем существование пациента и принадлежность врачу
    patient = await get_patient_by_id(db, patient_id, current_user.id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    result = await db.execute(
        select(PatientVideo).where(PatientVideo.patient_id == patient_id)
    )
    videos = result.scalars().all()

    response = []
    for video in videos:
        video_data = {
            "id": video.id,
            "title": video.title,
            "filename": video.filename,
            "file_size": video.file_size,
            "file_exists": os.path.exists(video.s3_path),
            "created_at": video.created_at.isoformat() if video.created_at else None,
            "patient_id": video.patient_id
        }
        response.append(video_data)

    return response


@router.get("/{patient_id}/videos/{video_id}")
async def get_patient_video_info(
        patient_id: int,
        video_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить информацию о видео пациента"""
    # Проверяем существование пациента и принадлежность врачу
    patient = await get_patient_by_id(db, patient_id, current_user.id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    result = await db.execute(
        select(PatientVideo).where(
            PatientVideo.id == video_id,
            PatientVideo.patient_id == patient_id
        )
    )
    video = result.scalars().first()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video not found"
        )

    return {
        "id": video.id,
        "title": video.title,
        "filename": video.filename,
        "file_size": video.file_size,
        "file_exists": os.path.exists(video.s3_path),
        "created_at": video.created_at.isoformat() if video.created_at else None,
        "patient_id": video.patient_id
    }


@router.get("/{patient_id}/videos/{video_id}/download")
async def download_patient_video(
        patient_id: int,
        video_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Скачать видео пациента"""
    # Проверяем существование пациента и принадлежность врачу
    patient = await get_patient_by_id(db, patient_id, current_user.id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    result = await db.execute(
        select(PatientVideo).where(
            PatientVideo.id == video_id,
            PatientVideo.patient_id == patient_id
        )
    )
    video = result.scalars().first()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video not found"
        )

    if not os.path.exists(video.s3_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video file not found on server"
        )

    media_type = get_video_mime_type(video.filename)

    return FileResponse(
        path=video.s3_path,
        filename=video.filename,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={video.filename}"}
    )


@router.get("/{patient_id}/videos/{video_id}/stream")
async def stream_patient_video(
        patient_id: int,
        video_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Стриминг видео пациента"""
    # Проверяем существование пациента и принадлежность врачу
    patient = await get_patient_by_id(db, patient_id, current_user.id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    result = await db.execute(
        select(PatientVideo).where(
            PatientVideo.id == video_id,
            PatientVideo.patient_id == patient_id
        )
    )
    video = result.scalars().first()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video not found"
        )

    if not os.path.exists(video.s3_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video file not found on server"
        )

    media_type = get_video_mime_type(video.filename)

    return FileResponse(
        path=video.s3_path,
        filename=video.filename,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": f"inline; filename={video.filename}"
        }
    )


@router.delete("/{patient_id}/videos/{video_id}")
async def delete_patient_video(
        patient_id: int,
        video_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Удалить видео пациента"""
    # Проверяем существование пациента и принадлежность врачу
    patient = await get_patient_by_id(db, patient_id, current_user.id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    result = await db.execute(
        select(PatientVideo).where(
            PatientVideo.id == video_id,
            PatientVideo.patient_id == patient_id
        )
    )
    video = result.scalars().first()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video not found"
        )

    try:
        # Сохраняем путь к файлу перед удалением из БД
        file_path = video.s3_path

        # Удаляем файл с диска
        await delete_video_from_disk(file_path)

        # Удаляем из базы данных
        await db.delete(video)
        await db.commit()

        return {"message": "Видео успешно удалено"}

    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting video: {str(e)}"
        )


@router.get("/{patient_id}/videos/storage-info")
async def get_patient_storage_info(
        patient_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
):
    """Получить информацию о хранилище видео пациента"""
    # Проверяем существование пациента и принадлежность врачу
    patient = await get_patient_by_id(db, patient_id, current_user.id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    patient_dir = os.path.join(BASE_VIDEO_DIR, str(patient_id))
    total_size = 0
    file_count = 0

    if os.path.exists(patient_dir):
        for filename in os.listdir(patient_dir):
            file_path = os.path.join(patient_dir, filename)
            if os.path.isfile(file_path):
                total_size += os.path.getsize(file_path)
                file_count += 1

    return {
        "patient_id": patient_id,
        "patient_name": f"{patient.name} {patient.surname}",
        "storage_used_bytes": total_size,
        "storage_used_mb": round(total_size / (1024 * 1024), 2),
        "file_count": file_count,
        "storage_path": patient_dir
    }