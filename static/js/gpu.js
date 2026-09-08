/**
 * GPU Detail Page Controller — Melius Reference Design System
 * Split-screen ambient wave, sub-nodes, bezier connectors, VRAM doughnut, and history.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    let gpuHistChart = null;
    let gpuDoughnutChart = null;
    let historyRange = '1h';
    const connectors = new ConnectorManager('canvasConnectorsSvg');
    const hub = document.getElementById('gpuHubNode');

    if (window.Dashboard) {
        window.Dashboard.init('gpu');
        window.Dashboard.setActiveMetricTab('gpu');
    }

    // Build Sub-Nodes
    const specsGrid = document.getElementById('gpuSpecsGrid');
    const loadNode = new NodeCard({ id: 'gpu-load', title: 'Compute Load', subtitle: '3D / Compute Engine', unit: '%', value: '—' });
    const tempNode = new NodeCard({ id: 'gpu-temp', title: 'Temperature', subtitle: 'Thermal Package', unit: '°C', value: '—' });
    const vramUsedNode = new NodeCard({ id: 'gpu-vram-used', title: 'VRAM Used', subtitle: 'Frame Buffer', unit: 'GB', value: '—' });
    const vramTotalNode = new NodeCard({ id: 'gpu-vram-total', title: 'VRAM Total', subtitle: 'Installed Video RAM', unit: 'GB', value: '—' });

    if (specsGrid) {
        specsGrid.appendChild(loadNode.element);
        specsGrid.appendChild(tempNode.element);
        specsGrid.appendChild(vramUsedNode.element);
        specsGrid.appendChild(vramTotalNode.element);
    }

    setTimeout(() => {
        if (hub) {
            connectors.connect('gpu-load', hub, document.getElementById('dot-gpu-load'), { status: 'normal' });
            connectors.connect('gpu-temp', hub, document.getElementById('dot-gpu-temp'), { status: 'normal' });
            connectors.connect('gpu-vram-used', hub, document.getElementById('dot-gpu-vram-used'), { status: 'normal' });
            connectors.connect('gpu-vram-total', hub, document.getElementById('dot-gpu-vram-total'), { status: 'normal' });
        }
    }, 120);

    async function fetchGpuTelemetry() {
        try {
            const resp = await fetch('/api/gpu');
            const json = await resp.json();
            if (!json.success || !json.data) return;
            const d = json.data;

            const nameEl = document.getElementById('gpuName');
            const loadHero = document.getElementById('gpuLoadHero');
            const summaryEl = document.getElementById('gpuSummaryText');
            const banner = document.getElementById('gpuUnavailableBanner');

            if (!d.available) {
                if (banner) banner.style.display = 'block';
                if (nameEl) nameEl.textContent = 'Hardware Telemetry Unavailable';
                if (loadHero) loadHero.textContent = '—';
                if (summaryEl) summaryEl.textContent = 'GPU hardware telemetry backend did not return readings.';
                loadNode.update('—', { status: 'normal' });
                tempNode.update('—', { status: 'normal' });
                vramUsedNode.update('—');
                vramTotalNode.update('—');
                return;
            }

            if (banner) banner.style.display = 'none';
            if (nameEl && d.name) nameEl.textContent = d.name;

            // Compute load handling (never fabricate 0 when null)
            const hasLoad = (d.load !== null && d.load !== undefined);
            const loadVal = hasLoad ? Math.round(d.load) : null;
            if (loadHero) loadHero.textContent = hasLoad ? loadVal : '—';

            // Temperature handling (never fabricate 0 when null)
            const hasTemp = (d.temperature !== null && d.temperature !== undefined);
            const tempVal = hasTemp ? Math.round(d.temperature) : null;

            if (summaryEl) {
                const loadText = hasLoad ? `${loadVal}% load` : 'Load unavailable';
                const tempText = hasTemp ? `${tempVal}°C` : 'Thermals unavailable';
                const vramText = (d.memory_used !== null && d.memory_used !== undefined) ? `${d.memory_used.toFixed(1)} GB VRAM` : 'VRAM unavailable';
                summaryEl.textContent = `${d.name || 'GPU'} active — ${loadText} (${tempText}, ${vramText}). Backend: ${d.backend || 'hardware'}`;
            }

            const loadStatus = hasLoad ? getStatusClass(loadVal, { warning: 80, critical: 90 }) : 'normal';
            const tempStatus = hasTemp ? getStatusClass(tempVal, { warning: 80, critical: 88 }) : 'normal';

            loadNode.update(hasLoad ? loadVal : 'Unavailable', { status: loadStatus });
            tempNode.update(hasTemp ? tempVal : 'Unavailable', { status: tempStatus });

            const vramUsed = (d.memory_used !== null && d.memory_used !== undefined) ? d.memory_used.toFixed(1) : '—';
            const vramTotal = (d.memory_total !== null && d.memory_total !== undefined) ? d.memory_total.toFixed(1) : '—';
            vramUsedNode.update(vramUsed);
            vramTotalNode.update(vramTotal);

            connectors.setConnectionState('gpu-load', { status: loadStatus });
            connectors.setConnectionState('gpu-temp', { status: tempStatus });

            if (d.memory_total && d.memory_used !== null && d.memory_used !== undefined) {
                updateDoughnut(d.memory_used, Math.max(0, d.memory_total - d.memory_used));
            }

        } catch (e) { /* retry */ }
    }

    function initDoughnut() {
        const el = document.getElementById('gpuDoughnut');
        if (!el || typeof SvgDoughnutChart === 'undefined') return;

        gpuDoughnutChart = new SvgDoughnutChart(el, {
            size: 220,
            radius: 72,
            strokeWidth: 20,
            labels: ['VRAM Used', 'VRAM Free'],
            colors: ['var(--accent-primary, #4E88FF)', 'var(--status-normal, #68D391)']
        });
    }

    function updateDoughnut(used, free) {
        if (!gpuDoughnutChart) return;
        const total = (Number(used) + Number(free)) || 1;
        const pct = Math.round((Number(used) / total) * 100);
        gpuDoughnutChart.update([used, free], ['VRAM Used', 'VRAM Free'], null, { val: `${pct}%`, sub: 'VRAM Used' });
    }

    function initHistoryChart() {
        const el = document.getElementById('gpuHistoryChart');
        if (!el || typeof SvgAreaChart === 'undefined') return;

        gpuHistChart = new SvgAreaChart(el, {
            color: 'var(--accent-primary, #4E88FF)',
            min: 0,
            max: 100,
            unit: '%'
        });
    }

    async function fetchGpuHistory() {
        try {
            const resp = await fetch(`/api/history/gpu?range=${historyRange}`);
            const json = await resp.json();
            if (!json.success) return;

            const stats = json.stats || {};
            const avgEl = document.getElementById('gpuAvg');
            const minEl = document.getElementById('gpuMin');
            const maxEl = document.getElementById('gpuMax');

            if (avgEl) avgEl.textContent = stats.avg !== null && stats.avg !== undefined ? `${stats.avg.toFixed(1)}%` : '—';
            if (minEl) minEl.textContent = stats.min !== null && stats.min !== undefined ? `${stats.min.toFixed(1)}%` : '—';
            if (maxEl) maxEl.textContent = stats.max !== null && stats.max !== undefined ? `${stats.max.toFixed(1)}%` : '—';

            if (gpuHistChart && json.data) {
                const labels = json.data.map(d => new Date(d.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                const values = json.data.map(d => (d.load_percent !== null && d.load_percent !== undefined) ? d.load_percent : 0);

                gpuHistChart.update(labels, values);
            }
        } catch (e) { /* retry */ }
    }

    document.querySelectorAll('#gpuHistoryTabs .editorial-pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#gpuHistoryTabs .editorial-pill-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            historyRange = e.currentTarget.getAttribute('data-range');
            fetchGpuHistory();
        });
    });

    initDoughnut();
    initHistoryChart();
    fetchGpuTelemetry();
    fetchGpuHistory();
    setInterval(fetchGpuTelemetry, 2000);
});
