/**
 * CPU Detail Page Controller — Melius Reference Design System
 * Split-screen ambient visualization, sub-nodes, per-core breakdown, and history.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    let cpuHistChart = null;
    let historyRange = '1h';
    const connectors = new ConnectorManager('canvasConnectorsSvg');
    const hub = document.getElementById('cpuHubNode');

    // 1. Initialize ambient visualizer for CPU
    if (window.Dashboard) {
        window.Dashboard.init('cpu');
        window.Dashboard.setActiveMetricTab('cpu');
    }

    // 2. Build Sub-nodes
    const specsGrid = document.getElementById('cpuSpecsGrid');
    const coresGrid = document.getElementById('coresGrid');

    const freqNode = new NodeCard({ id: 'cpu-freq', title: 'Frequency', subtitle: 'Clock Speed', unit: 'MHz', value: 0 });
    const physicalNode = new NodeCard({ id: 'cpu-phys', title: 'Physical Cores', subtitle: 'Hardware Cores', unit: '', value: 0 });
    const threadsNode = new NodeCard({ id: 'cpu-threads', title: 'Threads', subtitle: 'Logical Execution', unit: '', value: 0 });

    if (specsGrid) {
        specsGrid.appendChild(freqNode.element);
        specsGrid.appendChild(physicalNode.element);
        specsGrid.appendChild(threadsNode.element);
    }

    setTimeout(() => {
        if (hub) {
            connectors.connect('cpu-freq', hub, document.getElementById('dot-cpu-freq'), { status: 'normal' });
            connectors.connect('cpu-phys', hub, document.getElementById('dot-cpu-phys'), { status: 'normal' });
            connectors.connect('cpu-threads', hub, document.getElementById('dot-cpu-threads'), { status: 'normal' });
        }
    }, 120);

    // 3. Per-core nodes storage
    const coreNodes = [];

    async function fetchCpuTelemetry() {
        try {
            const resp = await fetch('/api/cpu');
            const json = await resp.json();
            if (!json.success || !json.data) return;
            const d = json.data;

            // Hero panel values
            const cpuVal = Math.round(d.percent || 0);
            const usageEl = document.getElementById('cpuUsage');
            const nameEl = document.getElementById('cpuName');
            const summaryEl = document.getElementById('cpuSummaryText');
            const freqSpecEl = document.getElementById('cpuFreqSpec');

            if (usageEl) usageEl.textContent = cpuVal;
            if (nameEl && d.name) nameEl.textContent = d.name;
            if (freqSpecEl) freqSpecEl.textContent = `Operating at ${Math.round(d.frequency || 0)} MHz`;
            if (summaryEl) {
                summaryEl.textContent = `CPU running at ${cpuVal}% with ${d.cores || 8} cores and ${d.threads || 16} threads.`;
            }

            // Sub-nodes
            freqNode.update(Math.round(d.frequency || 0));
            physicalNode.update(d.cores || 0);
            threadsNode.update(d.threads || 0);

            // Per-core nodes
            const perCore = d.per_core || [];
            if (coresGrid) {
                const countLabel = document.getElementById('coreCountLabel');
                if (countLabel) countLabel.textContent = `${perCore.length} Cores Active`;

                // If core nodes not yet created
                if (coreNodes.length === 0) {
                    coresGrid.innerHTML = '';
                    perCore.forEach((cVal, i) => {
                        const cNode = new NodeCard({
                            id: `core-${i}`,
                            title: `Core ${i}`,
                            subtitle: 'Logical Core',
                            unit: '%',
                            value: Math.round(cVal)
                        });
                        coreNodes.push(cNode);
                        coresGrid.appendChild(cNode.element);
                    });
                } else {
                    perCore.forEach((cVal, i) => {
                        if (coreNodes[i]) {
                            const p = Math.round(cVal);
                            const st = getStatusClass(p, { warning: 80, critical: 90 });
                            coreNodes[i].update(p, { status: st });
                        }
                    });
                }
            }

        } catch (e) { /* retry */ }
    }

    // 4. Historical Chart
    function initHistoryChart() {
        const el = document.getElementById('cpuHistoryChart');
        if (!el || typeof SvgAreaChart === 'undefined') return;

        cpuHistChart = new SvgAreaChart(el, {
            color: 'var(--accent-primary, #4E88FF)',
            min: 0,
            max: 100,
            unit: '%'
        });
    }

    async function fetchCpuHistory() {
        try {
            const resp = await fetch(`/api/history/cpu?range=${historyRange}`);
            const json = await resp.json();
            if (!json.success) return;

            const stats = json.stats || {};
            const avgEl = document.getElementById('cpuAvg');
            const minEl = document.getElementById('cpuMin');
            const maxEl = document.getElementById('cpuMax');

            if (avgEl) avgEl.textContent = stats.avg !== null ? `${stats.avg.toFixed(1)}%` : '—';
            if (minEl) minEl.textContent = stats.min !== null ? `${stats.min.toFixed(1)}%` : '—';
            if (maxEl) maxEl.textContent = stats.max !== null ? `${stats.max.toFixed(1)}%` : '—';

            if (cpuHistChart && json.data) {
                const labels = json.data.map(d => new Date(d.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                const values = json.data.map(d => d.usage_percent || 0);

                cpuHistChart.update(labels, values);
            }
        } catch (e) { /* retry */ }
    }

    // Tab buttons for history
    document.querySelectorAll('#cpuHistoryTabs .editorial-pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#cpuHistoryTabs .editorial-pill-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            historyRange = e.currentTarget.getAttribute('data-range');
            fetchCpuHistory();
        });
    });

    initHistoryChart();
    fetchCpuTelemetry();
    fetchCpuHistory();
    setInterval(fetchCpuTelemetry, 2000);
});
