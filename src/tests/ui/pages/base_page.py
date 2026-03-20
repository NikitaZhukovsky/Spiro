from playwright.sync_api import Page


class BasePage:
    """Базовый класс для всех страниц"""

    def __init__(self, page: Page):
        self.page = page
        self.timeout = 10000

    def wait_for_element(self, selector: str, state: str = "visible", timeout: int = None):
        """Ожидание элемента"""
        timeout = timeout or self.timeout
        self.page.wait_for_selector(selector, state=state, timeout=timeout)

    def click(self, selector: str):
        """Клик по элементу"""
        self.page.click(selector)

    def fill(self, selector: str, text: str):
        """Заполнение поля"""
        self.page.fill(selector, text)

    def get_text(self, selector: str) -> str:
        """Получение текста элемента"""
        element = self.page.locator(selector).first
        return element.text_content() or ""

    def is_visible(self, selector: str) -> bool:
        """Проверка видимости элемента"""
        return self.page.is_visible(selector)

    def wait_for_toast(self, toast_type: str = "success", timeout: int = 5000):
        """Ожидание тост-уведомления"""
        toast_selector = f'.toast.{toast_type}, .toast:has-text("{toast_type}")'
        self.page.wait_for_selector(toast_selector, timeout=timeout)
        return self.page.locator(toast_selector)

    def take_screenshot(self, name: str):
        """Сделать скриншот"""
        self.page.screenshot(path=f"test_screenshots/{name}.png")

    def reload(self):
        """Перезагрузка страницы"""
        self.page.reload(wait_until="networkidle")
