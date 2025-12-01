class CustomSelect {
    constructor(selectElement) {
        this.select = selectElement;
        this.targetSelect = document.getElementById(this.select.dataset.target);
        this.trigger = this.select.querySelector('.custom-select__trigger');
        this.selected = this.select.querySelector('.custom-select__selected');
        this.options = this.select.querySelectorAll('.custom-select__option');
        this.isOpen = false;
        this.backdrop = null;

        this.init();
    }

    init() {
        // Установить начальное значение
        this.updateSelected();

        // Обработчики событий
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Обработчики для опций
        this.options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectOption(option);
            });
        });

        // Синхронизация с оригинальным select
        this.targetSelect.addEventListener('change', () => this.updateSelected());

        // Закрытие при клике вне селекта
        document.addEventListener('click', (e) => {
            if (!this.select.contains(e.target)) {
                this.close();
            }
        });
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.isOpen = true;
        this.select.classList.add('open');
        this.addBackdrop();

        // Закрыть другие открытые селекты
        document.querySelectorAll('.custom-select.open').forEach(otherSelect => {
            if (otherSelect !== this.select) {
                const otherInstance = otherSelect.customSelectInstance;
                if (otherInstance) {
                    otherInstance.close();
                }
            }
        });
    }

    close() {
        this.isOpen = false;
        this.select.classList.remove('open');
        this.removeBackdrop();
    }

    selectOption(option) {
        const value = option.dataset.value;
        const text = option.textContent.trim();
        const icon = option.querySelector('i');

        // Обновить кастомный селект
        if (icon) {
            this.selected.innerHTML = `${icon.outerHTML} ${text}`;
        } else {
            this.selected.textContent = text;
        }

        // Обновить класс selected у опций
        this.options.forEach(opt => {
            opt.classList.remove('selected');
        });
        option.classList.add('selected');

        // Обновить оригинальный select
        this.targetSelect.value = value;

        // Создать и отправить события
        const changeEvent = new Event('change', { bubbles: true });
        const inputEvent = new Event('input', { bubbles: true });

        this.targetSelect.dispatchEvent(changeEvent);
        this.targetSelect.dispatchEvent(inputEvent);

        // Закрыть выпадающий список
        this.close();
    }

    updateSelected() {
        const selectedValue = this.targetSelect.value;
        const selectedOption = Array.from(this.targetSelect.options).find(option => option.value === selectedValue);

        if (selectedOption) {
            const selectedText = selectedOption.textContent;

            // Найти соответствующую опцию в кастомном селекте
            const customOption = Array.from(this.options).find(option =>
                option.dataset.value === selectedValue
            );

            if (customOption) {
                const icon = customOption.querySelector('i');
                if (icon) {
                    this.selected.innerHTML = `${icon.outerHTML} ${selectedText}`;
                } else {
                    this.selected.textContent = selectedText;
                }

                // Обновить класс selected у опций
                this.options.forEach(option => {
                    option.classList.remove('selected');
                });
                customOption.classList.add('selected');
            } else {
                this.selected.textContent = selectedText;
            }
        }
    }

    addBackdrop() {
        this.removeBackdrop();

        this.backdrop = document.createElement('div');
        this.backdrop.className = 'custom-select-backdrop';
        document.body.appendChild(this.backdrop);

        this.backdrop.addEventListener('click', () => this.close());
    }

    removeBackdrop() {
        if (this.backdrop) {
            this.backdrop.remove();
            this.backdrop = null;
        }
    }
}

class PatientManager {
    constructor(authApp) {
        this.authApp = authApp;
        this.baseURL = authApp.baseURL;
        this.patients = [];
        this.currentPatient = null;
        this.videoManager = null;
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
        // Валидация для формы добавления пациента
        this.setupFormValidation('patientForm');
        // Валидация для формы редактирования пациента
        this.setupFormValidation('editPatientForm');
    }

