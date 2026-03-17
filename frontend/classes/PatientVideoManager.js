import { API_ENDPOINTS } from '../utils/constants.js';
import { FormValidator } from '../utils/validators.js';
import { DataFormatter } from '../utils/formatters.js';
import { Toast } from '../components/Toast.js';

export class PatientVideoManager {
    constructor(authApp, patientManager) {
        this.authApp = authApp;
        this.patientManager = patientManager;
        this.baseURL = authApp.baseURL;
        this.currentPatientId = null;
        this.videos = [];
        this.videoPlayer = null;
        this.isPlaying = false;
        this.currentBlobUrl = null;
        this.pendingDeleteVideoId = null;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupVideoPlayer();
        this.setupVideoConfirmModal();
    }

    setupVideoConfirmModal() {
        document.getElementById('confirmDeleteVideo').addEventListener('click', () => this.executeVideoDelete());
        document.getElementById('cancelDeleteVideo').addEventListener('click', () => this.closeConfirmDeleteVideoModal());
        document.getElementById('closeConfirmDeleteVideo').addEventListener('click', () => this.closeConfirmDeleteVideoModal());
    }

    setCurrentPatient(patientId) {
        this.currentPatientId = patientId;
    }

    setupVideoPlayer() {
        this.videoPlayer = document.getElementById('previewVideo');
        if (!this.videoPlayer) return;

        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.muteBtn = document.getElementById('muteBtn');
        this.volumeSlider = document.getElementById('volumeSlider');
        this.progressBar = document.getElementById('progressBar');
        this.currentTimeEl = document.getElementById('currentTime');
        this.durationEl = document.getElementById('duration');
        this.fullscreenBtn = document.getElementById('fullscreenBtn');
        this.videoLoading = document.getElementById('videoLoading');

        this.setupVideoControls();
    }

    setupVideoControls() {
        if (!this.videoPlayer) return;

        this.playPauseBtn?.addEventListener('click', () => this.togglePlayPause());
        this.muteBtn?.addEventListener('click', () => this.toggleMute());
        this.volumeSlider?.addEventListener('input', (e) => {
            this.videoPlayer.volume = e.target.value;
            this.updateVolumeIcon();
        });
        this.progressBar?.addEventListener('input', (e) => {
            const time = (e.target.value / 100) * this.videoPlayer.duration;
            this.videoPlayer.currentTime = time;
        });
        this.fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());

