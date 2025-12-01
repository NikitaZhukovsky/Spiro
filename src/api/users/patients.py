from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from domain import models, schemas
from infrastructure.async_db import get_db
from api.users.auth import get_current_active_user

router = APIRouter(
    prefix="/patients",
    tags=["Patients"]
)


def calculate_bmi(weight: Optional[float], height: Optional[float]) -> Optional[float]:
    if weight is None or height is None or height == 0:
        return None
    height_m = height / 100
    bmi = weight / (height_m ** 2)
    return round(bmi, 2)


async def get_patient_by_id(db: AsyncSession, patient_id: int, doctor_id: int = None):
    """Получить пациента по ID с проверкой принадлежности врачу"""
    query = select(models.Patient).filter(models.Patient.id == patient_id)
    if doctor_id:
        query = query.filter(models.Patient.doctor_id == doctor_id)

    result = await db.execute(query)
    return result.scalars().first()


@router.post("/", response_model=schemas.Patient)
async def create_patient(
        patient_data: schemas.PatientCreate,
        db: AsyncSession = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
):
    """Создать нового пациента"""
    # Рассчитываем ИМТ
    bmi = calculate_bmi(patient_data.weight, patient_data.height)

    # Конвертируем Enum в строки
    gender = patient_data.gender.value if patient_data.gender else None
    smoking_status = patient_data.smoking_status.value if patient_data.smoking_status else None

    db_patient = models.Patient(
        doctor_id=current_user.id,
        name=patient_data.name,
        surname=patient_data.surname,
        age=patient_data.age,
        gender=gender,
        height=patient_data.height,
        weight=patient_data.weight,
        bmi=bmi,
        smoking_status=smoking_status,
        smoking_years=patient_data.smoking_years
    )

    db.add(db_patient)
    await db.commit()
    await db.refresh(db_patient)
    return db_patient


@router.get("/", response_model=List[schemas.Patient])
async def get_patients(
        skip: int = 0,
        limit: int = 100,
        db: AsyncSession = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
):
    """Получить список пациентов текущего врача"""
    result = await db.execute(
        select(models.Patient)
        .filter(models.Patient.doctor_id == current_user.id)
        .offset(skip)
        .limit(limit)
    )
    patients = result.scalars().all()
    return patients


@router.get("/{patient_id}/", response_model=schemas.Patient)
async def get_patient(
        patient_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
):
    """Получить пациента по ID"""
    patient = await get_patient_by_id(db, patient_id, current_user.id)

    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    return patient


@router.put("/{patient_id}/", response_model=schemas.Patient)
async def update_patient(
        patient_id: int,
        patient_data: schemas.PatientUpdate,
        db: AsyncSession = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
):
    """Обновить данные пациента"""
    patient = await get_patient_by_id(db, patient_id, current_user.id)

    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    update_data = patient_data.dict(exclude_unset=True)

    # Конвертируем Enum в строки
    if 'gender' in update_data and update_data['gender'] is not None:
        update_data['gender'] = update_data['gender'].value

    if 'smoking_status' in update_data and update_data['smoking_status'] is not None:
        update_data['smoking_status'] = update_data['smoking_status'].value

    # Пересчитываем ИМТ если нужно
    if 'weight' in update_data or 'height' in update_data:
        weight = update_data.get('weight', patient.weight)
        height = update_data.get('height', patient.height)
        update_data['bmi'] = calculate_bmi(weight, height)

    # Обновляем поля
    for field, value in update_data.items():
        setattr(patient, field, value)

    db.add(patient)
    await db.commit()
    await db.refresh(patient)
    return patient


@router.delete("/{patient_id}/")
async def delete_patient(
        patient_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
):
    """Удалить пациента"""
    patient = await get_patient_by_id(db, patient_id, current_user.id)

    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found"
        )

    await db.delete(patient)
    await db.commit()

    return {"message": "Patient deleted successfully"}