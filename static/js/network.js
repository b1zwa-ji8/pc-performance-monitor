/**
 * Network page — live speeds, chart, and history.
 */

let netLiveChart, netHistChart;
let netHistRange = '1h';

document.addEventListener('DOMContentLoaded', () => {
    netLiveChart = createLineChart('netChart', {
        showLegend: true,
        max: null,
        datasets: [
            { label: 'Download', data: [], borderColor: '#5b8def', backgroundColor: 'rgba(91,141,239,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
            { label: 'Upload', data: [], borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
        ],
        yCallback: (v) => formatSpeed(v),
    });

    netHistChart = createLineChart('netHistoryChart', { color: '#5b8def', max: null, label: 'Download Speed', yCallback: (v) => formatSpeed(v) });

    document.querySelectorAll('#netHistoryTabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#netHistoryTabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            netHistRange = tab.dataset.range;
            fetchNetHistory();
        });
    });

    fetchNetwork();
    fetchNetHistory();
    setInterval(fetchNetwork, 2000);
});

async function fetchNetwork() {
    try {
        const resp = await fetch('/api/network');
        const json = await resp.json();
        if (!json.success) return;
        const d = json.data;

        document.getElementById('netUpSpeed').textContent = d.upload_speed_fmt || '0 B/s';
        document.getElementById('netDownSpeed').textContent = d.download_speed_fmt || '0 B/s';
        document.getElementById('netConnections').textContent = d.connections || 0;

        if (json.buffer) {
            updateMultiLineChart(netLiveChart, json.buffer, ['download', 'upload'], 60);
        }
    } catch (e) { /* retry */ }
}

async function fetchNetHistory() {
    try {
        const resp = await fetch(`/api/history/network?range=${netHistRange}`);
        const json = await resp.json();
        if (!json.success) return;

        const s = json.stats || {};
        document.getElementById('netAvg').textContent = s.avg !== null ? formatSpeed(s.avg) : '—';
        document.getElementById('netMin').textContent = s.min !== null ? formatSpeed(s.min) : '—';
        document.getElementById('netMax').textContent = s.max !== null ? formatSpeed(s.max) : '—';

        updateHistoryChart(netHistChart, json.data || [], 'download_speed');
    } catch (e) { /* retry */ }
}
