# models.py
from infrastructure.async_db import Base
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime
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

    videos = relationship("UserVideo", back_populates="user", cascade="all, delete-orphan")


class UserVideo(Base):
    __tablename__ = "user_videos"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    filename = Column(String)
    s3_path = Column(String)
    file_size = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="videos")

