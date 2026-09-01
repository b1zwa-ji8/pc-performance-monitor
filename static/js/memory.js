/**
 * Memory detail page — live stats, composition doughnut, and history.
 */

let memLiveChart, memDoughnut, memHistChart;
let memHistRange = '1h';

document.addEventListener('DOMContentLoaded', () => {
    memLiveChart = createLineChart('memChart', { color: '#4ade80', max: 100, label: 'RAM %' });
    memDoughnut = createDoughnutChart('memDoughnut', {
        labels: ['Used', 'Available'],
        data: [0, 100],
        colors: ['#4ade80', 'rgba(255,255,255,0.06)'],
    });
    memHistChart = createLineChart('memHistoryChart', { color: '#22d3ee', max: 100, label: 'RAM %' });

    document.querySelectorAll('#memHistoryTabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#memHistoryTabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            memHistRange = tab.dataset.range;
            fetchMemHistory();
        });
    });

    fetchMemory();
    fetchMemHistory();
    setInterval(fetchMemory, 2000);
});

async function fetchMemory() {
    try {
        const resp = await fetch('/api/memory');
        const json = await resp.json();
        if (!json.success) return;
        const d = json.data;

        document.getElementById('memPercent').textContent = Math.round(d.percent || 0) + '%';
        document.getElementById('memUsed').textContent = (d.used || 0) + ' GB';
        document.getElementById('memAvailable').textContent = (d.available || 0) + ' GB';
        document.getElementById('memTotal').textContent = (d.total || 0) + ' GB';

        document.getElementById('swapPercent').textContent = Math.round(d.swap_percent || 0) + '%';
        document.getElementById('swapUsed').textContent = (d.swap_used || 0) + ' GB';
        document.getElementById('swapFree').textContent = (d.swap_free || 0) + ' GB';
        document.getElementById('swapTotal').textContent = (d.swap_total || 0) + ' GB';

        updateStatusBadge('memStatusBadge', d.percent || 0);

        // Doughnut
        if (memDoughnut) {
            memDoughnut.data.datasets[0].data = [d.used || 0, d.available || 0];
            memDoughnut.update('none');
        }

        // Live chart
        if (json.buffer) {
            updateLineChartFromBuffer(memLiveChart, json.buffer, 'value', 60);
        }
    } catch (e) { /* retry */ }
}

async function fetchMemHistory() {
    try {
        const resp = await fetch(`/api/history/memory?range=${memHistRange}`);
        const json = await resp.json();
        if (!json.success) return;

        const s = json.stats || {};
        document.getElementById('memAvg').textContent = s.avg !== null ? s.avg + '%' : '—';
        document.getElementById('memMin').textContent = s.min !== null ? s.min + '%' : '—';
        document.getElementById('memMax').textContent = s.max !== null ? s.max + '%' : '—';

        updateHistoryChart(memHistChart, json.data || [], 'percent');
    } catch (e) { /* retry */ }
}
