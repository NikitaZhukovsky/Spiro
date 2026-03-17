import { API_ENDPOINTS, ANALYSIS_CONFIG, TEXT } from '../utils/constants.js';
import { PDFReportGenerator } from './PDFReportGenerator.js';
import { DataFormatter } from '../utils/formatters.js';
import { FormValidator } from '../utils/validators.js';
import { Toast } from '../components/Toast.js';
import { CustomSelect } from './CustomSelect.js';

export class RespiratoryAnalysisManager {
    constructor(authApp, patientManager, videoManager) {
        this.authApp = authApp;
        this.patientManager = patientManager;
        this.videoManager = videoManager;
        this.baseURL = authApp.baseURL;
        this.currentPatientId = null;
        this.currentVideoId = null;
        this.analyses = [];
        this.filteredAnalyses = [];
        this.pendingAnalysisId = null;
        this.statusCheckInterval = null;
        this.currentAnalysisId = null;
        this.searchTerm = '';

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupAnalysisModal();
        this.setupAnalysisResultModal();
        this.setupConfirmModals();
        this.setupSearch();
    }

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-analyze')) {
                const videoId = e.target.closest('.btn-analyze').dataset.videoId;
                this.openAnalysisModal(videoId);
                return;
            }

            if (e.target.closest('#startAnalysisBtn')) {
                e.preventDefault();
                this.startAnalysis();
                return;
            }

            if (e.target.closest('#closeAnalysisModal') || e.target.closest('#cancelAnalysis')) {
                this.closeAnalysisModal();
                return;
            }

            if (e.target.closest('.btn-analysis-view')) {
                const analysisId = e.target.closest('.btn-analysis-view').dataset.analysisId;
                this.viewAnalysis(analysisId);
                return;
            }

            if (e.target.closest('.btn-analysis-delete')) {
                const analysisId = e.target.closest('.btn-analysis-delete').dataset.analysisId;
                this.deleteAnalysis(analysisId);
                return;
            }

            if (e.target.closest('#backToVideosFromAnalysis')) {
                this.patientManager.authApp.showSection('patientDetail');
                return;
            }

            if (e.target.closest('#refreshAnalyses')) {
                this.loadAnalyses();
                return;
            }

            if (e.target.closest('#analyzeVideo')) {
                const modal = document.getElementById('previewModal');
                if (modal.currentVideoId) {
                    this.openAnalysisModal(modal.currentVideoId);
                    if (this.videoManager) {
                        this.videoManager.closePreviewModal();
                    }
                }
                return;
            }

            if (e.target.closest('#closeAnalysisResultsModal') || e.target.closest('#closeResultsModalBtn')) {
                this.closeAnalysisResultModal();
                return;
            }

            if (e.target.closest('#downloadAnalysisResultBtn')) {
                this.generateAndDownloadPDFReport();
                return;
            }

            if (e.target.closest('#downloadAnalysisPlotsBtn')) {
                this.downloadAnalysisPlots();
                return;
            }
        });

        document.getElementById('confirmDeleteAnalysis').addEventListener('click', () => this.executeAnalysisDelete());
        document.getElementById('cancelDeleteAnalysis').addEventListener('click', () => this.closeConfirmDeleteAnalysisModal());
        document.getElementById('closeConfirmDeleteAnalysis').addEventListener('click', () => this.closeConfirmDeleteAnalysisModal());
    }

    setupSearch() {
        const searchInput = document.getElementById('analysisSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.trim();
                this.filterAnalyses();
            });

            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchInput.value = '';
                    this.searchTerm = '';
                    this.filterAnalyses();
                }
            });
        }
    }

    setupAnalysisModal() {
        const modal = document.getElementById('analysisModal');
        const form = document.getElementById('analysisForm');

        const customSelects = modal.querySelectorAll('.custom-select');
        customSelects.forEach(select => {
            new CustomSelect(select);
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        const markerColorSelect = document.getElementById('markerColor');
        if (markerColorSelect) {
            markerColorSelect.addEventListener('change', (e) => {
                this.updateMarkerColorPreview(e.target.value);
            });
        }

        this.updateMarkerColorPreview('#FF0000');
    }

    setupAnalysisResultModal() {
        this.addModalScrollStyles();
    }

    addModalScrollStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .modal-content.extra-large .modal-body {
                max-height: calc(90vh - 140px);
                overflow-y: auto;
                padding: 2rem;
            }

            .plots-grid-large {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
                gap: 1.5rem;
                margin-top: 1rem;
            }

            .plot-card-large {
                background: var(--surface);
                border: 1px solid var(--border);
                border-radius: var(--radius);
                overflow: hidden;
                transition: var(--transition);
            }

            .plot-card-large:hover {
                transform: translateY(-2px);
                box-shadow: var(--shadow-md);
            }

            .plot-image-container {
                width: 100%;
                height: 300px;
                background: var(--background);
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                border-bottom: 1px solid var(--border);
            }

            .plot-image-large {
                width: 100%;
                height: 100%;
                object-fit: contain;
                padding: 1rem;
            }

            .plot-info-large {
                padding: 1rem;
            }

            .plot-title-large {
                color: var(--text-primary);
                font-size: 1rem;
                font-weight: 600;
                margin-bottom: 0.5rem;
            }

            .plot-description-large {
                color: var(--text-secondary);
                font-size: 0.85rem;
                line-height: 1.4;
            }

            .plot-placeholder-large {
                text-align: center;
                padding: 4rem 2rem;
                color: var(--text-secondary);
                grid-column: 1 / -1;
            }

            .plot-placeholder-large i {
                font-size: 3rem;
                margin-bottom: 1rem;
                opacity: 0.5;
            }

            .plot-loading {
                text-align: center;
                padding: 2rem;
                color: var(--text-secondary);
            }

            .plot-error {
                text-align: center;
                padding: 2rem;
                color: var(--error);
            }

            .modal-content.extra-large .modal-body::-webkit-scrollbar {
                width: 8px;
            }

            .modal-content.extra-large .modal-body::-webkit-scrollbar-track {
                background: var(--surface-light);
                border-radius: 4px;
            }

            .modal-content.extra-large .modal-body::-webkit-scrollbar-thumb {
                background: var(--border);
                border-radius: 4px;
            }

            .modal-content.extra-large .modal-body::-webkit-scrollbar-thumb:hover {
                background: var(--text-tertiary);
            }
        `;
        document.head.appendChild(style);
    }

    setupConfirmModals() {
        document.getElementById('confirmDeleteAnalysis').addEventListener('click', () => this.executeAnalysisDelete());
        document.getElementById('cancelDeleteAnalysis').addEventListener('click', () => this.closeConfirmDeleteAnalysisModal());
        document.getElementById('closeConfirmDeleteAnalysis').addEventListener('click', () => this.closeConfirmDeleteAnalysisModal());
    }

    updateMarkerColorPreview(color) {
        const preview = document.getElementById('markerColorPreview');
        if (preview) {
            preview.style.backgroundColor = color;
            preview.style.borderColor = this.adjustColorBrightness(color, -30);
        }
    }

    adjustColorBrightness(color, percent) {
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) + amt;
        const G = (num >> 8 & 0x00FF) + amt;
        const B = (num & 0x0000FF) + amt;

        return "#" + (
            0x1000000 +
            (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
            (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
            (B < 255 ? B < 1 ? 0 : B : 255)
        ).toString(16).slice(1);
    }

    setCurrentPatient(patientId) {
        this.currentPatientId = patientId;
    }

    setCurrentVideo(videoId) {
        this.currentVideoId = videoId;
    }

    openAnalysisModal(videoId) {
        if (!this.currentPatientId) {
            Toast.show('Ошибка', 'Пациент не выбран', 'error');
            return;
        }

        this.setCurrentVideo(videoId);
        const modal = document.getElementById('analysisModal');

        document.getElementById('analysisForm').reset();
        document.getElementById('analysisProgress').style.display = 'none';
        document.getElementById('analysisResults').style.display = 'none';
        document.getElementById('analysisError').style.display = 'none';
        document.getElementById('analysisFormSection').style.display = 'block';
        document.getElementById('startAnalysisBtn').disabled = false;
        document.getElementById('startAnalysisBtn').querySelector('.btn-text').textContent = 'Начать анализ';

        this.updateMarkerColorPreview('#FF0000');
        modal.classList.add('active');
    }

    closeAnalysisModal() {
        const modal = document.getElementById('analysisModal');
        modal.classList.remove('active');
        this.stopStatusCheck();
    }

    async startAnalysis() {
        if (!this.currentPatientId || !this.currentVideoId) {
            Toast.show('Ошибка', 'Не выбраны пациент или видео', 'error');
            return;
        }

        const form = document.getElementById('analysisForm');
        const formData = new FormData(form);

        const markerColor = formData.get('marker_color');
        const markerSizeStr = formData.get('marker_size_mm');

        if (!markerColor || !markerSizeStr) {
            Toast.show('Ошибка', 'Заполните все обязательные поля', 'error');
            return;
        }

        const markerSizeValidation = FormValidator.validateMarkerSize(markerSizeStr);
        if (!markerSizeValidation.isValid) {
            Toast.show('Ошибка', markerSizeValidation.message, 'error');
            return;
        }

        const markerSize = parseFloat(markerSizeStr);
        const colorString = ANALYSIS_CONFIG.MARKER_COLORS[markerColor] || markerColor;

        const analysisData = {
            video_id: parseInt(this.currentVideoId),
            marker_color: colorString,
            marker_size_mm: markerSize
        };

        const startBtn = document.getElementById('startAnalysisBtn');
        this.authApp.setLoadingState(startBtn, true);

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.ANALYSIS.ANALYZE(this.currentPatientId)}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(analysisData)
            });

            if (response.ok) {
                const analysis = await response.json();
                this.pendingAnalysisId = analysis.id;

                this.closeAnalysisModal();
                Toast.show('Успешно', 'Анализ начат. Ожидайте результатов...', 'success');
                this.startStatusCheck(analysis.id);

            } else {
                const error = await response.json();
                Toast.show('Ошибка', error.detail || 'Не удалось начать анализ', 'error');
                this.authApp.setLoadingState(startBtn, false);
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение к серверу', 'error');
            this.authApp.setLoadingState(startBtn, false);
        }
    }

    startStatusCheck(analysisId) {
        this.stopStatusCheck();

        setTimeout(() => {
            this.checkAnalysisStatus(analysisId);
        }, 3000);

        this.statusCheckInterval = setInterval(() => {
            this.checkAnalysisStatus(analysisId);
        }, 5000);
    }

    stopStatusCheck() {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }
    }

    async checkAnalysisStatus(analysisId) {
        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.ANALYSIS.STATUS(analysisId)}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const statusData = await response.json();

                if (statusData.progress_percent >= 100) {
                    this.stopStatusCheck();
                    this.onAnalysisComplete(analysisId);
                }
            }
        } catch (error) {
            // Игнорируем ошибки проверки статуса
        }
    }

    async onAnalysisComplete(analysisId) {
        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.ANALYSIS.DETAIL(analysisId)}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const analysis = await response.json();

                Toast.show('Анализ завершен', 'Результаты готовы к просмотру', 'success');
                await this.loadAnalyses();

            } else {
                Toast.show('Ошибка', 'Не удалось загрузить результаты', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        }
    }

    async loadAnalyses() {
        if (!this.currentPatientId) return;

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.ANALYSIS.PATIENT_ANALYSES(this.currentPatientId)}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const analysesData = await response.json();
                this.analyses = analysesData;
                this.filteredAnalyses = [...this.analyses];

                await this.enrichAnalysesWithVideoTitles();
                this.filterAnalyses();
            } else if (response.status === 401) {
                Toast.show('Ошибка', 'Требуется авторизация', 'error');
                this.authApp.logout();
            }
        } catch (error) {
            // Игнорируем ошибки загрузки
        }
    }

    filterAnalyses() {
        if (!this.searchTerm) {
            this.filteredAnalyses = [...this.analyses];
        } else {
            const searchTermLower = this.searchTerm.toLowerCase();
            this.filteredAnalyses = this.analyses.filter(analysis => {
                const videoTitle = analysis.video_title || `Видео #${analysis.video_id}`;
                if (videoTitle.toLowerCase().includes(searchTermLower)) {
                    return true;
                }

                const date = DataFormatter.formatDate(analysis.created_at);
                if (date.includes(searchTermLower)) {
                    return true;
                }

                const statusText = this.getStatusText(analysis.status).toLowerCase();
                if (statusText.includes(searchTermLower)) {
                    return true;
                }

                if (analysis.id.toString().includes(searchTermLower)) {
                    return true;
                }

                if (analysis.video_id.toString().includes(searchTermLower)) {
                    return true;
                }

                return false;
            });
        }

        this.renderAnalyses();
    }

    async enrichAnalysesWithVideoTitles() {
        for (const analysis of this.analyses) {
            if (analysis.video_id && !analysis.video_title) {
                try {
                    const videoTitle = await this.getVideoTitle(analysis.video_id);
                    analysis.video_title = videoTitle || `Видео #${analysis.video_id}`;
                } catch (error) {
                    analysis.video_title = `Видео #${analysis.video_id}`;
                }
            }
        }
    }

    async getVideoTitle(videoId) {
        if (!this.currentPatientId || !videoId) return null;

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.PATIENTS.VIDEO_DETAIL(this.currentPatientId, videoId)}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const videoData = await response.json();
                return videoData.title || videoData.filename || `Видео #${videoId}`;
            }
            return `Видео #${videoId}`;
        } catch (error) {
            return `Видео #${videoId}`;
        }
    }

    renderAnalyses() {
        const container = document.getElementById('analysesContainer');
        if (!container) return;

        const analysesToRender = this.searchTerm ? this.filteredAnalyses : this.analyses;

        if (analysesToRender.length === 0) {
            if (this.searchTerm) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-search"></i>
                        <h3>Анализы не найдены</h3>
                        <p>По запросу "${this.searchTerm}" ничего не найдено</p>
                        <button class="btn btn-secondary" id="clearAnalysisSearch">
                            <i class="fas fa-times"></i>
                            Очистить поиск
                        </button>
                    </div>
                `;

                const clearBtn = document.getElementById('clearAnalysisSearch');
                if (clearBtn) {
                    clearBtn.addEventListener('click', () => {
                        document.getElementById('analysisSearch').value = '';
                        this.searchTerm = '';
                        this.filterAnalyses();
                    });
                }
            } else {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-chart-bar"></i>
                        <h3>Анализы не найдены</h3>
                        <p>Запустите первый анализ для видео пациента</p>
                    </div>
                `;
            }
            return;
        }

        container.innerHTML = analysesToRender.map(analysis => {
            const videoTitle = analysis.video_title || `Видео #${analysis.video_id}`;
            const analysisTitle = `Анализ - "${videoTitle}"`;

            let highlightedTitle = analysisTitle;
            if (this.searchTerm) {
                highlightedTitle = this.highlightSearchTerm(analysisTitle, this.searchTerm);
            }

            return `
                <div class="analysis-card" data-analysis-id="${analysis.id}">
                    <div class="analysis-info">
                        <div class="analysis-header">
                            <h4>${highlightedTitle}</h4>
                            <span class="analysis-status ${analysis.status}">
                                ${this.getStatusText(analysis.status)}
                            </span>
                        </div>
                        <div class="analysis-meta">
                            <span><i class="fas fa-calendar"></i> ${DataFormatter.formatDate(analysis.created_at)}</span>
                            <span><i class="fas fa-hashtag"></i> ID: ${analysis.id}</span>
                            <span><i class="fas fa-video"></i> Видео ID: ${analysis.video_id}</span>
                        </div>
                    </div>
                    <div class="analysis-actions">
                        ${analysis.status === 'completed' ? `
                            <button class="btn-action btn-analysis-view" data-analysis-id="${analysis.id}" title="Просмотр">
                                <i class="fas fa-eye"></i>
                            </button>
                        ` : ''}
                        <button class="btn-action btn-analysis-delete" data-analysis-id="${analysis.id}" title="Удалить">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    highlightSearchTerm(text, searchTerm) {
        if (!searchTerm) return text;

        const regex = new RegExp(`(${this.escapeRegex(searchTerm)})`, 'gi');
        return text.replace(regex, '<span class="search-highlight">$1</span>');
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    getStatusText(status) {
        const statusMap = {
            'processing': TEXT.STATUS.PROCESSING,
            'completed': TEXT.STATUS.COMPLETED,
            'failed': TEXT.STATUS.FAILED
        };
        return statusMap[status] || status;
    }

    async viewAnalysis(analysisId) {
        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.ANALYSIS.DETAIL(analysisId)}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const analysis = await response.json();
                this.currentAnalysisId = analysis.id;

                const videoTitle = await this.getVideoTitle(analysis.video_id);
                this.showAnalysisModalWithPlots(analysis, videoTitle);
            } else {
                Toast.show('Ошибка', 'Не удалось загрузить анализ', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка', 'Не удалось загрузить анализ', 'error');
        }
    }

    showAnalysisModalWithPlots(analysis, videoTitle) {
        const modal = document.getElementById('analysisResultsModal');
        if (!modal) {
            Toast.show('Ошибка', 'Модальное окно не найдено', 'error');
            return;
        }

        try {
            const displayTitle = videoTitle || `Видео #${analysis.video_id}`;
            document.getElementById('analysisResultsTitle').textContent = `Анализ - "${displayTitle}"`;

            this.fillAnalysisResultModal(analysis, videoTitle);
            this.insertPlotImages(analysis);

            modal.classList.add('active');
            this.scrollModalToTop('analysisResultsModal');
        } catch (error) {
            Toast.show('Ошибка', 'Не удалось отобразить результаты', 'error');
        }
    }

    scrollModalToTop(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            const modalBody = modal.querySelector('.modal-body');
            if (modalBody) {
                setTimeout(() => {
                    modalBody.scrollTop = 0;
                }, 50);
            }
        }
    }

    fillAnalysisResultModal(analysis, videoTitle) {
        try {
            console.log('Заполнение деталей анализа:', analysis);

            const analysisDateResultEl = document.getElementById('analysisDateResult');
            if (analysisDateResultEl && analysis.created_at) {
                analysisDateResultEl.textContent = DataFormatter.formatDate(analysis.created_at, true);
            }

            const analysisStatusResultEl = document.getElementById('analysisStatusResult');
            if (analysisStatusResultEl) {
                const statusText = analysis.status === 'completed' ? 'Завершен' :
                                 analysis.status === 'processing' ? 'В процессе' :
                                 analysis.status === 'failed' ? 'Ошибка' : 'Неизвестно';
                analysisStatusResultEl.textContent = statusText;
            }

            const markerColorResultEl = document.getElementById('markerColorResult');
            if (markerColorResultEl && analysis.marker_color) {
                markerColorResultEl.textContent = DataFormatter.formatMarkerColor(analysis.marker_color);
            }

            const markerSizeResultEl = document.getElementById('markerSizeResult');
            if (markerSizeResultEl && analysis.marker_size_mm) {
                markerSizeResultEl.textContent = `${analysis.marker_size_mm} мм`;
            }

            const processingTimeResultEl = document.getElementById('processingTimeResult');
            if (processingTimeResultEl && analysis.processing_time_seconds) {
                processingTimeResultEl.textContent = `${analysis.processing_time_seconds.toFixed(1)} сек`;
            }

            const analysisFramesResultEl = document.getElementById('analysisFramesResult');
            if (analysisFramesResultEl && analysis.total_frames) {
                analysisFramesResultEl.textContent = `${analysis.total_frames} кадров`;
            }

            const breathingRate = analysis.breathing_rate_mean_bpm ?
                `${analysis.breathing_rate_mean_bpm.toFixed(1)} вд/мин` : '—';

            const amplitude = analysis.amplitude_mean_mm ?
                `${analysis.amplitude_mean_mm.toFixed(1)} мм` : '—';

            const synchronization = analysis.synchronization_index ?
                `${(analysis.synchronization_index * 100).toFixed(1)}%` : '—';

            const breathingRateEl = document.getElementById('breathingRateResultDetailed');
            const amplitudeEl = document.getElementById('amplitudeResultDetailed');
            const synchronizationEl = document.getElementById('synchronizationResultDetailed');

            if (breathingRateEl) breathingRateEl.textContent = breathingRate;
            if (amplitudeEl) amplitudeEl.textContent = amplitude;
            if (synchronizationEl) synchronizationEl.textContent = synchronization;

            const medicalAssessmentContent = document.getElementById('medicalAssessmentContent');
            if (medicalAssessmentContent) {
                if (analysis.medical_assessment && analysis.medical_assessment !== "Оценка загружается...") {
                    medicalAssessmentContent.innerHTML = `<p>${analysis.medical_assessment.replace(/\n/g, '<br>')}</p>`;
                } else if (analysis.text_report) {
                    const reportLines = analysis.text_report.split('\n');
                    let assessmentText = '';

                    let foundGeneralInfo = false;
                    for (let i = 0; i < reportLines.length; i++) {
                        const line = reportLines[i].trim();
                        if (line.includes('ОБЩАЯ ИНФОРМАЦИЯ')) {
                            foundGeneralInfo = true;
                            continue;
                        }
                        if (foundGeneralInfo) {
                            if (line.includes('ЛИНИЯ 1:') || line.includes('==================================================')) {
                                break;
                            }
                            if (line && line !== '') {
                                assessmentText += line + '<br>';
                            }
                        }
                    }

                    if (assessmentText) {
                        medicalAssessmentContent.innerHTML = `<p>${assessmentText}</p>`;
                    } else if (analysis.breathing_rate_mean_bpm) {
                        const bpm = analysis.breathing_rate_mean_bpm;
                        let assessment = '';

                        if (bpm < 12) {
                            assessment = 'Брадипноэ: частота дыхания ниже нормы';
                        } else if (bpm > 20) {
                            assessment = 'Тахипноэ: частота дыхания выше нормы';
                        } else {
                            assessment = 'Нормальная частота дыхания';
                        }

                        medicalAssessmentContent.innerHTML = `<p>${assessment}. Частота дыхания: ${bpm.toFixed(1)}</p>`;
                    } else {
                        medicalAssessmentContent.innerHTML = '<p>Медицинская оценка не доступна</p>';
                    }
                } else {
                    medicalAssessmentContent.innerHTML = '<p>Медицинская оценка не доступна</p>';
                }
            }

            console.log('Детали анализа заполнены успешно');

        } catch (error) {
            console.error('Ошибка при заполнении результатов:', error);
        }
    }

    insertPlotImages(analysis) {
        const plotsGrid = document.getElementById('analysisPlotsGrid');
        if (!plotsGrid) return;

        plotsGrid.innerHTML = '';

        const plotData = [
            {
                path: analysis.width_line_1_plot,
                title: 'Изменение ширины маркера (линия 1)',
                description: 'Изменение ширины маркера по линии 1 в зависимости от времени',
                type: 'width_line_1'
            },
            {
                path: analysis.width_line_2_plot,
                title: 'Изменение ширины маркера (линия 2)',
                description: 'Изменение ширины маркера по линии 2 в зависимости от времени',
                type: 'width_line_2'
            },
            {
                path: analysis.width_line_3_plot,
                title: 'Изменение ширины маркера (линия 3)',
                description: 'Изменение ширины маркера по линии 3 в зависимости от времени',
                type: 'width_line_3'
            },
            {
                path: analysis.summary_plot,
                title: 'Сводный график анализа',
                description: 'Сводная информация по всем линиям анализа',
                type: 'summary_plot'
            }
        ];

        const availablePlots = plotData.filter(plot => plot.path && plot.path.trim() !== '');

        if (availablePlots.length === 0) {
            plotsGrid.innerHTML = `
                <div class="plot-placeholder-large">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h4>Графики не найдены в базе данных</h4>
                    <p>Проверьте пути к графикам в БД</p>
                </div>
            `;
            return;
        }

        let plotsHTML = '';

        availablePlots.forEach((plot) => {
            const relativePath = this.buildRelativePlotPath(analysis.patient_id, analysis.id, plot.path);

            const containerId = `plot-container-${analysis.id}-${plot.type}`;
            const imageId = `plot-image-${analysis.id}-${plot.type}`;
            const loadingId = `plot-loading-${analysis.id}-${plot.type}`;

            plotsHTML += `
                <div class="plot-card-large" id="${containerId}">
                    <div class="plot-image-container">
                        <div class="plot-loading" id="${loadingId}">
                            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                            <p>Загрузка графика...</p>
                        </div>
                        <img src="${relativePath}"
                             alt="${plot.title}"
                             class="plot-image-large"
                             id="${imageId}"
                             style="display: none;"
                             onload="
                                document.getElementById('${imageId}').style.display = 'block';
                                document.getElementById('${loadingId}').style.display = 'none';
                             "
                             onerror="
                                const loadingDiv = document.getElementById('${loadingId}');
                                if (loadingDiv) {
                                    loadingDiv.className = 'plot-error';
                                }
                                document.getElementById('${imageId}').style.display = 'none';
                             ">
                    </div>
                    <div class="plot-info-large">
                        <h4 class="plot-title-large">${plot.title}</h4>
                        <p class="plot-description-large">${plot.description}</p>
                    </div>
                </div>
            `;
        });

        plotsGrid.innerHTML = plotsHTML;
    }

    buildRelativePlotPath(patientId, analysisId, fullPath) {
        if (!fullPath) return '';

        const filename = this.extractFilename(fullPath);
        if (!filename) return '';

        return `analysis_plots/${patientId}/${analysisId}/${filename}`;
    }

    extractFilename(fullPath) {
        if (!fullPath) return '';

        const parts = fullPath.split(/[\\/]/);
        return parts[parts.length - 1];
    }

    closeAnalysisResultModal() {
        const modal = document.getElementById('analysisResultsModal');
        if (modal) {
            modal.classList.remove('active');

            const plotsGrid = document.getElementById('analysisPlotsGrid');
            if (plotsGrid) {
                plotsGrid.innerHTML = '';
            }

            this.currentAnalysisId = null;
        }
    }

    async generateAndDownloadPDFReport() {
        if (!this.currentAnalysisId || !this.currentPatientId) {
            Toast.show('Ошибка', 'Анализ не выбран', 'error');
            return;
        }

        const downloadBtn = document.getElementById('downloadAnalysisResultBtn');
        const originalContent = downloadBtn.innerHTML;
        downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Генерация PDF...';
        downloadBtn.disabled = true;

        try {
            const analysisResponse = await fetch(`${this.baseURL}${API_ENDPOINTS.ANALYSIS.DETAIL(this.currentAnalysisId)}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!analysisResponse.ok) {
                throw new Error('Не удалось получить данные анализа');
            }

            const analysis = await analysisResponse.json();

            let patient = this.patientManager.currentPatient;
            if (!patient) {
                const patientResponse = await fetch(`${this.baseURL}${API_ENDPOINTS.PATIENTS.DETAIL(this.currentPatientId)}`, {
                    headers: {
                        'Authorization': `Bearer ${this.authApp.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!patientResponse.ok) {
                    throw new Error('Не удалось получить данные пациента');
                }
                patient = await patientResponse.json();
            }

            const plots = await this.collectAllAnalysisPlots(analysis);

            const pdfGenerator = new PDFReportGenerator();
            await pdfGenerator.generateAnalysisReport(patient, analysis, plots);

            Toast.show('Успешно', 'PDF отчет создан', 'success');

        } catch (error) {
            console.error('Ошибка при генерации PDF:', error);
            Toast.show('Ошибка', 'Не удалось создать PDF отчет', 'error');
        } finally {
            downloadBtn.innerHTML = originalContent;
            downloadBtn.disabled = false;
        }
    }

    async collectAllAnalysisPlots(analysis) {
        const plots = [];
        const plotData = [
            {
                url: this.buildRelativePlotPath(analysis.patient_id, analysis.id, analysis.width_line_1_plot),
                title: 'Изменение ширины маркера (линия 1)',
                description: 'Изменение ширины маркера по линии 1 в зависимости от времени'
            },
            {
                url: this.buildRelativePlotPath(analysis.patient_id, analysis.id, analysis.width_line_2_plot),
                title: 'Изменение ширины маркера (линия 2)',
                description: 'Изменение ширины маркера по линии 2 в зависимости от времени'
            },
            {
                url: this.buildRelativePlotPath(analysis.patient_id, analysis.id, analysis.width_line_3_plot),
                title: 'Изменение ширины маркера (линия 3)',
                description: 'Изменение ширины маркера по линии 3 в зависимости от времени'
            },
            {
                url: this.buildRelativePlotPath(analysis.patient_id, analysis.id, analysis.summary_plot),
                title: 'Сводный график анализа',
                description: 'Сводная информация по всем линиям анализа'
            }
        ];

        for (const plot of plotData) {
            if (plot.url) {
                try {
                    const response = await fetch(plot.url, { method: 'HEAD' });
                    if (response.ok) {
                        plots.push(plot);
                    }
                } catch (error) {
                    console.warn(`График недоступен: ${plot.title}`);
                }
            }
        }

        return plots;
    }

    async downloadAnalysisPlots() {
        if (!this.currentAnalysisId || !this.currentPatientId) {
            Toast.show('Ошибка', 'Анализ не выбран', 'error');
            return;
        }

        const analysis = this.analyses.find(a => a.id === this.currentAnalysisId);
        if (!analysis) {
            Toast.show('Ошибка', 'Анализ не найден', 'error');
            return;
        }

        const plots = [
            { name: 'width_line_1', path: analysis.width_line_1_plot },
            { name: 'width_line_2', path: analysis.width_line_2_plot },
            { name: 'width_line_3', path: analysis.width_line_3_plot },
            { name: 'summary_plot', path: analysis.summary_plot }
        ];

        let downloaded = 0;
        let errors = 0;

        for (const plot of plots) {
            if (!plot.path) continue;

            try {
                const filename = this.extractFilename(plot.path);
                const url = this.buildRelativePlotPath(this.currentPatientId, this.currentAnalysisId, plot.path);

                const response = await fetch(url);

                if (response.ok) {
                    const blob = await response.blob();
                    const downloadUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(downloadUrl);

                    downloaded++;
                } else {
                    errors++;
                }
            } catch (error) {
                errors++;
            }
        }

        if (downloaded > 0) {
            Toast.show('Успешно', `Скачано ${downloaded} график(ов)`, 'success');
        }
        if (errors > 0) {
            Toast.show('Ошибка', `Не удалось скачать ${errors} график(ов)`, 'error');
        }
    }

    async downloadAnalysisReport() {
        if (!this.currentAnalysisId) {
            Toast.show('Ошибка', 'Анализ не выбран', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.ANALYSIS.REPORT(this.currentAnalysisId)}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const report = await response.json();
                this.downloadTextFile(report.report, `analysis_report_${this.currentAnalysisId}.txt`);
            } else {
                const error = await response.json();
                Toast.show('Ошибка', error.detail || 'Не удалось скачать отчет', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        }
    }

    downloadTextFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        Toast.show('Успешно', 'Отчет скачивается', 'success');
    }

    deleteAnalysis(analysisId) {
        const analysis = this.analyses.find(a => a.id === parseInt(analysisId));
        if (!analysis) return;

        this.pendingDeleteAnalysisId = analysisId;
        const deleteAnalysisIdEl = document.getElementById('deleteAnalysisId');
        const deleteAnalysisDateEl = document.getElementById('deleteAnalysisDate');

        if (deleteAnalysisIdEl) deleteAnalysisIdEl.textContent = `#${analysis.id}`;
        if (deleteAnalysisDateEl) deleteAnalysisDateEl.textContent = DataFormatter.formatDate(analysis.created_at);

        document.getElementById('confirmDeleteAnalysisModal').classList.add('active');
    }

    closeConfirmDeleteAnalysisModal() {
        document.getElementById('confirmDeleteAnalysisModal').classList.remove('active');
        this.pendingDeleteAnalysisId = null;
    }

    async executeAnalysisDelete() {
        if (!this.pendingDeleteAnalysisId) return;

        const analysisId = this.pendingDeleteAnalysisId;
        this.closeConfirmDeleteAnalysisModal();

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.ANALYSIS.DETAIL(analysisId)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                Toast.show('Успешно', 'Анализ удален', 'success');
                this.loadAnalyses();
            } else {
                const error = await response.json();
                Toast.show('Ошибка', error.detail || 'Не удалось удалить анализ', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение', 'error');
        } finally {
            this.pendingDeleteAnalysisId = null;
        }
    }
}