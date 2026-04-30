from playwright.sync_api import Page, expect
from tests.ui.pages.base_page import BasePage


class LoginPage(BasePage):
    """Page Object для страницы логина"""

    # Селекторы
    LOGIN_NAV = '#loginNav'
    LOGIN_SECTION = '#loginSection'
    EMAIL_INPUT = '#loginEmail'
    PASSWORD_INPUT = '#loginPassword'
    SUBMIT_BUTTON = 'button[type="submit"]'
    REGISTER_LINK = 'a[data-section="register"], a:has-text("Зарегистрируйтесь")'
    TOAST = '.toast'
    TOAST_ERROR = '.toast.error, .toast:has-text("Ошибка"), .toast:has-text("Incorrect")'

    def __init__(self, page: Page):
        super().__init__(page)

    def navigate_to_login(self):
        """Переход на вкладку логина"""
        if self._is_section_active(self.LOGIN_SECTION):
            return

        if self.is_visible(self.LOGIN_NAV):
            self.click(self.LOGIN_NAV)
        else:
            login_btn = self.page.locator('button:has-text("Вход")').first
            if login_btn.is_visible():
                login_btn.click()

        self.wait_for_login_section()

    def _is_section_active(self, section_selector: str) -> bool:
        """Проверка, активна ли секция (имеет класс active)"""
        section = self.page.locator(section_selector)
        if section.count() == 0:
            return False

        class_attr = section.get_attribute('class') or ""
        return 'active' in class_attr

    def wait_for_login_section(self, timeout: int = 10000):
        """Ожидание активации секции логина"""
        self.page.wait_for_function(
            """document.querySelector('#loginSection')?.classList.contains('active')""",
            timeout=timeout
        )

    def login(self, email: str, password: str):
        """Выполнение входа"""
        self.fill(self.EMAIL_INPUT, email)
        self.fill(self.PASSWORD_INPUT, password)
        self.click(self.SUBMIT_BUTTON)

    def is_login_form_visible(self) -> bool:
        """Проверка видимости формы логина"""
        if not self._is_section_active(self.LOGIN_SECTION):
            return False

        return (self.is_visible(self.EMAIL_INPUT) and
                self.is_visible(self.PASSWORD_INPUT) and
                self.is_visible(self.SUBMIT_BUTTON))

    def go_to_register(self):
        """Переход на страницу регистрации"""
        register_selectors = [
            'a[data-section="register"]',
            '#registerNav',
            'button:has-text("Регистрация")',
            'a:has-text("Зарегистрируйтесь")'
        ]

        for selector in register_selectors:
            if self.page.locator(selector).count() > 0:
                self.page.locator(selector).first.click()
                break

        self.page.wait_for_function(
            """document.querySelector('#registerSection')?.classList.contains('active')""",
            timeout=5000
        )

    def get_error_message(self) -> str:
        """Получение текста ошибки после неудачного входа"""
        try:
            # Сначала пробуем найти специфичный тост ошибки
            error_toast = self.page.locator(self.TOAST_ERROR)
            error_toast.first.wait_for(state='visible', timeout=5000)

            error_text = error_toast.first.text_content() or ""
            if error_text.strip():
                return error_text.strip()
        except Exception:
            pass

        try:

            toast = self.page.locator(self.TOAST)
            toast.first.wait_for(state='visible', timeout=3000)
            self.page.wait_for_timeout(500)

            error_text = toast.first.text_content() or ""
            if error_text.strip():
                return error_text.strip()
        except Exception:
            pass

        return ""

    def verify_successful_login(self):
        """Проверка успешного входа"""
        self.page.wait_for_selector('#patientsSection', state='visible', timeout=15000)

        patients_section = self.page.locator('#patientsSection')
        expect(patients_section).to_be_visible()

        logout_button = self.page.locator('#logoutNav')
        if logout_button.count() > 0:
            expect(logout_button).to_be_visible()

