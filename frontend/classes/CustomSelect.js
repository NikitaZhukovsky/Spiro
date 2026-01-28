export class CustomSelect {
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
        this.updateSelected();

        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        this.options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectOption(option);
            });
        });

        this.targetSelect.addEventListener('change', () => this.updateSelected());

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

        if (icon) {
            this.selected.innerHTML = `${icon.outerHTML} ${text}`;
        } else {
            this.selected.textContent = text;
        }

        this.options.forEach(opt => {
            opt.classList.remove('selected');
        });
        option.classList.add('selected');

        this.targetSelect.value = value;

        const changeEvent = new Event('change', { bubbles: true });
        const inputEvent = new Event('input', { bubbles: true });

        this.targetSelect.dispatchEvent(changeEvent);
        this.targetSelect.dispatchEvent(inputEvent);

        this.close();
    }

    updateSelected() {
        const selectedValue = this.targetSelect.value;
        const selectedOption = Array.from(this.targetSelect.options).find(option => option.value === selectedValue);

        if (selectedOption) {
            const selectedText = selectedOption.textContent;
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