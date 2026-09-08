/**
 * SVG Charts — Lightweight, Zero-Canvas Vector Visualizations
 * High-DPI crisp rendering for Area Charts, Multi-Line Charts, and Doughnuts.
 */

(function (global) {
    'use strict';

    // Helper to compute smooth SVG cubic bezier path through points
    function getBezierPath(points) {
        if (!points || points.length === 0) return '';
        if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

        let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(points.length - 1, i + 2)];

            // Catmull-Rom to Cubic Bezier conversion
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
        }
        return d;
    }

    class SvgAreaChart {
        constructor(container, options = {}) {
            this.container = typeof container === 'string' ? document.getElementById(container) : container;
            this.options = Object.assign({
                color: 'var(--accent-primary, #4E88FF)',
                fillColor: 'rgba(78, 136, 255, 0.12)',
                min: 0,
                max: 100,
                unit: '%',
                gridTicks: 4,
                showArea: true
            }, options);

            this.labels = [];
            this.data = [];
            this._init();
        }

        _init() {
            if (!this.container) return;
            this.container.classList.add('svg-chart-container');
            this.container.style.position = 'relative';
            this.container.style.width = '100%';
            this.container.style.height = '100%';
            this.container.style.minHeight = '180px';

            const gradId = 'areaGrad_' + Math.random().toString(36).substr(2, 9);
            this.gradId = gradId;

            this.container.innerHTML = `
                <svg class="svg-chart-element" viewBox="0 0 800 240" preserveAspectRatio="none" style="width: 100%; height: 100%; overflow: visible; display: block;">
                    <defs>
                        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="${this.options.color}" stop-opacity="0.28" />
                            <stop offset="90%" stop-color="${this.options.color}" stop-opacity="0.01" />
                        </linearGradient>
                    </defs>
                    <g class="chart-grid-layer"></g>
                    <path class="chart-area-path" fill="url(#${gradId})" d=""></path>
                    <path class="chart-line-path" fill="none" stroke="${this.options.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d=""></path>
                    <g class="chart-points-layer"></g>
                </svg>
                <div class="chart-x-labels" style="display: flex; justify-content: space-between; padding-top: 8px; font-size: 0.72rem; color: var(--text-on-dark-muted, #9a9a9e); font-family: var(--font-mono, monospace);"></div>
            `;

            this.svg = this.container.querySelector('svg');
            this.gridLayer = this.container.querySelector('.chart-grid-layer');
            this.areaPath = this.container.querySelector('.chart-area-path');
            this.linePath = this.container.querySelector('.chart-line-path');
            this.xLabelsEl = this.container.querySelector('.chart-x-labels');

            this._drawGrid();
        }

        _drawGrid() {
            if (!this.gridLayer) return;
            const w = 800;
            const h = 220;
            const padTop = 15;
            const ticks = this.options.gridTicks;
            let lines = '';

            for (let i = 0; i <= ticks; i++) {
                const y = padTop + (h - padTop) * (i / ticks);
                const val = Math.round(this.options.max - (i / ticks) * (this.options.max - this.options.min));
                lines += `
                    <line x1="0" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="3,3" />
                    <text x="6" y="${(y - 4).toFixed(1)}" fill="rgba(255,255,255,0.25)" font-size="10" font-family="monospace">${val}${this.options.unit}</text>
                `;
            }
            this.gridLayer.innerHTML = lines;
        }

        update(labels, data) {
            this.labels = labels || [];
            this.data = data || [];
            this.render();
        }

        render() {
            if (!this.svg || !this.data || this.data.length === 0) return;

            const w = 800;
            const h = 220;
            const padTop = 15;
            const n = this.data.length;

            let minVal = this.options.min;
            let maxVal = this.options.max;
            if (this.options.max === 'auto') {
                maxVal = Math.max(...this.data, 10);
                maxVal = Math.ceil(maxVal * 1.15);
            }

            const range = Math.max(1, maxVal - minVal);
            const stepX = n > 1 ? w / (n - 1) : w;

            const points = this.data.map((val, i) => {
                const clamped = Math.max(minVal, Math.min(maxVal, val));
                const norm = (clamped - minVal) / range;
                const x = i * stepX;
                const y = h - norm * (h - padTop);
                return { x, y };
            });

            const curveD = getBezierPath(points);
            this.linePath.setAttribute('d', curveD);

            if (this.options.showArea && points.length > 0) {
                const areaD = `${curveD} L ${points[points.length - 1].x.toFixed(1)} ${h} L ${points[0].x.toFixed(1)} ${h} Z`;
                this.areaPath.setAttribute('d', areaD);
            }

            // X-axis ticks (sample up to 6 labels)
            if (this.xLabelsEl && this.labels.length > 0) {
                const labelCount = Math.min(6, this.labels.length);
                const step = Math.floor(this.labels.length / Math.max(1, labelCount - 1)) || 1;
                let html = '';
                for (let i = 0; i < this.labels.length; i += step) {
                    html += `<span>${this.labels[i]}</span>`;
                }
                // Ensure last label is shown
                if (this.labels.length > 1 && !html.includes(this.labels[this.labels.length - 1])) {
                    html += `<span>${this.labels[this.labels.length - 1]}</span>`;
                }
                this.xLabelsEl.innerHTML = html;
            }
        }
    }

    class SvgMultiLineChart {
        constructor(container, options = {}) {
            this.container = typeof container === 'string' ? document.getElementById(container) : container;
            this.options = Object.assign({
                datasets: [], // [{ label: 'Read', color: '#34c77b' }, { label: 'Write', color: '#e8442c' }]
                min: 0,
                max: 'auto',
                unit: 'MB/s',
                gridTicks: 4
            }, options);

            this.labels = [];
            this.dataSets = [];
            this._init();
        }

        _init() {
            if (!this.container) return;
            this.container.classList.add('svg-chart-container');
            this.container.style.position = 'relative';
            this.container.style.width = '100%';
            this.container.style.height = '100%';
            this.container.style.minHeight = '180px';

            this.container.innerHTML = `
                <svg class="svg-chart-element" viewBox="0 0 800 240" preserveAspectRatio="none" style="width: 100%; height: 100%; overflow: visible; display: block;">
                    <g class="chart-grid-layer"></g>
                    <g class="chart-lines-layer"></g>
                </svg>
                <div class="chart-x-labels" style="display: flex; justify-content: space-between; padding-top: 8px; font-size: 0.72rem; color: var(--text-on-dark-muted, #9a9a9e); font-family: var(--font-mono, monospace);"></div>
            `;

            this.svg = this.container.querySelector('svg');
            this.gridLayer = this.container.querySelector('.chart-grid-layer');
            this.linesLayer = this.container.querySelector('.chart-lines-layer');
            this.xLabelsEl = this.container.querySelector('.chart-x-labels');
        }

        update(labels, datasetsData) {
            this.labels = labels || [];
            this.dataSets = datasetsData || [];
            this.render();
        }

        render() {
            if (!this.svg || !this.dataSets || this.dataSets.length === 0) return;

            const w = 800;
            const h = 220;
            const padTop = 15;

            // Find global max
            let allVals = [];
            this.dataSets.forEach(ds => {
                allVals = allVals.concat(ds.data || []);
            });
            let maxVal = Math.max(10, ...allVals);
            maxVal = Math.ceil(maxVal * 1.2);
            const minVal = 0;
            const range = Math.max(1, maxVal - minVal);

            // Redraw grid with current max
            let gridHtml = '';
            const ticks = this.options.gridTicks;
            for (let i = 0; i <= ticks; i++) {
                const y = padTop + (h - padTop) * (i / ticks);
                const val = Math.round(maxVal - (i / ticks) * (maxVal - minVal));
                gridHtml += `
                    <line x1="0" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="3,3" />
                    <text x="6" y="${(y - 4).toFixed(1)}" fill="rgba(255,255,255,0.25)" font-size="10" font-family="monospace">${val} ${this.options.unit}</text>
                `;
            }
            this.gridLayer.innerHTML = gridHtml;

            // Draw each dataset line
            let linesHtml = '';
            this.dataSets.forEach(ds => {
                const data = ds.data || [];
                const color = ds.color || 'var(--accent-primary)';
                const n = data.length;
                if (n === 0) return;

                const stepX = n > 1 ? w / (n - 1) : w;
                const points = data.map((val, i) => {
                    const norm = Math.max(0, val - minVal) / range;
                    const x = i * stepX;
                    const y = h - norm * (h - padTop);
                    return { x, y };
                });

                const d = getBezierPath(points);
                linesHtml += `<path fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="${d}" />`;
            });
            this.linesLayer.innerHTML = linesHtml;

            if (this.xLabelsEl && this.labels.length > 0) {
                const labelCount = Math.min(6, this.labels.length);
                const step = Math.floor(this.labels.length / Math.max(1, labelCount - 1)) || 1;
                let html = '';
                for (let i = 0; i < this.labels.length; i += step) {
                    html += `<span>${this.labels[i]}</span>`;
                }
                this.xLabelsEl.innerHTML = html;
            }
        }
    }

    class SvgDoughnutChart {
        constructor(container, options = {}) {
            this.container = typeof container === 'string' ? document.getElementById(container) : container;
            this.options = Object.assign({
                radius: 75,
                strokeWidth: 22,
                size: 200,
                colors: ['#e8442c', '#34c77b', '#f5d949'],
                labels: ['Used', 'Free', 'Swap']
            }, options);

            this.data = [0, 100, 0];
            this._init();
        }

        _init() {
            if (!this.container) return;
            this.container.classList.add('svg-doughnut-container');
            this.container.style.display = 'flex';
            this.container.style.flexDirection = 'column';
            this.container.style.alignItems = 'center';
            this.container.style.justifyContent = 'center';

            const size = this.options.size;
            const r = this.options.radius;
            const sw = this.options.strokeWidth;
            const c = size / 2;
            const circ = 2 * Math.PI * r;
            this.circ = circ;

            this.container.innerHTML = `
                <div style="position: relative; width: ${size}px; height: ${size}px;">
                    <svg viewBox="0 0 ${size} ${size}" style="width: 100%; height: 100%; transform: rotate(-90deg);">
                        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="${sw}" />
                        <g class="doughnut-segments"></g>
                    </svg>
                    <div class="doughnut-center-content" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: none;">
                        <span class="doughnut-center-val" style="font-size: 1.6rem; font-weight: 700; font-family: var(--font-sans, sans-serif); color: var(--text-on-dark, #fff);">0%</span>
                        <span class="doughnut-center-sub" style="font-size: 0.75rem; color: var(--text-on-dark-muted, #9a9a9e); text-transform: uppercase; letter-spacing: 0.06em;">Used</span>
                    </div>
                </div>
                <div class="doughnut-legend" style="display: flex; gap: 16px; margin-top: 16px; flex-wrap: wrap; justify-content: center; font-size: 0.78rem; color: var(--text-on-dark-muted, #9a9a9e);"></div>
            `;

            this.segmentsGroup = this.container.querySelector('.doughnut-segments');
            this.centerValEl = this.container.querySelector('.doughnut-center-val');
            this.centerSubEl = this.container.querySelector('.doughnut-center-sub');
            this.legendEl = this.container.querySelector('.doughnut-legend');
        }

        update(data, labels, colors, centerText) {
            this.data = data || this.data;
            if (labels) this.options.labels = labels;
            if (colors) this.options.colors = colors;
            this.render(centerText);
        }

        render(centerText) {
            if (!this.segmentsGroup) return;

            const size = this.options.size;
            const r = this.options.radius;
            const sw = this.options.strokeWidth;
            const c = size / 2;
            const circ = this.circ;

            const total = this.data.reduce((a, b) => a + Number(b), 0) || 1;
            let accumulated = 0;
            let segHtml = '';

            this.data.forEach((val, i) => {
                const fraction = Math.max(0, Number(val)) / total;
                const dash = fraction * circ;
                const offset = -accumulated * circ;
                const color = this.options.colors[i % this.options.colors.length];

                segHtml += `
                    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
                        stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}"
                        stroke-dashoffset="${offset.toFixed(2)}"
                        style="transition: stroke-dasharray 0.4s ease, stroke-dashoffset 0.4s ease;" />
                `;
                accumulated += fraction;
            });

            this.segmentsGroup.innerHTML = segHtml;

            // Center value
            if (centerText) {
                this.centerValEl.textContent = centerText.val || `${Math.round((this.data[0] / total) * 100)}%`;
                if (centerText.sub) this.centerSubEl.textContent = centerText.sub;
            } else {
                this.centerValEl.textContent = `${Math.round((this.data[0] / total) * 100)}%`;
            }

            // Legend
            if (this.legendEl && this.options.labels) {
                this.legendEl.innerHTML = this.options.labels.map((lbl, i) => {
                    const color = this.options.colors[i % this.options.colors.length];
                    const val = this.data[i] !== undefined ? `${this.data[i]}` : '';
                    return `
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; display: inline-block;"></span>
                            <span>${lbl}: <strong style="color: var(--text-on-dark, #fff);">${val}</strong></span>
                        </div>
                    `;
                }).join('');
            }
        }
    }

    global.SvgAreaChart = SvgAreaChart;
    global.SvgMultiLineChart = SvgMultiLineChart;
    global.SvgDoughnutChart = SvgDoughnutChart;

})(window);
