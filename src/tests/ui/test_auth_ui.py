import pytest
import sys
from pathlib import Path

root_dir = str(Path(__file__).parent.parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from tests.ui.pages.login_page import LoginPage
from tests.ui.pages.register_page import RegisterPage


class TestLoginUI:
    """UI тесты для авторизации"""

    WRONG_PASSWORD_KEYWORDS = ["неверн", "incorrect", "ошибк", "error", "не правильн"]
    NONEXISTENT_EMAIL_KEYWORDS = ["не найд", "not found", "не существу", "doesn't exist", "incorrect"]

    def test_login_page_elements(self, login_page: LoginPage):
        """Проверка элементов страницы логина"""
        login_page.navigate_to_login()
        assert login_page.is_login_form_visible(), "Форма логина не полностью видима"
        assert login_page.is_visible(login_page.REGISTER_LINK), "Ссылка на регистрацию не найдена"

    def test_successful_login(self, login_page: LoginPage, test_user: dict):
        """Тест успешного входа с тестовым пользователем"""
        login_page.navigate_to_login()
        login_page.login(test_user["email"], test_user["password"])
        login_page.verify_successful_login()

    def test_login_with_wrong_password(self, login_page: LoginPage, test_user: dict):
        """Тест входа с неверным паролем"""
        login_page.navigate_to_login()
        login_page.login(test_user["email"], "wrong_password_123")

        login_page.page.wait_for_timeout(2000)

        assert login_page.is_login_form_visible(), "Должны остаться на странице логина"

        patients_section = login_page.page.locator('#patientsSection')
        assert not patients_section.is_visible(), "Не должно быть перехода на страницу пациентов"

    def test_login_with_nonexistent_email(self, login_page: LoginPage):
        """Тест входа с несуществующим email"""
        login_page.navigate_to_login()
        login_page.login("nonexistent@example.com", "password123")

        error_message = login_page.get_error_message()
        assert error_message, "Должно быть сообщение об ошибке"
        assert any(word in error_message.lower() for word in self.NONEXISTENT_EMAIL_KEYWORDS), \
            f"Сообщение об ошибке '{error_message}' не содержит информацию о несуществующем пользователе"
        assert login_page.is_login_form_visible(), "Должны остаться на странице логина"

    def test_navigation_to_register(self, login_page: LoginPage):
        """Тест перехода на страницу регистрации"""
        login_page.navigate_to_login()
        login_page.go_to_register()

        register_page = RegisterPage(login_page.page)
        register_page.wait_for_element(
            '#registerForm button[type="submit"]',
            state='visible',
            timeout=5000
        )

        assert register_page.is_register_form_visible(), "Форма регистрации не видна"

    @pytest.mark.parametrize("email,password,should_fail", [
        ("", "password", True),
        ("test@example.com", "", True),
        ("", "", True),
    ])
    def test_login_with_empty_fields(self, login_page: LoginPage, email: str, password: str, should_fail: bool):
        """Тест валидации пустых полей"""
        login_page.navigate_to_login()

        if email:
            login_page.fill(login_page.EMAIL_INPUT, email)
        if password:
            login_page.fill(login_page.PASSWORD_INPUT, password)

        login_page.click(login_page.SUBMIT_BUTTON)

        assert login_page.is_visible('#loginSection'), "Должны остаться на странице логина"

        if not email:
            email_input = login_page.page.locator(login_page.EMAIL_INPUT)
            assert email_input.get_attribute("required") is not None, "Поле email должно быть обязательным"
