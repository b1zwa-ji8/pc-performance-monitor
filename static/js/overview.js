/**
 * Overview page — real-time metric cards + charts.
 */

let cpuChart, memChart, netChart, diskChart;
let prevCpu = null, prevMem = null;

// Initialize charts
document.addEventListener('DOMContentLoaded', () => {
    cpuChart = createLineChart('overviewCpuChart', { color: '#5b8def', max: 100, label: 'CPU %' });
    memChart = createLineChart('overviewMemChart', { color: '#4ade80', max: 100, label: 'RAM %' });

    netChart = createLineChart('overviewNetChart', {
        showLegend: true,
        max: null,
        datasets: [
            { label: 'Download', data: [], borderColor: '#5b8def', backgroundColor: 'rgba(91,141,239,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
            { label: 'Upload', data: [], borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
        ],
        yCallback: (v) => formatSpeed(v),
    });

    diskChart = createLineChart('overviewDiskChart', {
        showLegend: true,
        max: null,
        datasets: [
            { label: 'Read', data: [], borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
            { label: 'Write', data: [], borderColor: '#fb923c', backgroundColor: 'rgba(251,146,60,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
        ],
        yCallback: (v) => formatSpeed(v),
    });

    fetchOverview();
    setInterval(fetchOverview, 2000);
});

async function fetchOverview() {
    try {
        const resp = await fetch('/api/overview');
        const json = await resp.json();
        if (!json.success) return;
        const d = json.data;

        // System info
        if (d.system_info) {
            setText('infoHostname', d.system_info.hostname || '—');
            setText('infoOS', d.system_info.os || '—');
        }
        setText('uptimeValue', d.uptime || '—');
        setText('infoProcessCount', d.process_count || '0');

        // CPU card
        const cpu = d.cpu || {};
        const cpuP = Math.round(cpu.percent || 0);
        setText('cpuValue', cpuP);
        setText('cpuDetail', cpu.name || 'Unknown CPU');
        setBar('cpuBar', cpuP);
        updateStatusBadge('cpuStatus', cpuP);
        updateTrend('cpuTrend', cpuP, prevCpu);
        prevCpu = cpuP;

        // RAM card
        const mem = d.memory || {};
        const memP = Math.round(mem.percent || 0);
        setText('ramValue', memP);
        setText('ramDetail', `${mem.used || 0} GB / ${mem.total || 0} GB`);
        setBar('ramBar', memP);
        updateStatusBadge('ramStatus', memP);
        updateTrend('ramTrend', memP, prevMem);
        prevMem = memP;

        // GPU card
        const gpu = d.gpu || {};
        if (gpu.available) {
            setText('gpuValue', Math.round(gpu.load || 0));
            setText('gpuDetail', `${gpu.name} — ${gpu.temperature || 0}°C`);
            setBar('gpuBar', gpu.load || 0);
            updateStatusBadge('gpuStatus', gpu.load || 0);
        } else {
            setText('gpuValue', '—');
            setText('gpuDetail', 'GPU unavailable');
        }

        // Disk card
        const disk = d.disk || {};
        const parts = disk.partitions || [];
        if (parts.length > 0) {
            const mainDisk = parts[0];
            setText('diskValue', Math.round(mainDisk.percent || 0));
            setText('diskDetail', `${mainDisk.device} — ${mainDisk.used} / ${mainDisk.total} GB`);
            setBar('diskBar', mainDisk.percent || 0);
            updateStatusBadge('diskStatus', mainDisk.percent);
        }

        // Network card
        const net = d.network || {};
        setText('netUpload', net.upload_speed_fmt || '0 B/s');
        setText('netDownload', net.download_speed_fmt || '0 B/s');
        setText('netDetail', `${net.connections || 0} active connections`);

        // Battery card
        const bat = d.battery || {};
        const batCard = document.getElementById('batteryCard');
        if (bat.available) {
            if (batCard) batCard.style.display = '';
            setText('batValue', Math.round(bat.percent || 0));
            setText('batDetail', bat.plugged ? '🔌 Plugged in' : `⏱️ ${bat.time_left_fmt}`);
            setBar('batBar', bat.percent || 0);
            const batStatus = bat.percent < 20 ? 'warning' : 'normal';
            const batEl = document.getElementById('batStatus');
            if (batEl) {
                batEl.className = `status-badge ${batStatus}`;
                batEl.innerHTML = `<span class="status-dot"></span> ${bat.plugged ? 'Charging' : batStatus === 'warning' ? 'Low' : 'Normal'}`;
            }
        } else {
            if (batCard) batCard.style.display = 'none';
        }

    } catch (e) { /* retry next cycle */ }

    // Update charts from buffers
    try {
        const [cpuBuf, memBuf, netBuf, diskBuf] = await Promise.all([
            fetch('/api/buffer/cpu').then(r => r.json()),
            fetch('/api/buffer/memory').then(r => r.json()),
            fetch('/api/buffer/network').then(r => r.json()),
            fetch('/api/buffer/disk').then(r => r.json()),
        ]);

        if (cpuBuf.success) updateLineChartFromBuffer(cpuChart, cpuBuf.buffer, 'value', 60);
        if (memBuf.success) updateLineChartFromBuffer(memChart, memBuf.buffer, 'value', 60);
        if (netBuf.success) updateMultiLineChart(netChart, netBuf.buffer, ['download', 'upload'], 60);
        if (diskBuf.success) updateMultiLineChart(diskChart, diskBuf.buffer, ['read', 'write'], 60);
    } catch (e) { /* retry */ }
}

// Helpers
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setBar(id, percent) {
    const el = document.getElementById(id);
    if (el) {
        el.style.width = Math.min(100, percent) + '%';
        // Color based on value
        el.className = 'progress-fill';
        if (percent >= 90) el.classList.add('red');
        else if (percent >= 70) el.classList.add('yellow');
        else el.classList.add('blue');
    }
}

function updateTrend(id, current, previous) {
    const el = document.getElementById(id);
    if (!el || previous === null) return;
    const diff = current - previous;
    if (Math.abs(diff) < 2) {
        el.className = 'trend stable';
        el.textContent = '→ stable';
    } else if (diff > 0) {
        el.className = 'trend up';
        el.textContent = `↑ +${diff}%`;
    } else {
        el.className = 'trend down';
        el.textContent = `↓ ${diff}%`;
    }
}
