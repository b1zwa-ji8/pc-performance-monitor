/**
 * Toggle Component — Melius Pill Track Switch
 * Pill track with white circular sliding thumb, colored with --accent-primary when checked.
 */

class PillToggle {
    /**
     * @param {Object} options
     * @param {string} options.containerId
     * @param {string} options.labelLeft
     * @param {string} options.labelRight
     * @param {boolean} options.checked
     * @param {Function} options.onChange
     */
    constructor(options = {}) {
        this.container = document.getElementById(options.containerId);
        this.labelLeft = options.labelLeft || '';
        this.labelRight = options.labelRight || '';
        this.checked = options.checked || false;
        this.onChange = options.onChange || (() => {});
        this._render();
    }

    _render() {
        if (!this.container) return;

        this.container.className = 'pill-toggle-wrapper';
        this.container.innerHTML = `
            ${this.labelLeft ? `<span class="toggle-label ${!this.checked ? 'active' : ''}">${this.labelLeft}</span>` : ''}
            <button class="pill-toggle-switch ${this.checked ? 'checked' : ''}" role="switch" aria-checked="${this.checked}">
                <span class="pill-toggle-thumb"></span>
            </button>
            ${this.labelRight ? `<span class="toggle-label ${this.checked ? 'active' : ''}">${this.labelRight}</span>` : ''}
        `;

        this.btn = this.container.querySelector('.pill-toggle-switch');
        this.labels = this.container.querySelectorAll('.toggle-label');

        this.btn.addEventListener('click', () => {
            this.checked = !this.checked;
            this.btn.classList.toggle('checked', this.checked);
            this.btn.setAttribute('aria-checked', this.checked);
            if (this.labels.length === 2) {
                this.labels[0].classList.toggle('active', !this.checked);
                this.labels[1].classList.toggle('active', this.checked);
            }
            this.onChange(this.checked);
        });
    }

    setChecked(val) {
        this.checked = !!val;
        if (this.btn) {
            this.btn.classList.toggle('checked', this.checked);
            this.btn.setAttribute('aria-checked', this.checked);
            if (this.labels.length === 2) {
                this.labels[0].classList.toggle('active', !this.checked);
                this.labels[1].classList.toggle('active', this.checked);
            }
        }
    }
}

window.PillToggle = PillToggle;
