/**
 * Benchmark & PresentMon Page Controller
 * Handles capture lifecycle, live countdown, frame-time charts, and history review.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    let selectedDuration = 30;
    let pollTimer = null;
    let frametimeChart = null;
    let hwCorrelationChart = null;
    let currentReport = null;

    // Check PresentMon status and target app periodically
    checkPresentMonStatus();
    setInterval(checkPresentMonStatus, 3000);

    // Load History
    loadBenchmarkHistory();

    // Duration tabs
    document.querySelectorAll('#benchDurationTabs .editorial-pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#benchDurationTabs .editorial-pill-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectedDuration = parseInt(e.currentTarget.getAttribute('data-dur'), 10) || 30;
        });
    });

    // Start Button
    document.getElementById('benchStartBtn')?.addEventListener('click', startBenchmark);
    document.getElementById('benchStopBtn')?.addEventListener('click', stopBenchmark);
    document.getElementById('exportBenchBtn')?.addEventListener('click', exportReport);

    async function checkPresentMonStatus() {
        try {
            const resp = await fetch('/api/fps');
            const json = await resp.json();
            const badge = document.getElementById('pmStatusBadge');
            const targetEl = document.getElementById('targetAppText');

            if (!json.success || !json.data) {
                if (badge) {
                    badge.textContent = 'PresentMon Standby';
                    badge.style.color = 'var(--text-on-dark-muted)';
                }
                return;
            }

            const d = json.data;
            if (badge) {
                if (d.available) {
                    badge.textContent = d.status || 'PresentMon Active';
                    badge.style.color = 'var(--status-normal)';
                    badge.style.borderColor = 'rgba(52, 199, 123, 0.3)';
                } else {
                    badge.textContent = d.status || 'PresentMon Standby';
                    badge.style.color = 'var(--status-warning)';
                    badge.style.borderColor = 'rgba(245, 185, 66, 0.3)';
                }
            }

            if (targetEl) {
                const appName = d.app_name && d.app_name !== 'Unknown' ? d.app_name : 'System / Desktop Focus';
                const fs = d.is_exclusive_fullscreen ? ' (Exclusive Fullscreen)' : '';
                targetEl.textContent = `${appName}${fs}`;
            }
        } catch (e) { /* retry */ }
    }

    async function startBenchmark() {
        const startBtn = document.getElementById('benchStartBtn');
        const stopBtn = document.getElementById('benchStopBtn');
        const progressSec = document.getElementById('benchProgressSection');
        const resultsCard = document.getElementById('benchResultsCard');

        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.style.display = 'inline-block';
        if (progressSec) progressSec.style.display = 'block';
        if (resultsCard) resultsCard.style.display = 'none';

        updateProgress(0, selectedDuration);

        try {
            const resp = await fetch('/api/benchmark/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ duration: selectedDuration })
            });
            const json = await resp.json();

            if (!json.success) {
                alert(json.error || 'Failed to start benchmark');
                resetControls();
                return;
            }

            pollTimer = setInterval(pollBenchmarkStatus, 500);
        } catch (e) {
            alert('Error initiating benchmark session: ' + e);
            resetControls();
        }
    }

    async function stopBenchmark() {
        try {
            await fetch('/api/benchmark/stop', { method: 'POST' });
        } catch (e) { /* ignore */ }
    }

    async function pollBenchmarkStatus() {
        try {
            const resp = await fetch('/api/benchmark/status');
            const json = await resp.json();
            if (!json.success) return;

            const state = json.state;
            const elapsed = json.elapsed_seconds || 0;
            const target = json.target_duration || selectedDuration;

            updateProgress(elapsed, target);

            if (state === 'completed' || state === 'idle') {
                clearInterval(pollTimer);
                resetControls();
                if (json.report) {
                    renderReport(json.report);
                    loadBenchmarkHistory();
                }
            } else if (state === 'error') {
                clearInterval(pollTimer);
                resetControls();
                alert('Benchmark error: ' + (json.error || 'Unknown error occurred'));
            }
        } catch (e) { /* retry */ }
    }

    function updateProgress(elapsed, target) {
        const pct = Math.min(100, Math.round((elapsed / target) * 100));
        const bar = document.getElementById('benchProgressBar');
        const countText = document.getElementById('benchCountdownText');
        const statusText = document.getElementById('benchStatusText');

        if (bar) bar.style.width = `${pct}%`;
        if (countText) countText.textContent = `${Math.round(elapsed)}s / ${target}s`;
        if (statusText) statusText.textContent = `Capturing PresentMon frame events (${pct}% complete)...`;
    }

    function resetControls() {
        const startBtn = document.getElementById('benchStartBtn');
        const stopBtn = document.getElementById('benchStopBtn');
        const progressSec = document.getElementById('benchProgressSection');

        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.style.display = 'none';
        if (progressSec) progressSec.style.display = 'none';
    }

    function renderReport(report) {
        currentReport = report;
        const card = document.getElementById('benchResultsCard');
        if (!card) return;
        card.style.display = 'block';

        document.getElementById('reportAppTitle').textContent = `Benchmark: ${report.target_app || 'Application'}`;
        document.getElementById('reportMetaText').textContent = `Recorded on ${new Date((report.timestamp || Date.now() / 1000) * 1000).toLocaleString()} • ${report.duration_seconds || 0} seconds duration`;

        document.getElementById('resAvgFps').textContent = report.avg_fps !== null && report.avg_fps !== undefined ? `${report.avg_fps}` : '—';
        document.getElementById('resLow1Fps').textContent = report.low_1_fps !== null && report.low_1_fps !== undefined ? `${report.low_1_fps}` : '—';
        document.getElementById('resLow01Fps').textContent = report.low_01_fps !== null && report.low_01_fps !== undefined ? `${report.low_01_fps}` : '—';
        document.getElementById('resTotalFrames').textContent = (report.total_frames || 0).toLocaleString();
        document.getElementById('resDurationFmt').textContent = `${report.duration_seconds || 0}s window`;

        renderFrametimeChart(report.frame_times || []);
        renderHwChart(report.hardware_timeline || []);

        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderFrametimeChart(frameTimes) {
        const ctx = document.getElementById('frametimeChart')?.getContext('2d');
        if (!ctx || typeof Chart === 'undefined') return;

        if (frametimeChart) {
            frametimeChart.destroy();
            frametimeChart = null;
        }

        const labels = frameTimes.map(f => `${f.t}s`);
        const data = frameTimes.map(f => f.ms);

        frametimeChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Frame-Time (ms)',
                    data: data,
                    borderColor: '#34c77b',
                    backgroundColor: 'rgba(52, 199, 123, 0.08)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.parsed.y.toFixed(2)} ms (~${Math.round(1000 / ctx.parsed.y)} FPS)`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#9a9a9e', maxTicksLimit: 10 }
                    },
                    y: {
                        min: 0,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#9a9a9e', callback: (v) => v + ' ms' }
                    }
                }
            }
        });
    }

    function renderHwChart(hwSamples) {
        const ctx = document.getElementById('hwCorrelationChart')?.getContext('2d');
        if (!ctx || typeof Chart === 'undefined') return;

        if (hwCorrelationChart) {
            hwCorrelationChart.destroy();
            hwCorrelationChart = null;
        }

        const labels = hwSamples.map(h => `${h.t}s`);
        const cpuData = hwSamples.map(h => h.cpu_percent || 0);
        const gpuData = hwSamples.map(h => h.gpu_load !== null && h.gpu_load !== undefined ? h.gpu_load : null);
        const gpuTempData = hwSamples.map(h => h.gpu_temp !== null && h.gpu_temp !== undefined ? h.gpu_temp : null);

        hwCorrelationChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'CPU Usage %',
                        data: cpuData,
                        borderColor: '#e8442c',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y'
                    },
                    {
                        label: 'GPU Load %',
                        data: gpuData,
                        borderColor: '#38bdf8',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y'
                    },
                    {
                        label: 'GPU Temp (°C)',
                        data: gpuTempData,
                        borderColor: '#f5b942',
                        borderWidth: 1.5,
                        borderDash: [4, 4],
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#9a9a9e', font: { family: 'Inter', size: 11 }, boxWidth: 12 }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#9a9a9e', maxTicksLimit: 10 }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        min: 0,
                        max: 100,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#9a9a9e', callback: (v) => v + '%' }
                    },
                    y1: {
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

    async function loadBenchmarkHistory() {
        const tbody = document.getElementById('benchHistoryTableBody');
        const countText = document.getElementById('historyCountText');
        if (!tbody) return;

        try {
            const resp = await fetch('/api/benchmark/history');
            const json = await resp.json();
            if (!json.success || !json.data || json.data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="padding: 24px; text-align: center; color: var(--text-on-dark-muted);">No benchmark runs recorded yet.</td></tr>`;
                if (countText) countText.textContent = '0 runs stored';
                return;
            }

            const runs = json.data;
            if (countText) countText.textContent = `${runs.length} run(s) stored`;

            let rows = '';
            runs.forEach(r => {
                const dateStr = new Date(r.timestamp * 1000).toLocaleString();
                const avg = r.avg_fps !== null ? `${r.avg_fps} FPS` : '—';
                const l1 = r.low_1_fps !== null ? `${r.low_1_fps} FPS` : '—';
                const l01 = r.low_01_fps !== null ? `${r.low_01_fps} FPS` : '—';

                rows += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td style="padding: 12px 14px; color: var(--text-on-dark); font-family: monospace; font-size: 0.82rem;">${dateStr}</td>
                        <td style="padding: 12px 14px; font-weight: 500; color: #a5b4fc;">${r.target_app || 'Application'}</td>
                        <td style="padding: 12px 14px; color: var(--text-on-dark-muted);">${r.duration_seconds}s (${r.total_frames} frames)</td>
                        <td style="padding: 12px 14px; font-weight: 600; color: var(--text-on-dark);">${avg}</td>
                        <td style="padding: 12px 14px; color: #f5b942;">${l1}</td>
                        <td style="padding: 12px 14px; color: var(--status-critical);">${l01}</td>
                        <td style="padding: 12px 14px; text-align: right;">
                            <button class="btn btn-ghost load-run-btn" data-id="${r.id}" style="font-size: 0.78rem; padding: 4px 12px;">
                                View Report
                            </button>
                        </td>
                    </tr>
                `;
            });

            tbody.innerHTML = rows;

            document.querySelectorAll('.load-run-btn').forEach(b => {
                b.addEventListener('click', async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    try {
                        const rResp = await fetch(`/api/benchmark/history/${id}`);
                        const rJson = await rResp.json();
                        if (rJson.success && rJson.data) {
                            renderReport(rJson.data);
                        }
                    } catch (err) { /* retry */ }
                });
            });

        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="7" style="padding: 24px; text-align: center; color: var(--status-critical);">Failed to load history</td></tr>`;
        }
    }

    function exportReport() {
        if (!currentReport) return;
        const blob = new Blob([JSON.stringify(currentReport, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `benchmark_${(currentReport.target_app || 'run').replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
});
