import pytest
import sys
import time
from pathlib import Path

root_dir = str(Path(__file__).parent.parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from tests.ui.pages.register_page import RegisterPage


class TestRegisterUI:
    """UI тесты для регистрации"""

    def test_register_page_elements(self, register_page: RegisterPage):
        """Проверка элементов страницы регистрации"""
        register_page.navigate_to_register()
        assert register_page.is_register_form_visible(), "Форма регистрации не полностью видима"
        assert register_page.is_visible(register_page.LOGIN_LINK), "Ссылка на логин не найдена"

    def test_successful_registration(self, register_page: RegisterPage):
        """Тест успешной регистрации нового пользователя"""
        register_page.navigate_to_register()

        unique_email = f"test_user_{int(time.time())}@example.com"

        test_user = {
            "name": "Тест",
            "surname": "Регистрация",
            "email": unique_email,
            "password": "Test123!@#"
        }

        register_page.register(test_user)
        register_page.verify_successful_registration()

        login_section = register_page.page.locator('#loginSection')
        assert login_section.is_visible(), "Должна появиться форма логина"

    def test_registration_with_existing_email(self, register_page: RegisterPage, test_user: dict):
        """Тест регистрации с email уже существующего пользователя (из .env)"""
        register_page.navigate_to_register()

        existing_user = {
            "name": test_user["name"],
            "surname": test_user["surname"],
            "email": test_user["email"],
            "password": test_user["password"]
        }

        # Заполняем форму
        register_page.fill(register_page.NAME_INPUT, existing_user["name"])
        register_page.fill(register_page.SURNAME_INPUT, existing_user["surname"])
        register_page.fill(register_page.EMAIL_INPUT, existing_user["email"])
        register_page.fill(register_page.PASSWORD_INPUT, existing_user["password"])

        register_page.click(register_page.SUBMIT_BUTTON)

        register_page.page.wait_for_timeout(2000)

        assert register_page.is_register_form_visible(), "Должны остаться на странице регистрации"

        error_toast = register_page.page.locator(
            '.toast.error, .toast:has-text("уже существует"), .toast:has-text("already exists")')

        try:
            error_toast.first.wait_for(state='visible', timeout=5000)
            error_text = error_toast.first.text_content() or ""
            print(f"Найдена ошибка: {error_text}")

            # Проверяем, что сообщение об ошибке содержит информацию о существующем email
            assert any(keyword in error_text.lower() for keyword in [
                "уже существует", "already exists", "занят", "used", "существует"
            ]), f"Сообщение об ошибке не соответствует ожидаемому: {error_text}"

        except Exception as e:
            print(f"Тост с ошибкой не появился: {e}")

            success_toast = register_page.page.locator('.toast.success')
            assert not success_toast.is_visible(), "Не должно быть сообщения об успешной регистрации"

            login_section = register_page.page.locator('#loginSection')
            assert not login_section.is_visible(), "Не должно быть перехода на страницу логина"

            error_message = register_page.page.locator('.error-message, .alert-danger, .validation-error')
            if error_message.count() > 0:
                error_text = error_message.first.text_content() or ""
                assert any(keyword in error_text.lower() for keyword in [
                    "уже существует", "already exists", "занят"
                ]), f"Сообщение об ошибке не соответствует ожидаемому: {error_text}"

    @pytest.mark.parametrize("empty_field", [
        "name",
        "surname",
        "email",
        "password"
    ])
    def test_required_fields_validation(self, register_page: RegisterPage, empty_field: str):
        """Тест валидации обязательных полей"""
        register_page.navigate_to_register()

        test_user = {
            "name": "Тест",
            "surname": "Пользователь",
            "email": "test@example.com",
            "password": "Test123!@#"
        }

        if empty_field == "name":
            test_user["name"] = ""
        elif empty_field == "surname":
            test_user["surname"] = ""
        elif empty_field == "email":
            test_user["email"] = ""
        elif empty_field == "password":
            test_user["password"] = ""

        if test_user["name"]:
            register_page.fill(register_page.NAME_INPUT, test_user["name"])
        if test_user["surname"]:
            register_page.fill(register_page.SURNAME_INPUT, test_user["surname"])
        if test_user["email"]:
            register_page.fill(register_page.EMAIL_INPUT, test_user["email"])
        if test_user["password"]:
            register_page.fill(register_page.PASSWORD_INPUT, test_user["password"])

        register_page.click(register_page.SUBMIT_BUTTON)
        register_page.page.wait_for_timeout(1000)

        assert register_page.is_register_form_visible(), "Должны остаться на странице регистрации"

        if empty_field == "email" and not test_user["email"]:
            email_input = register_page.page.locator(register_page.EMAIL_INPUT)
            assert email_input.get_attribute("required") is not None, "Поле email должно быть обязательным"
            is_invalid = register_page.page.evaluate(
                """document.querySelector('#regEmail').validity.valueMissing"""
            )
            assert is_invalid, "Поле email должно быть отмечено как невалидное"

        toast = register_page.page.locator('.toast.success')
        assert not toast.is_visible(), "Не должно быть сообщения об успешной регистрации"

    def test_password_field_has_min_length_validation(self, register_page: RegisterPage):
        """Тест валидации минимальной длины пароля"""
        register_page.navigate_to_register()

        test_user = {
            "name": "Тест",
            "surname": "Пользователь",
            "email": "test@example.com",
            "password": "123"
        }

        register_page.fill(register_page.NAME_INPUT, test_user["name"])
        register_page.fill(register_page.SURNAME_INPUT, test_user["surname"])
        register_page.fill(register_page.EMAIL_INPUT, test_user["email"])
        register_page.fill(register_page.PASSWORD_INPUT, test_user["password"])

        register_page.click(register_page.SUBMIT_BUTTON)
        register_page.page.wait_for_timeout(1000)

        assert register_page.is_register_form_visible(), "Должны остаться на странице регистрации"

        password_input = register_page.page.locator(register_page.PASSWORD_INPUT)
        min_length = password_input.get_attribute("minlength")
        if min_length:
            assert int(min_length) > len(test_user["password"]), "Пароль должен быть короче минимальной длины"

