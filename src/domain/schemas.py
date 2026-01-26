from pydantic import BaseModel, EmailStr, validator, Field, ConfigDict
from typing import Optional, List, Dict, Any
from enum import Enum
from datetime import datetime


class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"


class SmokingStatus(str, Enum):
    NON_SMOKER = "non_smoker"
    ACTIVE_SMOKER = "active_smoker"
    PASSIVE_SMOKER = "passive_smoker"


class MarkerColor(str, Enum):
    red = "red"
    blue = "blue"
    green = "green"


class AnalysisStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


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

    model_config = ConfigDict(from_attributes=True)


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

    model_config = ConfigDict(from_attributes=True)


class PatientBase(BaseModel):
    name: str
    surname: str
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    age: Optional[int] = Field(None, ge=0, le=150)
    gender: Optional[Gender] = None
    height: Optional[float] = Field(None, ge=50, le=250)
    weight: Optional[float] = Field(None, ge=20, le=300)
    smoking_status: Optional[SmokingStatus] = None
    smoking_years: Optional[int] = Field(None, ge=0, le=100)


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

    model_config = ConfigDict(from_attributes=True)


class PatientWithDoctor(Patient):
    doctor: User

    model_config = ConfigDict(from_attributes=True)


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

    model_config = ConfigDict(from_attributes=True)


class VideoWithPatient(Video):
    patient: Patient

    model_config = ConfigDict(from_attributes=True)


class PatientWithVideos(Patient):
    videos: List[Video] = []

    model_config = ConfigDict(from_attributes=True)


class RespiratoryAnalysisCreate(BaseModel):
    video_id: int
    marker_color: MarkerColor
    marker_size_mm: float = Field(18.0, ge=5.0, le=100.0)

    @validator('marker_size_mm')
    def validate_marker_size(cls, v):
        if v <= 0:
            raise ValueError('Marker size must be positive')
        return v


class RespiratoryAnalysisResponse(BaseModel):
    id: int
    patient_id: int
    video_id: int
    marker_color: str
    marker_size_mm: float
    status: str
    breathing_rate_mean_bpm: Optional[float] = None
    amplitude_mean_mm: Optional[float] = None
    total_frames: Optional[int] = None
    medical_assessment: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    processing_time_seconds: Optional[float] = None
    error_message: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class LineResultDetail(BaseModel):
    breathing_rate_mean_bpm: Optional[float] = None
    amplitude_mean_mm: Optional[float] = None
    amplitude_mm: Optional[List[float]] = Field(
        default=None,
        description="Амплитуды дыхательных движений для каждой точки (в мм)"
    )
    peaks: Optional[List[int]] = Field(
        default=None,
        description="Индексы пиков (максимумов) дыхательных движений"
    )
    troughs: Optional[List[int]] = Field(
        default=None,
        description="Индексы впадин (минимумов) дыхательных движений"
    )
    timestamps: Optional[List[float]] = Field(
        default=None,
        description="Временные метки для каждой точки (в секундах)"
    )
    normalized_width: Optional[List[float]] = Field(
        default=None,
        description="Нормализованная ширина маркера для каждой точки"
    )


class RespiratoryAnalysisDetailResponse(BaseModel):
    id: int
    patient_id: int
    video_id: int
    marker_color: str
    marker_size_mm: float
    status: str
    breathing_rate_mean_bpm: Optional[float] = None
    amplitude_mean_mm: Optional[float] = None
    total_frames: Optional[int] = None
    medical_assessment: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    processing_time_seconds: Optional[float] = None
    error_message: Optional[str] = None
    text_report: Optional[str] = None

    # Пути к графикам
    width_line_1_plot: Optional[str] = None
    width_line_2_plot: Optional[str] = None
    width_line_3_plot: Optional[str] = None
    summary_plot: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class AnalysisStatusResponse(BaseModel):
    id: int
    progress_percent: float

    model_config = ConfigDict(from_attributes=True)


class AnalysisProgressResponse(BaseModel):
    id: int
    status: str
    progress_percent: float
    current_stage: Optional[str] = None
    frames_processed: Optional[int] = None
    total_frames: Optional[int] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    processing_time_seconds: Optional[float] = None
    error_message: Optional[str] = None


class AnalysisReportResponse(BaseModel):
    report: str


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


PatientBase = add_patient_validators(PatientBase)
PatientCreate = add_patient_validators(PatientCreate)
PatientUpdate = add_patient_validators(PatientUpdate)
