import { API_ENDPOINTS } from '../utils/constants.js';
import { FormValidator, FieldErrorHandler } from '../utils/validators.js';
import { DataFormatter } from '../utils/formatters.js';
import { PatientVideoManager } from './PatientVideoManager.js';
import { RespiratoryAnalysisManager } from './RespiratoryAnalysisManager.js';
import { CustomSelect } from './CustomSelect.js';
import { Toast } from '../components/Toast.js';

export class PatientManager {
    constructor(authApp) {
        this.authApp = authApp;
        this.baseURL = authApp.baseURL;
        this.patients = [];
        this.currentPatient = null;
        this.videoManager = null;
        this.analysisManager = null;
        this.pendingDeletePatientId = null;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupPatientModal();
        this.setupEditPatientModal();
        this.setupPatientUploadModal();
        this.setupConfirmModals();
        this.setupValidation();
    }

    setupValidation() {
        this.setupFormValidation('patientForm');
        this.setupFormValidation('editPatientForm');
    }

    setupFormValidation(formId) {
        const form = document.getElementById(formId);
        if (!form) return;

        this.setupRequiredFields(formId);

        const requiredFields = form.querySelectorAll('input[required], select[required]');
        requiredFields.forEach(field => {
            field.addEventListener('blur', () => this.validateRequiredField(field));
            field.addEventListener('input', () => FieldErrorHandler.clearError(field));
            field.addEventListener('change', () => FieldErrorHandler.clearError(field));
        });

        const numberFields = form.querySelectorAll('input[type="number"]');
        numberFields.forEach(field => {
            field.addEventListener('blur', () => this.validateNumberField(field));
            field.addEventListener('input', () => FieldErrorHandler.clearError(field));
        });

        const emailFields = form.querySelectorAll('input[type="email"]');
        emailFields.forEach(field => {
            field.addEventListener('blur', () => this.validateEmailField(field));
            field.addEventListener('input', () => FieldErrorHandler.clearError(field));
        });

        const smokingStatusSelect = form.querySelector('select[name="smoking_status"]');
        if (smokingStatusSelect) {
            smokingStatusSelect.addEventListener('change', (e) => {
                this.handleSmokingStatusValidation(e.target.value, formId);
            });
        }
    }

    setupRequiredFields(formId) {
        const form = document.getElementById(formId);
        if (!form) return;

        const requiredFields = [
            'name', 'surname', 'email', 'age', 'gender', 'height', 'weight', 'smoking_status'
        ];

        requiredFields.forEach(fieldName => {
            const field = form.querySelector(`[name="${fieldName}"]`);
            if (field) {
                field.required = true;

                const label = form.querySelector(`label[for="${field.id}"]`);
                if (label && !label.querySelector('.required-asterisk')) {
                    const asterisk = document.createElement('span');
                    asterisk.className = 'required-asterisk';
                    asterisk.textContent = ' *';
                    asterisk.style.color = 'var(--error)';
                    label.appendChild(asterisk);
                }
            }
        });

        const lastNameField = form.querySelector('[name="last_name"]');
        if (lastNameField) {
            lastNameField.required = false;
        }

        const smokingYearsField = form.querySelector('[name="smoking_years"]');
        if (smokingYearsField) {
            smokingYearsField.required = false;
        }
    }

    handleSmokingStatusValidation(status, formId) {
        const form = document.getElementById(formId);
        if (!form) return;

        const smokingYearsField = form.querySelector('[name="smoking_years"]');
        if (!smokingYearsField) return;

        if (status === 'active_smoker' || status === 'passive_smoker') {
            smokingYearsField.required = true;
            this.validateRequiredField(smokingYearsField);
        } else {
            smokingYearsField.required = false;
            FieldErrorHandler.clearError(smokingYearsField);
        }
    }

    validateRequiredField(field) {
        const validation = FormValidator.validateRequired(field, DataFormatter.getFieldName(field));
        if (!validation.isValid) {
            FieldErrorHandler.showError(field, validation.message);
            return false;
        }
        FieldErrorHandler.clearError(field);
        return true;
    }

    validateNumberField(field) {
        const validation = FormValidator.validateNumber(field, DataFormatter.getFieldName(field));
        if (!validation.isValid) {
            FieldErrorHandler.showError(field, validation.message);
            return false;
        }
        FieldErrorHandler.clearError(field);
        return true;
    }

