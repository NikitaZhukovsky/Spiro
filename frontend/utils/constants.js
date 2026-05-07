// utils/constants.js

// Динамическое определение базового URL
const getBaseUrl = () => {
    // Если мы на Render (production)
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        return 'https://spiro-dp7k.onrender.com';
    }
    // Локальная разработка
    return 'http://localhost:8000';
};

export const APP_CONFIG = {
    BASE_URL: getBaseUrl(),  // ← ТОЛЬКО ЭТА СТРОКА ИЗМЕНЕНА
    MAX_FILE_SIZE: 500 * 1024 * 1024, // 500MB
    SUPPORTED_VIDEO_TYPES: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv'],
    PDF_CONFIG: {
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
    },
    COLORS: {
        PRIMARY: [41, 128, 185],
        SUCCESS: [39, 174, 96],
        WARNING: [243, 156, 18],
        ERROR: [231, 76, 60],
        PURPLE: [142, 68, 173]
    }
};

// Текстовые константы
export const TEXT = {
    STATUS: {
        PROCESSING: 'Обработка',
        COMPLETED: 'Завершено',
        FAILED: 'Ошибка'
    },
    GENDER: {
        MALE: 'Мужской',
        FEMALE: 'Женский'
    },
    SMOKING_STATUS: {
        NON_SMOKER: 'Не курю',
        ACTIVE_SMOKER: 'Активный курильщик',
        PASSIVE_SMOKER: 'Пассивный курильщик'
    }
};

// Маршруты API - НЕ МЕНЯЮТСЯ (относительные пути)
export const API_ENDPOINTS = {
    AUTH: {
        LOGIN: '/auth/login/',
        REGISTER: '/auth/register/'
    },
    PATIENTS: {
        BASE: '/patients/',
        DETAIL: (id) => `/patients/${id}/`,
        VIDEOS: (id) => `/patients/${id}/videos/`,
        VIDEO_STREAM: (patientId, videoId) => `/patients/${patientId}/videos/${videoId}/stream`,
        VIDEO_DETAIL: (patientId, videoId) => `/patients/${patientId}/videos/${videoId}/`
    },
    ANALYSIS: {
        BASE: '/respiratory-analysis/',
        DETAIL: (id) => `/respiratory-analysis/${id}`,
        ANALYZE: (patientId) => `/respiratory-analysis/analyze/${patientId}`,
        STATUS: (analysisId) => `/respiratory-analysis/${analysisId}/status`,
        PATIENT_ANALYSES: (patientId) => `/respiratory-analysis/patient/${patientId}/analyses`,
        REPORT: (analysisId) => `/respiratory-analysis/${analysisId}/report`
    }
};

// Конфигурация PDF
export const PDF_SETTINGS = {
    MARGIN: 10,
    PAGE_WIDTH: 210,
    PAGE_HEIGHT: 297,
    PLOT_IMAGE_WIDTH: 95,
    PLOT_IMAGE_HEIGHT: 70,
    COLUMN_WIDTH: 60,
    ROW_HEIGHT: 25
};

// Настройки анализа
export const ANALYSIS_CONFIG = {
    MARKER_COLORS: {
        '#FF0000': 'red',
        '#00FF00': 'green',
        '#0000FF': 'blue'
    },
    MARKER_SIZE: {
        MIN: 0.1,
        MAX: 100
    }
};

