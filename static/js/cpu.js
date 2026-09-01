/**
 * CPU detail page — live stats, per-core grid, and history.
 */

let cpuLiveChart, cpuHistChart;
let historyRange = '1h';

document.addEventListener('DOMContentLoaded', () => {
    cpuLiveChart = createLineChart('cpuChart', { color: '#5b8def', max: 100, label: 'CPU Usage %' });
    cpuHistChart = createLineChart('cpuHistoryChart', { color: '#a78bfa', max: 100, label: 'CPU %' });

    // Tab handlers
    document.querySelectorAll('#cpuHistoryTabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#cpuHistoryTabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            historyRange = tab.dataset.range;
            fetchHistory();
        });
    });

    fetchCpu();
    fetchHistory();
    setInterval(fetchCpu, 2000);
});

async function fetchCpu() {
    try {
        const resp = await fetch('/api/cpu');
        const json = await resp.json();
        if (!json.success) return;

        const d = json.data;

        // Stats
        document.getElementById('cpuName').textContent = d.name || 'Unknown CPU';
        document.getElementById('cpuUsage').textContent = Math.round(d.percent || 0) + '%';
        document.getElementById('cpuFreq').textContent = Math.round(d.frequency || 0) + ' MHz';
        document.getElementById('cpuCores').textContent = d.cores || '—';
        document.getElementById('cpuThreads').textContent = d.threads || '—';

        updateStatusBadge('cpuStatusBadge', d.percent || 0);

        // Per-core grid
        const coreGrid = document.getElementById('coreGrid');
        const perCore = d.per_core || [];
        if (coreGrid && perCore.length > 0) {
            coreGrid.innerHTML = perCore.map((val, i) => {
                const color = val >= 90 ? 'var(--accent-red)' : val >= 70 ? 'var(--accent-yellow)' : 'var(--accent-blue)';
                return `
                    <div class="core-item">
                        <span class="core-label">Core ${i}</span>
                        <span class="core-value" style="color:${color}">${Math.round(val)}%</span>
                        <div class="core-bar">
                            <div class="core-bar-fill" style="width:${val}%;background:${color}"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Update live chart
        if (json.buffer) {
            updateLineChartFromBuffer(cpuLiveChart, json.buffer, 'value', 60);
        }
    } catch (e) { /* retry */ }
}

async function fetchHistory() {
    try {
        const resp = await fetch(`/api/history/cpu?range=${historyRange}`);
        const json = await resp.json();
        if (!json.success) return;

        // Stats
        const s = json.stats || {};
        document.getElementById('cpuAvg').textContent = s.avg !== null ? s.avg + '%' : '—';
        document.getElementById('cpuMin').textContent = s.min !== null ? s.min + '%' : '—';
        document.getElementById('cpuMax').textContent = s.max !== null ? s.max + '%' : '—';

        // Chart
        updateHistoryChart(cpuHistChart, json.data || [], 'usage_percent');
    } catch (e) { /* retry */ }
}