    validateEmailField(field) {
        const validation = FormValidator.validateEmail(field, DataFormatter.getFieldName(field));
        if (!validation.isValid) {
            FieldErrorHandler.showError(field, validation.message);
            return false;
        }
        FieldErrorHandler.clearError(field);
        return true;
    }

    validateForm(formId) {
        const form = document.getElementById(formId);
        if (!form) return false;

        let isValid = true;

        const requiredFields = form.querySelectorAll('input[required], select[required]');
        requiredFields.forEach(field => {
            if (!this.validateRequiredField(field)) {
                isValid = false;
            }
        });

        const numberFields = form.querySelectorAll('input[type="number"]');
        numberFields.forEach(field => {
            if (field.value.trim() && !this.validateNumberField(field)) {
                isValid = false;
            }
        });

        const emailFields = form.querySelectorAll('input[type="email"]');
        emailFields.forEach(field => {
            if (field.value.trim() && !this.validateEmailField(field)) {
                isValid = false;
            }
        });

        const smokingYearsInput = form.querySelector('input[name="smoking_years"]');
        const smokingStatusSelect = form.querySelector('select[name="smoking_status"]');

        if (smokingYearsInput && smokingStatusSelect) {
            const smokingStatus = smokingStatusSelect.value;
            const smokingYears = smokingYearsInput.value.trim();
            const validation = FormValidator.validateSmokingData(smokingStatus, smokingYears);

            if (!validation.isValid) {
                FieldErrorHandler.showError(smokingYearsInput, validation.message);
                isValid = false;
            }

            if (smokingYears && !this.validateNumberField(smokingYearsInput)) {
                isValid = false;
            }
        }

        return isValid;
    }

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('#addPatient') || e.target.closest('#emptyAddPatient')) {
                this.openPatientModal();
                return;
            }

            if (e.target.closest('#refreshPatients')) {
                this.loadPatients();
                return;
            }

            if (e.target.closest('#closePatientModal') || e.target.closest('#cancelPatient')) {
                this.closePatientModal();
                return;
            }

            if (e.target.closest('#closeEditPatientModal') || e.target.closest('#cancelEditPatient')) {
                this.closeEditPatientModal();
                return;
            }

            if (e.target.closest('.btn-patient-action.view')) {
                const patientId = e.target.closest('.btn-patient-action.view').dataset.patientId;
                this.viewPatient(patientId);
                return;
            }

            if (e.target.closest('.btn-patient-action.edit')) {
                const patientId = e.target.closest('.btn-patient-action.edit').dataset.patientId;
                this.editPatient(patientId);
                return;
            }

            if (e.target.closest('.btn-patient-action.delete')) {
                const patientId = e.target.closest('.btn-patient-action.delete').dataset.patientId;
                this.deletePatient(patientId);
                return;
            }

            if (e.target.closest('#backToPatients')) {
                this.showPatientsList();
                return;
            }

            if (e.target.closest('#editPatientBtn')) {
                this.editCurrentPatient();
                return;
            }

            if (e.target.closest('#addPatientVideo')) {
                this.openPatientUploadModal();
                return;
            }

            if (e.target.closest('#closePatientUploadModal') || e.target.closest('#cancelPatientUpload')) {
                this.closePatientUploadModal();
                return;
            }

            if (e.target.closest('#refreshPatientVideos')) {
                this.refreshPatientData();
                return;
            }

            if (e.target.closest('#uploadPatientBtn')) {
                e.preventDefault();
                e.stopPropagation();
                this.handlePatientVideoUpload();
                return;
            }

            if (e.target.closest('#viewPatientAnalyses')) {
                this.viewPatientAnalyses();
                return;
            }
        });

        document.getElementById('submitPatientBtn').addEventListener('click', (e) => this.handlePatientSubmit(e));
        document.getElementById('submitEditPatientBtn').addEventListener('click', (e) => this.handleEditPatientSubmit(e));

        document.getElementById('uploadPatientForm').addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        document.getElementById('patientSearch').addEventListener('input', (e) => {
            this.filterPatients(e.target.value);
        });

        document.addEventListener('sectionChanged', (e) => {
            if (e.detail.section === 'patients') {
                this.loadPatients();
            }
        });
    }

    setupConfirmModals() {
        document.getElementById('confirmDeletePatient').addEventListener('click', () => this.executePatientDelete());
        document.getElementById('cancelDeletePatient').addEventListener('click', () => this.closeConfirmDeletePatientModal());
        document.getElementById('closeConfirmDeletePatient').addEventListener('click', () => this.closeConfirmDeletePatientModal());
    }

    setupPatientModal() {
        const modal = document.getElementById('patientModal');

        const customSelects = modal.querySelectorAll('.custom-select');
        customSelects.forEach(select => {
            new CustomSelect(select);
        });

        document.getElementById('patientSmokingStatusSelect').addEventListener('change', (e) => {
            this.handlePatientSmokingStatusChange(e.target.value);
            this.handleSmokingStatusValidation(e.target.value, 'patientForm');
        });

        setTimeout(() => {
            const initialStatus = document.getElementById('patientSmokingStatusSelect').value;
            this.handlePatientSmokingStatusChange(initialStatus);
            this.handleSmokingStatusValidation(initialStatus, 'patientForm');
        }, 100);
    }

    setupEditPatientModal() {
        const modal = document.getElementById('editPatientModal');

        const customSelects = modal.querySelectorAll('.custom-select');
        customSelects.forEach(select => {
            new CustomSelect(select);
        });

        document.getElementById('editPatientSmokingStatusSelectModal').addEventListener('change', (e) => {
            this.handleEditPatientSmokingStatusChange(e.target.value);
            this.handleSmokingStatusValidation(e.target.value, 'editPatientForm');
        });

        setTimeout(() => {
            const initialStatus = document.getElementById('editPatientSmokingStatusSelectModal').value;
            this.handleEditPatientSmokingStatusChange(initialStatus);
            this.handleSmokingStatusValidation(initialStatus, 'editPatientForm');
        }, 100);
    }

    handlePatientSmokingStatusChange(status) {
        const smokingYearsInput = document.getElementById('patientSmokingYearsInput');
        const smokingYearsLabel = smokingYearsInput.closest('.input-group').querySelector('label');

        if (status === 'non_smoker' || status === '') {
            smokingYearsInput.disabled = true;
            smokingYearsInput.value = '';
            smokingYearsInput.placeholder = 'Не доступно для некурящих';
            smokingYearsLabel.style.opacity = '0.5';
            FieldErrorHandler.clearError(smokingYearsInput);
        } else {
            smokingYearsInput.disabled = false;
            smokingYearsInput.placeholder = 'Введите стаж курения в годах';
            smokingYearsLabel.style.opacity = '1';
        }
    }

    handleEditPatientSmokingStatusChange(status) {
        const smokingYearsInput = document.getElementById('editPatientSmokingYearsModal');
        const smokingYearsLabel = smokingYearsInput.closest('.input-group').querySelector('label');

        if (status === 'non_smoker' || status === '') {
            smokingYearsInput.disabled = true;
            smokingYearsInput.placeholder = 'Не доступно для некурящих';
            smokingYearsLabel.style.opacity = '0.5';
            FieldErrorHandler.clearError(smokingYearsInput);
        } else {
            smokingYearsInput.disabled = false;
            smokingYearsInput.placeholder = 'Введите стаж курения в годах';
            smokingYearsLabel.style.opacity = '1';
        }
    }

    setupPatientUploadModal() {
        const uploadArea = document.getElementById('uploadPatientArea');
        const fileInput = document.getElementById('patientVideoFile');
        const fileInfo = document.getElementById('patientFileInfo');
        const changeFile = document.getElementById('changePatientFile');
        const uploadBtn = document.getElementById('uploadPatientBtn');

        uploadArea.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handlePatientFileSelect(file);
            }
        });

        changeFile.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.value = '';
            fileInfo.style.display = 'none';
            uploadArea.querySelector('.upload-placeholder').style.display = 'block';
            uploadBtn.disabled = true;
        });

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('video/')) {
                this.handlePatientFileSelect(file);
                fileInput.files = e.dataTransfer.files;
            }
        });

        document.getElementById('uploadPatientForm').addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }

    handlePatientFileSelect(file) {
        const validation = FormValidator.validateFile(file);
        if (!validation.isValid) {
            Toast.show('Ошибка', validation.message, 'error');
            return;
        }

        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);

        document.getElementById('patientFileName').textContent = file.name;
        document.getElementById('patientFileSize').textContent = `${fileSizeMB} MB`;

        document.getElementById('patientFileInfo').style.display = 'flex';
        document.querySelector('#uploadPatientArea .upload-placeholder').style.display = 'none';
        document.getElementById('uploadPatientBtn').disabled = false;
    }

    async loadPatients() {
        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.PATIENTS.BASE}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const patientsData = await response.json();
                this.patients = patientsData;
                this.renderPatients();
                this.updateStats();
            } else if (response.status === 401) {
                Toast.show('Ошибка', 'Требуется авторизация', 'error');
                this.authApp.logout();
            } else {
                const error = await response.json();
                Toast.show('Ошибка', error.detail || 'Не удалось загрузить пациентов', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        }
    }

    renderPatients() {
        const patientsContainer = document.getElementById('patientsContainer');

        if (this.patients.length === 0) {
            patientsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-user-plus"></i>
                    <h3>Пациенты не найдены</h3>
                    <p>Добавьте первого пациента для начала работы</p>
                    <button class="btn btn-primary" id="emptyAddPatient">
                        <i class="fas fa-plus"></i>
                        Добавить пациента
                    </button>
                </div>
            `;
            return;
        }

        patientsContainer.innerHTML = this.patients.map(patient => `
            <div class="patient-card" data-patient-id="${patient.id}">
                <div class="patient-info">
                    <div class="patient-name">${this.getFullName(patient)}</div>
                    <div class="patient-details">
                        <span><i class="fas fa-birthday-cake"></i> ${patient.age || '—'} лет</span>
                        <span><i class="fas fa-venus-mars"></i> ${DataFormatter.formatGender(patient.gender)}</span>
                        <span><i class="fas fa-ruler-vertical"></i> ${patient.height || '—'} см</span>
                        <span><i class="fas fa-weight"></i> ${patient.weight || '—'} кг</span>
                    </div>
                </div>
                <div class="patient-actions">
                    <button class="btn-patient-action view" data-patient-id="${patient.id}" title="Просмотр">
                        <i class="fas fa-eye"></i>
                        Просмотр
                    </button>
                    <button class="btn-patient-action edit" data-patient-id="${patient.id}" title="Редактировать">
                        <i class="fas fa-edit"></i>
                        Редактировать
                    </button>
                    <button class="btn-patient-action delete" data-patient-id="${patient.id}" title="Удалить">
                        <i class="fas fa-trash"></i>
                        Удалить
                    </button>
                </div>
            </div>
        `).join('');
    }

    getFullName(patient) {
        const parts = [patient.surname, patient.name, patient.last_name].filter(Boolean);
        return parts.join(' ');
    }

    filterPatients(searchTerm) {
        const filteredPatients = this.patients.filter(patient => {
            const fullName = this.getFullName(patient).toLowerCase();
            return fullName.includes(searchTerm.toLowerCase());
        });

        const patientsContainer = document.getElementById('patientsContainer');

        if (filteredPatients.length === 0) {
            patientsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <h3>Пациенты не найдены</h3>
                    <p>Попробуйте изменить поисковый запрос</p>
                </div>
            `;
            return;
        }

        patientsContainer.innerHTML = filteredPatients.map(patient => `
            <div class="patient-card" data-patient-id="${patient.id}">
                <div class="patient-info">
                    <div class="patient-name">${this.getFullName(patient)}</div>
                    <div class="patient-details">
                        <span><i class="fas fa-birthday-cake"></i> ${patient.age || '—'} лет</span>
                        <span><i class="fas fa-venus-mars"></i> ${DataFormatter.formatGender(patient.gender)}</span>
                        <span><i class="fas fa-ruler-vertical"></i> ${patient.height || '—'} см</span>
                        <span><i class="fas fa-weight"></i> ${patient.weight || '—'} кг</span>
                    </div>
                </div>
                <div class="patient-actions">
                    <button class="btn-patient-action view" data-patient-id="${patient.id}" title="Просмотр">
                        <i class="fas fa-eye"></i>
                        Просмотр
                    </button>
                    <button class="btn-patient-action edit" data-patient-id="${patient.id}" title="Редактировать">
                        <i class="fas fa-edit"></i>
                        Редактировать
                    </button>
                    <button class="btn-patient-action delete" data-patient-id="${patient.id}" title="Удалить">
                        <i class="fas fa-trash"></i>
                        Удалить
                    </button>
                </div>
            </div>
        `).join('');
    }

    updateStats() {
        const totalPatients = this.patients.length;
        const recentPatients = this.patients.filter(patient => {
            return true;
        }).length;

        document.getElementById('totalPatientsCount').textContent = totalPatients;
        document.getElementById('recentPatients').textContent = recentPatients;
    }

    openPatientModal(patient = null) {
        const modal = document.getElementById('patientModal');
        const title = document.getElementById('patientModalTitle');
        const submitText = document.getElementById('patientSubmitText');

        if (patient) {
            title.textContent = 'Редактировать пациента';
            submitText.textContent = 'Сохранить изменения';
            this.fillPatientForm(patient);
        } else {
            title.textContent = 'Добавить пациента';
            submitText.textContent = 'Добавить пациента';
            this.clearPatientForm();
        }

        modal.classList.add('active');
        this.scrollModalToTop('patientModal');
    }

    closePatientModal() {
        const modal = document.getElementById('patientModal');
        modal.classList.remove('active');
        this.clearPatientForm();
    }

    openEditPatientModal(patient) {
        const modal = document.getElementById('editPatientModal');
        const title = document.getElementById('editPatientModalTitle');
        const submitText = document.getElementById('editPatientSubmitText');

        title.textContent = 'Редактировать пациента';
        submitText.textContent = 'Сохранить изменения';
        this.fillEditPatientForm(patient);

        modal.classList.add('active');
        this.scrollModalToTop('editPatientModal');
    }

    closeEditPatientModal() {
        const modal = document.getElementById('editPatientModal');
        modal.classList.remove('active');
        this.clearEditPatientForm();
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

    fillPatientForm(patient) {
        document.getElementById('patientNameInput').value = patient.name || '';
        document.getElementById('patientSurnameInput').value = patient.surname || '';
        document.getElementById('patientLastNameInput').value = patient.last_name || '';
        document.getElementById('patientEmailInput').value = patient.email || '';
        document.getElementById('patientAgeInput').value = patient.age || '';
        document.getElementById('patientHeightInput').value = patient.height || '';
        document.getElementById('patientWeightInput').value = patient.weight || '';
        document.getElementById('patientSmokingYearsInput').value = patient.smoking_years || '';

        document.getElementById('patientGenderSelect').value = patient.gender || '';
        document.getElementById('patientSmokingStatusSelect').value = patient.smoking_status || '';

        setTimeout(() => {
            const customSelects = document.querySelectorAll('#patientModal .custom-select');
            customSelects.forEach(select => {
                const instance = select.customSelectInstance;
                if (instance) {
                    instance.updateSelected();
                }
            });

            const status = document.getElementById('patientSmokingStatusSelect').value;
            this.handlePatientSmokingStatusChange(status);
            this.handleSmokingStatusValidation(status, 'patientForm');
        }, 200);
    }

    fillEditPatientForm(patient) {
        document.getElementById('editPatientId').value = patient.id;
        document.getElementById('editPatientNameModal').value = patient.name || '';
        document.getElementById('editPatientSurnameModal').value = patient.surname || '';
        document.getElementById('editPatientLastNameModal').value = patient.last_name || '';
        document.getElementById('editPatientEmailModal').value = patient.email || '';
        document.getElementById('editPatientAgeModal').value = patient.age || '';
        document.getElementById('editPatientHeightModal').value = patient.height || '';
        document.getElementById('editPatientWeightModal').value = patient.weight || '';
        document.getElementById('editPatientSmokingYearsModal').value = patient.smoking_years || '';

        document.getElementById('editPatientGenderSelectModal').value = patient.gender || '';
        document.getElementById('editPatientSmokingStatusSelectModal').value = patient.smoking_status || '';

        setTimeout(() => {
            const customSelects = document.querySelectorAll('#editPatientModal .custom-select');
            customSelects.forEach(select => {
                const instance = select.customSelectInstance;
                if (instance) {
                    instance.updateSelected();
                }
            });

            const status = document.getElementById('editPatientSmokingStatusSelectModal').value;
            this.handleEditPatientSmokingStatusChange(status);
            this.handleSmokingStatusValidation(status, 'editPatientForm');
        }, 200);
    }

    clearPatientForm() {
        document.getElementById('patientForm').reset();

        const customSelects = document.querySelectorAll('#patientModal .custom-select');
        customSelects.forEach(select => {
            const instance = select.customSelectInstance;
            if (instance) {
                instance.updateSelected();
            }
        });

        const errorFields = document.querySelectorAll('#patientModal .error');
        errorFields.forEach(field => FieldErrorHandler.clearError(field));

        this.handlePatientSmokingStatusChange('');
        this.handleSmokingStatusValidation('', 'patientForm');
    }

    clearEditPatientForm() {
        document.getElementById('editPatientForm').reset();

        const customSelects = document.querySelectorAll('#editPatientModal .custom-select');
        customSelects.forEach(select => {
            const instance = select.customSelectInstance;
            if (instance) {
                instance.updateSelected();
            }
        });

        const errorFields = document.querySelectorAll('#editPatientModal .error');
        errorFields.forEach(field => FieldErrorHandler.clearError(field));

        this.handleEditPatientSmokingStatusChange('');
        this.handleSmokingStatusValidation('', 'editPatientForm');
    }

    async handlePatientSubmit(e) {
        e.preventDefault();
        if (this.authApp.isLoading) return;

        if (!this.validateForm('patientForm')) {
            Toast.show('Ошибка валидации', 'Пожалуйста, исправьте ошибки в форме', 'error');
            return;
        }

        const form = document.getElementById('patientForm');
        const submitBtn = document.getElementById('submitPatientBtn');
        const formData = new FormData(form);

        const patientData = {
            name: formData.get('name').trim(),
            surname: formData.get('surname').trim(),
            last_name: formData.get('last_name')?.trim() || null,
            email: formData.get('email')?.trim() || null,
            age: formData.get('age') ? parseInt(formData.get('age')) : null,
            gender: formData.get('gender') || null,
            height: formData.get('height') ? parseFloat(formData.get('height')) : null,
            weight: formData.get('weight') ? parseFloat(formData.get('weight')) : null,
            smoking_status: formData.get('smoking_status') || null,
            smoking_years: formData.get('smoking_years') ? parseInt(formData.get('smoking_years')) : null
        };

        Object.keys(patientData).forEach(key => {
            if (patientData[key] === null || patientData[key] === '' || patientData[key] === undefined) {
                patientData[key] = null;
            }
        });

        if (patientData.smoking_status === 'non_smoker' || !patientData.smoking_status) {
            patientData.smoking_years = null;
        }

        const isEdit = document.getElementById('patientModalTitle').textContent === 'Редактировать пациента';
        const patientId = isEdit ? this.currentPatient.id : null;

        await this.submitPatient(patientData, patientId, submitBtn);
    }

    async handleEditPatientSubmit(e) {
        e.preventDefault();
        if (this.authApp.isLoading) return;

        if (!this.validateForm('editPatientForm')) {
            Toast.show('Ошибка валидации', 'Пожалуйста, исправьте ошибки в форме', 'error');
            return;
        }

        const form = document.getElementById('editPatientForm');
        const submitBtn = document.getElementById('submitEditPatientBtn');
        const formData = new FormData(form);

        const patientData = {
            name: formData.get('name').trim(),
            surname: formData.get('surname').trim(),
            last_name: formData.get('last_name')?.trim() || null,
            email: formData.get('email')?.trim() || null,
            age: formData.get('age') ? parseInt(formData.get('age')) : null,
            gender: formData.get('gender') || null,
            height: formData.get('height') ? parseFloat(formData.get('height')) : null,
            weight: formData.get('weight') ? parseFloat(formData.get('weight')) : null,
            smoking_status: formData.get('smoking_status') || null,
            smoking_years: formData.get('smoking_years') ? parseInt(formData.get('smoking_years')) : null
        };

        Object.keys(patientData).forEach(key => {
            if (patientData[key] === null || patientData[key] === '' || patientData[key] === undefined) {
                patientData[key] = null;
            }
        });

        if (patientData.smoking_status === 'non_smoker' || !patientData.smoking_status) {
            patientData.smoking_years = null;
        }

        const patientId = formData.get('id');
        await this.submitPatient(patientData, patientId, submitBtn);
    }

    async submitPatient(patientData, patientId, submitBtn) {
        this.authApp.setLoadingState(submitBtn, true);

        try {
            const url = patientId ?
                `${this.baseURL}${API_ENDPOINTS.PATIENTS.DETAIL(patientId)}` :
                `${this.baseURL}${API_ENDPOINTS.PATIENTS.BASE}`;
            const method = patientId ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(patientData)
            });

            if (response.ok) {
                const patient = await response.json();
                Toast.show('Успешно', patientId ? 'Пациент обновлен' : 'Пациент добавлен', 'success');
                this.closePatientModal();
                this.closeEditPatientModal();
                this.loadPatients();

                if (patientId && this.currentPatient && this.currentPatient.id === parseInt(patientId)) {
                    this.currentPatient = patient;
                    this.updatePatientDetailDisplay(patient);
                }
            } else {
                const error = await response.json();
                Toast.show('Ошибка', error.detail || 'Произошла ошибка', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        } finally {
            this.authApp.setLoadingState(submitBtn, false);
        }
    }

    async viewPatient(patientId) {
        const patient = this.patients.find(p => p.id === parseInt(patientId));
        if (!patient) {
            Toast.show('Ошибка', 'Пациент не найден', 'error');
            return;
        }

        this.currentPatient = patient;
        this.showPatientDetail(patient);
    }

    showPatientDetail(patient) {
        this.updatePatientDetailDisplay(patient);
        this.authApp.showSection('patientDetail');

        if (!this.videoManager) {
            this.videoManager = new PatientVideoManager(this.authApp, this);
        }
        this.videoManager.setCurrentPatient(patient.id);
        this.videoManager.loadVideos();

        if (!this.analysisManager) {
            this.analysisManager = new RespiratoryAnalysisManager(this.authApp, this, this.videoManager);
        }
        this.analysisManager.setCurrentPatient(patient.id);
        this.analysisManager.loadAnalyses();
    }

    viewPatientAnalyses() {
        if (!this.currentPatient) {
            Toast.show('Ошибка', 'Пациент не выбран', 'error');
            return;
        }

        this.authApp.showSection('patientAnalyses');

        if (this.analysisManager) {
            this.analysisManager.loadAnalyses();
        }
    }

    showPatientsList() {
        this.authApp.showSection('patients');
        this.currentPatient = null;
    }

    editPatient(patientId) {
        const patient = this.patients.find(p => p.id === parseInt(patientId));
        if (patient) {
            this.currentPatient = patient;
            this.openEditPatientModal(patient);
        }
    }

    editCurrentPatient() {
        if (this.currentPatient) {
            this.openEditPatientModal(this.currentPatient);
        }
    }

    async deletePatient(patientId) {
        const patient = this.patients.find(p => p.id === parseInt(patientId));
        if (!patient) return;

        this.pendingDeletePatientId = patientId;
        document.getElementById('deletePatientName').textContent = this.getFullName(patient);
        document.getElementById('confirmDeletePatientModal').classList.add('active');
    }

    closeConfirmDeletePatientModal() {
        document.getElementById('confirmDeletePatientModal').classList.remove('active');
        this.pendingDeletePatientId = null;
    }

    async executePatientDelete() {
        if (!this.pendingDeletePatientId) return;

        const patientId = this.pendingDeletePatientId;
        this.closeConfirmDeletePatientModal();

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.PATIENTS.DETAIL(patientId)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                Toast.show('Успешно', 'Пациент удален', 'success');
                this.loadPatients();

                if (this.currentPatient && this.currentPatient.id === parseInt(patientId)) {
                    this.showPatientsList();
                }
            } else {
                const error = await response.json();
                Toast.show('Ошибка', error.detail || 'Не удалось удалить пациента', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение', 'error');
        } finally {
            this.pendingDeletePatientId = null;
        }
    }

    openPatientUploadModal() {
        if (!this.currentPatient) {
            Toast.show('Ошибка', 'Пациент не выбран', 'error');
            return;
        }
        document.getElementById('uploadPatientModal').classList.add('active');
        this.scrollModalToTop('uploadPatientModal');
    }

    closePatientUploadModal() {
        const modal = document.getElementById('uploadPatientModal');
        const form = document.getElementById('uploadPatientForm');
        const fileInfo = document.getElementById('patientFileInfo');
        const uploadPlaceholder = document.querySelector('#uploadPatientArea .upload-placeholder');
        const uploadProgress = document.getElementById('uploadPatientProgress');
        const fileInput = document.getElementById('patientVideoFile');

        modal.classList.remove('active');
        form.reset();
        fileInfo.style.display = 'none';
        uploadPlaceholder.style.display = 'block';
        uploadProgress.style.display = 'none';
        document.getElementById('uploadPatientBtn').disabled = true;

        if (fileInput) {
            fileInput.value = '';
        }
    }

    async handlePatientVideoUpload() {
        console.log('Начало загрузки видео...');

        if (!this.currentPatient) {
            Toast.show('Ошибка', 'Пациент не выбран', 'error');
            return;
        }

        const fileInput = document.getElementById('patientVideoFile');
        const file = fileInput.files[0];
        const titleInput = document.getElementById('videoTitle');
        const title = titleInput.value.trim();

        const fileValidation = FormValidator.validateFile(file);
        if (!fileValidation.isValid) {
            Toast.show('Ошибка', fileValidation.message, 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        if (title) {
            formData.append('title', title);
        } else {
            const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
            formData.append('title', fileNameWithoutExt);
        }

        const uploadBtn = document.getElementById('uploadPatientBtn');
        const uploadProgress = document.getElementById('uploadPatientProgress');

        this.authApp.setLoadingState(uploadBtn, true);
        uploadProgress.style.display = 'flex';

        try {
            console.log('Отправка запроса на сервер...');

            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.PATIENTS.VIDEOS(this.currentPatient.id)}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`
                },
                body: formData
            });

            console.log('Получен ответ от сервера:', response.status);

            if (response.ok) {
                const result = await response.json();
                console.log('Результат загрузки:', result);

                Toast.show('Успешно', result.message || 'Видео успешно загружено', 'success');
                this.closePatientUploadModal();

                if (this.videoManager) {
                    await this.videoManager.loadVideos();
                }

                console.log('Видео успешно загружено и список обновлен');
            } else {
                const error = await response.json();
                console.error('Ошибка загрузки:', error);
                Toast.show('Ошибка загрузки', error.detail || 'Произошла ошибка при загрузке видео', 'error');
            }
        } catch (error) {
            console.error('Ошибка сети:', error);
            Toast.show('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        } finally {
            this.authApp.setLoadingState(uploadBtn, false);
            uploadProgress.style.display = 'none';
        }
    }

    async refreshPatientData() {
        if (!this.currentPatient) {
            Toast.show('Ошибка', 'Пациент не выбран', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.baseURL}${API_ENDPOINTS.PATIENTS.BASE}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const patientsData = await response.json();
                this.patients = patientsData;

                const updatedPatient = this.patients.find(p => p.id === this.currentPatient.id);

                if (updatedPatient) {
                    this.currentPatient = updatedPatient;
                    this.updatePatientDetailDisplay(updatedPatient);

                    if (this.videoManager) {
                        this.videoManager.loadVideos();
                    }

                    Toast.show('Успешно', 'Данные пациента обновлены', 'success');
                } else {
                    Toast.show('Ошибка', 'Пациент не найден в обновленных данных', 'error');
                }
            } else if (response.status === 401) {
                Toast.show('Ошибка', 'Требуется авторизация', 'error');
                this.authApp.logout();
            } else {
                const error = await response.json();
                Toast.show('Ошибка', error.detail || 'Не удалось обновить данные пациента', 'error');
            }
        } catch (error) {
            Toast.show('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        }
    }

    updatePatientDetailDisplay(patient) {
        document.getElementById('patientDetailName').textContent = this.getFullName(patient);
        document.getElementById('patientName').textContent = patient.name || '—';
        document.getElementById('patientSurname').textContent = patient.surname || '—';
        document.getElementById('patientLastName').textContent = patient.last_name || '—';
        document.getElementById('patientEmail').textContent = patient.email || '—';
        document.getElementById('patientAge').textContent = patient.age ? `${patient.age} лет` : '—';
        document.getElementById('patientGender').textContent = DataFormatter.formatGender(patient.gender);
        document.getElementById('patientHeight').textContent = patient.height ? `${patient.height} см` : '—';
        document.getElementById('patientWeight').textContent = patient.weight ? `${patient.weight} кг` : '—';
        document.getElementById('patientBMI').innerHTML = DataFormatter.formatBMI(patient.bmi);
        document.getElementById('patientSmokingStatus').textContent = DataFormatter.formatSmokingStatus(patient.smoking_status);
        document.getElementById('patientSmokingYears').textContent = patient.smoking_years ? `${patient.smoking_years} лет` : '—';

        this.updatePatientStats(patient);
    }

    updatePatientStats(patient) {
        if (patient.created_at) {
            const createdDate = new Date(patient.created_at);
            const now = new Date();
            const diffTime = Math.abs(now - createdDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            document.getElementById('patientAccountAge').textContent = `${diffDays} дней`;
        } else {
            document.getElementById('patientAccountAge').textContent = '—';
        }
    }
}