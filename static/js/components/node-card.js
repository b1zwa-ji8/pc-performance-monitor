/**
 * NodeCard Component — Melius Node Canvas Card
 * Renders and updates a monitored metric card on the 2D node canvas.
 * Anatomy:
 *  1. Label pair (metric name in text-on-dark + muted subtitle)
 *  2. Status pill tag (Normal / Warning / Critical)
 *  3. Content card (--bg-card-light, large serif value, unit, inline sparkline)
 *  4. Connector dot at anchor point
 */

class NodeCard {
    constructor(options = {}) {
        this.id = options.id || 'metric-node';
        this.title = options.title || 'Metric';
        this.subtitle = options.subtitle || '';
        this.unit = options.unit || '%';
        this.href = options.href || null;
        this.anchor = options.anchor || 'left'; // left or top
        this.history = options.history || [];
        this.maxHistory = options.maxHistory || 20;
        this.status = options.status || 'normal'; // normal, warning, critical
        this.value = options.value !== undefined ? options.value : 0;
        this.minVal = options.minVal !== undefined ? options.minVal : null;
        this.maxVal = options.maxVal !== undefined ? options.maxVal : null;
        this.avgVal = options.avgVal !== undefined ? options.avgVal : null;
        this.customFormattedValue = options.customFormattedValue || null;

        this.element = null;
        this._build();
    }

    _build() {
        const wrap = document.createElement('div');
        wrap.className = 'canvas-node';
        wrap.id = `node-${this.id}`;
        if (this.href) {
            wrap.setAttribute('data-href', this.href);
            wrap.style.cursor = 'pointer';
            wrap.addEventListener('click', (e) => {
                // If not clicking a button or specific inner link, navigate
                if (!e.target.closest('button') && this.href) {
                    window.location.href = this.href;
                }
            });
        }

        wrap.innerHTML = `
            <div class="node-label-pair">
                <span class="node-title">${this.title}</span>
                <span class="node-subtitle" id="sub-${this.id}">${this.subtitle}</span>
            </div>
            <div class="node-pill-tag status-${this.status}" id="pill-${this.id}">
                ${this._statusLabel(this.status)}
            </div>
            <div class="node-card-body">
                <div class="node-anchor-dot anchor-${this.anchor}" id="dot-${this.id}"></div>
                <div class="node-metric-row">
                    <span class="node-number" id="num-${this.id}">${this.customFormattedValue || this.value}</span>
                    <span class="node-unit" id="unit-${this.id}">${this.unit}</span>
                </div>
                <div class="node-sparkline-wrap">
                    <svg class="node-sparkline" id="spark-${this.id}" viewBox="0 0 120 30" preserveAspectRatio="none">
                        <path class="node-sparkline-path" id="sparkpath-${this.id}" d=""></path>
                    </svg>
                </div>
                <div class="node-tooltip" id="tooltip-${this.id}">
                    <div class="tooltip-item"><span>Min</span><strong id="min-${this.id}">${this.minVal !== null ? this.minVal + this.unit : '—'}</strong></div>
                    <div class="tooltip-item"><span>Avg</span><strong id="avg-${this.id}">${this.avgVal !== null ? this.avgVal + this.unit : '—'}</strong></div>
                    <div class="tooltip-item"><span>Max</span><strong id="max-${this.id}">${this.maxVal !== null ? this.maxVal + this.unit : '—'}</strong></div>
                </div>
            </div>
        `;

        this.element = wrap;
        this._updateSparkline();
    }

    _statusLabel(s) {
        if (s === 'critical') return 'Critical';
        if (s === 'warning') return 'Warning';
        return 'Normal';
    }

    update(val, options = {}) {
        this.value = val;
        if (options.formatted !== undefined) this.customFormattedValue = options.formatted;
        if (options.subtitle !== undefined) this.subtitle = options.subtitle;
        if (options.status !== undefined) this.status = options.status;
        if (options.unit !== undefined) this.unit = options.unit;

        // Push to history
        const num = typeof val === 'number' ? val : parseFloat(val) || 0;
        this.history.push(num);
        if (this.history.length > this.maxHistory) this.history.shift();

        // Calculate min, max, avg
        if (this.history.length > 0) {
            const sum = this.history.reduce((a, b) => a + b, 0);
            this.avgVal = Math.round(sum / this.history.length);
            this.minVal = Math.min(...this.history);
            this.maxVal = Math.max(...this.history);
        }

        // DOM updates
        const numEl = document.getElementById(`num-${this.id}`);
        if (numEl) numEl.textContent = this.customFormattedValue || this.value;

        const subEl = document.getElementById(`sub-${this.id}`);
        if (subEl && this.subtitle) subEl.textContent = this.subtitle;

        const unitEl = document.getElementById(`unit-${this.id}`);
        if (unitEl) unitEl.textContent = this.unit;

        const pillEl = document.getElementById(`pill-${this.id}`);
        if (pillEl) {
            pillEl.className = `node-pill-tag status-${this.status}`;
            pillEl.textContent = this._statusLabel(this.status);
        }

        // Tooltip stats
        const minEl = document.getElementById(`min-${this.id}`);
        if (minEl && this.minVal !== null) minEl.textContent = this.minVal + (this.unit ? ` ${this.unit}` : '');
        const avgEl = document.getElementById(`avg-${this.id}`);
        if (avgEl && this.avgVal !== null) avgEl.textContent = this.avgVal + (this.unit ? ` ${this.unit}` : '');
        const maxEl = document.getElementById(`max-${this.id}`);
        if (maxEl && this.maxVal !== null) maxEl.textContent = this.maxVal + (this.unit ? ` ${this.unit}` : '');

        this._updateSparkline();
    }

    _updateSparkline() {
        const path = document.getElementById(`sparkpath-${this.id}`);
        if (!path || this.history.length < 2) return;

        const w = 120;
        const h = 30;
        const min = Math.min(0, ...this.history);
        const max = Math.max(100, ...this.history);
        const range = max - min || 1;

        const step = w / (this.history.length - 1);
        let d = '';
        this.history.forEach((val, i) => {
            const x = (i * step).toFixed(1);
            const y = (h - ((val - min) / range) * (h - 6) - 3).toFixed(1);
            if (i === 0) d += `M ${x} ${y}`;
            else d += ` L ${x} ${y}`;
        });

        path.setAttribute('d', d);
        path.setAttribute('stroke', this.status === 'critical' ? 'var(--status-critical)' :
                                   this.status === 'warning' ? 'var(--status-warning)' : 'var(--accent-primary)');
    }

    getAnchorPoint() {
        const dot = document.getElementById(`dot-${this.id}`) || this.element.querySelector('.node-anchor-dot');
        if (!dot) return null;
        const rect = dot.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }
}

window.NodeCard = NodeCard;