    setupFormValidation(formId) {
        const form = document.getElementById(formId);
        if (!form) return;

        // Добавляем атрибуты required для обязательных полей
        this.setupRequiredFields(formId);

        // Валидация обязательных полей
        const requiredFields = form.querySelectorAll('input[required], select[required]');
        requiredFields.forEach(field => {
            field.addEventListener('blur', () => this.validateRequiredField(field));
            field.addEventListener('input', () => this.clearFieldError(field));
            field.addEventListener('change', () => this.clearFieldError(field));
        });

        // Валидация числовых полей
        const numberFields = form.querySelectorAll('input[type="number"]');
        numberFields.forEach(field => {
            field.addEventListener('blur', () => this.validateNumberField(field));
            field.addEventListener('input', () => this.clearFieldError(field));
        });

        // Валидация email
        const emailFields = form.querySelectorAll('input[type="email"]');
        emailFields.forEach(field => {
            field.addEventListener('blur', () => this.validateEmailField(field));
            field.addEventListener('input', () => this.clearFieldError(field));
        });

        // Специальная валидация для статуса курения
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

        // Обязательные поля (кроме отчества и стажа курения)
        const requiredFields = [
            'name', 'surname', 'email', 'age', 'gender', 'height', 'weight', 'smoking_status'
        ];

        requiredFields.forEach(fieldName => {
            const field = form.querySelector(`[name="${fieldName}"]`);
            if (field) {
                field.required = true;

                // Добавляем звездочку к label
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

        // Отчество - необязательное поле
        const lastNameField = form.querySelector('[name="last_name"]');
        if (lastNameField) {
            lastNameField.required = false;
        }

        // Стаж курения - необязательное поле (зависит от статуса)
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

        // Если статус "активный курильщик" или "пассивный курильщик" - стаж обязателен
        if (status === 'active_smoker' || status === 'passive_smoker') {
            smokingYearsField.required = true;
            this.validateRequiredField(smokingYearsField);
        } else {
            // Для "не курю" или пустого статуса - стаж не обязателен
            smokingYearsField.required = false;
            this.clearFieldError(smokingYearsField);
        }
    }

    validateRequiredField(field) {
        const value = field.value.trim();
        const fieldName = this.getFieldName(field);
        const fieldType = field.type || field.tagName.toLowerCase();

        // Для select проверяем выбранное значение
        let isValid = true;
        if (fieldType === 'select-one') {
            isValid = value !== '' && value !== null && value !== undefined;
        } else {
            isValid = value !== '';
        }

        if (!isValid) {
            this.showFieldError(field, `${fieldName} является обязательным полем`);
            return false;
        }

        this.clearFieldError(field);
        return true;
    }

    validateNumberField(field) {
        const value = field.value.trim();
        const fieldName = this.getFieldName(field);

        // Если поле не обязательно и пустое - пропускаем валидацию
        if (!field.required && !value) {
            this.clearFieldError(field);
            return true;
        }

        if (!value) {
            this.showFieldError(field, `${fieldName} является обязательным полем`);
            return false;
        }

        const numValue = parseFloat(value);
        const min = parseFloat(field.min) || -Infinity;
        const max = parseFloat(field.max) || Infinity;

        if (isNaN(numValue)) {
            this.showFieldError(field, `${fieldName} должно быть числом`);
            return false;
        }

        if (numValue < 0) {
            this.showFieldError(field, `${fieldName} не может быть отрицательным`);
            return false;
        }

        if (numValue < min) {
            this.showFieldError(field, `${fieldName} не может быть меньше ${min}`);
            return false;
        }

        if (numValue > max) {
            this.showFieldError(field, `${fieldName} не может быть больше ${max}`);
            return false;
        }

        this.clearFieldError(field);
        return true;
    }

    validateEmailField(field) {
        const value = field.value.trim();
        const fieldName = this.getFieldName(field);

        // Если поле не обязательно и пустое - пропускаем валидацию
        if (!field.required && !value) {
            this.clearFieldError(field);
            return true;
        }

        if (!value) {
            this.showFieldError(field, `${fieldName} является обязательным полем`);
            return false;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            this.showFieldError(field, 'Введите корректный email адрес');
            return false;
        }

        this.clearFieldError(field);
        return true;
    }

    getFieldName(field) {
        const label = field.closest('.input-group')?.querySelector('label');
        if (label) {
            // Убираем звездочку из названия поля
            return label.textContent.replace('*', '').replace('★', '').trim();
        }

        // Названия полей по умолчанию
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

    showFieldError(field, message) {
        this.clearFieldError(field);

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

    clearFieldError(field) {
        field.classList.remove('error');
        const existingError = field.parentNode.querySelector('.field-error');
        if (existingError) {
            existingError.remove();
        }
    }

    validateForm(formId) {
        const form = document.getElementById(formId);
        if (!form) return false;

        let isValid = true;

        // Проверка обязательных полей
        const requiredFields = form.querySelectorAll('input[required], select[required]');
        requiredFields.forEach(field => {
            if (!this.validateRequiredField(field)) {
                isValid = false;
            }
        });

        // Проверка числовых полей
        const numberFields = form.querySelectorAll('input[type="number"]');
        numberFields.forEach(field => {
            if (field.value.trim() && !this.validateNumberField(field)) {
                isValid = false;
            }
        });

        // Проверка email полей
        const emailFields = form.querySelectorAll('input[type="email"]');
        emailFields.forEach(field => {
            if (field.value.trim() && !this.validateEmailField(field)) {
                isValid = false;
            }
        });

        // Специальная проверка для стажа курения
        const smokingYearsInput = form.querySelector('input[name="smoking_years"]');
        const smokingStatusSelect = form.querySelector('select[name="smoking_status"]');

        if (smokingYearsInput && smokingStatusSelect) {
            const smokingStatus = smokingStatusSelect.value;
            const smokingYears = smokingYearsInput.value.trim();

            // Если статус "не курю", но указан стаж - ошибка
            if ((smokingStatus === 'non_smoker' || !smokingStatus) && smokingYears) {
                this.showFieldError(smokingYearsInput, 'Для некурящего пациента стаж курения должен быть пустым');
                isValid = false;
            }

            // Если статус требует стажа, но стаж не указан - ошибка
            if ((smokingStatus === 'active_smoker' || smokingStatus === 'passive_smoker') && !smokingYears) {
                this.showFieldError(smokingYearsInput, `Для статуса "${this.getSmokingStatusText(smokingStatus)}" необходимо указать стаж курения`);
                isValid = false;
            }

            // Если стаж указан, проверяем что это корректное число
            if (smokingYears && !this.validateNumberField(smokingYearsInput)) {
                isValid = false;
            }
        }

        return isValid;
    }

    getSmokingStatusText(status) {
        switch(status) {
            case 'active_smoker': return 'Активный курильщик';
            case 'passive_smoker': return 'Пассивный курильщик';
            case 'non_smoker': return 'Не курю';
            default: return status;
        }
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

            // Обработчики для модального окна добавления пациента
            if (e.target.closest('#closePatientModal') || e.target.closest('#cancelPatient')) {
                this.closePatientModal();
                return;
            }

            // Обработчики для модального окна редактирования пациента
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

            // ВАЖНО: Обработчик кнопки загрузки видео
            if (e.target.closest('#uploadPatientBtn')) {
                e.preventDefault();
                e.stopPropagation();
                this.handlePatientVideoUpload();
                return;
            }
        });

        // Исправленные обработчики форм
        document.getElementById('submitPatientBtn').addEventListener('click', (e) => this.handlePatientSubmit(e));
        document.getElementById('submitEditPatientBtn').addEventListener('click', (e) => this.handleEditPatientSubmit(e));

        // Предотвращаем стандартное поведение формы загрузки видео
        document.getElementById('uploadPatientForm').addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        // Поиск пациентов
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
        // Patient delete confirmation
        document.getElementById('confirmDeletePatient').addEventListener('click', () => this.executePatientDelete());
        document.getElementById('cancelDeletePatient').addEventListener('click', () => this.closeConfirmDeletePatientModal());
        document.getElementById('closeConfirmDeletePatient').addEventListener('click', () => this.closeConfirmDeletePatientModal());
    }

    setupPatientModal() {
        const modal = document.getElementById('patientModal');

        // Инициализация кастомных селектов
        const customSelects = modal.querySelectorAll('.custom-select');
        customSelects.forEach(select => {
            new CustomSelect(select);
        });

        // Обработчик изменения статуса курения с блокировкой поля
        document.getElementById('patientSmokingStatusSelect').addEventListener('change', (e) => {
            this.handlePatientSmokingStatusChange(e.target.value);
            this.handleSmokingStatusValidation(e.target.value, 'patientForm');
        });

        // Принудительная инициализация состояния
        setTimeout(() => {
            const initialStatus = document.getElementById('patientSmokingStatusSelect').value;
            this.handlePatientSmokingStatusChange(initialStatus);
            this.handleSmokingStatusValidation(initialStatus, 'patientForm');
        }, 100);
    }

    setupEditPatientModal() {
        const modal = document.getElementById('editPatientModal');

        // Инициализация кастомных селектов
        const customSelects = modal.querySelectorAll('.custom-select');
        customSelects.forEach(select => {
            new CustomSelect(select);
        });

        // Обработчик изменения статуса курения для формы редактирования с блокировкой поля
        document.getElementById('editPatientSmokingStatusSelectModal').addEventListener('change', (e) => {
            this.handleEditPatientSmokingStatusChange(e.target.value);
            this.handleSmokingStatusValidation(e.target.value, 'editPatientForm');
        });

        // Принудительная инициализация состояния
        setTimeout(() => {
            const initialStatus = document.getElementById('editPatientSmokingStatusSelectModal').value;
            this.handleEditPatientSmokingStatusChange(initialStatus);
            this.handleSmokingStatusValidation(initialStatus, 'editPatientForm');
        }, 100);
    }

    handlePatientSmokingStatusChange(status) {
        const smokingYearsInput = document.getElementById('patientSmokingYearsInput');
        const smokingYearsLabel = smokingYearsInput.closest('.input-group').querySelector('label');

        // Блокируем поле и очищаем его если статус "не курю" или не выбран
        if (status === 'non_smoker' || status === '') {
            smokingYearsInput.disabled = true;
            smokingYearsInput.value = '';
            smokingYearsInput.placeholder = 'Не доступно для некурящих';
            smokingYearsLabel.style.opacity = '0.5';
            this.clearFieldError(smokingYearsInput);
        } else {
            smokingYearsInput.disabled = false;
            smokingYearsInput.placeholder = 'Введите стаж курения в годах';
            smokingYearsLabel.style.opacity = '1';
        }
    }

    handleEditPatientSmokingStatusChange(status) {
        const smokingYearsInput = document.getElementById('editPatientSmokingYearsModal');
        const smokingYearsLabel = smokingYearsInput.closest('.input-group').querySelector('label');

        // Блокируем поле если статус "не курю" или не выбран
        if (status === 'non_smoker' || status === '') {
            smokingYearsInput.disabled = true;
            smokingYearsInput.placeholder = 'Не доступно для некурящих';
            smokingYearsLabel.style.opacity = '0.5';
            this.clearFieldError(smokingYearsInput);
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

        // Предотвращаем стандартное поведение формы
        document.getElementById('uploadPatientForm').addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }

    handlePatientFileSelect(file) {
        if (!file.type.startsWith('video/')) {
            this.authApp.showToast('Ошибка', 'Пожалуйста, выберите видео файл', 'error');
            return;
        }

        if (file.size > 500 * 1024 * 1024) {
            this.authApp.showToast('Ошибка', 'Файл слишком большой. Максимальный размер: 500MB', 'error');
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
            const response = await fetch(`${this.baseURL}/patients/`, {
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
                this.authApp.showToast('Ошибка', 'Требуется авторизация', 'error');
                this.authApp.logout();
            } else {
                const error = await response.json();
                this.authApp.showToast('Ошибка', error.detail || 'Не удалось загрузить пациентов', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение к серверу', 'error');
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
                        <span><i class="fas fa-venus-mars"></i> ${this.formatGender(patient.gender)}</span>
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
                        <span><i class="fas fa-venus-mars"></i> ${this.formatGender(patient.gender)}</span>
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
        const totalVideos = this.getTotalVideosCount();

        document.getElementById('totalPatientsCount').textContent = totalPatients;
        document.getElementById('recentPatients').textContent = recentPatients;
        document.getElementById('totalPatientVideos').textContent = totalVideos;
    }

    getTotalVideosCount() {
        return this.patients.reduce((total, patient) => total + (patient.video_count || 0), 0);
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

        // Прокрутка вверх при открытии модального окна
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

        // Прокрутка вверх при открытии модального окна
        this.scrollModalToTop('editPatientModal');
    }

    closeEditPatientModal() {
        const modal = document.getElementById('editPatientModal');
        modal.classList.remove('active');
        this.clearEditPatientForm();
    }

    // Метод для прокрутки модального окна вверх
    scrollModalToTop(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            const modalBody = modal.querySelector('.modal-body');
            if (modalBody) {
                // Используем setTimeout чтобы дать время на отрисовку модального окна
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

        // Установить значения для select элементов
        document.getElementById('patientGenderSelect').value = patient.gender || '';
        document.getElementById('patientSmokingStatusSelect').value = patient.smoking_status || '';

        // Обновить кастомные селекты
        setTimeout(() => {
            const customSelects = document.querySelectorAll('#patientModal .custom-select');
            customSelects.forEach(select => {
                const instance = select.customSelectInstance;
                if (instance) {
                    instance.updateSelected();
                }
            });

            // Обновить состояние поля стажа курения после заполнения формы
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

        // Установить значения для select элементов
        document.getElementById('editPatientGenderSelectModal').value = patient.gender || '';
        document.getElementById('editPatientSmokingStatusSelectModal').value = patient.smoking_status || '';

        // Обновить кастомные селекты
        setTimeout(() => {
            const customSelects = document.querySelectorAll('#editPatientModal .custom-select');
            customSelects.forEach(select => {
                const instance = select.customSelectInstance;
                if (instance) {
                    instance.updateSelected();
                }
            });

            // Обновить состояние поля стажа курения после заполнения формы
            const status = document.getElementById('editPatientSmokingStatusSelectModal').value;
            this.handleEditPatientSmokingStatusChange(status);
            this.handleSmokingStatusValidation(status, 'editPatientForm');
        }, 200);
    }

    clearPatientForm() {
        document.getElementById('patientForm').reset();

        // Сбросить кастомные селекты
        const customSelects = document.querySelectorAll('#patientModal .custom-select');
        customSelects.forEach(select => {
            const instance = select.customSelectInstance;
            if (instance) {
                instance.updateSelected();
            }
        });

        // Очистить все ошибки
        const errorFields = document.querySelectorAll('#patientModal .error');
        errorFields.forEach(field => this.clearFieldError(field));

        this.handlePatientSmokingStatusChange('');
        this.handleSmokingStatusValidation('', 'patientForm');
    }

    clearEditPatientForm() {
        document.getElementById('editPatientForm').reset();

        // Сбросить кастомные селекты
        const customSelects = document.querySelectorAll('#editPatientModal .custom-select');
        customSelects.forEach(select => {
            const instance = select.customSelectInstance;
            if (instance) {
                instance.updateSelected();
            }
        });

        // Очистить все ошибки
        const errorFields = document.querySelectorAll('#editPatientModal .error');
        errorFields.forEach(field => this.clearFieldError(field));

        this.handleEditPatientSmokingStatusChange('');
        this.handleSmokingStatusValidation('', 'editPatientForm');
    }

    async handlePatientSubmit(e) {
        e.preventDefault();
        if (this.authApp.isLoading) return;

        // Валидация формы перед отправкой
        if (!this.validateForm('patientForm')) {
            this.authApp.showToast('Ошибка валидации', 'Пожалуйста, исправьте ошибки в форме', 'error');
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

        // Очистка данных - устанавливаем null для необязательных полей если они пустые
        Object.keys(patientData).forEach(key => {
            if (patientData[key] === null || patientData[key] === '' || patientData[key] === undefined) {
                patientData[key] = null; // Явно устанавливаем null
            }
        });

        // Автоматическая очистка стажа курения для некурящих
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

        // Валидация формы перед отправкой
        if (!this.validateForm('editPatientForm')) {
            this.authApp.showToast('Ошибка валидации', 'Пожалуйста, исправьте ошибки в форме', 'error');
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

        // Очистка данных - устанавливаем null для необязательных полей если они пустые
        Object.keys(patientData).forEach(key => {
            if (patientData[key] === null || patientData[key] === '' || patientData[key] === undefined) {
                patientData[key] = null; // Явно устанавливаем null
            }
        });

        // Автоматическая очистка стажа курения для некурящих
        if (patientData.smoking_status === 'non_smoker' || !patientData.smoking_status) {
            patientData.smoking_years = null;
        }

        const patientId = formData.get('id');
        await this.submitPatient(patientData, patientId, submitBtn);
    }

    async submitPatient(patientData, patientId, submitBtn) {
        this.authApp.setLoadingState(submitBtn, true);

        try {
            const url = patientId ? `${this.baseURL}/patients/${patientId}/` : `${this.baseURL}/patients/`;
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
                this.authApp.showToast('Успешно', patientId ? 'Пациент обновлен' : 'Пациент добавлен', 'success');
                this.closePatientModal();
                this.closeEditPatientModal();
                this.loadPatients();

                // Если редактировали текущего пациента, обновляем его данные
                if (patientId && this.currentPatient && this.currentPatient.id === parseInt(patientId)) {
                    this.currentPatient = patient;
                    this.updatePatientDetailDisplay(patient);
                }
            } else {
                const error = await response.json();
                this.authApp.showToast('Ошибка', error.detail || 'Произошла ошибка', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        } finally {
            this.authApp.setLoadingState(submitBtn, false);
        }
    }

    async viewPatient(patientId) {
        const patient = this.patients.find(p => p.id === parseInt(patientId));
        if (!patient) {
            this.authApp.showToast('Ошибка', 'Пациент не найден', 'error');
            return;
        }

        this.currentPatient = patient;
        this.showPatientDetail(patient);
    }

    showPatientDetail(patient) {
        // Обновить информацию о пациенте
        this.updatePatientDetailDisplay(patient);

        // Показать секцию деталей пациента
        this.authApp.showSection('patientDetail');

        // Инициализировать менеджер видео для пациента
        if (!this.videoManager) {
            this.videoManager = new PatientVideoManager(this.authApp, this);
        }
        this.videoManager.setCurrentPatient(patient.id);
        this.videoManager.loadVideos();
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

    // Patient deletion methods
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
            const response = await fetch(`${this.baseURL}/patients/${patientId}/`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                this.authApp.showToast('Успешно', 'Пациент удален', 'success');
                this.loadPatients();

                // Если удаляем текущего пациента, возвращаемся к списку
                if (this.currentPatient && this.currentPatient.id === parseInt(patientId)) {
                    this.showPatientsList();
                }
            } else {
                const error = await response.json();
                this.authApp.showToast('Ошибка', error.detail || 'Не удалось удалить пациента', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение', 'error');
        } finally {
            this.pendingDeletePatientId = null;
        }
    }

    openPatientUploadModal() {
        if (!this.currentPatient) {
            this.authApp.showToast('Ошибка', 'Пациент не выбран', 'error');
            return;
        }
        document.getElementById('uploadPatientModal').classList.add('active');

        // Прокрутка вверх при открытии модального окна
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

        // Очищаем файловый инпут
        if (fileInput) {
            fileInput.value = '';
        }
    }

    // ИСПРАВЛЕННЫЙ метод загрузки видео
    async handlePatientVideoUpload() {
        console.log('Начало загрузки видео...');

        if (!this.currentPatient) {
            this.authApp.showToast('Ошибка', 'Пациент не выбран', 'error');
            return;
        }

        const fileInput = document.getElementById('patientVideoFile');
        const file = fileInput.files[0];
        const titleInput = document.getElementById('videoTitle');
        const title = titleInput.value.trim();

        if (!file) {
            this.authApp.showToast('Ошибка', 'Пожалуйста, выберите видео файл', 'error');
            return;
        }

        // Проверка типа файла
        if (!file.type.startsWith('video/')) {
            this.authApp.showToast('Ошибка', 'Пожалуйста, выберите видео файл', 'error');
            return;
        }

        // Проверка размера файла
        if (file.size > 500 * 1024 * 1024) {
            this.authApp.showToast('Ошибка', 'Файл слишком большой. Максимальный размер: 500MB', 'error');
            return;
        }

        // ИСПРАВЛЕНИЕ: Правильно формируем FormData
        const formData = new FormData();
        formData.append('file', file);

        // ИСПРАВЛЕНИЕ: Добавляем title как отдельное поле формы
        if (title) {
            formData.append('title', title);
        } else {
            // Если заголовок не указан, используем имя файла без расширения
            const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
            formData.append('title', fileNameWithoutExt);
        }

        const uploadBtn = document.getElementById('uploadPatientBtn');
        const uploadProgress = document.getElementById('uploadPatientProgress');

        this.authApp.setLoadingState(uploadBtn, true);
        uploadProgress.style.display = 'flex';

        try {
            console.log('Отправка запроса на сервер...');
            console.log('Данные формы:', {
                file: file.name,
                title: title || file.name.replace(/\.[^/.]+$/, ""),
                size: file.size
            });

            const response = await fetch(`${this.baseURL}/patients/${this.currentPatient.id}/videos/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`
                    // Не устанавливаем Content-Type - браузер сам установит с boundary для FormData
                },
                body: formData
            });

            console.log('Получен ответ от сервера:', response.status);

            if (response.ok) {
                const result = await response.json();
                console.log('Результат загрузки:', result);

                this.authApp.showToast('Успешно', result.message || 'Видео успешно загружено', 'success');
                this.closePatientUploadModal();

                // Обновляем список видео
                if (this.videoManager) {
                    await this.videoManager.loadVideos();
                }

                console.log('Видео успешно загружено и список обновлен');
            } else {
                const error = await response.json();
                console.error('Ошибка загрузки:', error);
                this.authApp.showToast('Ошибка загрузки', error.detail || 'Произошла ошибка при загрузке видео', 'error');
            }
        } catch (error) {
            console.error('Ошибка сети:', error);
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        } finally {
            this.authApp.setLoadingState(uploadBtn, false);
            uploadProgress.style.display = 'none';
        }
    }

    // Новый метод для обновления данных пациента
    async refreshPatientData() {
        if (!this.currentPatient) {
            this.authApp.showToast('Ошибка', 'Пациент не выбран', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.baseURL}/patients/`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const patientsData = await response.json();
                this.patients = patientsData;

                // Находим обновленные данные текущего пациента
                const updatedPatient = this.patients.find(p => p.id === this.currentPatient.id);

                if (updatedPatient) {
                    // Обновляем текущего пациента
                    this.currentPatient = updatedPatient;

                    // Обновляем отображаемые данные
                    this.updatePatientDetailDisplay(updatedPatient);

                    // Обновляем видео пациента
                    if (this.videoManager) {
                        this.videoManager.loadVideos();
                    }

                    this.authApp.showToast('Успешно', 'Данные пациента обновлены', 'success');
                } else {
                    this.authApp.showToast('Ошибка', 'Пациент не найден в обновленных данных', 'error');
                }
            } else if (response.status === 401) {
                this.authApp.showToast('Ошибка', 'Требуется авторизация', 'error');
                this.authApp.logout();
            } else {
                const error = await response.json();
                this.authApp.showToast('Ошибка', error.detail || 'Не удалось обновить данные пациента', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        }
    }

    // Метод для обновления отображения данных пациента
    updatePatientDetailDisplay(patient) {
        // Обновить информацию о пациенте на странице
        document.getElementById('patientDetailName').textContent = this.getFullName(patient);
        document.getElementById('patientName').textContent = patient.name || '—';
        document.getElementById('patientSurname').textContent = patient.surname || '—';
        document.getElementById('patientLastName').textContent = patient.last_name || '—';
        document.getElementById('patientEmail').textContent = patient.email || '—';
        document.getElementById('patientAge').textContent = patient.age ? `${patient.age} лет` : '—';
        document.getElementById('patientGender').textContent = this.formatGender(patient.gender);
        document.getElementById('patientHeight').textContent = patient.height ? `${patient.height} см` : '—';
        document.getElementById('patientWeight').textContent = patient.weight ? `${patient.weight} кг` : '—';
        document.getElementById('patientBMI').innerHTML = patient.bmi ? this.formatBMI(patient.bmi) : '—';
        document.getElementById('patientSmokingStatus').textContent = this.formatSmokingStatus(patient.smoking_status);
        document.getElementById('patientSmokingYears').textContent = patient.smoking_years ? `${patient.smoking_years} лет` : '—';

        // Обновляем статистику пациента
        this.updatePatientStats(patient);
    }

    // Метод для обновления статистики пациента
    updatePatientStats(patient) {
        const totalVideos = patient.video_count || 0;
        document.getElementById('patientTotalVideos').textContent = totalVideos;

        // Вычисляем время в системе
        if (patient.created_at) {
            const createdDate = new Date(patient.created_at);
            const now = new Date();
            const diffTime = Math.abs(now - createdDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            document.getElementById('patientAccountAge').textContent = `${diffDays} дней`;
        } else {
            document.getElementById('patientAccountAge').textContent = '—';
        }

        // Обновляем дату последнего анализа (можно добавить логику из данных пациента)
        document.getElementById('patientLastAnalysis').textContent = patient.last_analysis_date || '—';
    }

    formatGender(gender) {
        switch(gender) {
            case 'male': return 'Мужской';
            case 'female': return 'Женский';
            default: return '—';
        }
    }

    formatSmokingStatus(status) {
        switch(status) {
            case 'non_smoker': return 'Не курю';
            case 'active_smoker': return 'Активный курильщик';
            case 'passive_smoker': return 'Пассивный курильщик';
            default: return '—';
        }
    }

    formatBMI(bmi) {
        if (!bmi) return '—';

        let bmiClass = 'bmi-normal';
        if (bmi < 18.5) bmiClass = 'bmi-underweight';
        else if (bmi < 25) bmiClass = 'bmi-normal';
        else if (bmi < 30) bmiClass = 'bmi-overweight';
        else bmiClass = 'bmi-obese';

        return `<span class="bmi-indicator ${bmiClass}">${bmi.toFixed(1)}</span>`;
    }
}

class PatientVideoManager {
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
        // Video delete confirmation
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

    // Video deletion methods
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
            const response = await fetch(`${this.baseURL}/patients/${this.currentPatientId}/videos/${videoId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const result = await response.json();
                this.authApp.showToast('Успешно', result.message || 'Видео удалено', 'success');
                this.loadVideos();
            } else {
                const error = await response.json();
                this.authApp.showToast('Ошибка', error.detail || 'Не удалось удалить видео', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение', 'error');
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
            this.authApp.showToast('Ошибка', 'Не удалось воспроизвести видео', 'error');
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
            const response = await fetch(`${this.baseURL}/patients/${this.currentPatientId}/videos/`, {
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
                this.authApp.showToast('Ошибка', 'Требуется авторизация', 'error');
                this.authApp.logout();
            } else {
                const error = await response.json();
                this.authApp.showToast('Ошибка', error.detail || 'Не удалось загрузить видео', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение к серверу', 'error');
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

        // ИСПРАВЛЕНИЕ: Отображаем title вместо filename
        videosContainer.innerHTML = existingVideos.map(video => `
            <div class="video-card grid-view">
                <div class="video-thumbnail">
                    <i class="fas fa-file-video"></i>
                    <div class="video-duration">${this.formatDuration(video.duration)}</div>
                </div>
                <div class="video-content">
                    <div class="video-title">${video.title || this.escapeHtml(video.name)}</div>
                    <div class="video-meta">
                        <span><i class="fas fa-calendar"></i> ${new Date(video.upload_date).toLocaleDateString()}</span>
                        <span><i class="fas fa-weight-hanging"></i> ${this.formatFileSize(video.size)}</span>
                    </div>
                    <div class="video-actions">
                        <button class="btn-action btn-preview" data-video-id="${video.id}" title="Просмотр">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="btn-action btn-download" data-video-id="${video.id}" title="Скачать">
                            <i class="fas fa-download"></i>
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
            this.authApp.showToast('Ошибка', 'Видео не найдено', 'error');
            return;
        }

        if (video.file_exists === false) {
            this.authApp.showToast('Ошибка', 'Файл видео не найден на сервере', 'error');
            return;
        }

        const modal = document.getElementById('previewModal');
        const previewTitle = document.getElementById('previewTitle');
        const previewDate = document.getElementById('previewDate');
        const previewSize = document.getElementById('previewSize');
        const previewDuration = document.getElementById('previewDuration');

        previewTitle.textContent = video.title || video.name;
        previewDate.textContent = new Date(video.upload_date).toLocaleDateString();
        previewSize.textContent = this.formatFileSize(video.size || 0);
        previewDuration.textContent = this.formatDuration(video.duration || 0);

        this.resetVideoPlayer();
        this.showLoading();

        try {
            const videoUrl = `${this.baseURL}/patients/${this.currentPatientId}/videos/${numericVideoId}/stream`;

            const response = await fetch(videoUrl, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    this.authApp.showToast('Ошибка авторизации', 'Требуется повторный вход', 'error');
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
                this.authApp.showToast('Ошибка авторизации', 'Требуется повторный вход', 'error');
                this.authApp.logout();
            } else if (error.message.includes('Invalid video format')) {
                this.authApp.showToast('Ошибка', 'Неверный формат видеофайла', 'error');
            } else {
                this.authApp.showToast('Ошибка', 'Не удалось загрузить видео', 'error');
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
            this.authApp.showToast('Ошибка', 'Файл видео не найден на сервере', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.baseURL}/patients/${this.currentPatientId}/videos/${videoId}/download`, {
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

                this.authApp.showToast('Успешно', 'Видео скачивается', 'success');
            } else {
                const error = await response.json();
                this.authApp.showToast('Ошибка', error.detail || 'Не удалось скачать видео', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение', 'error');
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
        if (modal.currentVideoId) {
            this.authApp.showToast('Анализ', 'Запуск анализа видео...', 'info');
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

class AuthApp {
    constructor() {
        this.baseURL = 'http://localhost:8000';
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
            const response = await fetch(`${this.baseURL}/auth/login/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(loginData)
            });

            const result = await response.json();

            if (response.ok) {
                this.setTokens(result.access_token, result.refresh_token);
                this.showToast('Успешный вход!', 'Добро пожаловать!', 'success');
                this.showSection('patients');
                form.reset();
            } else {
                this.showToast('Ошибка входа', result.detail || 'Неверный email или пароль', 'error');
            }
        } catch (error) {
            this.showToast('Ошибка сети', 'Проверьте подключение к интернету', 'error');
        } finally {
            this.setLoadingState(submitBtn, false);
        }
    }

    async submitRegister(userData) {
        const form = document.getElementById('registerForm');
        const submitBtn = form.querySelector('button[type="submit"]');

        this.setLoadingState(submitBtn, true);

        try {
            const response = await fetch(`${this.baseURL}/auth/register/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(userData)
            });

            const result = await response.json();

            if (response.ok) {
                this.showToast('Регистрация успешна!', 'Теперь вы можете войти в систему', 'success');
                this.showSection('login');
                form.reset();
            } else {
                this.showToast('Ошибка регистрации', result.detail || 'Произошла ошибка при регистрации', 'error');
            }
        } catch (error) {
            this.showToast('Ошибка сети', 'Проверьте подключение к интернету', 'error');
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

        this.showToast('Выход', 'Вы успешно вышли из системы', 'success');
    }

    showToast(title, message, type = 'info') {
        const toastContainer = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };

        toast.innerHTML = `
            <div class="toast-icon">
                <i class="${icons[type] || icons.info}"></i>
            </div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close">
                <i class="fas fa-times"></i>
            </button>
        `;

        toastContainer.appendChild(toast);

        const autoRemove = setTimeout(() => {
            if (toast.parentElement) {
                toast.style.animation = 'slideInRight 0.3s ease-out reverse';
                setTimeout(() => toast.remove(), 300);
            }
        }, 5000);

        toast.querySelector('.toast-close').addEventListener('click', () => {
            clearTimeout(autoRemove);
            toast.style.animation = 'slideInRight 0.3s ease-out reverse';
            setTimeout(() => toast.remove(), 300);
        });
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

        document.querySelectorAll('.auth-card, .profile-card, .patient-card, .video-card, .stat-card').forEach(card => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            observer.observe(card);
        });
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new AuthApp();
});