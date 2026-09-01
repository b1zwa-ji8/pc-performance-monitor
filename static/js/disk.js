/**
 * Disk page — partitions, I/O chart, and storage analyzer.
 */

let diskIOChart;

document.addEventListener('DOMContentLoaded', () => {
    diskIOChart = createLineChart('diskIOChart', {
        showLegend: true,
        max: null,
        datasets: [
            { label: 'Read', data: [], borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
            { label: 'Write', data: [], borderColor: '#fb923c', backgroundColor: 'rgba(251,146,60,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
        ],
        yCallback: (v) => formatSpeed(v),
    });

    document.getElementById('analyzeBtn')?.addEventListener('click', analyzeDirectory);
    document.getElementById('analyzePath')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') analyzeDirectory();
    });

    fetchDisk();
    setInterval(fetchDisk, 2000);
});

async function fetchDisk() {
    try {
        const resp = await fetch('/api/disk');
        const json = await resp.json();
        if (!json.success) return;
        const d = json.data;

        // I/O stats
        const io = d.io || {};
        document.getElementById('diskRead').textContent = io.read_speed_fmt || '0 B/s';
        document.getElementById('diskWrite').textContent = io.write_speed_fmt || '0 B/s';

        // Partitions
        const grid = document.getElementById('partitionGrid');
        const parts = d.partitions || [];
        if (grid) {
            grid.innerHTML = parts.map(p => {
                const color = p.percent >= 90 ? 'var(--accent-red)' : p.percent >= 70 ? 'var(--accent-yellow)' : 'var(--accent-blue)';
                const barColor = p.percent >= 90 ? 'red' : p.percent >= 70 ? 'yellow' : 'blue';
                return `
                    <div class="partition-card">
                        <div class="partition-header">
                            <span class="partition-name">💿 ${p.device}</span>
                            <span class="partition-percent" style="color:${color}">${p.percent}%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill ${barColor}" style="width:${p.percent}%"></div>
                        </div>
                        <div class="partition-details">
                            <span>Total: ${p.total} GB</span>
                            <span>Used: ${p.used} GB</span>
                            <span>Free: ${p.free} GB</span>
                            <span>${p.fstype}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // I/O chart
        if (json.buffer) {
            updateMultiLineChart(diskIOChart, json.buffer, ['read', 'write'], 60);
        }
    } catch (e) { /* retry */ }
}

async function analyzeDirectory() {
    const pathInput = document.getElementById('analyzePath');
    const results = document.getElementById('analyzerResults');
    const path = pathInput?.value?.trim();

    if (!path) {
        showToast('Please enter a path', 'warning');
        return;
    }

    results.innerHTML = '<div class="loading-container"><div class="spinner"></div> Analyzing...</div>';

    try {
        const resp = await fetch(`/api/disk/analyze?path=${encodeURIComponent(path)}`);
        const json = await resp.json();

        if (!json.success) {
            results.innerHTML = `<div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-text">${json.error || 'Analysis failed'}</div></div>`;
            return;
        }

        const data = json.data;
        if (data.error) {
            results.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">${data.error}</div></div>`;
            return;
        }

        const items = data.items || [];
        if (items.length === 0) {
            results.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📂</div><div class="empty-state-text">No items found</div></div>';
            return;
        }

        const maxSize = items[0]?.size || 1;
        results.innerHTML = `
            <div style="margin-bottom:12px;font-size:0.82rem;color:var(--text-secondary);">
                Total: <strong>${data.total_size_fmt}</strong> — Showing top ${items.length} items
            </div>
            ${items.map(item => `
                <div class="analyzer-row">
                    <span class="analyzer-icon">${item.type === 'folder' ? '📁' : '📄'}</span>
                    <span class="analyzer-name" title="${item.path}">${item.name}</span>
                    <span class="analyzer-size">${item.size_fmt}</span>
                    <div class="analyzer-bar">
                        <div class="analyzer-bar-fill" style="width:${Math.round((item.size / maxSize) * 100)}%"></div>
                    </div>
                </div>
            `).join('')}
        `;
    } catch (e) {
        results.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-text">Failed to analyze directory</div></div>';
    }
}
