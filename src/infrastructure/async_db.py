import os
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine

DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    ASYNC_SQLALCHEMY_DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    SYNC_SQLALCHEMY_DATABASE_URL = DATABASE_URL
else:
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_NAME = os.getenv("DB_NAME", "spiro")
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASS = os.getenv("DB_PASS", "14092004NikZuk")
    DB_PORT = os.getenv("DB_PORT", "5432")

    ASYNC_SQLALCHEMY_DATABASE_URL = f"postgresql+asyncpg://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    SYNC_SQLALCHEMY_DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Всё остальное оставляем без изменений
Base = declarative_base()
async_engine = create_async_engine(ASYNC_SQLALCHEMY_DATABASE_URL)
sync_engine = create_engine(SYNC_SQLALCHEMY_DATABASE_URL)

AsyncSessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=async_engine, class_=AsyncSession
)
SyncSessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=sync_engine
)


async def get_db():
    """Dependency для асинхронного доступа к БД (FastAPI)"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


def get_sync_db():
    """Dependency для синхронного доступа к БД (фоновые задачи)"""
    with SyncSessionLocal() as session:
        try:
            yield session
        finally:
            session.close()