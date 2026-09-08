/**
 * Disk Detail Page Controller — Melius Reference Design System
 * Split-screen ambient wave, sub-nodes, bezier connectors, partition cards, I/O chart, and analyzer.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    let diskChart = null;
    const connectors = new ConnectorManager('canvasConnectorsSvg');
    const hub = document.getElementById('diskHubNode');

    if (window.Dashboard) {
        window.Dashboard.init('disk');
        window.Dashboard.setActiveMetricTab('disk');
    }

    // Build Sub-Nodes for Read and Write
    const specsGrid = document.getElementById('diskSpecsGrid');
    const readNode = new NodeCard({ id: 'disk-read', title: 'Read Speed', subtitle: 'I/O Inflow', unit: 'B/s', value: 0 });
    const writeNode = new NodeCard({ id: 'disk-write', title: 'Write Speed', subtitle: 'I/O Outflow', unit: 'B/s', value: 0 });

    if (specsGrid) {
        specsGrid.appendChild(readNode.element);
        specsGrid.appendChild(writeNode.element);
    }

    setTimeout(() => {
        if (hub) {
            connectors.connect('disk-read', hub, document.getElementById('dot-disk-read'), { status: 'normal' });
            connectors.connect('disk-write', hub, document.getElementById('dot-disk-write'), { status: 'normal' });
        }
    }, 120);

    const partitionNodes = [];

    async function fetchDiskTelemetry() {
        try {
            const resp = await fetch('/api/disk');
            const json = await resp.json();
            if (!json.success || !json.data) return;
            const d = json.data;

            const readBps = d.read_speed || 0;
            const writeBps = d.write_speed || 0;
            const readFmt = d.read_speed_fmt || formatSpeed(readBps);
            const writeFmt = d.write_speed_fmt || formatSpeed(writeBps);

            readNode.update(readBps, {
                formatted: readFmt.split(' ')[0],
                unit: readFmt.split(' ')[1] || 'B/s'
            });

            writeNode.update(writeBps, {
                formatted: writeFmt.split(' ')[0],
                unit: writeFmt.split(' ')[1] || 'B/s'
            });

            // Partitions
            const parts = d.partitions || [];
            const partCountEl = document.getElementById('diskPartCount');
            if (partCountEl) partCountEl.textContent = `${parts.length} Mounted Volumes`;

            if (parts.length > 0) {
                const p0 = parts[0];
                const p0Percent = Math.round(p0.percent || 0);
                const percentEl = document.getElementById('primaryDiskPercent');
                const subEl = document.getElementById('diskSubtitle');
                const sumEl = document.getElementById('diskSummaryText');

                if (percentEl) percentEl.textContent = p0Percent;
                if (subEl) subEl.textContent = `Primary ${p0.device} (${p0.used || 0} GB used of ${p0.total || 0} GB)`;
                if (sumEl) {
                    sumEl.textContent = `Primary drive is ${p0Percent}% full. Read: ${readFmt}, Write: ${writeFmt}.`;
                }

                // Partition grid
                const partGrid = document.getElementById('partitionGrid');
                if (partGrid) {
                    if (partitionNodes.length === 0) {
                        partGrid.innerHTML = '';
                        parts.forEach((p, idx) => {
                            const pNode = new NodeCard({
                                id: `part-${idx}`,
                                title: p.device || `Disk ${idx}`,
                                subtitle: `${p.used} / ${p.total} GB`,
                                unit: '%',
                                value: Math.round(p.percent || 0),
                                status: getStatusClass(p.percent || 0, { warning: 85, critical: 95 })
                            });
                            partitionNodes.push(pNode);
                            partGrid.appendChild(pNode.element);
                        });
                    } else {
                        parts.forEach((p, idx) => {
                            if (partitionNodes[idx]) {
                                const val = Math.round(p.percent || 0);
                                partitionNodes[idx].update(val, {
                                    subtitle: `${p.used} / ${p.total} GB`,
                                    status: getStatusClass(val, { warning: 85, critical: 95 })
                                });
                            }
                        });
                    }
                }
            }

            // Buffer updates for I/O chart
            if (json.buffer && diskChart) {
                updateDiskChart(json.buffer);
            }

        } catch (e) { /* retry */ }
    }

    function initChart() {
        const el = document.getElementById('diskIOChart');
        if (!el || typeof SvgMultiLineChart === 'undefined') return;

        diskChart = new SvgMultiLineChart(el, {
            unit: 'MB/s',
            datasets: [
                { label: 'Read Speed', color: 'var(--status-normal, #68D391)' },
                { label: 'Write Speed', color: 'var(--accent-primary, #4E88FF)' }
            ]
        });
    }

    function updateDiskChart(buffer) {
        if (!diskChart || !Array.isArray(buffer)) return;
        const labels = buffer.map((_, i) => `${i}s`);
        const reads = buffer.map(b => (b.read || 0) / (1024 * 1024));
        const writes = buffer.map(b => (b.write || 0) / (1024 * 1024));

        diskChart.update(labels, [
            { label: 'Read', color: 'var(--status-normal, #68D391)', data: reads },
            { label: 'Write', color: 'var(--accent-primary, #4E88FF)', data: writes }
        ]);
    }

    // Storage Analyzer
    const analyzeBtn = document.getElementById('analyzeBtn');
    const analyzePathInput = document.getElementById('analyzePath');
    const resultsContainer = document.getElementById('analyzerResults');

    if (analyzeBtn && analyzePathInput) {
        analyzeBtn.addEventListener('click', async () => {
            const path = analyzePathInput.value.trim();
            if (!path) return;

            resultsContainer.innerHTML = `<p style="color: var(--text-on-dark-muted);">Analyzing "${path}"...</p>`;

            try {
                const resp = await fetch(`/api/disk/analyze?path=${encodeURIComponent(path)}`);
                const json = await resp.json();
                if (!json.success || !json.data) {
                    resultsContainer.innerHTML = `<p style="color: var(--status-critical);">${json.error || 'Failed to scan directory'}</p>`;
                    return;
                }

                const items = json.data.items || [];
                if (items.length === 0) {
                    resultsContainer.innerHTML = `<p style="color: var(--text-on-dark-muted);">No large files or folders found.</p>`;
                    return;
                }

                resultsContainer.innerHTML = `
                    <div class="data-table-wrap">
                        <table class="editorial-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Type</th>
                                    <th>Size</th>
                                    <th>Path</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${items.slice(0, 10).map(it => `
                                    <tr>
                                        <td><strong>${it.name}</strong></td>
                                        <td>${it.is_dir ? '📁 Directory' : '📄 File'}</td>
                                        <td><span style="color: var(--accent-primary); font-weight: 600;">${it.size_fmt || formatBytes(it.size)}</span></td>
                                        <td style="color: var(--text-on-dark-muted); font-size: 0.78rem;">${it.path}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            } catch (err) {
                resultsContainer.innerHTML = `<p style="color: var(--status-critical);">Error running analyzer: ${err.message}</p>`;
            }
        });
    }

    initChart();
    fetchDiskTelemetry();
    setInterval(fetchDiskTelemetry, 2000);
});
