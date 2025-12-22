from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine

from core.config import DB_HOST, DB_NAME, DB_PASS, DB_USER

# Асинхронный URL для FastAPI
ASYNC_SQLALCHEMY_DATABASE_URL = (
    f"postgresql+asyncpg://{DB_USER}:{DB_PASS}@{DB_HOST}/{DB_NAME}"
)

# Синхронный URL для фоновых задач (убираем asyncpg)
SYNC_SQLALCHEMY_DATABASE_URL = (
    f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}/{DB_NAME}"
)

Base = declarative_base()

# Асинхронный движок для FastAPI
async_engine = create_async_engine(ASYNC_SQLALCHEMY_DATABASE_URL)

# Синхронный движок для фоновых задач
sync_engine = create_engine(SYNC_SQLALCHEMY_DATABASE_URL)

# Асинхронная сессия
AsyncSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=async_engine,
    class_=AsyncSession
)

# Синхронная сессия (для фоновых задач)
SyncSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=sync_engine
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