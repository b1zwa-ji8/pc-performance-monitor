/**
 * Memory Detail Page Controller — Melius Reference Design System
 * Split-screen ambient wave, sub-nodes, bezier connectors, composition doughnut, and history.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    let memHistChart = null;
    let memDoughnutChart = null;
    let historyRange = '1h';
    const connectors = new ConnectorManager('canvasConnectorsSvg');
    const hub = document.getElementById('memHubNode');

    if (window.Dashboard) {
        window.Dashboard.init('memory');
        window.Dashboard.setActiveMetricTab('memory');
    }

    // Build Sub-Nodes
    const specsGrid = document.getElementById('memSpecsGrid');
    const usedNode = new NodeCard({ id: 'mem-used', title: 'RAM Used', subtitle: 'Active Allocation', unit: 'GB', value: 0 });
    const availNode = new NodeCard({ id: 'mem-avail', title: 'Available', subtitle: 'Free Capacity', unit: 'GB', value: 0 });
    const totalNode = new NodeCard({ id: 'mem-total', title: 'Total RAM', subtitle: 'Installed Physical', unit: 'GB', value: 0 });
    const swapNode = new NodeCard({ id: 'mem-swap', title: 'Swap Used', subtitle: 'Paging File', unit: 'GB', value: 0 });

    if (specsGrid) {
        specsGrid.appendChild(usedNode.element);
        specsGrid.appendChild(availNode.element);
        specsGrid.appendChild(totalNode.element);
        specsGrid.appendChild(swapNode.element);
    }

    setTimeout(() => {
        if (hub) {
            connectors.connect('mem-used', hub, document.getElementById('dot-mem-used'), { status: 'normal' });
            connectors.connect('mem-avail', hub, document.getElementById('dot-mem-avail'), { status: 'normal' });
            connectors.connect('mem-total', hub, document.getElementById('dot-mem-total'), { status: 'normal' });
            connectors.connect('mem-swap', hub, document.getElementById('dot-mem-swap'), { status: 'normal' });
        }
    }, 120);

    // Fetch live memory telemetry
    async function fetchMemoryTelemetry() {
        try {
            const resp = await fetch('/api/memory');
            const json = await resp.json();
            if (!json.success || !json.data) return;
            const d = json.data;

            const memP = Math.round(d.percent || 0);
            const percentEl = document.getElementById('memPercent');
            const subEl = document.getElementById('memSubtitle');
            const sumEl = document.getElementById('memSummaryText');
            const totalSpecEl = document.getElementById('memTotalSpec');

            if (percentEl) percentEl.textContent = memP;
            if (subEl) subEl.textContent = `${d.used || 0} GB used out of ${d.total || 0} GB`;
            if (totalSpecEl) totalSpecEl.textContent = `Total Installed: ${d.total || 0} GB (${d.type || 'DDR'})`;
            if (sumEl) {
                sumEl.textContent = `RAM load at ${memP}% with ${(d.available || 0).toFixed(1)} GB available. Swap usage is ${Math.round(d.swap_percent || 0)}%.`;
            }

            const memStatus = getStatusClass(memP, { warning: 80, critical: 90 });
            usedNode.update(d.used || 0, { status: memStatus });
            availNode.update(d.available || 0);
            totalNode.update(d.total || 0);
            swapNode.update(d.swap_used || 0);

            connectors.setConnectionState('mem-used', { status: memStatus });

            // Update Doughnut
            updateDoughnut(d.used || 0, d.available || 0, d.swap_used || 0);

        } catch (e) { /* retry */ }
    }

    function initDoughnut() {
        const el = document.getElementById('memDoughnut');
        if (!el || typeof SvgDoughnutChart === 'undefined') return;

        memDoughnutChart = new SvgDoughnutChart(el, {
            size: 220,
            radius: 72,
            strokeWidth: 20,
            labels: ['RAM Used', 'RAM Free', 'Swap Used'],
            colors: ['var(--status-critical, #F56565)', 'var(--status-normal, #68D391)', 'var(--status-warning, #ECC94B)']
        });
    }

    function updateDoughnut(used, free, swap) {
        if (!memDoughnutChart) return;
        const total = (Number(used) + Number(free)) || 1;
        const pct = Math.round((Number(used) / total) * 100);
        memDoughnutChart.update([used, free, swap], ['RAM Used', 'RAM Free', 'Swap Used'], null, { val: `${pct}%`, sub: 'RAM Used' });
    }

    // Historical Chart
    function initHistoryChart() {
        const el = document.getElementById('memHistoryChart');
        if (!el || typeof SvgAreaChart === 'undefined') return;

        memHistChart = new SvgAreaChart(el, {
            color: 'var(--status-normal, #68D391)',
            min: 0,
            max: 100,
            unit: '%'
        });
    }

    async function fetchMemoryHistory() {
        try {
            const resp = await fetch(`/api/history/memory?range=${historyRange}`);
            const json = await resp.json();
            if (!json.success) return;

            const stats = json.stats || {};
            const avgEl = document.getElementById('memAvg');
            const minEl = document.getElementById('memMin');
            const maxEl = document.getElementById('memMax');

            if (avgEl) avgEl.textContent = stats.avg !== null ? `${stats.avg.toFixed(1)}%` : '—';
            if (minEl) minEl.textContent = stats.min !== null ? `${stats.min.toFixed(1)}%` : '—';
            if (maxEl) maxEl.textContent = stats.max !== null ? `${stats.max.toFixed(1)}%` : '—';

            if (memHistChart && json.data) {
                const labels = json.data.map(d => new Date(d.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                const values = json.data.map(d => d.percent || 0);

                memHistChart.update(labels, values);
            }
        } catch (e) { /* retry */ }
    }
        } catch (e) { /* retry */ }
    }

    document.querySelectorAll('#memHistoryTabs .editorial-pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#memHistoryTabs .editorial-pill-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            historyRange = e.currentTarget.getAttribute('data-range');
            fetchMemoryHistory();
        });
    });

    initDoughnut();
    initHistoryChart();
    fetchMemoryTelemetry();
    fetchMemoryHistory();
    setInterval(fetchMemoryTelemetry, 2000);
});
