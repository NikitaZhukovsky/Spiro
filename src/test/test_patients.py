import sys
from pathlib import Path
import pytest
from unittest.mock import AsyncMock, MagicMock, Mock, patch
from fastapi import HTTPException, status

src_path = str(Path(__file__).parent.parent)
if src_path not in sys.path:
    sys.path.insert(0, src_path)

from api.users.patients import (
    create_patient, get_patients, get_patient,
    update_patient, delete_patient, get_patient_by_id,
    calculate_bmi
)
from domain import schemas, models


class TestPatientUtils:
    """Тесты для вспомогательных функций"""

    def test_calculate_bmi_success(self):
        """Тест успешного расчета ИМТ"""
        weight = 70.5
        height = 175.0

        bmi = calculate_bmi(weight, height)

        expected_bmi = round(70.5 / ((175 / 100) ** 2), 2)
        assert bmi == expected_bmi
        assert isinstance(bmi, float)

    def test_calculate_bmi_missing_weight(self):
        assert calculate_bmi(None, 175) is None

    def test_calculate_bmi_missing_height(self):
        assert calculate_bmi(70.5, None) is None

    def test_calculate_bmi_zero_height(self):
        assert calculate_bmi(70.5, 0) is None


@pytest.mark.asyncio
class TestGetPatientById:
    """Тесты для функции получения пациента по ID"""

    async def test_get_patient_by_id_success(self, mock_db, mock_patient):
        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = mock_patient
        mock_db.execute.return_value = mock_result

        result = await get_patient_by_id(mock_db, patient_id=1, doctor_id=1)

        assert result == mock_patient
        mock_db.execute.assert_called_once()

    async def test_get_patient_by_id_not_found(self, mock_db):
        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = None
        mock_db.execute.return_value = mock_result

        result = await get_patient_by_id(mock_db, patient_id=999, doctor_id=1)

        assert result is None

    async def test_get_patient_by_id_without_doctor(self, mock_db, mock_patient):
        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = mock_patient
        mock_db.execute.return_value = mock_result

        result = await get_patient_by_id(mock_db, patient_id=1)

        assert result == mock_patient


@pytest.mark.asyncio
class TestCreatePatient:
    """Тесты для создания пациента"""

    async def test_create_patient_success(self, mock_db, mock_user):
        """Тест успешного создания пациента"""
        patient_data = schemas.PatientCreate(
            name="Иван",
            surname="Иванов",
            last_name="Петрович",
            email="ivan@example.com",
            age=30,
            gender=schemas.Gender.MALE,
            height=175.5,
            weight=70.5,
            smoking_status=schemas.SmokingStatus.NON_SMOKER,
            smoking_years=0
        )

        created_patient = models.Patient(
            id=1,
            doctor_id=mock_user.id,
            name=patient_data.name,
            surname=patient_data.surname,
            last_name=patient_data.last_name,
            email=patient_data.email,
            age=patient_data.age,
            gender=patient_data.gender.value,
            height=patient_data.height,
            weight=patient_data.weight,
            bmi=22.9,
            smoking_status=patient_data.smoking_status.value,
            smoking_years=patient_data.smoking_years
        )

        mock_db.add = Mock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        async def refresh_side_effect(patient):
            for key, value in created_patient.__dict__.items():
                if not key.startswith('_'):
                    setattr(patient, key, value)

        mock_db.refresh.side_effect = refresh_side_effect

        result = await create_patient(
            patient_data=patient_data,
            db=mock_db,
            current_user=mock_user
        )

        assert result.doctor_id == mock_user.id
        assert result.name == patient_data.name
        assert result.surname == patient_data.surname
        assert result.email == patient_data.email
        assert result.gender == patient_data.gender.value

        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()
        mock_db.refresh.assert_called_once()

    async def test_create_patient_without_optional_fields(self, mock_db, mock_user):
        """Тест создания пациента без опциональных полей"""
        patient_data = schemas.PatientCreate(
            name="Иван",
            surname="Иванов",
            last_name=None,
            email=None,
            age=None,
            gender=None,
            height=None,
            weight=None,
            smoking_status=None,
            smoking_years=None
        )

        created_patient = models.Patient(
            id=1,
            doctor_id=mock_user.id,
            name=patient_data.name,
            surname=patient_data.surname,
            last_name=None,
            email=None,
            age=None,
            gender=None,
            height=None,
            weight=None,
            bmi=None,
            smoking_status=None,
            smoking_years=None
        )

        mock_db.add = Mock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        async def refresh_side_effect(patient):
            for key, value in created_patient.__dict__.items():
                if not key.startswith('_'):
                    setattr(patient, key, value)

        mock_db.refresh.side_effect = refresh_side_effect

        result = await create_patient(
            patient_data=patient_data,
            db=mock_db,
            current_user=mock_user
        )

        assert result.doctor_id == mock_user.id
        assert result.name == patient_data.name
        assert result.surname == patient_data.surname
        assert result.last_name is None
        assert result.email is None
        assert result.age is None
        assert result.gender is None
        assert result.smoking_status is None
        assert result.bmi is None


