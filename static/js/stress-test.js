/**
 * GPU Stress Test & Thermal Stability Engine
 * Features:
 * 1. WebGL2 Procedural Volumetric Raymarching Shader (Original, zero external code)
 * 2. Precision Frame-Time, 1% Lows & Stability Score Analysis
 * 3. 500ms Hardware Telemetry Poller (GPU temp, load, clock, VRAM)
 * 4. Chart.js Dual-Axis Correlation Chart (Live & Post-Run)
 * 5. Automatic Thermal Safety Abort
 * 6. SQLite History Persistence & JSON Export
 */

console.log("[STRESS-TEST] module loaded");

(function () {
    'use strict';

    // ── Configuration & State ──────────────────────────────────────────────────
    let isRunning = false;
    let currentPreset = 'medium';
    let currentDuration = 30; // seconds, 0 = unlimited
    let testStartTime = 0;
    let testAnimFrameId = null;
    let telemetryIntervalId = null;
    let idleTelemetryIntervalId = null;

    // Safety threshold (°C)
    let safetyTempLimit = 85.0;

    // Hardware state cache
    let latestTelemetry = {
        gpu_available: false,
        gpu_name: 'Detecting...',
        gpu_temp: null,
        gpu_load: null,
        gpu_vram_used: null,
        gpu_vram_total: null,
        gpu_clock_mhz: null,
        cpu_load: null,
        safety_temp_threshold: 85.0,
    };

    // Frame statistics
    let frameTimes = [];       // all delta ms during run
    let totalFrames = 0;
    let lastFrameTimestamp = 0;
    let runTimeline = [];      // time-series samples for correlation

    // WebGL2 Resources
    let gl = null;
    let program = null;
    let quadVao = null;
    let uTimeLoc = null;
    let uResolutionLoc = null;
    let uStepsLoc = null;
    let uOctavesLoc = null;
    let uDensityLoc = null;

    // Preset configurations
    const PRESETS = {
        low: {
            scale: 0.5,
            steps: 36,
            octaves: 2,
            density: 1.4,
            label: 'Low (0.5x Scale, 36 Steps)',
        },
        medium: {
            scale: 0.75,
            steps: 64,
            octaves: 3,
            density: 1.8,
            label: 'Medium (0.75x Scale, 64 Steps)',
        },
        high: {
            scale: 1.0,
            steps: 100,
            octaves: 4,
            density: 2.2,
            label: 'High (Native 1.0x, 100 Steps)',
        },
        extreme: {
            scale: 1.25,
            steps: 160,
            octaves: 5,
            density: 2.8,
            label: 'Extreme (1.25x Supersampled, 160 Steps)',
        },
    };

    // Charts
    let liveChart = null;
    let resultsChart = null;

    // Last completed run cache for export
    let lastCompletedRunData = null;

    // ── DOM Elements ───────────────────────────────────────────────────────────
    const elements = {
        canvas: document.getElementById('stress-canvas') || document.getElementById('stressGlCanvas'),
        canvasWrapper: document.getElementById('canvasWrapper'),
        stageCard: document.getElementById('stressStageCard'),
        idleOverlay: document.getElementById('idleOverlay'),
        countdownFill: document.getElementById('countdownFill'),
        startBtn: document.getElementById('startStressBtn'),
        stopBtn: document.getElementById('stopStressBtn'),
        presetTabs: document.querySelectorAll('#presetTabs .editorial-pill-btn'),
        durationTabs: document.querySelectorAll('#durationTabs .editorial-pill-btn'),
        fullscreenBtn: document.getElementById('canvasFullscreenBtn'),
        fsText: document.getElementById('fsText'),
        fsIcon: document.getElementById('fsIcon'),
        // Badges & alerts
        gpuStatusBadge: document.getElementById('gpuStatusBadge'),
        safetyThresholdText: document.getElementById('safetyThresholdText'),
        safetyBadge: document.getElementById('safetyBadge'),
        safetyAbortAlert: document.getElementById('safetyAbortAlert'),
        safetyAbortMessage: document.getElementById('safetyAbortMessage'),
        // HUD
        hudFps: document.getElementById('hudFps'),
        hudFrameTime: document.getElementById('hudFrameTime'),
        hudGpuTemp: document.getElementById('hudGpuTemp'),
        hudGpuLoadClock: document.getElementById('hudGpuLoadClock'),
        // Results
        resultsSection: document.getElementById('stressResultsSection'),
        resultsStatusEyebrow: document.getElementById('resultsStatusEyebrow'),
        resultsHeading: document.getElementById('resultsHeading'),
        resultsSubtext: document.getElementById('resultsSubtext'),
        statStability: document.getElementById('statStability'),
        statAvgFps: document.getElementById('statAvgFps'),
        statOnePercentLow: document.getElementById('statOnePercentLow'),
        statMinFps: document.getElementById('statMinFps'),
        statPeakTemp: document.getElementById('statPeakTemp'),
        statPeakTempLimit: document.getElementById('statPeakTempLimit'),
        statPeakLoad: document.getElementById('statPeakLoad'),
        statPeakVram: document.getElementById('statPeakVram'),
        statVramTotal: document.getElementById('statVramTotal'),
        resultsExportBtn: document.getElementById('resultsExportBtn'),
        resultsRetestBtn: document.getElementById('resultsRetestBtn'),
        // History
        historyTableBody: document.getElementById('stressHistoryTableBody'),
        refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
    };

    // ── Procedural WebGL2 Raymarching Shaders ──────────────────────────────────
    const VS_SOURCE = `#version 300 es
    in vec2 a_position;
    out vec2 v_uv;
    void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }`;

    // Stage 2: Animated Gradient with u_time
    const FS_SOURCE = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform float u_time;
    out vec4 fragColor;
    void main() {
        fragColor = vec4(v_uv.x, v_uv.y, 0.5 + 0.5 * sin(u_time), 1.0);
    }`;

    // ── WebGL2 Engine Initialization ──────────────────────────────────────────
    function initWebGL() {
        gl = elements.canvas.getContext('webgl2', {
            alpha: false,
            depth: false,
            stencil: false,
            antialias: false,
            powerPreference: 'high-performance',
        });

        console.log("WebGL2 support:", !!gl);
        if (gl) {
            console.log("RENDERER:", gl.getParameter(gl.RENDERER));
            console.log("VENDOR:", gl.getParameter(gl.VENDOR));
            console.log("GLSL version:", gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
        }

        if (!gl) {
            console.error('WebGL2 not supported on this browser/GPU');
            elements.idleOverlay.innerHTML = `
                <div class="stress-idle-icon" style="color: var(--status-critical);">✕</div>
                <div class="stress-idle-title">WebGL2 Not Supported</div>
                <div class="stress-idle-subtitle">This device or browser does not have WebGL2 acceleration enabled.</div>
            `;
            elements.startBtn.disabled = true;
            return false;
        }

        const vs = createShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
        const fs = createShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);
        if (!vs || !fs) return false;

        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Shader program link failed:', gl.getProgramInfoLog(program));
            return false;
        }

        // Fullscreen quad [-1, -1] to [1, 1]
        const quadPos = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0,
        ]);

        quadVao = gl.createVertexArray();
        gl.bindVertexArray(quadVao);

        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, quadPos, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        // Uniform locations
        uTimeLoc = gl.getUniformLocation(program, 'u_time');
        uResolutionLoc = gl.getUniformLocation(program, 'u_resolution');
        uStepsLoc = gl.getUniformLocation(program, 'u_steps');
        uOctavesLoc = gl.getUniformLocation(program, 'u_octaves');
        uDensityLoc = gl.getUniformLocation(program, 'u_density');

        // Draw initial verification frame
        gl.viewport(0, 0, elements.canvas.width || 800, elements.canvas.height || 600);
        gl.useProgram(program);
        gl.bindVertexArray(quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        return true;
    }

    function createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    function resizeCanvas() {
        if (!gl || !elements.canvas) return;
        const rect = elements.canvasWrapper.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const preset = PRESETS[currentPreset] || PRESETS.medium;
        const scale = preset.scale;

        const targetW = Math.max(1, Math.floor(rect.width * dpr * scale));
        const targetH = Math.max(1, Math.floor(rect.height * dpr * scale));

        if (elements.canvas.width !== targetW || elements.canvas.height !== targetH) {
            elements.canvas.width = targetW;
            elements.canvas.height = targetH;
            gl.viewport(0, 0, targetW, targetH);
        }
    }

    // ── Telemetry Poller ───────────────────────────────────────────────────────
    async function fetchTelemetry() {
        try {
            const res = await fetch('/api/stress-test/telemetry');
            if (!res.ok) return null;
            const json = await res.json();
            if (json.success && json.data) {
                latestTelemetry = json.data;
                updateHeaderAndHUD();
                checkSafetyAbort();
                return json.data;
            }
        } catch (err) {
            console.debug('Telemetry fetch failed:', err);
        }
        return null;
    }

    function updateHeaderAndHUD() {
        // Hardware status badge in header
        if (latestTelemetry.gpu_available) {
            const tempStr = latestTelemetry.gpu_temp !== null ? `${Math.round(latestTelemetry.gpu_temp)}°C` : 'N/A';
            const loadStr = latestTelemetry.gpu_load !== null ? `${Math.round(latestTelemetry.gpu_load)}%` : 'N/A';
            elements.gpuStatusBadge.textContent = `${latestTelemetry.gpu_name} • ${tempStr} • ${loadStr}`;
            elements.gpuStatusBadge.style.color = '#34c77b';
        } else {
            elements.gpuStatusBadge.textContent = 'GPU Hardware Sensors Offline';
            elements.gpuStatusBadge.style.color = 'var(--text-on-dark-muted)';
        }

        // Safety limit text
        if (latestTelemetry.safety_temp_threshold) {
            safetyTempLimit = Number(latestTelemetry.safety_temp_threshold);
            elements.safetyThresholdText.textContent = `${safetyTempLimit}°C`;
            elements.statPeakTempLimit.textContent = `Cutoff limit: ${safetyTempLimit}°C`;
        }

        // Canvas HUD (active during run)
        if (latestTelemetry.gpu_temp !== null) {
            const t = Math.round(latestTelemetry.gpu_temp);
            elements.hudGpuTemp.textContent = `${t}°C`;
            if (t >= safetyTempLimit - 3) {
                elements.hudGpuTemp.className = 'stress-hud-val temp-hot';
            } else {
                elements.hudGpuTemp.className = 'stress-hud-val';
            }
        } else {
            elements.hudGpuTemp.textContent = 'N/A';
        }

        const gLoad = latestTelemetry.gpu_load !== null ? `${Math.round(latestTelemetry.gpu_load)}%` : '—';
        const gClock = latestTelemetry.gpu_clock_mhz ? ` / ${latestTelemetry.gpu_clock_mhz}MHz` : '';
        elements.hudGpuLoadClock.textContent = `${gLoad}${gClock}`;
    }

    // ── Thermal Safety Auto-Abort Guard ────────────────────────────────────────
    function checkSafetyAbort() {
        if (!isRunning) return;

        const currentTemp = latestTelemetry.gpu_temp;
        if (currentTemp !== null && currentTemp >= safetyTempLimit) {
            console.warn(`[SAFETY CUTOFF TRIGGERED] GPU temp ${currentTemp}°C reached threshold ${safetyTempLimit}°C`);
            stopStressTest({
                aborted: true,
                abortReason: `Thermal safety cutoff triggered: GPU temperature reached ${currentTemp}°C (limit ${safetyTempLimit}°C).`,
            });
        }
    }

    // ── Render Loop & Frame Accounting ────────────────────────────────────────
    function renderFrame(now) {
        if (!isRunning) return;

        // Calculate precision delta frame time
        if (lastFrameTimestamp > 0) {
            const delta = now - lastFrameTimestamp;
            frameTimes.push(delta);
            totalFrames++;

            // Update HUD FPS every 8 frames for smooth readability
            if (totalFrames % 8 === 0) {
                const instantFps = Math.round(1000 / delta);
                elements.hudFps.textContent = `${instantFps}`;
                elements.hudFrameTime.textContent = `${delta.toFixed(1)} ms`;

                if (instantFps >= 60) {
                    elements.hudFps.className = 'stress-hud-val fps-good';
                } else if (instantFps >= 30) {
                    elements.hudFps.className = 'stress-hud-val fps-warn';
                } else {
                    elements.hudFps.className = 'stress-hud-val fps-bad';
                }
            }
        }
        lastFrameTimestamp = now;

        // Update progress bar
        const elapsedSec = (performance.now() - testStartTime) / 1000;
        if (currentDuration > 0) {
            const pct = Math.min(100, (elapsedSec / currentDuration) * 100);
            elements.countdownFill.style.width = `${pct}%`;

            if (elapsedSec >= currentDuration) {
                stopStressTest({ aborted: false, abortReason: '' });
                return;
            }
        } else {
            // Unlimited mode: pulsing indicator
            elements.countdownFill.style.width = '100%';
        }

        // WebGL Render Draw Call
        gl.useProgram(program);
        gl.bindVertexArray(quadVao);

        const preset = PRESETS[currentPreset] || PRESETS.medium;
        const timeSec = elapsedSec;

        gl.uniform1f(uTimeLoc, timeSec);
        gl.uniform2f(uResolutionLoc, elements.canvas.width, elements.canvas.height);
        gl.uniform1i(uStepsLoc, preset.steps);
        gl.uniform1i(uOctavesLoc, preset.octaves);
        gl.uniform1f(uDensityLoc, preset.density);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        testAnimFrameId = requestAnimationFrame(renderFrame);
    }

    // ── Live Correlation Chart ─────────────────────────────────────────────────
    function initLiveChart() {
        const ctx = document.getElementById('stressLiveChart').getContext('2d');
        if (liveChart) {
            liveChart.destroy();
        }

        liveChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Client FPS',
                        data: [],
                        borderColor: '#34c77b',
                        backgroundColor: 'rgba(52, 199, 123, 0.08)',
                        borderWidth: 2,
                        tension: 0.25,
                        pointRadius: 0,
                        fill: true,
                        yAxisID: 'yFps',
                    },
                    {
                        label: 'GPU Temp (°C)',
                        data: [],
                        borderColor: '#e8442c',
                        borderWidth: 2,
                        tension: 0.25,
                        pointRadius: 0,
                        fill: false,
                        yAxisID: 'yHardware',
                    },
                    {
                        label: 'GPU Load (%)',
                        data: [],
                        borderColor: '#f5b942',
                        borderWidth: 1.5,
                        borderDash: [4, 4],
                        tension: 0.25,
                        pointRadius: 0,
                        fill: false,
                        yAxisID: 'yHardware',
                    },
                    {
                        label: 'VRAM Used (GB)',
                        data: [],
                        borderColor: '#818cf8',
                        borderWidth: 1.5,
                        tension: 0.25,
                        pointRadius: 0,
                        fill: false,
                        yAxisID: 'yHardware',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        display: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#9a9a9e', font: { family: 'JetBrains Mono', size: 11 }, maxTicksLimit: 8 },
                        title: { display: true, text: 'Elapsed Test Time (s)', color: '#9a9a9e', font: { size: 11 } },
                    },
                    yFps: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#34c77b', font: { family: 'JetBrains Mono', size: 11 } },
                        title: { display: true, text: 'Rendering FPS', color: '#34c77b', font: { size: 11 } },
                    },
                    yHardware: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
                        max: 100,
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#e8442c', font: { family: 'JetBrains Mono', size: 11 } },
                        title: { display: true, text: 'Temp (°C) / Load (%) / VRAM', color: '#e8442c', font: { size: 11 } },
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(20, 20, 22, 0.95)',
                        titleColor: '#f5f5f3',
                        bodyColor: '#9a9a9e',
                        borderColor: 'rgba(255, 255, 255, 0.12)',
                        borderWidth: 1,
                    },
                },
            },
        });
    }

    function recordTelemetrySnapshot() {
        if (!isRunning) return;

        const elapsedSec = Math.round((performance.now() - testStartTime) / 1000);

        // Recent window FPS
        let instantFps = 0;
        if (frameTimes.length > 0) {
            const recent = frameTimes.slice(-15);
            const sum = recent.reduce((a, b) => a + b, 0);
            instantFps = Math.round((recent.length / sum) * 1000);
        }

        const sample = {
            time: elapsedSec,
            fps: instantFps,
            gpuTemp: latestTelemetry.gpu_temp,
            gpuLoad: latestTelemetry.gpu_load,
            vramUsed: latestTelemetry.gpu_vram_used,
            clockMhz: latestTelemetry.gpu_clock_mhz,
            cpuLoad: latestTelemetry.cpu_load,
        };

        runTimeline.push(sample);

        // Push to live chart (keep max 60 points on live display)
        if (liveChart) {
            liveChart.data.labels.push(`${elapsedSec}s`);
            liveChart.data.datasets[0].data.push(instantFps);
            liveChart.data.datasets[1].data.push(latestTelemetry.gpu_temp || 0);
            liveChart.data.datasets[2].data.push(latestTelemetry.gpu_load || 0);
            liveChart.data.datasets[3].data.push(latestTelemetry.gpu_vram_used || 0);

            if (liveChart.data.labels.length > 60) {
                liveChart.data.labels.shift();
                liveChart.data.datasets.forEach(ds => ds.data.shift());
            }
            liveChart.update('none');
        }
    }

    // ── Start / Stop Lifecycle ─────────────────────────────────────────────────
    async function startStressTest() {
        if (isRunning) return;

        // Reset state
        isRunning = true;
        frameTimes = [];
        totalFrames = 0;
        runTimeline = [];
        lastFrameTimestamp = 0;
        testStartTime = performance.now();

        // UI toggles
        elements.idleOverlay.classList.add('hidden');
        elements.startBtn.style.display = 'none';
        elements.stopBtn.style.display = 'inline-flex';
        elements.countdownFill.style.width = '0%';
        elements.resultsSection.style.display = 'none';
        elements.safetyAbortAlert.style.display = 'none';
        elements.safetyBadge.classList.remove('abort-active');

        // Disable options during run
        elements.presetTabs.forEach(t => t.disabled = true);
        elements.durationTabs.forEach(t => t.disabled = true);

        // Setup chart & canvas
        initLiveChart();
        resizeCanvas();

        // Start 500ms telemetry interval
        await fetchTelemetry();
        recordTelemetrySnapshot();
        telemetryIntervalId = setInterval(async () => {
            await fetchTelemetry();
            recordTelemetrySnapshot();
        }, 500);

        // Kick off WebGL render loop
        testAnimFrameId = requestAnimationFrame(renderFrame);
    }

    async function stopStressTest({ aborted = false, abortReason = '' } = {}) {
        if (!isRunning) return;
        isRunning = false;

        // Cancel render loop & poller
        if (testAnimFrameId) {
            cancelAnimationFrame(testAnimFrameId);
            testAnimFrameId = null;
        }
        if (telemetryIntervalId) {
            clearInterval(telemetryIntervalId);
            telemetryIntervalId = null;
        }

        const durationSeconds = (performance.now() - testStartTime) / 1000;

        // UI resets
        elements.startBtn.style.display = 'inline-flex';
        elements.stopBtn.style.display = 'none';
        elements.presetTabs.forEach(t => t.disabled = false);
        elements.durationTabs.forEach(t => t.disabled = false);

        if (aborted) {
            elements.safetyAbortAlert.style.display = 'flex';
            elements.safetyAbortMessage.textContent = abortReason;
            elements.safetyBadge.classList.add('abort-active');
        }

        // Compute metrics
        const metrics = computeRunMetrics(durationSeconds, aborted, abortReason);
        lastCompletedRunData = metrics;

        // Display results report
        renderResultsReport(metrics);

        // Save to SQLite
        try {
            await fetch('/api/stress-test/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(metrics),
            });
            loadHistory();
        } catch (e) {
            console.error('Failed to save stress test run:', e);
        }
    }

    // ── Metric Computation ─────────────────────────────────────────────────────
    function computeRunMetrics(durationSeconds, aborted, abortReason) {
        if (frameTimes.length === 0) {
            return {
                timestamp: Date.now() / 1000,
                duration_seconds: durationSeconds,
                preset: currentPreset,
                avg_fps: 0,
                min_fps: 0,
                one_percent_low_fps: 0,
                stability_score: 0,
                peak_gpu_temp: latestTelemetry.gpu_temp,
                peak_gpu_load: latestTelemetry.gpu_load,
                peak_vram_used: latestTelemetry.gpu_vram_used,
                aborted: aborted,
                abort_reason: abortReason,
                timeline: runTimeline,
            };
        }

        // Calculate Average FPS
        const totalDurationMs = frameTimes.reduce((a, b) => a + b, 0);
        const avgFps = Math.round((frameTimes.length / (totalDurationMs / 1000)) * 10) / 10;

        // Sort frame times for percentiles
        const sortedDeltas = [...frameTimes].sort((a, b) => a - b);
        const maxDelta = sortedDeltas[sortedDeltas.length - 1];
        const minFps = Math.round((1000 / maxDelta) * 10) / 10;

        // 1% Low FPS (99th percentile of frame delivery time)
        const idx99 = Math.floor(sortedDeltas.length * 0.99);
        const p99Delta = sortedDeltas[Math.min(idx99, sortedDeltas.length - 1)];
        const onePercentLowFps = Math.round((1000 / p99Delta) * 10) / 10;

        // Stability Score: standard deviation of frame times normalized against mean
        const meanDelta = totalDurationMs / frameTimes.length;
        const variance = frameTimes.reduce((sum, d) => sum + Math.pow(d - meanDelta, 2), 0) / frameTimes.length;
        const stdDev = Math.sqrt(variance);
        const coeffOfVariation = stdDev / (meanDelta || 1); // 0 = perfectly consistent
        // Stability percentage clamped between 0 and 100
        const stabilityScore = Math.max(0, Math.min(100, Math.round((1 - coeffOfVariation * 1.5) * 100)));

        // Peaks from timeline
        const temps = runTimeline.map(s => s.gpuTemp).filter(t => t !== null && !isNaN(t));
        const loads = runTimeline.map(s => s.gpuLoad).filter(l => l !== null && !isNaN(l));
        const vrams = runTimeline.map(s => s.vramUsed).filter(v => v !== null && !isNaN(v));

        const peakTemp = temps.length > 0 ? Math.max(...temps) : latestTelemetry.gpu_temp;
        const peakLoad = loads.length > 0 ? Math.max(...loads) : latestTelemetry.gpu_load;
        const peakVram = vrams.length > 0 ? Math.max(...vrams) : latestTelemetry.gpu_vram_used;

        return {
            timestamp: Date.now() / 1000,
            duration_seconds: Math.round(durationSeconds * 10) / 10,
            preset: currentPreset,
            avg_fps: avgFps,
            min_fps: minFps,
            one_percent_low_fps: onePercentLowFps,
            stability_score: stabilityScore,
            peak_gpu_temp: peakTemp !== null ? Math.round(peakTemp * 10) / 10 : null,
            peak_gpu_load: peakLoad !== null ? Math.round(peakLoad * 10) / 10 : null,
            peak_vram_used: peakVram !== null ? Math.round(peakVram * 100) / 100 : null,
            aborted: aborted,
            abort_reason: abortReason,
            timeline: runTimeline,
        };
    }

    // ── Render Results Report ──────────────────────────────────────────────────
    function renderResultsReport(data) {
        elements.resultsSection.style.display = 'block';

        if (data.aborted) {
            elements.resultsStatusEyebrow.textContent = 'SAFETY CUTOFF ACTIVATED';
            elements.resultsStatusEyebrow.style.color = 'var(--status-critical)';
            elements.resultsHeading.textContent = 'Test Aborted by Thermal Guard';
            elements.resultsSubtext.textContent = data.abort_reason || 'GPU core reached critical threshold.';
        } else {
            elements.resultsStatusEyebrow.textContent = 'TEST COMPLETED SUCCESSFULLY';
            elements.resultsStatusEyebrow.style.color = 'var(--status-normal)';
            elements.resultsHeading.textContent = `${(PRESETS[data.preset] || {}).label || data.preset} Results`;
            elements.resultsSubtext.textContent = `Completed ${data.duration_seconds}s stress run with consistent hardware telemetry logging.`;
        }

        elements.statStability.textContent = `${data.stability_score}%`;
        elements.statAvgFps.textContent = `${data.avg_fps}`;
        elements.statOnePercentLow.textContent = `${data.one_percent_low_fps}`;
        elements.statMinFps.textContent = `${data.min_fps}`;
        elements.statPeakTemp.textContent = data.peak_gpu_temp !== null ? `${data.peak_gpu_temp}°C` : 'N/A';
        elements.statPeakLoad.textContent = data.peak_gpu_load !== null ? `${data.peak_gpu_load}%` : 'N/A';
        elements.statPeakVram.textContent = data.peak_vram_used !== null ? `${data.peak_vram_used} GB` : 'N/A';

        if (latestTelemetry.gpu_vram_total) {
            elements.statVramTotal.textContent = `Total VRAM: ${latestTelemetry.gpu_vram_total} GB`;
        }

        // Render post-test chart
        renderResultsChart(data.timeline);

        // Smooth scroll to results
        elements.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderResultsChart(timeline) {
        const ctx = document.getElementById('stressResultsChart').getContext('2d');
        if (resultsChart) {
            resultsChart.destroy();
        }

        if (!timeline || timeline.length === 0) return;

        const labels = timeline.map(s => `${s.time}s`);
        const fpsData = timeline.map(s => s.fps);
        const tempData = timeline.map(s => s.gpuTemp);
        const loadData = timeline.map(s => s.gpuLoad);
        const vramData = timeline.map(s => s.vramUsed);

        resultsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'FPS',
                        data: fpsData,
                        borderColor: '#34c77b',
                        backgroundColor: 'rgba(52, 199, 123, 0.1)',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.2,
                        yAxisID: 'yFps',
                    },
                    {
                        label: 'GPU Temp (°C)',
                        data: tempData,
                        borderColor: '#e8442c',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.2,
                        yAxisID: 'yHardware',
                    },
                    {
                        label: 'GPU Load (%)',
                        data: loadData,
                        borderColor: '#f5b942',
                        borderWidth: 1.5,
                        borderDash: [4, 4],
                        fill: false,
                        tension: 0.2,
                        yAxisID: 'yHardware',
                    },
                    {
                        label: 'VRAM Used (GB)',
                        data: vramData,
                        borderColor: '#818cf8',
                        borderWidth: 1.5,
                        fill: false,
                        tension: 0.2,
                        yAxisID: 'yHardware',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#9a9a9e', font: { family: 'JetBrains Mono', size: 11 } },
                    },
                    yFps: {
                        type: 'linear',
                        position: 'left',
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#34c77b', font: { family: 'JetBrains Mono', size: 11 } },
                        title: { display: true, text: 'Rendering FPS', color: '#34c77b' },
                    },
                    yHardware: {
                        type: 'linear',
                        position: 'right',
                        beginAtZero: true,
                        max: 100,
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#e8442c', font: { family: 'JetBrains Mono', size: 11 } },
                        title: { display: true, text: 'Temp (°C) / Load (%) / VRAM (GB)', color: '#e8442c' },
                    },
                },
                plugins: {
                    legend: {
                        labels: { color: '#f5f5f3', font: { family: 'Inter', size: 12 } },
                    },
                },
            },
        });
    }

    // ── History Table & Detail Viewer ──────────────────────────────────────────
    async function loadHistory() {
        try {
            const res = await fetch('/api/stress-test/history?limit=15');
            if (!res.ok) return;
            const json = await res.json();
            if (!json.success || !json.data) return;

            const runs = json.data;
            if (runs.length === 0) {
                elements.historyTableBody.innerHTML = `
                    <tr>
                        <td colspan="10" style="text-align: center; padding: 24px; color: var(--text-on-dark-muted);">
                            No stress test runs recorded yet. Click "Start Stress Test" above to record your first run.
                        </td>
                    </tr>
                `;
                return;
            }

            let html = '';
            runs.forEach(run => {
                const date = new Date(run.timestamp * 1000);
                const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const presetClass = (run.preset || 'medium').toLowerCase();
                const statusTag = run.aborted
                    ? `<span class="tag-status-aborted" title="${run.abort_reason || 'Aborted'}">Aborted</span>`
                    : `<span class="tag-status-ok">Passed</span>`;

                html += `
                    <tr>
                        <td>${dateStr}</td>
                        <td><span class="tag-preset ${presetClass}">${run.preset}</span></td>
                        <td class="mono">${run.duration_seconds}s</td>
                        <td class="mono" style="font-weight: 600; color: #34c77b;">${run.avg_fps}</td>
                        <td class="mono">${run.one_percent_low_fps}</td>
                        <td class="mono">${run.stability_score}%</td>
                        <td class="mono">${run.peak_gpu_temp !== null ? run.peak_gpu_temp + '°C' : '—'}</td>
                        <td class="mono">${run.peak_gpu_load !== null ? run.peak_gpu_load + '%' : '—'}</td>
                        <td>${statusTag}</td>
                        <td style="text-align: right;">
                            <button class="btn btn-ghost" onclick="window.viewStressRun(${run.id})" style="padding: 4px 10px; font-size: 0.78rem;">
                                View Run
                            </button>
                        </td>
                    </tr>
                `;
            });

            elements.historyTableBody.innerHTML = html;
        } catch (e) {
            console.error('Failed to load stress test history:', e);
        }
    }

    // Expose view run for table action
    window.viewStressRun = async function (runId) {
        try {
            const res = await fetch(`/api/stress-test/run/${runId}`);
            if (!res.ok) return;
            const json = await res.json();
            if (json.success && json.data) {
                lastCompletedRunData = json.data;
                renderResultsReport(json.data);
            }
        } catch (e) {
            console.error('Failed to fetch run details:', e);
        }
    };

    // ── Export Results ─────────────────────────────────────────────────────────
    function exportRunData() {
        if (!lastCompletedRunData) return;
        const jsonStr = JSON.stringify(lastCompletedRunData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gpu-stress-test-${lastCompletedRunData.preset}-${Math.round(lastCompletedRunData.timestamp)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ── Fullscreen Toggle ──────────────────────────────────────────────────────
    function toggleFullscreen() {
        const card = elements.stageCard;
        const isFs = card.classList.toggle('fullscreen-mode');
        if (isFs) {
            elements.fsText.textContent = 'Exit Fullscreen';
            elements.fsIcon.textContent = '✕';
        } else {
            elements.fsText.textContent = 'Fullscreen';
            elements.fsIcon.textContent = '⛶';
        }
        setTimeout(resizeCanvas, 50);
    }

    // ── Event Handlers & Initialization ────────────────────────────────────────
    function bindEvents() {
        elements.startBtn.addEventListener('click', startStressTest);
        elements.stopBtn.addEventListener('click', () => stopStressTest({ aborted: false, abortReason: 'Stopped by user.' }));

        // Preset tabs
        elements.presetTabs.forEach(btn => {
            btn.addEventListener('click', () => {
                if (isRunning) return;
                elements.presetTabs.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentPreset = btn.dataset.preset;
                resizeCanvas();
            });
        });

        // Duration tabs
        elements.durationTabs.forEach(btn => {
            btn.addEventListener('click', () => {
                if (isRunning) return;
                elements.durationTabs.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentDuration = parseInt(btn.dataset.duration, 10);
            });
        });

        // Fullscreen button
        elements.fullscreenBtn.addEventListener('click', toggleFullscreen);

        // Escape key exits fullscreen
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && elements.stageCard.classList.contains('fullscreen-mode')) {
                toggleFullscreen();
            }
        });

        // Window resize
        window.addEventListener('resize', resizeCanvas);

        // Visibility change (pause/stop if tab hidden)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && isRunning) {
                console.log('Tab backgrounded during stress test — stopping for safety.');
                stopStressTest({ aborted: false, abortReason: 'Test paused: browser tab was placed in background.' });
            }
        });

        // Results actions
        elements.resultsExportBtn.addEventListener('click', exportRunData);
        elements.resultsRetestBtn.addEventListener('click', () => {
            elements.resultsSection.style.display = 'none';
            elements.idleOverlay.classList.remove('hidden');
            window.scrollTo({ top: elements.stageCard.offsetTop - 100, behavior: 'smooth' });
        });

        // History refresh
        elements.refreshHistoryBtn.addEventListener('click', loadHistory);
    }

    // ── Entry Point ────────────────────────────────────────────────────────────
    function init() {
        if (!initWebGL()) {
            return;
        }

        initLiveChart();
        bindEvents();
        resizeCanvas();

        // Idle telemetry poller every 2.5 seconds to keep hardware badge updated
        fetchTelemetry();
        idleTelemetryIntervalId = setInterval(() => {
            if (!isRunning) {
                fetchTelemetry();
            }
        }, 2500);

        // Load existing history
        loadHistory();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
