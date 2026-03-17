import sys
from pathlib import Path

src_path = str(Path(__file__).parent.parent)
if src_path not in sys.path:
    sys.path.insert(0, src_path)

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException, status
import jwt

from api.users.auth import (
    register, login, refresh_token, get_current_user,
    get_current_active_user, SECRET_KEY, REFRESH_SECRET_KEY,
    ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
)
from domain import schemas


@pytest.mark.asyncio
class TestRegisterAPI:
    """Тесты для эндпоинта регистрации"""

    async def test_register_success(self, mock_db):
        # Arrange
        user_data = schemas.UserCreate(
            email="new@example.com",
            name="New",
            surname="User",
            password="password123"
        )

        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = None
        mock_db.execute.return_value = mock_result

        result = await register(user_data, mock_db)

        assert result.email == user_data.email
        assert result.name == user_data.name
        assert result.surname == user_data.surname

        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()
        mock_db.refresh.assert_called_once()

    async def test_register_email_already_exists(self, mock_db, mock_user):
        user_data = schemas.UserCreate(
            email="existing@example.com",
            name="Test",
            surname="User",
            password="password123"
        )

        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = mock_user
        mock_db.execute.return_value = mock_result

        with pytest.raises(HTTPException) as exc_info:
            await register(user_data, mock_db)

        assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
        assert exc_info.value.detail == "Email already registered"


@pytest.mark.asyncio
class TestLoginAPI:
    """Тесты для эндпоинта входа"""

    async def test_login_success(self, mock_db, mock_user):
        login_data = schemas.LoginRequest(
            email="test@example.com",
            password="password123"
        )

        with patch('api.users.auth.authenticate_user', new_callable=AsyncMock) as mock_auth:
            mock_auth.return_value = mock_user

            result = await login(login_data, mock_db)

            assert "access_token" in result
            assert "refresh_token" in result
            assert result["token_type"] == "bearer"

            mock_auth.assert_called_once_with(mock_db, login_data.email, login_data.password)

    async def test_login_invalid_credentials(self, mock_db):
        login_data = schemas.LoginRequest(
            email="test@example.com",
            password="wrong_password"
        )


        with patch('api.users.auth.authenticate_user', new_callable=AsyncMock) as mock_auth:
            mock_auth.return_value = False
            with pytest.raises(HTTPException) as exc_info:
                await login(login_data, mock_db)

            assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
            assert exc_info.value.detail == "Incorrect email or password"

            mock_auth.assert_called_once_with(mock_db, login_data.email, login_data.password)


@pytest.mark.asyncio
class TestRefreshTokenAPI:
    """Тесты для эндпоинта обновления токена"""

    async def test_refresh_token_success(self, mock_db, mock_user):
        exp_time = datetime.now(timezone.utc) + timedelta(days=7)

        refresh_token_data = {
            "sub": mock_user.email,
            "type": "refresh",
            "exp": exp_time
        }
        valid_refresh_token = jwt.encode(
            refresh_token_data,
            REFRESH_SECRET_KEY,
            algorithm=ALGORITHM
        )

        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = mock_user
        mock_db.execute.return_value = mock_result

        result = await refresh_token(valid_refresh_token, mock_db)

        assert "access_token" in result
        assert result["token_type"] == "bearer"

    async def test_refresh_token_invalid_token(self, mock_db):
        invalid_token = "invalid.token.string"

        with pytest.raises(HTTPException) as exc_info:
            await refresh_token(invalid_token, mock_db)

        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
        assert exc_info.value.detail == "Could not validate refresh token"

