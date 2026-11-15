/**
 * Fan Speed & Thermal View Controller
 * Dual-axis correlation between cooling speeds and hardware package thermals.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    let correlationChart = null;
    let selectedRange = '1h';

    initCorrelationChart();
    fetchFanTelemetry();
    fetchFanHistory();

    setInterval(fetchFanTelemetry, 2500);

    // Range tabs
    document.querySelectorAll('#fanHistoryTabs .editorial-pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#fanHistoryTabs .editorial-pill-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectedRange = e.currentTarget.getAttribute('data-range');
            fetchFanHistory();
        });
    });

    async function fetchFanTelemetry() {
        try {
            const resp = await fetch('/api/fans');
            const json = await resp.json();
            if (!json.success || !json.data) return;

            const d = json.data;
            const fanHero = document.getElementById('fanSpeedHero');
            const fanBackend = document.getElementById('fanBackendText');
            const gpuHero = document.getElementById('gpuTempHero');
            const cpuHero = document.getElementById('cpuTempHero');

            if (d.fan && d.fan.available) {
                if (fanHero) fanHero.textContent = d.fan.speed_display || `${d.fan.rpm} RPM`;
                if (fanBackend) {
                    fanBackend.textContent = `Backend: ${d.fan.backend}`;
                    fanBackend.style.color = 'var(--status-normal)';
                }
            } else {
                if (fanHero) fanHero.textContent = 'Unavailable';
                if (fanBackend) {
                    fanBackend.textContent = 'OEM ACPI / Embedded Controller managed';
                    fanBackend.style.color = 'var(--text-on-dark-muted)';
                }
            }

            // GPU Temp
            if (gpuHero) {
                gpuHero.textContent = (d.gpu_temp !== null && d.gpu_temp !== undefined) ? `${Math.round(d.gpu_temp)}°C` : 'Unavailable';
            }

            // CPU Temp
            if (cpuHero) {
                cpuHero.textContent = (d.cpu_temp !== null && d.cpu_temp !== undefined) ? `${Math.round(d.cpu_temp)}°C` : 'Unavailable';
            }

            // Sensor diagnostic lines
            const nvmlEl = document.getElementById('diagNvmlFan');
            const lhmEl = document.getElementById('diagLhmFan');
            const wmiEl = document.getElementById('diagWmiFan');

            if (nvmlEl) nvmlEl.textContent = d.fan.backend === 'pynvml' ? 'Active' : 'Not Supported on Mobile GPU';
            if (lhmEl) lhmEl.textContent = d.fan.backend?.includes('LibreHardwareMonitor') ? 'Active' : 'No LHM driver running';
            if (wmiEl) wmiEl.textContent = d.fan.backend?.includes('Win32_Fan') ? 'Active' : 'ACPI speed reading not exposed';

        } catch (e) { /* retry */ }
    }

    function initCorrelationChart() {
        const ctx = document.getElementById('fanCorrelationChart')?.getContext('2d');
        if (!ctx || typeof Chart === 'undefined') return;

        correlationChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Fan Speed (RPM)',
                        data: [],
                        borderColor: '#38bdf8',
                        backgroundColor: 'rgba(56, 189, 248, 0.08)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.25,
                        yAxisID: 'yFan'
                    },
                    {
                        label: 'GPU Core Temp (°C)',
                        data: [],
                        borderColor: '#f5b942',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.25,
                        yAxisID: 'yTemp'
                    },
                    {
                        label: 'CPU Package Temp (°C)',
                        data: [],
                        borderColor: '#e8442c',
                        borderWidth: 1.5,
                        borderDash: [4, 4],
                        pointRadius: 0,
                        tension: 0.25,
                        yAxisID: 'yTemp'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#9a9a9e', font: { family: 'Inter', size: 11 }, boxWidth: 14 }
                    },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#9a9a9e', maxTicksLimit: 8 }
                    },
                    yFan: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        min: 0,
                        max: 4000,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#38bdf8', callback: (v) => v + ' RPM' }
                    },
                    yTemp: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        min: 20,
                        max: 110,
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#f5b942', callback: (v) => v + '°C' }
                    }
                }
            }
        });
    }

    async function fetchFanHistory() {
        try {
            const resp = await fetch(`/api/fans/history?range=${selectedRange}`);
            const json = await resp.json();
            if (!json.success || !json.data || !correlationChart) return;

            const labels = json.data.map(d => new Date(d.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            const fanData = json.data.map(d => d.fan_rpm !== null && d.fan_rpm !== undefined ? d.fan_rpm : null);
            const gpuData = json.data.map(d => d.gpu_temp !== null && d.gpu_temp !== undefined ? d.gpu_temp : null);
            const cpuData = json.data.map(d => d.cpu_temp !== null && d.cpu_temp !== undefined ? d.cpu_temp : null);

            correlationChart.data.labels = labels;
            correlationChart.data.datasets[0].data = fanData;
            correlationChart.data.datasets[1].data = gpuData;
            correlationChart.data.datasets[2].data = cpuData;
            correlationChart.update('none');

        } catch (e) { /* retry */ }
    }
});
