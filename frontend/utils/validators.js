import { APP_CONFIG, ANALYSIS_CONFIG } from './constants.js';

export class FormValidator {
    static validateRequired(field, fieldName) {
        const value = field.value.trim();
        const fieldType = field.type || field.tagName.toLowerCase();

        let isValid = true;
        if (fieldType === 'select-one') {
            isValid = value !== '' && value !== null && value !== undefined;
        } else {
            isValid = value !== '';
        }

        return {
            isValid,
            message: isValid ? '' : `${fieldName} является обязательным полем`
        };
    }

    static validateEmail(field, fieldName) {
        const value = field.value.trim();

        if (!field.required && !value) {
            return { isValid: true, message: '' };
        }

        if (!value) {
            return {
                isValid: false,
                message: `${fieldName} является обязательным полем`
            };
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            return {
                isValid: false,
                message: 'Введите корректный email адрес'
            };
        }

        return { isValid: true, message: '' };
    }

    static validateNumber(field, fieldName) {
        const value = field.value.trim();

        if (!field.required && !value) {
            return { isValid: true, message: '' };
        }

        if (!value) {
            return {
                isValid: false,
                message: `${fieldName} является обязательным полем`
            };
        }

        const numValue = parseFloat(value);
        const min = parseFloat(field.min) || -Infinity;
        const max = parseFloat(field.max) || Infinity;

        if (isNaN(numValue)) {
            return {
                isValid: false,
                message: `${fieldName} должно быть числом`
            };
        }

        if (numValue < 0) {
            return {
                isValid: false,
                message: `${fieldName} не может быть отрицательным`
            };
        }

        if (numValue < min) {
            return {
                isValid: false,
                message: `${fieldName} не может быть меньше ${min}`
            };
        }

        if (numValue > max) {
            return {
                isValid: false,
                message: `${fieldName} не может быть больше ${max}`
            };
        }

        return { isValid: true, message: '' };
    }

    static validateFile(file, options = {}) {
        const { maxSize = APP_CONFIG.MAX_FILE_SIZE, allowedTypes = APP_CONFIG.SUPPORTED_VIDEO_TYPES } = options;

        if (!file) {
            return { isValid: false, message: 'Файл не выбран' };
        }

        if (!allowedTypes.some(type => file.type.startsWith('video/'))) {
            return { isValid: false, message: 'Пожалуйста, выберите видео файл' };
        }

        if (file.size > maxSize) {
            const sizeMB = (maxSize / (1024 * 1024)).toFixed(0);
            return {
                isValid: false,
                message: `Файл слишком большой. Максимальный размер: ${sizeMB}MB`
            };
        }

        return { isValid: true, message: '' };
    }

    static validateMarkerSize(size) {
        const numSize = parseFloat(size);
        if (isNaN(numSize)) {
            return { isValid: false, message: 'Размер маркера должен быть числом' };
        }

        if (numSize < ANALYSIS_CONFIG.MARKER_SIZE.MIN || numSize > ANALYSIS_CONFIG.MARKER_SIZE.MAX) {
            return {
                isValid: false,
                message: `Размер маркера должен быть от ${ANALYSIS_CONFIG.MARKER_SIZE.MIN} до ${ANALYSIS_CONFIG.MARKER_SIZE.MAX} мм`
            };
        }

        return { isValid: true, message: '' };
    }

    static validateSmokingData(status, years) {
        if (!status) {
            return { isValid: true, message: '' }; // Статус не обязателен
        }

        if ((status === 'active_smoker' || status === 'passive_smoker') && !years) {
            return {
                isValid: false,
                message: 'Для курящего пациента необходимо указать стаж курения'
            };
        }

        if (status === 'non_smoker' && years) {
            return {
                isValid: false,
                message: 'Для некурящего пациента стаж курения должен быть пустым'
            };
        }

        return { isValid: true, message: '' };
    }
}

export class FieldErrorHandler {
    static showError(field, message) {
        this.clearError(field);

        field.classList.add('error');

        const errorElement = document.createElement('div');
        errorElement.className = 'field-error';
        errorElement.textContent = message;
        errorElement.style.cssText = `
            color: var(--error);
            font-size: 0.8rem;
            margin-top: 0.25rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        `;

        const icon = document.createElement('i');
        icon.className = 'fas fa-exclamation-circle';
        errorElement.prepend(icon);

        field.parentNode.appendChild(errorElement);
    }

    static clearError(field) {
        field.classList.remove('error');
        const existingError = field.parentNode.querySelector('.field-error');
        if (existingError) {
            existingError.remove();
        }
    }
}