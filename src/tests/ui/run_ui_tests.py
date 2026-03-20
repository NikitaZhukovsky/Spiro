import pytest
import os
import sys

if __name__ == "__main__":
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

    # Запускаем тесты
    pytest.main([
        "-v",
        "--tb=short",
        "--headed",
        "--slowmo=500",
        "tests/ui/test_auth_ui.py",
        "tests/ui/test_register_ui.py"
    ])

