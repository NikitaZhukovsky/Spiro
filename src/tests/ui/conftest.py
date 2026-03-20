import pytest
import os
from typing import Dict
from playwright.sync_api import Page, sync_playwright
from dotenv import load_dotenv
import sys
from pathlib import Path

# Загружаем переменные окружения из .env файла
load_dotenv()

# Добавляем корневую директорию в sys.path
root_dir = str(Path(__file__).parent.parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)
    print(f"Added {root_dir} to sys.path")

from tests.ui.pages.login_page import LoginPage
from tests.ui.pages.register_page import RegisterPage

# Конфигурация из .env
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# Данные тестового пользователя из .env
TEST_USER = {
    "email": os.getenv("TEST_USER_EMAIL"),
    "password": os.getenv("TEST_USER_PASSWORD"),
    "name": os.getenv("TEST_USER_NAME"),
    "surname": os.getenv("TEST_USER_SURNAME")
}


@pytest.fixture(scope="session")
def playwright_instance():
    """Фикстура для Playwright"""
    with sync_playwright() as p:
        yield p


@pytest.fixture(scope="session")
def browser(playwright_instance):
    """Фикстура для браузера"""
    browser = playwright_instance.chromium.launch(
        headless=False,
        slow_mo=500
    )
    yield browser
    browser.close()


@pytest.fixture(scope="function")
def page(browser):
    """Фикстура для страницы"""
    context = browser.new_context(
        viewport={'width': 1920, 'height': 1080},
        ignore_https_errors=True
    )
    page = context.new_page()

    # Добавляем обработку консольных ошибок для отладки
    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
    page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

    yield page
    context.close()


@pytest.fixture(scope="function")
def test_user() -> Dict:
    """Фикстура с данными тестового пользователя из .env"""
    print(f"\n🔐 Используем тестового пользователя: {TEST_USER['email']}")
    return TEST_USER.copy()


@pytest.fixture(scope="function")
def login_page(page: Page):
    """Фикстура для страницы логина"""
    print(f"\n🌐 Переход на фронтенд: {FRONTEND_URL}")
    page.goto(FRONTEND_URL)
    page.wait_for_load_state("networkidle")
    print(f"📄 Заголовок: {page.title()}")
    return LoginPage(page)


@pytest.fixture(scope="function")
def register_page(page: Page):
    """Фикстура для страницы регистрации"""
    page.goto(FRONTEND_URL)
    page.wait_for_load_state("networkidle")
    return RegisterPage(page)


@pytest.fixture(scope="function")
def clear_browser_data(page: Page):
    """Очистка данных браузера после теста"""
    yield
    page.evaluate("localStorage.clear()")
    page.evaluate("sessionStorage.clear()")
    page.context.clear_cookies()