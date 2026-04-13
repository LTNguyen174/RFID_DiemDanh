from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .settings import settings


engine = create_async_engine(settings.database_url, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


async def get_db_session() -> AsyncSession:
    """Dependency function for FastAPI Depends()"""
    async with AsyncSessionLocal() as session:
        yield session


@asynccontextmanager
async def get_db_session_context():
    """Async context manager for use with 'async with' statements"""
    async with AsyncSessionLocal() as session:
        yield session
