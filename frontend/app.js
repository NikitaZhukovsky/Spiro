class PDFReportGenerator {
    constructor() {
        if (typeof jspdf === 'undefined') {
            console.error('jsPDF не загружен');
            throw new Error('jsPDF не загружен');
        }

        const { jsPDF } = window.jspdf;

        this.doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4',
            compress: true
        });

        this.margin = 10;
        this.pageWidth = 210;
        this.pageHeight = 297;
        this.currentY = this.margin;

        // ВАЖНО: Используем стандартный шрифт который поддерживает кириллицу
        this.setupFonts();
    }

    setupFonts() {
        // Пробуем использовать разные шрифты для кириллицы
        try {
            // Пробуем стандартные шрифты которые могут поддерживать кириллицу
            const availableFonts = ['helvetica', 'times', 'courier'];

            for (const font of availableFonts) {
                try {
                    this.doc.setFont(font);
                    this.doc.setFontSize(10);
                    // Тест русских символов
                    this.doc.text('Тест', 10, 10);
                    this.doc.deletePage(1); // Удаляем тестовую страницу
                    console.log(`Используется шрифт: ${font}`);
                    break;
                } catch (e) {
                    continue;
                }
            }

            // Если ни один стандартный не подошел, создаем новую страницу
            if (!this.doc.internal.pages.length) {
                this.doc.addPage();
            }

        } catch (error) {
            console.warn('Ошибка настройки шрифтов:', error);
            // Используем helvetica по умолчанию
            this.doc.setFont("helvetica");
            this.doc.setFontSize(10);
        }
    }

    // Добавляем метод для кодирования текста
    encodeText(text) {
        if (!text) return '—';

        // Простая замена проблемных символов
        return String(text)
            .replace(/[^\x00-\x7F]/g, '') // Удаляем не-ASCII символы временно
            .replace(/—/g, '-') // Заменяем длинное тире на обычное
            .replace(/«|»/g, '"') // Заменяем кавычки
            .replace(/ё/g, 'е') // Заменяем букву ё
            .replace(/Ё/g, 'Е'); // Заменяем букву Ё
    }

    // Обновленный safeString с кодированием
    safeString(value) {
        if (value === null || value === undefined) return '—';
        const str = String(value);
        return this.encodeText(str);
    }

    async generateAnalysisReport(patient, analysis, plots = []) {
        try {
            this.currentY = this.margin;

            this.addHeader(patient, analysis);
            this.addCompactInfo(patient, analysis);
            this.addMetricsTable(analysis);

            if (plots.length > 0) {
                await this.addPlots(plots);
            }

            this.addMedicalAssessment(analysis);
            this.addFooter();

            const fileName = `Анализ_${this.safeString(patient.surname)}_${this.safeString(patient.name)}.pdf`;
            this.doc.save(fileName);

            return this.doc;
        } catch (error) {
            console.error('Ошибка при генерации PDF:', error);
            throw error;
        }
    }

    addHeader(patient, analysis) {
        this.doc.setFillColor(41, 128, 185);
        this.doc.rect(0, 0, this.pageWidth, 25, 'F');

        this.doc.setTextColor(255, 255, 255);
        this.doc.setFontSize(18);
        this.doc.setFont("helvetica", "bold");
        this.doc.text("Отчет анализа дыхания", this.pageWidth / 2, 15, { align: 'center' });

        this.doc.setFontSize(11);
        const fullName = `${this.safeString(patient.surname)} ${this.safeString(patient.name)}`;
        this.doc.text(`Пациент: ${fullName}`, 10, 35);

        const analysisDate = new Date(analysis.created_at);
        const dateString = analysisDate.toLocaleDateString('ru-RU');
        this.doc.text(`Дата анализа: ${this.safeString(dateString)}`, 10, 42);

        this.currentY = 50;
    }

    addCompactInfo(patient, analysis) {
        const data = [
            ['ПАЦИЕНТ', 'АНАЛИЗ'],
            ['Фамилия:', this.safeString(patient.surname), 'ID анализа:', this.safeString(analysis.id)],
            ['Имя:', this.safeString(patient.name), 'Видео:', this.safeString(analysis.video_title || `#${analysis.video_id}`)],
            ['Возраст:', patient.age ? `${this.safeString(patient.age)} лет` : '—', 'Статус:', this.getStatusText(analysis.status)],
            ['Пол:', this.formatGender(patient.gender), 'Время:', analysis.processing_time_seconds ? `${this.safeString(analysis.processing_time_seconds.toFixed(1))} сек` : '—'],
            ['Рост:', patient.height ? `${this.safeString(patient.height)} см` : '—', 'Кадры:', this.safeString(analysis.total_frames)],
            ['Вес:', patient.weight ? `${this.safeString(patient.weight)} кг` : '—', 'Маркер:', `${this.formatMarkerColor(analysis.marker_color)} ${analysis.marker_size_mm ? `${this.safeString(analysis.marker_size_mm)} мм` : ''}`],
        ];

        let x = this.margin;
        let y = this.currentY + 5;

        this.doc.setFontSize(10);
        this.doc.setFont("helvetica", "bold");

        this.doc.text('ПАЦИЕНТ', x, y);
        this.doc.text('АНАЛИЗ', x + 90, y);

        y += 7;
        this.doc.setDrawColor(200, 200, 200);
        this.doc.line(x, y, x + 190, y);
        y += 5;

        this.doc.setFont("helvetica", "normal");

        for (let i = 1; i < data.length; i++) {
            const row = data[i];

            this.doc.setFont("helvetica", "bold");
            this.doc.text(this.safeString(row[0]), x, y);
            this.doc.setFont("helvetica", "normal");
            this.doc.text(this.safeString(row[1]), x + 30, y);

            this.doc.setFont("helvetica", "bold");
            this.doc.text(this.safeString(row[2]), x + 90, y);
            this.doc.setFont("helvetica", "normal");
            this.doc.text(this.safeString(row[3]), x + 120, y);

            y += 6;

            if (i < data.length - 1) {
                this.doc.setDrawColor(240, 240, 240);
                this.doc.line(x, y - 1, x + 190, y - 1);
            }
        }

        this.currentY = y + 10;
    }

    addMetricsTable(analysis) {
        const breathingRate = analysis.breathing_rate_mean_bpm ?
            `${this.safeString(analysis.breathing_rate_mean_bpm.toFixed(1))} вд/мин` : '—';

        const amplitude = analysis.amplitude_mean_mm ?
            `${this.safeString(analysis.amplitude_mean_mm.toFixed(1))} ± ${this.safeString(analysis.amplitude_std_mm?.toFixed(1) || '0.0')} мм` : '—';

        const synchronization = analysis.synchronization_index ?
            `${this.safeString((analysis.synchronization_index * 100).toFixed(1))}%` : '—';

        const metrics = [
            {
                title: 'Частота дыхания',
                value: breathingRate,
                description: 'Средняя частота дыхания',
                color: [41, 128, 185]
            },
            {
                title: 'Амплитуда',
                value: amplitude,
                description: 'Амплитуда движений',
                color: [39, 174, 96]
            },
            {
                title: 'Синхронизация',
                value: synchronization,
                description: 'Синхронность дыхания',
                color: [142, 68, 173]
            }
        ];

        let x = this.margin;
        let y = this.currentY;
        const colWidth = 60;
        const rowHeight = 25;

        this.doc.setFontSize(12);
        this.doc.setFont("helvetica", "bold");
        this.doc.text('ОСНОВНЫЕ ПОКАЗАТЕЛИ', x, y);
        y += 8;

        metrics.forEach((metric, index) => {
            const colX = x + (index * colWidth);

            this.doc.setFillColor(metric.color[0], metric.color[1], metric.color[2], 0.1);
            this.doc.roundedRect(colX, y, colWidth - 5, rowHeight, 2, 2, 'F');

            this.doc.setFontSize(10);
            this.doc.setFont("helvetica", "bold");
            this.doc.text(this.safeString(metric.title), colX + 5, y + 7);

            this.doc.setFontSize(14);
            this.doc.text(this.safeString(metric.value), colX + 5, y + 16);

            this.doc.setFontSize(8);
            this.doc.setTextColor(100, 100, 100);
            this.doc.text(this.safeString(metric.description), colX + 5, y + 22);

            this.doc.setTextColor(0, 0, 0);
        });

        this.currentY = y + rowHeight + 10;
    }

    async addPlots(plots) {
        this.doc.setFontSize(12);
        this.doc.setFont("helvetica", "bold");
        this.doc.text('ГРАФИКИ АНАЛИЗА', this.margin, this.currentY);
        this.currentY += 8;

        const plotsPerRow = 2;
        const imgWidth = 95;
        const imgHeight = 70;

        for (let i = 0; i < plots.length; i += plotsPerRow) {
            const rowPlots = plots.slice(i, i + plotsPerRow);

            if (this.currentY + imgHeight > this.pageHeight - 30) {
                this.doc.addPage();
                this.currentY = this.margin;
            }

            for (let j = 0; j < rowPlots.length; j++) {
                const plot = rowPlots[j];
                const x = this.margin + (j * (imgWidth + 5));

                try {
                    const image = await this.getPlotImage(plot.url);
                    if (image) {
                        this.doc.addImage(
                            image.dataUrl,
                            'JPEG',
                            x,
                            this.currentY,
                            imgWidth,
                            imgHeight
                        );

                        this.doc.setFontSize(9);
                        this.doc.setTextColor(0, 0, 0);
                        const plotTitle = plot.title || `График ${i + j + 1}`;
                        this.doc.text(
                            this.safeString(plotTitle),
                            x + imgWidth / 2,
                            this.currentY + imgHeight + 5,
                            { align: 'center', maxWidth: imgWidth }
                        );
                    }
                } catch (error) {
                    console.error('Ошибка при добавлении графика:', error);
                    this.doc.setFontSize(9);
                    this.doc.setTextColor(150, 150, 150);
                    this.doc.text('График недоступен', x + imgWidth / 2, this.currentY + imgHeight / 2, { align: 'center' });
                }
            }

            this.currentY += imgHeight + 15;

            if (i + plotsPerRow < plots.length) {
                this.currentY += 5;
            }
        }

        this.doc.setTextColor(0, 0, 0);
    }

    async getPlotImage(plotUrl) {
        try {
            const response = await fetch(plotUrl);
            if (!response.ok) return null;

            const blob = await response.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                    resolve({
                        dataUrl: reader.result
                    });
                };
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.error('Ошибка загрузки графика:', error);
            return null;
        }
    }

    addMedicalAssessment(analysis) {
        let assessmentText = "Медицинская оценка не доступна";

        if (analysis.medical_assessment && analysis.medical_assessment !== "Оценка загружается...") {
            assessmentText = analysis.medical_assessment;
        } else if (analysis.text_report) {
            const reportLines = analysis.text_report.split('\n');
            let found = false;

            for (let i = 0; i < reportLines.length; i++) {
                const line = reportLines[i].trim();
                if (line.includes('ОБЩАЯ ИНФОРМАЦИЯ') || line.includes('МЕДИЦИНСКАЯ ОЦЕНКА')) {
                    found = true;
                    continue;
                }
                if (found && (line.includes('ЛИНИЯ 1:') || line.includes('================================'))) {
                    break;
                }
                if (found && line && line !== '') {
                    assessmentText = line;
                    break;
                }
            }
        }

        if (this.currentY + 50 > this.pageHeight - 30) {
            this.doc.addPage();
            this.currentY = this.margin;
        }

        this.doc.setFontSize(12);
        this.doc.setFont("helvetica", "bold");
        this.doc.text('МЕДИЦИНСКАЯ ОЦЕНКА', this.margin, this.currentY);
        this.currentY += 8;

        this.doc.setFontSize(10);
        this.doc.setFont("helvetica", "normal");

        const maxWidth = this.pageWidth - (2 * this.margin);
        const lines = this.doc.splitTextToSize(this.safeString(assessmentText), maxWidth);

        lines.forEach(line => {
            if (this.currentY > this.pageHeight - 30) {
                this.doc.addPage();
                this.currentY = this.margin;
            }
            this.doc.text(this.safeString(line), this.margin, this.currentY);
            this.currentY += 5;
        });

        this.currentY += 10;
    }

    addFooter() {
        const totalPages = this.doc.internal.getNumberOfPages();
        const currentYear = new Date().getFullYear();

        for (let i = 1; i <= totalPages; i++) {
            this.doc.setPage(i);

            this.doc.setFontSize(8);
            this.doc.setTextColor(150, 150, 150);

            const pageText = `Страница ${this.safeString(i)} из ${this.safeString(totalPages)}`;
            this.doc.text(
                pageText,
                this.pageWidth - this.margin - 20,
                this.pageHeight - 10,
                { align: 'right' }
            );

            const copyrightText = `SpiroApp © ${this.safeString(currentYear)}`;
            this.doc.text(
                copyrightText,
                this.margin,
                this.pageHeight - 10
            );
        }

        this.doc.setFontSize(10);
        this.doc.setTextColor(0, 0, 0);
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

    getStatusText(status) {
        switch(status) {
            case 'processing': return 'Обработка';
            case 'completed': return 'Завершено';
            case 'failed': return 'Ошибка';
            default: return this.safeString(status);
        }
    }

    formatMarkerColor(color) {
        const colorMap = {
            'red': 'Красный',
            'green': 'Зеленый',
            'blue': 'Синий',
            '#FF0000': 'Красный',
            '#00FF00': 'Зеленый',
            '#0000FF': 'Синий'
        };
        return colorMap[color] || this.safeString(color);
    }
}


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

            // Просмотр анализов пациента
            if (e.target.closest('#viewPatientAnalyses')) {
                this.viewPatientAnalyses();
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

        // Инициализировать менеджер анализа
        if (!this.analysisManager) {
            this.analysisManager = new RespiratoryAnalysisManager(this.authApp, this, this.videoManager);
        }
        this.analysisManager.setCurrentPatient(patient.id);
        this.analysisManager.loadAnalyses();
    }

    viewPatientAnalyses() {
        if (!this.currentPatient) {
            this.authApp.showToast('Ошибка', 'Пациент не выбран', 'error');
            return;
        }

        // Показываем секцию анализов
        this.authApp.showSection('patientAnalyses');

        // Загружаем анализы
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

    // Метод для обновления статистики пациента - ОБНОВЛЕН: убраны виджеты видео
    updatePatientStats(patient) {
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
        if (modal.currentVideoId && this.patientManager.analysisManager) {
            this.patientManager.analysisManager.openQuickAnalysis(modal.currentVideoId);
            // Закрываем модальное окно просмотра после запуска анализа
            this.closePreviewModal();
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

class RespiratoryAnalysisManager {
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
            // Кнопка "Анализировать" на видео
            if (e.target.closest('.btn-analyze')) {
                const videoId = e.target.closest('.btn-analyze').dataset.videoId;
                this.openAnalysisModal(videoId);
                return;
            }

            // Кнопка "Начать анализ" в модальном окне
            if (e.target.closest('#startAnalysisBtn')) {
                e.preventDefault();
                this.startAnalysis();
                return;
            }

            // Закрыть модальное окно анализа
            if (e.target.closest('#closeAnalysisModal') || e.target.closest('#cancelAnalysis')) {
                this.closeAnalysisModal();
                return;
            }

            // Просмотр анализа
            if (e.target.closest('.btn-analysis-view')) {
                const analysisId = e.target.closest('.btn-analysis-view').dataset.analysisId;
                this.viewAnalysis(analysisId);
                return;
            }

            // Удаление анализа
            if (e.target.closest('.btn-analysis-delete')) {
                const analysisId = e.target.closest('.btn-analysis-delete').dataset.analysisId;
                this.deleteAnalysis(analysisId);
                return;
            }

            // Назад к списку видео из секции анализов
            if (e.target.closest('#backToVideosFromAnalysis')) {
                this.patientManager.authApp.showSection('patientDetail');
                return;
            }

            // Обновить список анализов
            if (e.target.closest('#refreshAnalyses')) {
                this.loadAnalyses();
                return;
            }

            // Кнопка "Анализировать" в модальном окне просмотра видео
            if (e.target.closest('#analyzeVideo')) {
                const modal = document.getElementById('previewModal');
                if (modal.currentVideoId) {
                    this.openAnalysisModal(modal.currentVideoId);
                    // Закрываем окно просмотра видео
                    if (this.videoManager) {
                        this.videoManager.closePreviewModal();
                    }
                }
                return;
            }

            // Закрыть модальное окно с результатами
            if (e.target.closest('#closeAnalysisResultsModal') || e.target.closest('#closeResultsModalBtn')) {
                this.closeAnalysisResultModal();
                return;
            }

            // Скачать отчет PDF - ОСНОВНАЯ КНОПКА
            if (e.target.closest('#downloadAnalysisResultBtn')) {
                this.generateAndDownloadPDFReport();
                return;
            }

            // Скачать графики (старая функция)
            if (e.target.closest('#downloadAnalysisPlotsBtn')) {
                this.downloadAnalysisPlots();
                return;
            }
        });

        // Кнопки подтверждения удаления анализа
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

            // Очистка поиска при нажатии на крестик
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
            this.authApp.showToast('Ошибка', 'Пациент не выбран', 'error');
            return;
        }

        this.setCurrentVideo(videoId);
        const modal = document.getElementById('analysisModal');

        // Сбрасываем форму и показываем секцию с параметрами
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
            this.authApp.showToast('Ошибка', 'Не выбраны пациент или видео', 'error');
            return;
        }

        const form = document.getElementById('analysisForm');
        const formData = new FormData(form);

        const markerColor = formData.get('marker_color');
        const markerSizeStr = formData.get('marker_size_mm');

        if (!markerColor || !markerSizeStr) {
            this.authApp.showToast('Ошибка', 'Заполните все обязательные поля', 'error');
            return;
        }

        const markerSize = parseFloat(markerSizeStr);
        if (isNaN(markerSize) || markerSize <= 0 || markerSize > 100) {
            this.authApp.showToast('Ошибка', 'Размер маркера должен быть от 0.1 до 100 мм', 'error');
            return;
        }

        const colorMap = {
            '#FF0000': 'red',
            '#00FF00': 'green',
            '#0000FF': 'blue'
        };

        const colorString = colorMap[markerColor] || markerColor;

        const analysisData = {
            video_id: parseInt(this.currentVideoId),
            marker_color: colorString,
            marker_size_mm: markerSize
        };

        const startBtn = document.getElementById('startAnalysisBtn');
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
                this.pendingAnalysisId = analysis.id;

                // Закрываем модальное окно
                this.closeAnalysisModal();

                // Показываем сообщение
                this.authApp.showToast('Успешно', 'Анализ начат. Ожидайте результатов...', 'success');

                // Запускаем проверку статуса
                this.startStatusCheck(analysis.id);

            } else {
                const error = await response.json();
                this.authApp.showToast('Ошибка', error.detail || 'Не удалось начать анализ', 'error');
                this.authApp.setLoadingState(startBtn, false);
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение к серверу', 'error');
            this.authApp.setLoadingState(startBtn, false);
        }
    }

    startStatusCheck(analysisId) {
        this.stopStatusCheck();

        // Первая проверка через 3 секунды
        setTimeout(() => {
            this.checkAnalysisStatus(analysisId);
        }, 3000);

        // Дальнейшие проверки каждые 5 секунд
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
            const response = await fetch(`${this.baseURL}/respiratory-analysis/${analysisId}/status`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const statusData = await response.json();

                if (statusData.progress_percent >= 100) {
                    // Анализ завершен
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
            const response = await fetch(`${this.baseURL}/respiratory-analysis/${analysisId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const analysis = await response.json();

                // Уведомление об успешном завершении
                this.authApp.showToast('Анализ завершен', 'Результаты готовы к просмотру', 'success');

                // Обновляем список анализов
                await this.loadAnalyses();

            } else {
                this.authApp.showToast('Ошибка', 'Не удалось загрузить результаты', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение к серверу', 'error');
        }
    }

    async loadAnalyses() {
        if (!this.currentPatientId) return;

        try {
            const response = await fetch(`${this.baseURL}/respiratory-analysis/patient/${this.currentPatientId}/analyses`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const analysesData = await response.json();
                this.analyses = analysesData;
                this.filteredAnalyses = [...this.analyses]; // Копируем для фильтрации

                await this.enrichAnalysesWithVideoTitles();
                this.filterAnalyses(); // Применяем фильтрацию если есть поисковый запрос
            } else if (response.status === 401) {
                this.authApp.showToast('Ошибка', 'Требуется авторизация', 'error');
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
                // Поиск по названию видео
                const videoTitle = analysis.video_title || `Видео #${analysis.video_id}`;
                if (videoTitle.toLowerCase().includes(searchTermLower)) {
                    return true;
                }

                // Поиск по дате
                const date = new Date(analysis.created_at);
                const dateString = date.toLocaleDateString('ru-RU');
                if (dateString.includes(searchTermLower)) {
                    return true;
                }

                // Поиск по статусу
                const statusText = this.getStatusText(analysis.status).toLowerCase();
                if (statusText.includes(searchTermLower)) {
                    return true;
                }

                // Поиск по ID анализа
                if (analysis.id.toString().includes(searchTermLower)) {
                    return true;
                }

                // Поиск по ID видео
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

                // Добавляем обработчик для кнопки очистки поиска
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

            // Подсветка результатов поиска
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
                            <span><i class="fas fa-calendar"></i> ${new Date(analysis.created_at).toLocaleDateString()}</span>
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
        switch(status) {
            case 'processing': return 'Обработка';
            case 'completed': return 'Завершено';
            case 'failed': return 'Ошибка';
            default: return status;
        }
    }

    async viewAnalysis(analysisId) {
        try {
            const response = await fetch(`${this.baseURL}/respiratory-analysis/${analysisId}`, {
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
                this.authApp.showToast('Ошибка', 'Не удалось загрузить анализ', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка', 'Не удалось загрузить анализ', 'error');
        }
    }

    showAnalysisModalWithPlots(analysis, videoTitle) {
        const modal = document.getElementById('analysisResultsModal');
        if (!modal) {
            this.authApp.showToast('Ошибка', 'Модальное окно не найдено', 'error');
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
            this.authApp.showToast('Ошибка', 'Не удалось отобразить результаты', 'error');
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

            // 1. Дата анализа
            const analysisDateResultEl = document.getElementById('analysisDateResult');
            if (analysisDateResultEl && analysis.created_at) {
                const date = new Date(analysis.created_at);
                const formattedDate = date.toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });
                const formattedTime = date.toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                analysisDateResultEl.textContent = `${formattedDate} ${formattedTime}`;
            }

            // 2. Статус анализа
            const analysisStatusResultEl = document.getElementById('analysisStatusResult');
            if (analysisStatusResultEl) {
                const statusText = analysis.status === 'completed' ? 'Завершен' :
                                 analysis.status === 'processing' ? 'В процессе' :
                                 analysis.status === 'failed' ? 'Ошибка' : 'Неизвестно';
                analysisStatusResultEl.textContent = statusText;
            }

            // 3. Цвет маркера
            const markerColorResultEl = document.getElementById('markerColorResult');
            if (markerColorResultEl && analysis.marker_color) {
                markerColorResultEl.textContent = this.formatMarkerColor(analysis.marker_color);
            }

            // 4. Размер маркера
            const markerSizeResultEl = document.getElementById('markerSizeResult');
            if (markerSizeResultEl && analysis.marker_size_mm) {
                markerSizeResultEl.textContent = `${analysis.marker_size_mm} мм`;
            }

            // 5. Время обработки
            const processingTimeResultEl = document.getElementById('processingTimeResult');
            if (processingTimeResultEl && analysis.processing_time_seconds) {
                processingTimeResultEl.textContent = `${analysis.processing_time_seconds.toFixed(1)} сек`;
            }

            // 6. Количество кадров
            const analysisFramesResultEl = document.getElementById('analysisFramesResult');
            if (analysisFramesResultEl && analysis.total_frames) {
                analysisFramesResultEl.textContent = `${analysis.total_frames} кадров`;
            }

            // 7. Основные метрики дыхания
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

            // 8. Медицинская оценка
            const medicalAssessmentContent = document.getElementById('medicalAssessmentContent');
            if (medicalAssessmentContent) {
                if (analysis.medical_assessment && analysis.medical_assessment !== "Оценка загружается...") {
                    medicalAssessmentContent.innerHTML = `<p>${analysis.medical_assessment.replace(/\n/g, '<br>')}</p>`;
                } else if (analysis.text_report) {
                    // Извлекаем общую информацию из текстового отчета
                    const reportLines = analysis.text_report.split('\n');
                    let assessmentText = '';

                    // Ищем раздел "ОБЩАЯ ИНФОРМАЦИЯ"
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
                        // Формируем простую оценку на основе данных
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

    formatMarkerColor(color) {
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

            // Создаем уникальный ID для обработчиков
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

    // ОСНОВНОЙ МЕТОД: Генерация и скачивание PDF отчета
    async generateAndDownloadPDFReport() {
        if (!this.currentAnalysisId || !this.currentPatientId) {
            this.authApp.showToast('Ошибка', 'Анализ не выбран', 'error');
            return;
        }

        const downloadBtn = document.getElementById('downloadAnalysisResultBtn');
        const originalContent = downloadBtn.innerHTML;
        downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Генерация PDF...';
        downloadBtn.disabled = true;

        try {
            // Получаем данные анализа
            const analysisResponse = await fetch(`${this.baseURL}/respiratory-analysis/${this.currentAnalysisId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!analysisResponse.ok) {
                throw new Error('Не удалось получить данные анализа');
            }

            const analysis = await analysisResponse.json();

            // Получаем данные пациента
            let patient = this.patientManager.currentPatient;
            if (!patient) {
                const patientResponse = await fetch(`${this.baseURL}/patients/${this.currentPatientId}`, {
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

            // Собираем графики
            const plots = await this.collectAllAnalysisPlots(analysis);

            // Генерируем PDF
            const pdfGenerator = new PDFReportGenerator();
            await pdfGenerator.generateAnalysisReport(patient, analysis, plots);

            this.authApp.showToast('Успешно', 'PDF отчет создан', 'success');

        } catch (error) {
            console.error('Ошибка при генерации PDF:', error);
            this.authApp.showToast('Ошибка', 'Не удалось создать PDF отчет', 'error');
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

        // Проверяем доступность каждого графика
        for (const plot of plotData) {
            if (plot.url) {
                try {
                    // Проверяем, доступен ли график
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

    // Старая функция для скачивания отдельных графиков
    async downloadAnalysisPlots() {
        if (!this.currentAnalysisId || !this.currentPatientId) {
            this.authApp.showToast('Ошибка', 'Анализ не выбран', 'error');
            return;
        }

        const analysis = this.analyses.find(a => a.id === this.currentAnalysisId);
        if (!analysis) {
            this.authApp.showToast('Ошибка', 'Анализ не найден', 'error');
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
            this.authApp.showToast('Успешно', `Скачано ${downloaded} график(ов)`, 'success');
        }
        if (errors > 0) {
            this.authApp.showToast('Ошибка', `Не удалось скачать ${errors} график(ов)`, 'error');
        }
    }

    // Старая функция для скачивания текстового отчета
    async downloadAnalysisReport() {
        if (!this.currentAnalysisId) {
            this.authApp.showToast('Ошибка', 'Анализ не выбран', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.baseURL}/respiratory-analysis/${this.currentAnalysisId}/report`, {
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
                this.authApp.showToast('Ошибка', error.detail || 'Не удалось скачать отчет', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение к серверу', 'error');
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

        this.authApp.showToast('Успешно', 'Отчет скачивается', 'success');
    }

    deleteAnalysis(analysisId) {
        const analysis = this.analyses.find(a => a.id === parseInt(analysisId));
        if (!analysis) return;

        this.pendingDeleteAnalysisId = analysisId;
        const deleteAnalysisIdEl = document.getElementById('deleteAnalysisId');
        const deleteAnalysisDateEl = document.getElementById('deleteAnalysisDate');

        if (deleteAnalysisIdEl) deleteAnalysisIdEl.textContent = `#${analysis.id}`;
        if (deleteAnalysisDateEl) deleteAnalysisDateEl.textContent = new Date(analysis.created_at).toLocaleDateString();

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
            const response = await fetch(`${this.baseURL}/respiratory-analysis/${analysisId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authApp.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                this.authApp.showToast('Успешно', 'Анализ удален', 'success');
                this.loadAnalyses();
            } else {
                const error = await response.json();
                this.authApp.showToast('Ошибка', error.detail || 'Не удалось удалить анализ', 'error');
            }
        } catch (error) {
            this.authApp.showToast('Ошибка сети', 'Проверьте подключение', 'error');
        } finally {
            this.pendingDeleteAnalysisId = null;
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

        document.querySelectorAll('.auth-card, .profile-card, .patient-card, .video-card, .stat-card, .analysis-card').forEach(card => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            observer.observe(card);
        });
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    const authApp = new AuthApp();

    // Глобальный доступ для отладки
    window.authApp = authApp;

});

// Глобальные функции для обработки ошибок картинок
window.handleModalPlotError = function(imgElement) {
    imgElement.onerror = null;
    imgElement.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDQwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNGMEYwRjAiLz48dGV4dCB4PSIyMDAiIHk9IjEwMCIgZm9udC1mYW1pbHk9IkludGVyIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjQ3NDhCIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+R3JhcGggbm90IGF2YWlsYWJsZTwvdGV4dD48L3N2Zz4=';
    imgElement.classList.remove('loading');
};