@pytest.mark.asyncio
class TestGetPatients:
    """Тесты для получения списка пациентов"""

    async def test_get_patients_success(self, mock_db, mock_user, mock_patient):
        mock_patients = [mock_patient, mock_patient]
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = mock_patients
        mock_db.execute.return_value = mock_result

        result = await get_patients(
            skip=0,
            limit=100,
            db=mock_db,
            current_user=mock_user
        )

        assert len(result) == 2
        assert result == mock_patients

    async def test_get_patients_empty(self, mock_db, mock_user):
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        result = await get_patients(
            skip=0,
            limit=100,
            db=mock_db,
            current_user=mock_user
        )

        assert len(result) == 0

    async def test_get_patients_with_pagination(self, mock_db, mock_user):
        mock_result = MagicMock()
        mock_db.execute.return_value = mock_result

        await get_patients(
            skip=10,
            limit=20,
            db=mock_db,
            current_user=mock_user
        )

        mock_db.execute.assert_called_once()


@pytest.mark.asyncio
class TestGetPatient:
    """Тесты для получения конкретного пациента"""

    async def test_get_patient_success(self, mock_db, mock_user, mock_patient):
        with patch('api.users.patients.get_patient_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_patient

            result = await get_patient(
                patient_id=1,
                db=mock_db,
                current_user=mock_user
            )

            assert result == mock_patient
            mock_get.assert_called_once_with(mock_db, 1, mock_user.id)

    async def test_get_patient_not_found(self, mock_db, mock_user):
        with patch('api.users.patients.get_patient_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = None

            with pytest.raises(HTTPException) as exc_info:
                await get_patient(
                    patient_id=999,
                    db=mock_db,
                    current_user=mock_user
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert exc_info.value.detail == "Patient not found"


@pytest.mark.asyncio
class TestUpdatePatient:
    """Тесты для обновления пациента"""

    async def test_update_patient_success(self, mock_db, mock_user):
        """Тест успешного обновления пациента"""
        patient = models.Patient(
            id=1,
            doctor_id=mock_user.id,
            name="Иван",
            surname="Иванов",
            age=30,
            height=175.5,
            weight=70.5,
            bmi=22.9
        )

        update_data = schemas.PatientUpdate(
            name="Петр",
            age=35,
            height=180.0,
            weight=75.0
        )

        with patch('api.users.patients.get_patient_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = patient

            mock_db.add = Mock()
            mock_db.commit = AsyncMock()
            mock_db.refresh = AsyncMock()

            result = await update_patient(
                patient_id=1,
                patient_data=update_data,
                db=mock_db,
                current_user=mock_user
            )

            assert result.name == "Петр"
            assert result.age == 35
            assert result.height == 180.0
            assert result.weight == 75.0

            mock_db.add.assert_called_once_with(patient)
            mock_db.commit.assert_called_once()
            mock_db.refresh.assert_called_once()

    async def test_update_patient_not_found(self, mock_db, mock_user):
        update_data = schemas.PatientUpdate(name="Петр")

        with patch('api.users.patients.get_patient_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = None

            with pytest.raises(HTTPException) as exc_info:
                await update_patient(
                    patient_id=999,
                    patient_data=update_data,
                    db=mock_db,
                    current_user=mock_user
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert exc_info.value.detail == "Patient not found"

    async def test_update_patient_partial(self, mock_db, mock_user):
        """Тест частичного обновления пациента"""
        patient = models.Patient(
            id=1,
            doctor_id=mock_user.id,
            name="Иван",
            surname="Иванов",
            age=30,
            height=175.5,
            weight=70.5
        )

        update_data = schemas.PatientUpdate(
            name="Новое имя",
            age=None
        )

        with patch('api.users.patients.get_patient_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = patient

            mock_db.add = Mock()
            mock_db.commit = AsyncMock()
            mock_db.refresh = AsyncMock()

            # Act
            result = await update_patient(
                patient_id=1,
                patient_data=update_data,
                db=mock_db,
                current_user=mock_user
            )

            assert result.name == "Новое имя"
            assert result.age is None

    async def test_update_patient_with_enum_values(self, mock_db, mock_user):
        """Тест обновления пациента с enum значениями"""
        patient = models.Patient(
            id=1,
            doctor_id=mock_user.id,
            name="Иван",
            surname="Иванов",
            gender="male",
            smoking_status="non_smoker"
        )

        update_data = schemas.PatientUpdate(
            gender=schemas.Gender.FEMALE,
            smoking_status=schemas.SmokingStatus.ACTIVE_SMOKER
        )

        with patch('api.users.patients.get_patient_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = patient

            mock_db.add = Mock()
            mock_db.commit = AsyncMock()
            mock_db.refresh = AsyncMock()

            # Act
            result = await update_patient(
                patient_id=1,
                patient_data=update_data,
                db=mock_db,
                current_user=mock_user
            )

            assert result.gender == "female"
            assert result.smoking_status == "active_smoker"


@pytest.mark.asyncio
class TestDeletePatient:
    """Тесты для удаления пациента"""

    async def test_delete_patient_success(self, mock_db, mock_user, mock_patient):
        with patch('api.users.patients.get_patient_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_patient

            mock_db.delete = AsyncMock()
            mock_db.commit = AsyncMock()

            result = await delete_patient(
                patient_id=1,
                db=mock_db,
                current_user=mock_user
            )

            assert result["message"] == "Patient deleted successfully"
            mock_db.delete.assert_called_once_with(mock_patient)
            mock_db.commit.assert_called_once()

    async def test_delete_patient_not_found(self, mock_db, mock_user):
        with patch('api.users.patients.get_patient_by_id', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = None

            with pytest.raises(HTTPException) as exc_info:
                await delete_patient(
                    patient_id=999,
                    db=mock_db,
                    current_user=mock_user
                )

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert exc_info.value.detail == "Patient not found"

