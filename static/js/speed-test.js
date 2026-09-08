/**
 * Network Speed Test Frontend Controller
 * Real-time telemetry, SVG radial gauge animation, and historical trend chart.
 * Zero canvas rendering — pure SVG & CSS.
 */

(function () {
    'use strict';

    // Gauge constants
    const GAUGE_ARC_LENGTH = 518.36; // 270deg arc of r=110 circle (2 * PI * 110 * 270/360)
    let pollInterval = null;
    let cooldownTimer = null;
    let cooldownRemaining = 0;
    let isTestActive = false;

    // DOM Elements
    let elements = {};

    document.addEventListener('DOMContentLoaded', () => {
        initElements();
        initEventListeners();
        checkInitialStatus();
        loadHistory();
    });

    function initElements() {
        elements = {
            startBtn: document.getElementById('startSpeedTestBtn'),
            startBtnLabel: document.getElementById('startBtnLabel'),
            cooldownPill: document.getElementById('cooldownPill'),
            cooldownLabel: document.getElementById('cooldownLabel'),
            cooldownHelper: document.getElementById('cooldownHelper'),
            engineStatusDot: document.getElementById('engineStatusDot'),
            engineStatusText: document.getElementById('engineStatusText'),
            stageBanner: document.getElementById('stageBanner'),
            stagePulseIcon: document.getElementById('stagePulseIcon'),
            stageTitle: document.getElementById('stageTitle'),
            stageSubtitle: document.getElementById('stageSubtitle'),
            stageProgressBar: document.getElementById('stageProgressBar'),
            gaugeProgressCircle: document.getElementById('gaugeProgressCircle'),
            gaugeDigitalVal: document.getElementById('gaugeDigitalVal'),
            gaugePhaseTag: document.getElementById('gaugePhaseTag'),
            gaugeUnitTag: document.getElementById('gaugeUnitTag'),
            resPing: document.getElementById('resPing'),
            resDownload: document.getElementById('resDownload'),
            resUpload: document.getElementById('resUpload'),
            resServer: document.getElementById('resServer'),
            resIsp: document.getElementById('resIsp'),
            resLocation: document.getElementById('resLocation'),
            pingQuality: document.getElementById('pingQuality'),
            speedHistorySvg: document.getElementById('speedHistorySvg'),
            chartEmptyState: document.getElementById('chartEmptyState'),
            speedHistoryTableBody: document.getElementById('speedHistoryTableBody'),
            tableCountBadge: document.getElementById('tableCountBadge'),
            refreshHistoryBtn: document.getElementById('refreshHistoryBtn')
        };
    }

    function initEventListeners() {
        if (elements.startBtn) {
            elements.startBtn.addEventListener('click', () => {
                if (!isTestActive && cooldownRemaining <= 0) {
                    startSpeedTest();
                }
            });
        }

        if (elements.refreshHistoryBtn) {
            elements.refreshHistoryBtn.addEventListener('click', () => {
                loadHistory();
            });
        }
    }

    /**
     * Check if test is already running or in cooldown on page load.
     */
    async function checkInitialStatus() {
        try {
            const res = await fetch('/api/speedtest/status');
            const data = await res.json();
            if (data.success && data.data) {
                const status = data.data;
                if (status.is_running) {
                    startPolling();
                } else {
                    if (status.remaining_cooldown > 0) {
                        applyCooldown(status.remaining_cooldown);
                    }
                    if (status.result) {
                        displayResult(status.result);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to get initial speed test status:', err);
        }
    }

    /**
     * Trigger speed test via POST /api/speedtest/run
     */
    async function startSpeedTest() {
        setBtnLoading(true);
        updateGauge(0, 'INITIATING', 'Mbps');
        setStageState('testing', 'Initializing Test...', 'Connecting to Ookla / Edge CDN probes...', 5);

        try {
            const res = await fetch('/api/speedtest/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();

            if (res.status === 429) {
                // Cooldown active
                const remaining = data.remaining_cooldown || 30;
                applyCooldown(remaining);
                setStageState('idle', 'Cooldown Active', `Please wait ${remaining}s before testing again`, 0);
                setBtnLoading(false);
                return;
            }

            if (res.ok && data.success) {
                isTestActive = true;
                startPolling();
            } else {
                setStageState('error', 'Initiation Failed', data.message || 'Unable to launch speed test', 0);
                setBtnLoading(false);
            }
        } catch (err) {
            console.error('Error starting speed test:', err);
            setStageState('error', 'Network Error', 'Could not reach server endpoint', 0);
            setBtnLoading(false);
        }
    }

    /**
     * Start status polling every 500ms
     */
    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        isTestActive = true;
        setBtnLoading(true);

        pollInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/speedtest/status');
                const data = await res.json();
                if (!data.success || !data.data) return;

                const status = data.data;
                handleStatusUpdate(status);
            } catch (err) {
                console.error('Poll error:', err);
            }
        }, 500);
    }

    function stopPolling() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        isTestActive = false;
    }

    /**
     * Handle incoming status telemetry
     */
    function handleStatusUpdate(status) {
        // Progress bar and stage info
        elements.stageProgressBar.style.width = `${status.progress}%`;
        elements.stageSubtitle.textContent = status.stage_message;

        if (status.status === 'testing_ping') {
            setStageState('testing', 'Measuring Latency', status.stage_message, status.progress);
            elements.gaugePhaseTag.textContent = 'PING';
            elements.gaugeUnitTag.textContent = 'ms';
            elements.gaugeDigitalVal.textContent = status.current_speed_mbps.toFixed(1);
        } else if (status.status === 'testing_download') {
            setStageState('testing', 'Testing Download Throughput', status.stage_message, status.progress);
            updateGauge(status.current_speed_mbps, 'DOWNLOAD', 'Mbps');
            if (elements.resDownload) {
                elements.resDownload.textContent = status.current_speed_mbps.toFixed(1);
            }
        } else if (status.status === 'testing_upload') {
            setStageState('testing', 'Testing Upload Throughput', status.stage_message, status.progress);
            updateGauge(status.current_speed_mbps, 'UPLOAD', 'Mbps');
            if (elements.resUpload) {
                elements.resUpload.textContent = status.current_speed_mbps.toFixed(1);
            }
        } else if (status.status === 'complete') {
            stopPolling();
            setStageState('complete', 'Speed Test Completed', 'All latency and throughput metrics recorded', 100);
            if (status.result) {
                displayResult(status.result);
            }
            if (status.remaining_cooldown > 0) {
                applyCooldown(status.remaining_cooldown);
            } else {
                setBtnLoading(false);
            }
            loadHistory();
        } else if (status.status === 'error') {
            stopPolling();
            setStageState('error', 'Test Failed', status.error || 'Unknown error occurred during test', 0);
            if (status.remaining_cooldown > 0) {
                applyCooldown(status.remaining_cooldown);
            } else {
                setBtnLoading(false);
            }
        }
    }

    /**
     * Display completed results on metric cards and gauge
     */
    function displayResult(result) {
        if (!result) return;

        if (elements.resPing) elements.resPing.textContent = result.ping_ms ? result.ping_ms.toFixed(1) : '--';
        if (elements.resDownload) elements.resDownload.textContent = result.download_mbps ? result.download_mbps.toFixed(1) : '--';
        if (elements.resUpload) elements.resUpload.textContent = result.upload_mbps ? result.upload_mbps.toFixed(1) : '--';

        const serverName = result.server_name || (result.server_sponsor ? `${result.server_sponsor}` : 'Edge Server');
        if (elements.resServer) elements.resServer.textContent = serverName;
        if (elements.resIsp) elements.resIsp.textContent = result.isp || 'Local Network';
        if (elements.resLocation) {
            const loc = [result.server_country, result.client_ip ? `IP: ${result.client_ip}` : ''].filter(Boolean).join(' • ');
            elements.resLocation.textContent = loc || 'Edge Probe';
        }

        // Quality rating
        if (elements.pingQuality && result.ping_ms) {
            if (result.ping_ms < 20) elements.pingQuality.textContent = 'Excellent (Low Latency)';
            else if (result.ping_ms < 50) elements.pingQuality.textContent = 'Good (Moderate Latency)';
            else elements.pingQuality.textContent = 'High Latency';
        }

        // Keep download speed in center gauge
        if (result.download_mbps) {
            updateGauge(result.download_mbps, 'FINAL DOWNLOAD', 'Mbps');
        }
    }

    /**
     * Update SVG radial gauge arc and digital readout
     */
    function updateGauge(speed, phase, unit) {
        if (elements.gaugeDigitalVal) elements.gaugeDigitalVal.textContent = speed.toFixed(1);
        if (elements.gaugePhaseTag) elements.gaugePhaseTag.textContent = phase;
        if (elements.gaugeUnitTag) elements.gaugeUnitTag.textContent = unit;

        if (elements.gaugeProgressCircle) {
            // Auto-scale: baseline 100 Mbps, or scale to 250, 500, 1000 if higher
            let maxScale = 100;
            if (speed > 500) maxScale = 1000;
            else if (speed > 250) maxScale = 500;
            else if (speed > 100) maxScale = 250;

            const fraction = Math.min(1.0, Math.max(0.0, speed / maxScale));
            const offset = GAUGE_ARC_LENGTH * (1.0 - fraction);
            elements.gaugeProgressCircle.style.strokeDashoffset = offset.toFixed(2);
        }
    }

    /**
     * Set stage banner state
     */
    function setStageState(type, title, subtitle, progressPercent) {
        if (elements.stageTitle) elements.stageTitle.textContent = title;
        if (elements.stageSubtitle) elements.stageSubtitle.textContent = subtitle;
        if (elements.stageProgressBar) elements.stageProgressBar.style.width = `${progressPercent}%`;

        if (elements.stagePulseIcon) {
            elements.stagePulseIcon.className = 'stage-pulse-icon ' + type;
        }

        if (elements.engineStatusText) {
            elements.engineStatusText.textContent = type === 'testing' ? 'Testing Bandwidth...' : 'Service Ready';
        }
        if (elements.engineStatusDot) {
            elements.engineStatusDot.style.background = type === 'testing' ? '#38BDF8' : (type === 'error' ? '#EF4444' : '#10B981');
        }
    }

    /**
     * Set button loading / running state
     */
    function setBtnLoading(isLoading) {
        if (!elements.startBtn) return;
        elements.startBtn.disabled = isLoading;
        if (elements.startBtnLabel) {
            elements.startBtnLabel.textContent = isLoading ? 'Testing in Progress...' : 'Run Speed Test';
        }
    }

    /**
     * Apply 30s cooldown timer countdown
     */
    function applyCooldown(seconds) {
        if (cooldownTimer) clearInterval(cooldownTimer);
        cooldownRemaining = seconds;

        if (elements.startBtn) elements.startBtn.disabled = true;
        if (elements.cooldownPill) elements.cooldownPill.style.display = 'inline-flex';
        if (elements.cooldownLabel) elements.cooldownLabel.textContent = `Cooldown: ${cooldownRemaining}s`;

        cooldownTimer = setInterval(() => {
            cooldownRemaining--;
            if (cooldownRemaining <= 0) {
                clearInterval(cooldownTimer);
                cooldownTimer = null;
                cooldownRemaining = 0;
                if (elements.cooldownPill) elements.cooldownPill.style.display = 'none';
                if (elements.startBtn && !isTestActive) {
                    elements.startBtn.disabled = false;
                    if (elements.startBtnLabel) elements.startBtnLabel.textContent = 'Run Speed Test';
                }
            } else {
                if (elements.cooldownLabel) elements.cooldownLabel.textContent = `Cooldown: ${cooldownRemaining}s`;
            }
        }, 1000);
    }

    /**
     * Fetch past speed test history from /api/speedtest/history
     */
    async function loadHistory() {
        try {
            const res = await fetch('/api/speedtest/history?limit=30');
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                renderTable(data.data);
                renderChart(data.data);
            }
        } catch (err) {
            console.error('Failed to load speed test history:', err);
        }
    }

    /**
     * Render historical test runs table
     */
    function renderTable(records) {
        if (!elements.speedHistoryTableBody) return;

        if (elements.tableCountBadge) {
            elements.tableCountBadge.textContent = `${records.length} records`;
        }

        if (records.length === 0) {
            elements.speedHistoryTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="table-empty-cell">No speed tests recorded yet. Run a test above!</td>
                </tr>
            `;
            return;
        }

        elements.speedHistoryTableBody.innerHTML = records.map(r => {
            const dateStr = new Date(r.timestamp * 1000).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const ping = r.ping_ms != null ? `${r.ping_ms.toFixed(1)} ms` : '--';
            const dl = r.download_mbps != null ? `${r.download_mbps.toFixed(1)} Mbps` : '--';
            const ul = r.upload_mbps != null ? `${r.upload_mbps.toFixed(1)} Mbps` : '--';
            const server = r.server_name || r.server_sponsor || 'Edge Node';
            const isp = r.isp || 'Local Network';
            const statusClass = r.status === 'completed' ? 'status-completed' : (r.status === 'fallback' ? 'status-fallback' : 'status-failed');
            const statusLabel = r.status ? (r.status.charAt(0).toUpperCase() + r.status.slice(1)) : 'Completed';

            return `
                <tr>
                    <td><strong>${dateStr}</strong></td>
                    <td style="color: #ECC94B;">${ping}</td>
                    <td style="color: #4E88FF; font-weight: 600;">${dl}</td>
                    <td style="color: #68D391; font-weight: 600;">${ul}</td>
                    <td>${escapeHtml(server)}</td>
                    <td style="color: #94A3B8;">${escapeHtml(isp)}</td>
                    <td><span class="table-status-pill ${statusClass}">${statusLabel}</span></td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Render SVG Historical Bandwidth Chart (Pure SVG, NO CANVAS)
     */
    function renderChart(records) {
        const svg = elements.speedHistorySvg;
        if (!svg) return;

        // Valid records with numeric download/upload, reversed to chronological order (left to right)
        const valid = records
            .filter(r => r.download_mbps != null && r.upload_mbps != null)
            .slice(0, 20)
            .reverse();

        if (valid.length === 0) {
            svg.innerHTML = '';
            if (elements.chartEmptyState) elements.chartEmptyState.style.display = 'flex';
            return;
        }

        if (elements.chartEmptyState) elements.chartEmptyState.style.display = 'none';

        const width = 900;
        const height = 240;
        const padLeft = 60;
        const padRight = 30;
        const padTop = 25;
        const padBottom = 35;
        const chartW = width - padLeft - padRight;
        const chartH = height - padTop - padBottom;

        // Max speed for Y-axis scale
        const maxVal = Math.max(...valid.map(r => Math.max(r.download_mbps, r.upload_mbps, 10)));
        const yMax = Math.ceil(maxVal * 1.15);

        // Coordinates mapping
        const getX = (idx) => padLeft + (valid.length === 1 ? chartW / 2 : (idx / (valid.length - 1)) * chartW);
        const getY = (val) => padTop + chartH - (val / yMax) * chartH;

        // Build grid lines
        let gridSvg = '';
        const ySteps = 4;
        for (let i = 0; i <= ySteps; i++) {
            const stepVal = Math.round((yMax / ySteps) * i);
            const yPos = getY(stepVal);
            gridSvg += `
                <line x1="${padLeft}" y1="${yPos}" x2="${width - padRight}" y2="${yPos}" stroke="#21262D" stroke-width="1" stroke-dasharray="3,3" />
                <text x="${padLeft - 10}" y="${yPos + 4}" fill="#64748B" font-size="11" text-anchor="end" font-family="sans-serif">${stepVal}M</text>
            `;
        }

        // Build points & paths for Download and Upload
        let dlPoints = [];
        let ulPoints = [];
        let dotsSvg = '';
        let xLabelsSvg = '';

        valid.forEach((r, idx) => {
            const x = getX(idx);
            const yDl = getY(r.download_mbps);
            const yUl = getY(r.upload_mbps);

            dlPoints.push(`${x},${yDl}`);
            ulPoints.push(`${x},${yUl}`);

            // Circles and tooltips
            dotsSvg += `
                <circle cx="${x}" cy="${yDl}" r="4.5" fill="#4E88FF" stroke="#161B22" stroke-width="2">
                    <title>Download: ${r.download_mbps.toFixed(1)} Mbps</title>
                </circle>
                <circle cx="${x}" cy="${yUl}" r="4.5" fill="#68D391" stroke="#161B22" stroke-width="2">
                    <title>Upload: ${r.upload_mbps.toFixed(1)} Mbps</title>
                </circle>
            `;

            // X-axis label (show up to 7 labels)
            if (valid.length <= 7 || idx % Math.ceil(valid.length / 6) === 0 || idx === valid.length - 1) {
                const timeLabel = new Date(r.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                xLabelsSvg += `<text x="${x}" y="${height - 12}" fill="#64748B" font-size="10" text-anchor="middle" font-family="sans-serif">${timeLabel}</text>`;
            }
        });

        // SVG Area paths
        const dlPathD = `M ${dlPoints.join(' L ')}`;
        const ulPathD = `M ${ulPoints.join(' L ')}`;

        const firstX = getX(0);
        const lastX = getX(valid.length - 1);
        const baseY = padTop + chartH;

        const dlAreaD = `${dlPathD} L ${lastX},${baseY} L ${firstX},${baseY} Z`;
        const ulAreaD = `${ulPathD} L ${lastX},${baseY} L ${firstX},${baseY} Z`;

        svg.innerHTML = `
            <defs>
                <linearGradient id="dlAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#4E88FF" stop-opacity="0.3" />
                    <stop offset="100%" stop-color="#4E88FF" stop-opacity="0.0" />
                </linearGradient>
                <linearGradient id="ulAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#68D391" stop-opacity="0.2" />
                    <stop offset="100%" stop-color="#68D391" stop-opacity="0.0" />
                </linearGradient>
            </defs>

            <!-- Grid & Axes -->
            ${gridSvg}
            ${xLabelsSvg}

            <!-- Area Fills -->
            <path d="${dlAreaD}" fill="url(#dlAreaGrad)" />
            <path d="${ulAreaD}" fill="url(#ulAreaGrad)" />

            <!-- Smooth Lines -->
            <path d="${dlPathD}" fill="none" stroke="#4E88FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            <path d="${ulPathD}" fill="none" stroke="#68D391" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

            <!-- Interactive Dots -->
            ${dotsSvg}
        `;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
})();
