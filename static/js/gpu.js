/**
 * GPU detail page — load, temp, VRAM, chart, and history.
 */

let gpuLiveChart, gpuMemDoughnut, gpuHistChart;
let gpuHistRange = '1h';

document.addEventListener('DOMContentLoaded', () => {
    gpuLiveChart = createLineChart('gpuChart', { color: '#a78bfa', max: 100, label: 'GPU Load %' });
    gpuMemDoughnut = createDoughnutChart('gpuMemDoughnut', {
        labels: ['Used', 'Free'],
        data: [0, 100],
        colors: ['#a78bfa', 'rgba(255,255,255,0.06)'],
    });
    gpuHistChart = createLineChart('gpuHistoryChart', { color: '#a78bfa', max: 100, label: 'GPU %' });

    document.querySelectorAll('#gpuHistoryTabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#gpuHistoryTabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            gpuHistRange = tab.dataset.range;
            fetchGpuHistory();
        });
    });

    fetchGpu();
    fetchGpuHistory();
    setInterval(fetchGpu, 2000);
});

async function fetchGpu() {
    try {
        const resp = await fetch('/api/gpu');
        const json = await resp.json();
        if (!json.success) return;
        const d = json.data;

        if (!d.available) {
            document.getElementById('gpuContent').classList.add('hidden');
            document.getElementById('gpuUnavailable').classList.remove('hidden');
            document.getElementById('gpuName').textContent = d.name || 'GPU unavailable';
            return;
        }

        document.getElementById('gpuContent').classList.remove('hidden');
        document.getElementById('gpuUnavailable').classList.add('hidden');

        document.getElementById('gpuName').textContent = d.name || 'Unknown GPU';
        document.getElementById('gpuLoad').textContent = Math.round(d.load || 0) + '%';
        document.getElementById('gpuTemp').textContent = (d.temperature || 0) + '°C';
        document.getElementById('gpuMemUsed').textContent = (d.memory_used || 0) + ' GB';
        document.getElementById('gpuMemTotal').textContent = (d.memory_total || 0) + ' GB';
        document.getElementById('gpuMemPercent').textContent = Math.round(d.memory_percent || 0) + '%';

        updateStatusBadge('gpuStatusBadge', d.load || 0);

        if (gpuMemDoughnut) {
            gpuMemDoughnut.data.datasets[0].data = [d.memory_used || 0, d.memory_free || 0];
            gpuMemDoughnut.update('none');
        }

        if (json.buffer) {
            updateLineChartFromBuffer(gpuLiveChart, json.buffer, 'value', 60);
        }
    } catch (e) { /* retry */ }
}

async function fetchGpuHistory() {
    try {
        const resp = await fetch(`/api/history/gpu?range=${gpuHistRange}`);
        const json = await resp.json();
        if (!json.success) return;

        const s = json.stats || {};
        document.getElementById('gpuAvg').textContent = s.avg !== null ? s.avg + '%' : '—';
        document.getElementById('gpuMin').textContent = s.min !== null ? s.min + '%' : '—';
        document.getElementById('gpuMax').textContent = s.max !== null ? s.max + '%' : '—';

        updateHistoryChart(gpuHistChart, json.data || [], 'load_percent');
    } catch (e) { /* retry */ }
}
