class PlotUrlManager {
    static getPlotUrl(baseURL, plotPath) {
        if (!plotPath) return null;

        if (plotPath.startsWith('http')) {
            return plotPath;
        }

        let cleanPath = plotPath;
        if (cleanPath.startsWith('static/')) {
            cleanPath = cleanPath.substring(7);
        }

        return `${baseURL}/${cleanPath.replace(/\\/g, '/')}`;
    }
}


class EnhancedRespiratoryAnalysisManager {
    constructor(authApp, patientManager, videoManager) {
        this.authApp = authApp;
        this.patientManager = patientManager;
        this.videoManager = videoManager;
        this.baseURL = authApp.baseURL;
        this.currentPatientId = null;
        this.currentVideoId = null;
        this.currentAnalysisId = null;
        this.videoAnalyses = [];
        this.statusCheckInterval = null;
        this.startTime = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupEnhancedAnalysisModal();
    }

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-analyze-enhanced')) {
                const videoId = e.target.closest('.btn-analyze-enhanced').dataset.videoId;
                this.openEnhancedAnalysisModal(videoId);
                return;
            }

            if (e.target.closest('#closeEnhancedAnalysisModal') || e.target.closest('#cancelEnhancedAnalysis')) {
                this.closeEnhancedAnalysisModal();
                return;
            }

            if (e.target.closest('.analysis-tab')) {
                const tab = e.target.closest('.analysis-tab');
                const tabName = tab.dataset.tab;
                this.switchTab(tabName);
                return;
            }

            if (e.target.closest('#startEnhancedAnalysis')) {
                e.preventDefault();
                this.startEnhancedAnalysis();
                return;
            }

            if (e.target.closest('#viewResultsBtn')) {
                this.switchTab('results');
                return;
            }

            if (e.target.closest('#newAnalysisBtn')) {
                this.switchTab('start');
                return;
            }

            if (e.target.closest('.btn-view-analysis-history')) {
                const analysisId = e.target.closest('.btn-view-analysis-history').dataset.analysisId;
                this.viewAnalysisHistory(analysisId);
                return;
            }
        });
    }

    setupEnhancedAnalysisModal() {
        const colorOptions = document.querySelectorAll('.color-option input[type="radio"]');
        colorOptions.forEach(option => {
            option.addEventListener('change', (e) => {
                const preview = e.target.nextElementSibling;
                preview.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1)';
            });
        });

        // Инициализация слайдера размера маркера
        const markerSizeSlider = document.getElementById('enhancedMarkerSize');
        if (markerSizeSlider) {
            markerSizeSlider.addEventListener('input', (e) => {
                document.getElementById('markerSizeValue').textContent = `${e.target.value} мм`;
            });
        }
    }

    setCurrentPatient(patientId) {
        this.currentPatientId = patientId;
    }

    setCurrentVideo(videoId) {
        this.currentVideoId = videoId;
    }

    async openEnhancedAnalysisModal(videoId) {
        if (!this.currentPatientId) {
            this.authApp.showToast('Ошибка', 'Пациент не выбран', 'error');
            return;
        }

        this.setCurrentVideo(videoId);
        const modal = document.getElementById('enhancedAnalysisModal');

        await this.updateVideoInfo();
        await this.loadAnalysesHistory();
        this.resetAnalysisForm();
        this.switchTab('start');

        modal.classList.add('active');
    }

    closeEnhancedAnalysisModal() {
        const modal = document.getElementById('enhancedAnalysisModal');
        modal.classList.remove('active');
        this.stopStatusCheck();
        this.resetAnalysisForm();
    }

    async updateVideoInfo() {
        if (!this.currentPatientId || !this.currentVideoId) return;

        try {
            const response = await fetch(`${this.baseURL}/patients/${this.currentPatientId}/videos/${this.currentVideoId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const videoData = await response.json();
                document.getElementById('analysisVideoTitleInfo').textContent = videoData.title || videoData.filename;
                document.getElementById('analysisVideoDateInfo').textContent = new Date(videoData.created_at).toLocaleDateString();
                document.getElementById('analysisVideoSizeInfo').textContent = this.formatFileSize(videoData.file_size || 0);
            }
        } catch (error) {
            console.error('Error fetching video info:', error);
        }
    }

    async loadAnalysesHistory() {
        if (!this.currentPatientId || !this.currentVideoId) return;

        try {
            const response = await fetch(`${this.baseURL}/respiratory-analysis/video/${this.currentVideoId}/analyses`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                this.videoAnalyses = await response.json();

                // Получаем названия видео для анализов
                await this.enrichAnalysesHistoryWithVideoTitles();
                this.renderAnalysesHistory();
            }
        } catch (error) {
            console.error('Error loading analyses history:', error);
        }
    }

    async enrichAnalysesHistoryWithVideoTitles() {
        for (const analysis of this.videoAnalyses) {
            if (analysis.video_id && !analysis.video_title) {
                analysis.video_title = await this.getVideoTitle(analysis.video_id);
            }
        }
    }

    async getVideoTitle(videoId) {
        if (!this.currentPatientId || !videoId) return null;

        try {
            const response = await fetch(`${this.baseURL}/patients/${this.currentPatientId}/videos/${videoId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const videoData = await response.json();
                return videoData.title || videoData.filename;
            }
            return null;
        } catch (error) {
            console.error('Error fetching video title:', error);
            return null;
        }
    }

    renderAnalysesHistory() {
        const container = document.getElementById('analysesHistoryContainer');

        if (!this.videoAnalyses || this.videoAnalyses.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-chart-line"></i>
                    <h3>История анализов</h3>
                    <p>Запустите первый анализ для этого видео</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.videoAnalyses.map(analysis => {
            const videoTitle = analysis.video_title || 'Без названия';
            return `

                        <span class="history-status ${analysis.status}">
                            ${this.getStatusText(analysis.status)}
                        </span>
                    </div>
                    <div class="history-actions">
                        ${analysis.status === 'completed' ? `
                            <button class="btn-action btn-view-analysis-history" data-analysis-id="${analysis.id}" title="Просмотр">
                                <i class="fas fa-eye"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    switchTab(tabName) {
        document.querySelectorAll('.analysis-tab-content').forEach(content => {
            content.classList.remove('active');
        });

        document.querySelectorAll('.analysis-tab').forEach(tab => {
            tab.classList.remove('active');
        });

        const tabContent = document.getElementById(`${tabName}AnalysisTab`);
        const tabButton = document.querySelector(`.analysis-tab[data-tab="${tabName}"]`);

        if (tabContent) {
            tabContent.classList.add('active');
        }

        if (tabButton) {
            tabButton.classList.add('active');
        }

        this.updateFooterButtons(tabName);
    }

    updateFooterButtons(tabName) {
        const startBtn = document.getElementById('startEnhancedAnalysis');
        const cancelBtn = document.getElementById('cancelEnhancedAnalysis');
        const viewResultsBtn = document.getElementById('viewResultsBtn');
        const newAnalysisBtn = document.getElementById('newAnalysisBtn');

        switch(tabName) {
            case 'start':
                startBtn.classList.remove('hidden');
                cancelBtn.classList.remove('hidden');
                viewResultsBtn.classList.add('hidden');
                newAnalysisBtn.classList.add('hidden');
                break;

            case 'progress':
                startBtn.classList.add('hidden');
                cancelBtn.classList.remove('hidden');
                viewResultsBtn.classList.add('hidden');
                newAnalysisBtn.classList.add('hidden');
                break;

            case 'results':
                startBtn.classList.add('hidden');
                cancelBtn.classList.add('hidden');
                viewResultsBtn.classList.add('hidden');
                newAnalysisBtn.classList.remove('hidden');
                break;

            default:
                startBtn.classList.remove('hidden');
                cancelBtn.classList.remove('hidden');
                viewResultsBtn.classList.add('hidden');
                newAnalysisBtn.classList.add('hidden');
        }
    }

    resetAnalysisForm() {
        document.getElementById('enhancedMarkerSize').value = 10;
        document.getElementById('markerSizeValue').textContent = '10 мм';

        const defaultColor = document.querySelector('.color-option input[type="radio"][value="red"]');
        if (defaultColor) {
            defaultColor.checked = true;
        }

        // Скрываем элементы прогресса
        document.getElementById('enhancedProgressBar').style.display = 'none';
        document.getElementById('progressPercent').textContent = '0%';
        document.getElementById('currentProgressStage').textContent = 'Инициализация...';
        document.getElementById('elapsedTimeStat').textContent = '0 сек';
        document.getElementById('framesProcessed').textContent = '0/0';
        document.getElementById('progressDetail').textContent = 'Подготовка к анализу...';
    }

    async startEnhancedAnalysis() {
        if (!this.currentPatientId || !this.currentVideoId) {
            this.authApp.showToast('Ошибка', 'Не выбраны пациент или видео', 'error');
            return;
        }

        const markerColor = document.querySelector('.color-option input[type="radio"]:checked').value;
        const markerSize = parseFloat(document.getElementById('enhancedMarkerSize').value);

        if (!markerColor || !markerSize || isNaN(markerSize)) {
            this.authApp.showToast('Ошибка', 'Заполните все параметры анализа', 'error');
            return;
        }

        const analysisData = {
            video_id: parseInt(this.currentVideoId),
            marker_color: markerColor,
            marker_size_mm: markerSize
        };

        const startBtn = document.getElementById('startEnhancedAnalysis');
        this.authApp.setLoadingState(startBtn, true);

        try {
            const response = await fetch(`${this.baseURL}/respiratory-analysis/analyze/${this.currentPatientId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(analysisData)
            });

            if (response.ok) {
                const analysis = await response.json();
                this.currentAnalysisId = analysis.id;
                this.startTime = new Date();

                this.switchTab('progress');
                this.startEnhancedStatusCheck(analysis.id);

                this.authApp.showToast('Успешно', 'Анализ начат. Ожидайте результатов...', 'success');
            } else {
                const errorText = await response.text();
                let errorMessage = 'Не удалось начать анализ';

                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.detail || errorMessage;
                } catch (e) {
                    errorMessage = errorText || errorMessage;
                }

                this.authApp.showToast('Ошибка', errorMessage, 'error');
            }
        } catch (error) {
            console.error('Ошибка сети:', error);
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        } finally {
            this.authApp.setLoadingState(startBtn, false);
        }
    }

    startEnhancedStatusCheck(analysisId) {
        this.stopStatusCheck();

        this.checkEnhancedStatus(analysisId);

        this.statusCheckInterval = setInterval(() => {
            this.checkEnhancedStatus(analysisId);
        }, 2000);
    }

    stopStatusCheck() {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }
    }

    async checkEnhancedStatus(analysisId) {
        try {
            const response = await fetch(`${this.baseURL}/respiratory-analysis/${analysisId}/status`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const statusData = await response.json();

                this.updateEnhancedProgress(statusData);

                if (statusData.progress_percent >= 100) {
                    this.stopStatusCheck();
                    await this.showEnhancedResults(analysisId);
                }
            }
        } catch (error) {
            console.error('Error checking analysis status:', error);
        }
    }

    updateEnhancedProgress(statusData) {
        const progressPercent = Math.min(99.9, statusData.progress_percent || 0);

        // Обновляем только процент и время, скрываем прогресс бар
        document.getElementById('progressPercent').textContent = `${progressPercent.toFixed(1)}%`;

        if (this.startTime) {
            const elapsedSeconds = Math.floor((new Date() - this.startTime) / 1000);
            document.getElementById('elapsedTimeStat').textContent = `${elapsedSeconds} сек`;
        }

        let stage = 'Инициализация...';
        if (progressPercent > 20) stage = 'Загрузка видео';
        if (progressPercent > 40) stage = 'Обнаружение маркера';
        if (progressPercent > 60) stage = 'Трекинг движений';
        if (progressPercent > 80) stage = 'Анализ паттернов';

        document.getElementById('currentProgressStage').textContent = stage;
        document.getElementById('progressDetail').textContent = stage;
    }

    async showEnhancedResults(analysisId) {
        try {
            const response = await fetch(`${this.baseURL}/respiratory-analysis/${analysisId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const analysis = await response.json();

                // Получаем название видео
                const videoTitle = await this.getVideoTitle(analysis.video_id) || 'Без названия';

                // Обновляем заголовок результата с новым форматом
                document.querySelector('#resultsAnalysisTab .results-header h3').innerHTML = `
                    <i class="fas fa-check-circle success"></i>
                    Анализ - "${videoTitle}"
                `;

                this.fillEnhancedResults(analysis);
                this.renderAnalysisPlotsFromPaths(analysis);
                this.switchTab('results');
                await this.loadAnalysesHistory();

                this.authApp.showToast('Успешно', 'Анализ завершен!', 'success');
            }
        } catch (error) {
            console.error('Error loading analysis results:', error);
            this.authApp.showToast('Ошибка', 'Не удалось загрузить результаты анализа', 'error');
        }
    }

    fillEnhancedResults(analysis) {
        document.getElementById('enhancedBreathingRate').textContent =
            analysis.breathing_rate_mean_bpm ?
            `${analysis.breathing_rate_mean_bpm.toFixed(1)} ± ${analysis.breathing_rate_std_bpm?.toFixed(1) || '0.0'} уд/мин` :
            '—';

        document.getElementById('enhancedAmplitude').textContent =
            analysis.amplitude_mean_mm ?
            `${analysis.amplitude_mean_mm.toFixed(1)} ± ${analysis.amplitude_std_mm?.toFixed(1) || '0.0'} мм` :
            '—';

        document.getElementById('enhancedSynchronization').textContent =
            analysis.synchronization_index ?
            `${(analysis.synchronization_index * 100).toFixed(1)}%` :
            '—';

        document.getElementById('analysisTimeResult').textContent =
            analysis.processing_time_seconds ?
            `${analysis.processing_time_seconds.toFixed(1)} сек` :
            '—';

        document.getElementById('framesResult').textContent = analysis.total_frames || '—';

        const assessmentElement = document.getElementById('enhancedMedicalAssessment');
        if (assessmentElement && analysis.medical_assessment) {
            assessmentElement.innerHTML = `<p>${analysis.medical_assessment.replace(/\n/g, '<br>')}</p>`;
        }
    }

    renderAnalysisPlotsFromPaths(analysis) {
        const plotsContainer = document.getElementById('plotsGrid');

        if (!plotsContainer) return;

        // Собираем пути к графикам из ответа
        const plotPaths = {
            'width_line_1': analysis.width_line_1_plot_path,
            'width_line_2': analysis.width_line_2_plot_path,
            'width_line_3': analysis.width_line_3_plot_path,
            'summary_plot': analysis.summary_plot_path
        };

        // Проверяем, есть ли хотя бы один график
        const hasPlots = Object.values(plotPaths).some(path => path);

        if (!hasPlots) {
            plotsContainer.innerHTML = `
                <div class="plot-placeholder">
                    <i class="fas fa-chart-line"></i>
                    <p>Графики не найдены</p>
                </div>
            `;
            return;
        }

        const plotTitles = {
            'width_line_1': 'Изменение ширины маркера (линия 1)',
            'width_line_2': 'Изменение ширины маркера (линия 2)',
            'width_line_3': 'Изменение ширины маркера (линия 3)',
            'summary_plot': 'Сводный график анализа'
        };

        const plotDescriptions = {
            'width_line_1': 'Изменение ширины маркера по линии 1 в зависимости от времени',
            'width_line_2': 'Изменение ширины маркера по линии 2 в зависимости от времени',
            'width_line_3': 'Изменение ширины маркера по линии 3 в зависимости от времени',
            'summary_plot': 'Сводная информация по всем линиям анализа'
        };

        // Рендерим только те графики, у которых есть путь
        plotsContainer.innerHTML = Object.keys(plotPaths)
            .filter(plotKey => plotPaths[plotKey])
            .map(plotKey => {
                const plotUrl = this.getPlotUrl(plotPaths[plotKey]);
                return `
                    <div class="plot-card">
                        <img src="${plotUrl}"
                             alt="${plotTitles[plotKey] || plotKey}"
                             class="plot-image"
                             onload="this.classList.remove('loading')"
                             onerror="window.handlePlotError(this)">
                        <div class="plot-info">
                            <h4 class="plot-title">${plotTitles[plotKey] || plotKey}</h4>
                            <p class="plot-description">${plotDescriptions[plotKey] || ''}</p>
                        </div>
                    </div>
                `;
            })
            .join('');
    }

    getPlotUrl(plotPath) {
        if (!plotPath) return null;

        // Если путь уже содержит http, возвращаем как есть
        if (plotPath.startsWith('http')) {
            return plotPath;
        }

        // Иначе добавляем baseURL и убираем "static/" если он есть в начале
        let cleanPath = plotPath;
        if (cleanPath.startsWith('static/')) {
            cleanPath = cleanPath.substring(7); // Убираем "static/"
        } else if (cleanPath.includes('analysis_plots')) {
            // Если путь содержит analysis_plots, добавляем static/ в начало
            cleanPath = `static/${cleanPath}`;
        }

        // Заменяем обратные слеши на прямые для URL
        cleanPath = cleanPath.replace(/\\/g, '/');

        return `${this.baseURL}/${cleanPath}`;
    }

    async viewAnalysisHistory(analysisId) {
        try {
            const response = await fetch(`${this.baseURL}/respiratory-analysis/${analysisId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const analysis = await response.json();

                // Получаем название видео
                const videoTitle = await this.getVideoTitle(analysis.video_id) || 'Без названия';

                // Обновляем заголовок с новым форматом
                document.querySelector('#resultsAnalysisTab .results-header h3').innerHTML = `
                    <i class="fas fa-check-circle success"></i>
                    Анализ - "${videoTitle}"
                `;

                this.currentAnalysisId = analysis.id;
                this.fillEnhancedResults(analysis);
                this.renderAnalysisPlotsFromPaths(analysis);
                this.switchTab('results');

                this.authApp.showToast('Успешно', 'Результаты анализа загружены', 'success');
            }
        } catch (error) {
            console.error('Error loading analysis:', error);
            this.authApp.showToast('Ошибка', 'Не удалось загрузить анализ', 'error');
        }
    }

    getStatusText(status) {
        switch(status) {
            case 'processing': return 'Обработка';
            case 'completed': return 'Завершено';
            case 'failed': return 'Ошибка';
            default: return status;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}