import { APP_CONFIG, API_ENDPOINTS } from '../utils/constants.js';
import { PatientManager } from './PatientManager.js';
import { CustomSelect } from './CustomSelect.js';
import { Toast } from '../components/Toast.js';

export class AuthApp {
    constructor() {
        this.baseURL = APP_CONFIG.BASE_URL;
        this.accessToken = localStorage.getItem('accessToken');
        this.refreshToken = localStorage.getItem('refreshToken');
        this.isLoading = false;
        this.patientManager = null;
        this.currentUser = null;
        this.customSelects = [];

        this.init();
    }

    init() {
        document.querySelectorAll('.auth-section').forEach(section => {
            section.classList.remove('active');
        });

        this.setupEventListeners();
        this.setupPasswordToggles();
        this.checkAuthStatus();
        this.setupAnimations();
        this.initCustomSelects();
    }

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('.nav-btn[data-section]')) {
                const btn = e.target.closest('.nav-btn[data-section]');
                const section = btn.dataset.section;
                this.showSection(section);
                return;
            }

            if (e.target.closest('.auth-link')) {
                e.preventDefault();
                const link = e.target.closest('.auth-link');
                const section = link.dataset.section;
                this.showSection(section);
                return;
            }

            if (e.target.closest('#logoutNav')) {
                e.preventDefault();
                this.logout();
                return;
            }

            if (e.target.closest('.password-toggle')) {
                const toggle = e.target.closest('.password-toggle');
                this.togglePasswordVisibility(toggle);
                return;
            }
        });

        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('registerForm').addEventListener('submit', (e) => this.handleRegister(e));

        const passwordInput = document.getElementById('regPassword');
        if (passwordInput) {
            passwordInput.addEventListener('input', (e) => this.checkPasswordStrength(e.target.value));
        }

        this.setupPasswordFocus();
    }

    initCustomSelects() {
        const customSelects = document.querySelectorAll('.custom-select');
        customSelects.forEach(select => {
            const customSelect = new CustomSelect(select);
            this.customSelects.push(customSelect);
            select.customSelectInstance = customSelect;
        });
    }

    setupPasswordFocus() {
        const passwordInputs = document.querySelectorAll('.password-input-wrapper input');
        passwordInputs.forEach(input => {
            input.addEventListener('focus', () => {
                const toggle = input.parentElement.querySelector('.password-toggle');
                if (toggle) {
                    toggle.style.color = 'var(--primary)';
                }
            });

            input.addEventListener('blur', () => {
                const toggle = input.parentElement.querySelector('.password-toggle');
                if (toggle && !toggle.classList.contains('password-visible')) {
                    toggle.style.color = 'var(--text-secondary)';
                }
            });
        });
    }

    setupPasswordToggles() {
        const toggles = document.querySelectorAll('.password-toggle');
        toggles.forEach(toggle => {
            const targetId = toggle.dataset.target;
            const input = document.getElementById(targetId);
            if (input) {
                this.updateToggleIcon(toggle, input.type === 'password');
            }
        });
    }

    togglePasswordVisibility(toggle) {
        const targetId = toggle.dataset.target;
        const input = document.getElementById(targetId);

        if (!input) return;

        const isCurrentlyPassword = input.type === 'password';
        input.type = isCurrentlyPassword ? 'text' : 'password';

        this.updateToggleIcon(toggle, isCurrentlyPassword);

        toggle.classList.add('active');
        setTimeout(() => {
            toggle.classList.remove('active');
        }, 300);

        if (isCurrentlyPassword) {
            toggle.classList.add('password-visible');
        } else {
            toggle.classList.remove('password-visible');
        }

        input.focus();
    }

    updateToggleIcon(toggle, isPassword) {
        const icon = toggle.querySelector('i');
        if (isPassword) {
            icon.className = 'fas fa-eye';
            toggle.setAttribute('aria-label', 'Скрыть пароль');
            toggle.style.color = 'var(--success)';
        } else {
            icon.className = 'fas fa-eye-slash';
            toggle.setAttribute('aria-label', 'Показать пароль');
            toggle.style.color = 'var(--text-secondary)';
        }
    }

    showSection(sectionName) {
        document.querySelectorAll('.auth-section').forEach(section => {
            section.classList.remove('active');
        });

        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        const targetSection = document.getElementById(`${sectionName}Section`);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        const targetNav = document.querySelector(`[data-section="${sectionName}"]`);
        if (targetNav) {
            targetNav.classList.add('active');
        }

        if (this.accessToken) {
            document.getElementById('loginNav').classList.add('hidden');
            document.getElementById('registerNav').classList.add('hidden');
            document.getElementById('patientsNav').classList.remove('hidden');
            document.getElementById('logoutNav').classList.remove('hidden');
        } else {
            document.getElementById('loginNav').classList.remove('hidden');
            document.getElementById('registerNav').classList.remove('hidden');
            document.getElementById('patientsNav').classList.add('hidden');
            document.getElementById('logoutNav').classList.add('hidden');
        }

        document.dispatchEvent(new CustomEvent('sectionChanged', {
            detail: { section: sectionName }
        }));

        if (sectionName === 'patients') {
            if (!this.patientManager) {
                this.patientManager = new PatientManager(this);
            }
            this.patientManager.loadPatients();
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        if (this.isLoading) return;

        const formData = new FormData(e.target);
        const loginData = {
            email: formData.get('email').trim(),
            password: formData.get('password')
        };

        await this.submitLogin(loginData);
    }

    async handleRegister(e) {
        e.preventDefault();
        if (this.isLoading) return;

        const formData = new FormData(e.target);
        const userData = {
            name: formData.get('name').trim(),
            surname: formData.get('surname').trim(),
            email: formData.get('email').trim(),
            password: formData.get('password')
        };

        await this.submitRegister(userData);
    }

    async submitLogin(loginData) {
        const form = document.getElementById('loginForm');
        const submitBtn = form.querySelector('button[type="submit"]');

        this.setLoadingState(submitBtn, true);

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.AUTH.LOGIN}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(loginData)
            });

            const result = await response.json();

            if (response.ok) {
                this.setTokens(result.access_token, result.refresh_token);
                Toast.show('Успешный вход!', 'Добро пожаловать!', 'success');
                this.showSection('patients');
                form.reset();
            } else {
                Toast.show('Ошибка входа', result.detail || 'Неверный email или пароль', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение к интернету', 'error');
        } finally {
            this.setLoadingState(submitBtn, false);
        }
    }

    async submitRegister(userData) {
        const form = document.getElementById('registerForm');
        const submitBtn = form.querySelector('button[type="submit"]');

        this.setLoadingState(submitBtn, true);

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.AUTH.REGISTER}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(userData)
            });

            const result = await response.json();

            if (response.ok) {
                Toast.show('Регистрация успешна!', 'Теперь вы можете войти в систему', 'success');
                this.showSection('login');
                form.reset();
            } else {
                Toast.show('Ошибка регистрации', result.detail || 'Произошла ошибка при регистрации', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение к интернету', 'error');
        } finally {
            this.setLoadingState(submitBtn, false);
        }
    }

    setLoadingState(button, isLoading) {
        this.isLoading = isLoading;

        if (isLoading) {
            button.classList.add('loading');
            button.disabled = true;
        } else {
            button.classList.remove('loading');
            button.disabled = false;
        }
    }

    setTokens(accessToken, refreshToken) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
    }

    clearTokens() {
        this.accessToken = null;
        this.refreshToken = null;
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
    }

    checkPasswordStrength(password) {
        const strengthBar = document.querySelector('.strength-bar');
        if (!strengthBar) return;

        let strength = 0;

        if (password.length >= 8) strength++;
        if (password.match(/[a-z]+/)) strength++;
        if (password.match(/[A-Z]+/)) strength++;
        if (password.match(/[0-9]+/)) strength++;
        if (password.match(/[!@#$%^&*(),.?":{}|<>]+/)) strength++;

        strengthBar.className = 'strength-bar';

        if (password.length === 0) {
            return;
        } else if (strength <= 2) {
            strengthBar.classList.add('weak');
        } else if (strength <= 4) {
            strengthBar.classList.add('medium');
        } else {
            strengthBar.classList.add('strong');
        }
    }

    checkAuthStatus() {
        if (this.accessToken) {
            this.showSection('patients');
        } else {
            this.showSection('login');
        }
    }

    logout() {
        this.clearTokens();
        this.currentUser = null;
        this.showSection('login');

        document.getElementById('loginNav').classList.remove('hidden');
        document.getElementById('registerNav').classList.remove('hidden');
        document.getElementById('patientsNav').classList.add('hidden');
        document.getElementById('logoutNav').classList.add('hidden');

        Toast.show('Выход', 'Вы успешно вышли из системы', 'success');
    }

    showToast(title, message, type = 'info') {
        Toast.show(title, message, type);
    }

    setupAnimations() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll('.auth-card, .profile-card, .patient-card, .video-card, .stat-card, .analysis-card').forEach(card => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            observer.observe(card);
        });
    }
}