        this.videoPlayer.addEventListener('loadeddata', () => this.onVideoLoaded());
        this.videoPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.videoPlayer.addEventListener('ended', () => this.onVideoEnded());
        this.videoPlayer.addEventListener('waiting', () => this.showLoading());
        this.videoPlayer.addEventListener('canplay', () => this.hideLoading());

        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-preview')) {
                const videoId = e.target.closest('.btn-preview').dataset.videoId;
                this.previewVideo(videoId);
                return;
            }

            if (e.target.closest('.btn-analyze')) {
                const videoId = e.target.closest('.btn-analyze').dataset.videoId;
                if (this.patientManager.analysisManager) {
                    this.patientManager.analysisManager.openAnalysisModal(videoId);
                }
                return;
            }

            if (e.target.closest('.btn-download')) {
                const videoId = e.target.closest('.btn-download').dataset.videoId;
                this.downloadVideo(videoId);
                return;
            }

            if (e.target.closest('.btn-delete')) {
                const videoId = e.target.closest('.btn-delete').dataset.videoId;
                this.deleteVideo(videoId);
                return;
            }

            if (e.target.closest('#closePreview')) {
                this.closePreviewModal();
                return;
            }

            if (e.target.closest('#downloadPreview')) {
                this.downloadCurrentVideo();
                return;
            }

            if (e.target.closest('#analyzeVideo')) {
                this.analyzeCurrentVideo();
                return;
            }

            if (e.target.closest('#closeEditPatientModal') || e.target.closest('#cancelEditPatient')) {
                this.patientManager.closeEditPatientModal();
                return;
            }
        });
    }

    async deleteVideo(videoId) {
        const video = this.videos.find(v => v.id === parseInt(videoId));
        if (!video) return;

        this.pendingDeleteVideoId = videoId;
        document.getElementById('deleteVideoName').textContent = video.title || video.name;
        document.getElementById('confirmDeleteVideoModal').classList.add('active');
    }

    closeConfirmDeleteVideoModal() {
        document.getElementById('confirmDeleteVideoModal').classList.remove('active');
        this.pendingDeleteVideoId = null;
    }

    async executeVideoDelete() {
        if (!this.pendingDeleteVideoId || !this.currentPatientId) return;

        const videoId = this.pendingDeleteVideoId;
        this.closeConfirmDeleteVideoModal();

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.PATIENTS.VIDEO_DETAIL(this.currentPatientId, videoId)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const result = await response.json();
                Toast.show('Успешно', result.message || 'Видео удалено', 'success');
                this.loadVideos();
            } else {
                const error = await response.json();
                Toast.show('Ошибка', error.detail || 'Не удалось удалить видео', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение', 'error');
        } finally {
            this.pendingDeleteVideoId = null;
        }
    }

    handleKeyboard(e) {
        if (!document.getElementById('previewModal').classList.contains('active')) return;

        switch(e.code) {
            case 'Space':
                e.preventDefault();
                this.togglePlayPause();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.videoPlayer.currentTime = Math.max(0, this.videoPlayer.currentTime - 10);
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.videoPlayer.currentTime = Math.min(this.videoPlayer.duration, this.videoPlayer.currentTime + 10);
                break;
            case 'KeyM':
                e.preventDefault();
                this.toggleMute();
                break;
            case 'KeyF':
                e.preventDefault();
                this.toggleFullscreen();
                break;
        }
    }

    togglePlayPause() {
        if (this.videoPlayer.paused || this.videoPlayer.ended) {
            this.playVideo();
        } else {
            this.pauseVideo();
        }
    }

    playVideo() {
        this.videoPlayer.play().then(() => {
            this.isPlaying = true;
            this.updatePlayPauseIcon();
        }).catch(error => {
            Toast.show('Ошибка', 'Не удалось воспроизвести видео', 'error');
        });
    }

    pauseVideo() {
        this.videoPlayer.pause();
        this.isPlaying = false;
        this.updatePlayPauseIcon();
    }

    toggleMute() {
        this.videoPlayer.muted = !this.videoPlayer.muted;
        this.updateVolumeIcon();
    }

    updateVolumeIcon() {
        if (!this.muteBtn) return;

        if (this.videoPlayer.muted || this.videoPlayer.volume === 0) {
            this.muteBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        } else if (this.videoPlayer.volume < 0.5) {
            this.muteBtn.innerHTML = '<i class="fas fa-volume-down"></i>';
        } else {
            this.muteBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
        }
    }

    updatePlayPauseIcon() {
        if (!this.playPauseBtn) return;

        if (this.isPlaying) {
            this.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        } else {
            this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        }
    }

    updateProgress() {
        if (!this.videoPlayer.duration) return;

        const progress = (this.videoPlayer.currentTime / this.videoPlayer.duration) * 100;
        this.progressBar.value = progress;

        this.currentTimeEl.textContent = this.formatTime(this.videoPlayer.currentTime);
        this.durationEl.textContent = this.formatTime(this.videoPlayer.duration);
    }

    onVideoLoaded() {
        this.durationEl.textContent = this.formatTime(this.videoPlayer.duration);
        this.hideLoading();
    }

    onVideoEnded() {
        this.isPlaying = false;
        this.updatePlayPauseIcon();
        this.videoPlayer.currentTime = 0;
        this.updateProgress();
    }

    showLoading() {
        if (this.videoLoading) {
            this.videoLoading.style.display = 'block';
        }
    }

    hideLoading() {
        if (this.videoLoading) {
            this.videoLoading.style.display = 'none';
        }
    }

    toggleFullscreen() {
        const container = this.videoPlayer.parentElement;

        if (!document.fullscreenElement) {
            if (container.requestFullscreen) {
                container.requestFullscreen();
            } else if (container.webkitRequestFullscreen) {
                container.webkitRequestFullscreen();
            } else if (container.msRequestFullscreen) {
                container.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    }

    async loadVideos() {
        if (!this.currentPatientId) return;

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.PATIENTS.VIDEOS(this.currentPatientId)}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const videosData = await response.json();
                this.videos = videosData.map(video => ({
                    id: video.id,
                    name: video.filename,
                    title: video.title,
                    size: video.file_size,
                    upload_date: video.created_at,
                    duration: 0,
                    file_exists: video.file_exists !== false,
                    s3_path: video.s3_path
                }));
                this.renderVideos();
            } else if (response.status === 401) {
                Toast.show('Ошибка', 'Требуется авторизация', 'error');
                this.authApp.logout();
            } else {
                const error = await response.json();
                Toast.show('Ошибка', error.detail || 'Не удалось загрузить видео', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        }
    }

    renderVideos() {
        const videosContainer = document.getElementById('patientVideosContainer');

        if (this.videos.length === 0) {
            videosContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-video-slash"></i>
                    <h3>Видео анализы не найдены</h3>
                    <p>Загрузите первое видео для анализа дыхания пациента</p>
                </div>
            `;
            return;
        }

        const existingVideos = this.videos.filter(video => video.file_exists !== false);

        if (existingVideos.length === 0) {
            videosContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-video-slash"></i>
                    <h3>Видео анализы не найдены</h3>
                    <p>Загрузите первое видео для анализа дыхания пациента</p>
                </div>
            `;
            return;
        }

        videosContainer.innerHTML = existingVideos.map(video => `
            <div class="video-card grid-view">
                <div class="video-thumbnail">
                    <i class="fas fa-file-video"></i>
                    <div class="video-duration">${DataFormatter.formatDuration(video.duration)}</div>
                </div>
                <div class="video-content">
                    <div class="video-title">${DataFormatter.escapeHtml(video.title || video.name)}</div>
                    <div class="video-meta">
                        <span><i class="fas fa-calendar"></i> ${DataFormatter.formatDate(video.upload_date)}</span>
                        <span><i class="fas fa-weight-hanging"></i> ${DataFormatter.formatFileSize(video.size)}</span>
                    </div>
                    <div class="video-actions">
                        <button class="btn-action btn-preview" data-video-id="${video.id}" title="Просмотр">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="btn-action btn-delete" data-video-id="${video.id}" title="Удалить">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async previewVideo(videoId) {
        const numericVideoId = parseInt(videoId);
        const video = this.videos.find(v => v.id === numericVideoId);

        if (!video) {
            Toast.show('Ошибка', 'Видео не найдено', 'error');
            return;
        }

        if (video.file_exists === false) {
            Toast.show('Ошибка', 'Файл видео не найден на сервере', 'error');
            return;
        }

        const modal = document.getElementById('previewModal');
        const previewTitle = document.getElementById('previewTitle');
        const previewDate = document.getElementById('previewDate');
        const previewSize = document.getElementById('previewSize');
        const previewDuration = document.getElementById('previewDuration');

        previewTitle.textContent = DataFormatter.escapeHtml(video.title || video.name);
        previewDate.textContent = DataFormatter.formatDate(video.upload_date);
        previewSize.textContent = DataFormatter.formatFileSize(video.size || 0);
        previewDuration.textContent = DataFormatter.formatDuration(video.duration || 0);

        this.resetVideoPlayer();
        this.showLoading();

        try {
            const videoUrl = `${this.baseURL}${API_ENDPOINTS.PATIENTS.VIDEO_STREAM(this.currentPatientId, numericVideoId)}`;

            const response = await fetch(videoUrl, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    Toast.show('Ошибка авторизации', 'Требуется повторный вход', 'error');
                    this.authApp.logout();
                    return;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const blob = await response.blob();

            if (!blob.type.startsWith('video/')) {
                throw new Error('Invalid video format');
            }

            this.currentBlobUrl = URL.createObjectURL(blob);

            this.videoPlayer.src = this.currentBlobUrl;
            this.videoPlayer.crossOrigin = 'anonymous';

            modal.currentVideoId = numericVideoId;
            modal.classList.add('active');

            const handleCanPlay = () => {
                this.hideLoading();
                this.playVideo().catch(e => {
                    // Игнорируем ошибки автовоспроизведения
                });
            };

            const handleLoadError = (e) => {
                this.hideLoading();
                this.cleanupBlobUrl();
            };

            this.videoPlayer.addEventListener('canplay', handleCanPlay, { once: true });
            this.videoPlayer.addEventListener('error', handleLoadError, { once: true });

        } catch (error) {
            this.hideLoading();
            this.cleanupBlobUrl();

            if (error.message.includes('401')) {
                Toast.show('Ошибка авторизации', 'Требуется повторный вход', 'error');
                this.authApp.logout();
            } else if (error.message.includes('Invalid video format')) {
                Toast.show('Ошибка', 'Неверный формат видеофайла', 'error');
            } else {
                Toast.show('Ошибка', 'Не удалось загрузить видео', 'error');
            }
        }
    }

    cleanupBlobUrl() {
        if (this.currentBlobUrl) {
            URL.revokeObjectURL(this.currentBlobUrl);
            this.currentBlobUrl = null;
        }
    }

    resetVideoPlayer() {
        if (this.videoPlayer) {
            this.videoPlayer.pause();
            this.videoPlayer.currentTime = 0;
            this.videoPlayer.src = '';
            this.isPlaying = false;
            this.updatePlayPauseIcon();
            this.updateProgress();
            this.hideLoading();
            this.cleanupBlobUrl();
        }
    }

    closePreviewModal() {
        const modal = document.getElementById('previewModal');
        this.resetVideoPlayer();
        modal.classList.remove('active');
        delete modal.currentVideoId;
    }

    async downloadVideo(videoId) {
        const video = this.videos.find(v => v.id === videoId);
        if (!video || !video.file_exists) {
            Toast.show('Ошибка', 'Файл видео не найден на сервере', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.PATIENTS.VIDEO_STREAM(this.currentPatientId, videoId)}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`
                }
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;

                const fileName = video.title ? `${video.title}.mp4` : video.name || `video_${videoId}.mp4`;
                a.download = fileName;

                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);

                Toast.show('Успешно', 'Видео скачивается', 'success');
            } else {
                const error = await response.json();
                Toast.show('Ошибка', error.detail || 'Не удалось скачать видео', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение', 'error');
        }
    }

    downloadCurrentVideo() {
        const modal = document.getElementById('previewModal');
        if (modal.currentVideoId) {
            this.downloadVideo(modal.currentVideoId);
        }
    }

    analyzeCurrentVideo() {
        const modal = document.getElementById('previewModal');
        if (modal.currentVideoId && this.patientManager.analysisManager) {
            this.patientManager.analysisManager.openAnalysisModal(modal.currentVideoId);
            this.closePreviewModal();
        }
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}