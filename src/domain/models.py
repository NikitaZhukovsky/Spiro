from infrastructure.async_db import Base
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Float, JSON, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    name = Column(String, unique=False, index=True)
    surname = Column(String)
    hashed_password = Column(String)
    is_active = Column(Boolean, default=True)
    is_doctor = Column(Boolean, default=True)

    # Связи
    patients = relationship("Patient", back_populates="doctor", cascade="all, delete-orphan")


class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)
    doctor_id = Column(Integer, ForeignKey("users.id"))

    name = Column(String, index=True)
    surname = Column(String)
    last_name = Column(String, nullable=True)
    email = Column(String, nullable=True)

    age = Column(Integer, nullable=True)
    gender = Column(String, nullable=True)
    height = Column(Float, nullable=True)
    weight = Column(Float, nullable=True)
    bmi = Column(Float, nullable=True)
    smoking_status = Column(String, nullable=True)
    smoking_years = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Связи
    doctor = relationship("User", back_populates="patients")
    videos = relationship("PatientVideo", back_populates="patient", cascade="all, delete-orphan")
    respiratory_analyses = relationship("RespiratoryAnalysis", back_populates="patient", cascade="all, delete-orphan")


class PatientVideo(Base):
    __tablename__ = "patient_videos"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"))
    title = Column(String, nullable=True)
    filename = Column(String)
    file_path = Column(String)
    file_size = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    patient = relationship("Patient", back_populates="videos")
    respiratory_analyses = relationship("RespiratoryAnalysis", back_populates="video", cascade="all, delete-orphan")


class RespiratoryAnalysis(Base):
    __tablename__ = "respiratory_analyses"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"))
    video_id = Column(Integer, ForeignKey("patient_videos.id"))

    marker_color = Column(String, default="red")  # red, blue, green
    marker_size_mm = Column(Float, default=18.0)

    status = Column(String, default="pending")  # pending, processing, completed, failed
    error_message = Column(Text, nullable=True)
    processing_time_seconds = Column(Float, nullable=True)

    # Основные результаты
    breathing_rate_mean_bpm = Column(Float, nullable=True)
    amplitude_mean_mm = Column(Float, nullable=True)
    total_frames = Column(Integer, nullable=True)

    width_line_1_plot = Column(Text, nullable=True)
    width_line_2_plot = Column(Text, nullable=True)
    width_line_3_plot = Column(Text, nullable=True)
    summary_plot = Column(Text, nullable=True)

    text_report = Column(Text, nullable=True)

    medical_assessment = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    patient = relationship("Patient", back_populates="respiratory_analyses")
    video = relationship("PatientVideo", back_populates="respiratory_analyses")