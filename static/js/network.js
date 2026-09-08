/**
 * Network Detail Page Controller — Melius Reference Design System
 * Split-screen ambient wave, sub-nodes, bezier connectors, dual-line I/O chart, and history.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    let netChart = null;
    let netHistChart = null;
    let historyRange = '1h';
    const connectors = new ConnectorManager('canvasConnectorsSvg');
    const hub = document.getElementById('netHubNode');

    if (window.Dashboard) {
        window.Dashboard.init('network');
        window.Dashboard.setActiveMetricTab('network');
    }

    // Build Sub-Nodes
    const specsGrid = document.getElementById('netSpecsGrid');
    const downNode = new NodeCard({ id: 'net-down', title: 'Download Speed', subtitle: 'Inbound Stream', unit: 'B/s', value: 0 });
    const upNode = new NodeCard({ id: 'net-up', title: 'Upload Speed', subtitle: 'Outbound Stream', unit: 'B/s', value: 0 });
    const connNode = new NodeCard({ id: 'net-conns', title: 'Active Sockets', subtitle: 'TCP / UDP Conns', unit: '', value: 0 });

    if (specsGrid) {
        specsGrid.appendChild(downNode.element);
        specsGrid.appendChild(upNode.element);
        specsGrid.appendChild(connNode.element);
    }

    setTimeout(() => {
        if (hub) {
            connectors.connect('net-down', hub, document.getElementById('dot-net-down'), { status: 'normal' });
            connectors.connect('net-up', hub, document.getElementById('dot-net-up'), { status: 'normal' });
            connectors.connect('net-conns', hub, document.getElementById('dot-net-conns'), { status: 'normal' });
        }
    }, 120);

    async function fetchNetworkTelemetry() {
        try {
            const resp = await fetch('/api/network');
            const json = await resp.json();
            if (!json.success || !json.data) return;
            const d = json.data;

            const downBps = d.download_speed || 0;
            const upBps = d.upload_speed || 0;
            const downFmt = d.download_speed_fmt || formatSpeed(downBps);
            const upFmt = d.upload_speed_fmt || formatSpeed(upBps);

            // Left Hero Elements
            const heroNum = document.getElementById('netDownHero');
            const heroUnit = document.getElementById('netDownHeroUnit');
            const subEl = document.getElementById('netSubtitle');
            const sumEl = document.getElementById('netSummaryText');
            const specEl = document.getElementById('netConnSpec');

            if (heroNum) heroNum.textContent = downFmt.split(' ')[0];
            if (heroUnit) heroUnit.textContent = `${downFmt.split(' ')[1] || 'B/s'} Inflow`;
            if (subEl) subEl.textContent = `${d.connections || 0} active socket connections`;
            if (specEl) specEl.textContent = `${d.connections || 0} Open Connections`;
            if (sumEl) {
                sumEl.textContent = `Bandwidth activity: ↓ ${downFmt} download, ↑ ${upFmt} upload across all interfaces.`;
            }

            downNode.update(downBps, {
                formatted: downFmt.split(' ')[0],
                unit: downFmt.split(' ')[1] || 'B/s'
            });

            upNode.update(upBps, {
                formatted: upFmt.split(' ')[0],
                unit: upFmt.split(' ')[1] || 'B/s'
            });

            connNode.update(d.connections || 0);

            // Buffer updates for real-time chart
            if (json.buffer && netChart) {
                updateNetLiveChart(json.buffer);
            }

        } catch (e) { /* retry */ }
     function initNetLiveChart() {
        const el = document.getElementById('netChart');
        if (!el || typeof SvgMultiLineChart === 'undefined') return;

        netChart = new SvgMultiLineChart(el, {
            unit: 'KB/s',
            datasets: [
                { label: 'Download Speed', color: 'var(--accent-primary, #4E88FF)' },
                { label: 'Upload Speed', color: 'var(--status-normal, #68D391)' }
            ]
        });
    }

    function updateNetLiveChart(buffer) {
        if (!netChart || !Array.isArray(buffer)) return;
        const labels = buffer.map((_, i) => `${i}s`);
        const downloads = buffer.map(b => (b.download || 0) / 1024);
        const uploads = buffer.map(b => (b.upload || 0) / 1024);

        netChart.update(labels, [
            { label: 'Download', color: 'var(--accent-primary, #4E88FF)', data: downloads },
            { label: 'Upload', color: 'var(--status-normal, #68D391)', data: uploads }
        ]);
    }

    function initHistoryChart() {
        const el = document.getElementById('netHistoryChart');
        if (!el || typeof SvgAreaChart === 'undefined') return;

        netHistChart = new SvgAreaChart(el, {
            color: 'var(--accent-primary, #4E88FF)',
            min: 0,
            max: 'auto',
            unit: ' KB/s'
        });
    }

    async function fetchNetworkHistory() {
        try {
            const resp = await fetch(`/api/history/network?range=${historyRange}`);
            const json = await resp.json();
            if (!json.success) return;

            const stats = json.stats || {};
            const avgEl = document.getElementById('netAvg');
            const minEl = document.getElementById('netMin');
            const maxEl = document.getElementById('netMax');

            if (avgEl) avgEl.textContent = stats.avg !== null ? formatSpeed(stats.avg) : '—';
            if (minEl) minEl.textContent = stats.min !== null ? formatSpeed(stats.min) : '—';
            if (maxEl) maxEl.textContent = stats.max !== null ? formatSpeed(stats.max) : '—';

            if (netHistChart && json.data) {
                const labels = json.data.map(d => new Date(d.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                const values = json.data.map(d => (d.download_speed || 0) / 1024);

                netHistChart.update(labels, values);
            }
        } catch (e) { /* retry */ }
    }

    document.querySelectorAll('#netHistoryTabs .editorial-pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#netHistoryTabs .editorial-pill-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            historyRange = e.currentTarget.getAttribute('data-range');
            fetchNetworkHistory();
        });
    });

    initNetLiveChart();
    initHistoryChart();
    fetchNetworkTelemetry();
    fetchNetworkHistory();
    setInterval(fetchNetworkTelemetry, 2000);
});
