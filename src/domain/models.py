from infrastructure.async_db import Base
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Float
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


class PatientVideo(Base):
    __tablename__ = "patient_videos"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"))
    title = Column(String, nullable=True)
    filename = Column(String)
    s3_path = Column(String)
    file_size = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    patient = relationship("Patient", back_populates="videos")