from playwright.sync_api import Page
from tests.ui.pages.base_page import BasePage


class RegisterPage(BasePage):
    """Page Object для страницы регистрации"""

    # Селекторы
    REGISTER_NAV = '#registerNav'
    REGISTER_SECTION = '#registerSection'
    NAME_INPUT = '#regName'
    SURNAME_INPUT = '#regSurname'
    EMAIL_INPUT = '#regEmail'
    PASSWORD_INPUT = '#regPassword'
    SUBMIT_BUTTON = '#registerForm button[type="submit"]'
    LOGIN_LINK = 'a[data-section="login"]'
    TOAST_SUCCESS = '.toast.success'

    def __init__(self, page: Page):
        super().__init__(page)

    def navigate_to_register(self):
        """Переход на вкладку регистрации"""
        if self._is_section_active(self.REGISTER_SECTION):
            return

        if self.is_visible(self.REGISTER_NAV):
            self.click(self.REGISTER_NAV)
        else:
            register_btn = self.page.locator('button:has-text("Регистрация")').first
            if register_btn.is_visible():
                register_btn.click()

        self.wait_for_register_section()

    def _is_section_active(self, section_selector: str) -> bool:
        """Проверка, активна ли секция (имеет класс active)"""
        section = self.page.locator(section_selector)
        if section.count() == 0:
            return False

        class_attr = section.get_attribute('class') or ""
        return 'active' in class_attr

    def wait_for_register_section(self, timeout: int = 10000):
        """Ожидание активации секции регистрации"""
        self.page.wait_for_function(
            """document.querySelector('#registerSection')?.classList.contains('active')""",
            timeout=timeout
        )

    def register(self, user_data: dict):
        """Выполнение регистрации"""
        self.wait_for_register_section()

        self.fill(self.NAME_INPUT, user_data["name"])
        self.fill(self.SURNAME_INPUT, user_data["surname"])
        self.fill(self.EMAIL_INPUT, user_data["email"])
        self.fill(self.PASSWORD_INPUT, user_data["password"])

        register_button = self.page.locator(self.SUBMIT_BUTTON)
        if register_button.count() > 0:
            register_button.first.click()

        self.page.wait_for_timeout(2000)

    def is_register_form_visible(self) -> bool:
        """Проверка видимости формы регистрации"""
        try:
            if not self._is_section_active(self.REGISTER_SECTION):
                return False

            name_visible = self.is_visible(self.NAME_INPUT)
            surname_visible = self.is_visible(self.SURNAME_INPUT)
            email_visible = self.is_visible(self.EMAIL_INPUT)
            password_visible = self.is_visible(self.PASSWORD_INPUT)

            register_button = self.page.locator(self.SUBMIT_BUTTON)
            button_exists = register_button.count() > 0

            return (name_visible and surname_visible and
                    email_visible and password_visible and
                    button_exists)

        except Exception:
            return False

    def go_to_login(self):
        """Переход на страницу логина"""
        login_selectors = [
            'a[data-section="login"]',
            '#loginNav',
            'button:has-text("Вход")',
            'a:has-text("Вход")',
            'a:has-text("Войдите")'
        ]

        for selector in login_selectors:
            if self.page.locator(selector).count() > 0:
                self.page.locator(selector).first.click()
                break

        self.page.wait_for_function(
            """document.querySelector('#loginSection')?.classList.contains('active')""",
            timeout=5000
        )

    def verify_successful_registration(self):
        """Проверка успешной регистрации"""
        self.wait_for_toast("success")
        self.page.wait_for_function(
            """document.querySelector('#loginSection')?.classList.contains('active')""",
            timeout=5000
        )

