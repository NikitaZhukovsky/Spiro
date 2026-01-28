import { APP_CONFIG, PDF_SETTINGS } from '../utils/constants.js';
import { DataFormatter } from '../utils/formatters.js';

export class PDFReportGenerator {
    constructor() {
        this.init();
    }

    init() {
        if (typeof jspdf === 'undefined') {
            console.error('jsPDF не загружен');
            throw new Error('jsPDF не загружен');
        }

        const { jsPDF } = window.jspdf;

        this.doc = new jsPDF(APP_CONFIG.PDF_CONFIG);
        this.margin = PDF_SETTINGS.MARGIN;
        this.pageWidth = PDF_SETTINGS.PAGE_WIDTH;
        this.pageHeight = PDF_SETTINGS.PAGE_HEIGHT;
        this.currentY = this.margin;

        this.setupFonts();
    }

    setupFonts() {
        try {
            const availableFonts = ['helvetica', 'times', 'courier'];

            for (const font of availableFonts) {
                try {
                    this.doc.setFont(font);
                    this.doc.setFontSize(10);
                    this.doc.text('Тест', 10, 10);
                    this.doc.deletePage(1);
                    console.log(`Используется шрифт: ${font}`);
                    break;
                } catch (e) {
                    continue;
                }
            }

            if (!this.doc.internal.pages.length) {
                this.doc.addPage();
            }
        } catch (error) {
            console.warn('Ошибка настройки шрифтов:', error);
            this.doc.setFont("helvetica");
            this.doc.setFontSize(10);
        }
    }

    encodeText(text) {
        if (!text) return '—';

        return String(text)
            .replace(/[^\x00-\x7F]/g, '')
            .replace(/—/g, '-')
            .replace(/«|»/g, '"')
            .replace(/ё/g, 'е')
            .replace(/Ё/g, 'Е');
    }

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
        this.doc.setFillColor(...APP_CONFIG.COLORS.PRIMARY);
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
            ['Пол:', DataFormatter.formatGender(patient.gender), 'Время:', analysis.processing_time_seconds ? `${this.safeString(analysis.processing_time_seconds.toFixed(1))} сек` : '—'],
            ['Рост:', patient.height ? `${this.safeString(patient.height)} см` : '—', 'Кадры:', this.safeString(analysis.total_frames)],
            ['Вес:', patient.weight ? `${this.safeString(patient.weight)} кг` : '—', 'Маркер:', `${DataFormatter.formatMarkerColor(analysis.marker_color)} ${analysis.marker_size_mm ? `${this.safeString(analysis.marker_size_mm)} мм` : ''}`],
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
                color: APP_CONFIG.COLORS.PRIMARY
            },
            {
                title: 'Амплитуда',
                value: amplitude,
                description: 'Амплитуда движений',
                color: APP_CONFIG.COLORS.SUCCESS
            },
            {
                title: 'Синхронизация',
                value: synchronization,
                description: 'Синхронность дыхания',
                color: APP_CONFIG.COLORS.PURPLE
            }
        ];

        let x = this.margin;
        let y = this.currentY;
        const colWidth = PDF_SETTINGS.COLUMN_WIDTH;
        const rowHeight = PDF_SETTINGS.ROW_HEIGHT;

        this.doc.setFontSize(12);
        this.doc.setFont("helvetica", "bold");
        this.doc.text('ОСНОВНЫЕ ПОКАЗАТЕЛИ', x, y);
        y += 8;

        metrics.forEach((metric, index) => {
            const colX = x + (index * colWidth);

            this.doc.setFillColor(...metric.color, 0.1);
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
        const imgWidth = PDF_SETTINGS.PLOT_IMAGE_WIDTH;
        const imgHeight = PDF_SETTINGS.PLOT_IMAGE_HEIGHT;

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

    getStatusText(status) {
        const statusMap = {
            'processing': 'Обработка',
            'completed': 'Завершено',
            'failed': 'Ошибка'
        };
        return statusMap[status] || this.safeString(status);
    }
}