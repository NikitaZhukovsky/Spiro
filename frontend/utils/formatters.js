import { TEXT } from './constants.js';

export class DataFormatter {
    static formatGender(gender) {
        const genderMap = {
            'male': TEXT.GENDER.MALE,
            'female': TEXT.GENDER.FEMALE
        };
        return genderMap[gender] || '—';
    }

    static formatSmokingStatus(status) {
        const statusMap = {
            'non_smoker': TEXT.SMOKING_STATUS.NON_SMOKER,
            'active_smoker': TEXT.SMOKING_STATUS.ACTIVE_SMOKER,
            'passive_smoker': TEXT.SMOKING_STATUS.PASSIVE_SMOKER
        };
        return statusMap[status] || '—';
    }

    static formatFileSize(bytes) {
        if (!bytes && bytes !== 0) return '—';
        if (bytes === 0) return '0 B';

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    static formatDuration(seconds) {
        if (!seconds && seconds !== 0) return '—';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    static formatDate(dateString, includeTime = false) {
        if (!dateString) return '—';

        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return '—';

            if (includeTime) {
                return date.toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }

            return date.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        } catch (error) {
            return '—';
        }
    }

    static formatMarkerColor(color) {
        const colorMap = {
            'red': 'Красный',
            'green': 'Зеленый',
            'blue': 'Синий',
            '#FF0000': 'Красный',
            '#00FF00': 'Зеленый',
            '#0000FF': 'Синий'
        };
        return colorMap[color] || color;
    }

    static escapeHtml(unsafe) {
        if (!unsafe) return '';

        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    static formatBMI(bmi) {
        if (!bmi) return '—';

        let bmiClass = 'bmi-normal';
        if (bmi < 18.5) bmiClass = 'bmi-underweight';
        else if (bmi < 25) bmiClass = 'bmi-normal';
        else if (bmi < 30) bmiClass = 'bmi-overweight';
        else bmiClass = 'bmi-obese';

        return `<span class="bmi-indicator ${bmiClass}">${bmi.toFixed(1)}</span>`;
    }

    static getFieldName(field) {
        const label = field.closest('.input-group')?.querySelector('label');
        if (label) {
            return label.textContent.replace('*', '').replace('★', '').trim();
        }

        const fieldNames = {
            'name': 'Имя',
            'surname': 'Фамилия',
            'last_name': 'Отчество',
            'email': 'Email',
            'age': 'Возраст',
            'gender': 'Пол',
            'height': 'Рост',
            'weight': 'Вес',
            'smoking_status': 'Статус курения',
            'smoking_years': 'Стаж курения'
        };

        return fieldNames[field.name] || field.name || 'Поле';
    }

    static getSmokingStatusText(status) {
        const statusMap = {
            'active_smoker': 'Активный курильщик',
            'passive_smoker': 'Пассивный курильщик',
            'non_smoker': 'Не курю'
        };
        return statusMap[status] || status;
    }
}