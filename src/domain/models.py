from infrastructure.async_db import Base
from sqlalchemy import Column, Integer, String, Boolean


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    name = Column(String, unique=False, index=True)
    surname = Column(String)
    hashed_password = Column(String)
    is_active = Column(Boolean, default=True)
