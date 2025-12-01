from pydantic import BaseModel, EmailStr, validator
from typing import Optional, List
from enum import Enum
from datetime import datetime


# Enums
class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"


class SmokingStatus(str, Enum):
    NON_SMOKER = "non_smoker"
    ACTIVE_SMOKER = "active_smoker"
    PASSIVE_SMOKER = "passive_smoker"


# User (Doctor) Schemas
class UserBase(BaseModel):
    email: EmailStr
    name: str
    surname: Optional[str] = None


class UserCreate(UserBase):
    password: str


class User(UserBase):
    id: int
    is_active: bool
    is_doctor: bool = True

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    name: Optional[str] = None
    surname: Optional[str] = None


class UserProfile(BaseModel):
    id: int
    email: str
    name: str
    surname: Optional[str]
    is_active: bool
    is_doctor: bool = True

    class Config:
        from_attributes = True


# Patient Schemas
class PatientBase(BaseModel):
    name: str
    surname: str
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    age: Optional[int] = None
    gender: Optional[Gender] = None
    height: Optional[float] = None
    weight: Optional[float] = None
    smoking_status: Optional[SmokingStatus] = None
    smoking_years: Optional[int] = None


class PatientCreate(PatientBase):
    pass


class PatientUpdate(PatientBase):
    name: Optional[str] = None
    surname: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None


class Patient(PatientBase):
    id: int
    doctor_id: int
    bmi: Optional[float] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PatientWithDoctor(Patient):
    doctor: User

    class Config:
        from_attributes = True


# Video Schemas
class VideoBase(BaseModel):
    title: Optional[str] = None


class VideoCreate(VideoBase):
    pass


class Video(VideoBase):
    id: int
    patient_id: int
    filename: str
    s3_path: str
    file_size: int
    created_at: datetime

    class Config:
        from_attributes = True


class VideoWithPatient(Video):
    patient: Patient

    class Config:
        from_attributes = True


# Patient with videos
class PatientWithVideos(Patient):
    videos: List[Video] = []

    class Config:
        from_attributes = True


# Auth Schemas
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenWithRefresh(Token):
    refresh_token: str


def add_patient_validators(cls):
    @validator('age')
    def validate_age(cls, v):
        if v is not None and (v < 0 or v > 150):
            raise ValueError('Age must be between 0 and 150')
        return v

    @validator('height')
    def validate_height(cls, v):
        if v is not None and (v < 50 or v > 250):
            raise ValueError('Height must be between 50 and 250 cm')
        return v

    @validator('weight')
    def validate_weight(cls, v):
        if v is not None and (v < 20 or v > 300):
            raise ValueError('Weight must be between 20 and 300 kg')
        return v

    @validator('smoking_years')
    def validate_smoking_years(cls, v):
        if v is not None and (v < 0 or v > 100):
            raise ValueError('Smoking years must be between 0 and 100')
        return v

    return cls


# Apply validators to Patient schemas
PatientBase = add_patient_validators(PatientBase)
PatientCreate = add_patient_validators(PatientCreate)
PatientUpdate = add_patient_validators(PatientUpdate)