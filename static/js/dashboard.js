/**
 * PC Performance Monitor — Unified Client-Side Telemetry Controller
 * Connects to SSE /api/stream, powers the ambient hero wave visualizer, and dispatches data.
 */

window.Dashboard = (function () {
    'use strict';

    let _eventSource = null;
    let _pollInterval = null;
    let _isPaused = false;
    let _subscribers = [];
    let _latestData = {};
    let _activeTab = 'cpu';

    // Ambient hero SVG / Canvas animation state
    let _heroSvg = null;
    let _heroCanvas = null;
    let _heroCtx = null;
    let _wavePaths = [];
    let _waveGradStops = [];
    let _waveHistory = [];
    let _wavePhase = 0;
    let _animFrameId = null;
    let _overallStatus = 'normal'; // normal, warning, critical

    function init(page = 'overview') {
        _initAmbientVisualizer();
        _connectSSE();
    }

    function _connectSSE() {
        if (_eventSource) {
            _eventSource.close();
            _eventSource = null;
        }

        try {
            _eventSource = new EventSource('/api/stream');
            _eventSource.onmessage = function (event) {
                if (_isPaused) return;
                try {
                    const data = JSON.parse(event.data);
                    if (data && !data.error) {
                        _handleTelemetry(data);
                    }
                } catch (e) {
                    console.error('Failed to parse SSE telemetry:', e);
                }
            };

            _eventSource.onerror = function () {
                console.warn('SSE connection lost; falling back to polling.');
                _eventSource.close();
                _eventSource = null;
                _startPollingFallback();
            };
        } catch (e) {
            _startPollingFallback();
        }
    }

    function _startPollingFallback() {
        if (_pollInterval) return;
        _pollInterval = setInterval(async () => {
            if (_isPaused) return;
            try {
                const res = await fetch('/api/overview');
                const json = await res.json();
                if (json.success && json.data) {
                    _handleTelemetry(json.data);
                }
            } catch (e) { /* retry */ }
        }, 2000);
    }

    function _handleTelemetry(data) {
        _latestData = data;

        // Calculate overall system health
        const cpuP = data.cpu?.percent || 0;
        const memP = data.memory?.percent || 0;
        const diskP = data.disk?.partitions?.[0]?.percent || 0;
        const gpuLoad = data.gpu?.available ? (data.gpu.load || 0) : 0;

        if (cpuP >= 90 || memP >= 90 || diskP >= 95) {
            _overallStatus = 'critical';
        } else if (cpuP >= 75 || memP >= 80 || diskP >= 85 || (data.alerts && data.alerts.length > 0)) {
            _overallStatus = 'warning';
        } else {
            _overallStatus = 'normal';
        }

        // Push current active metric value to wave history
        let currentMetricVal = cpuP;
        if (_activeTab === 'memory') currentMetricVal = memP;
        else if (_activeTab === 'gpu') currentMetricVal = gpuLoad;
        else if (_activeTab === 'disk') currentMetricVal = diskP;
        else if (_activeTab === 'network') currentMetricVal = Math.min(100, (data.network?.download_speed || 0) / 100000);
        else if (_activeTab === 'battery') currentMetricVal = data.battery?.percent || 50;

        _waveHistory.push(currentMetricVal);
        if (_waveHistory.length > 40) _waveHistory.shift();

        // Notify all subscribers
        _subscribers.forEach(fn => {
            try { fn(data); } catch (e) { console.error('Subscriber error:', e); }
        });
    }

    function subscribe(fn) {
        if (typeof fn === 'function') {
            _subscribers.push(fn);
            if (Object.keys(_latestData).length > 0) {
                fn(_latestData);
            }
        }
    }

    function unsubscribe(fn) {
        _subscribers = _subscribers.filter(f => f !== fn);
    }

    function setActiveMetricTab(tab) {
        _activeTab = tab;
    }

    function setPaused(paused) {
        _isPaused = !!paused;
    }

    function getLatest() {
        return _latestData;
    }

    function getOverallStatus() {
        return _overallStatus;
    }

    // ── Ambient Hero Wave Visualizer (Section 3) ─────────────────────────────
    function _initAmbientVisualizer() {
        _heroSvg = document.getElementById('heroAmbientSvg');
        _heroCanvas = document.getElementById('heroAmbientCanvas');

        if (!_heroSvg && !_heroCanvas) return;

        if (_heroSvg) {
            _heroSvg.setAttribute('viewBox', '0 0 800 300');
            _heroSvg.setAttribute('preserveAspectRatio', 'none');
            _heroSvg.innerHTML = `
                <defs>
                    <linearGradient id="heroWaveGrad0" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="var(--accent-primary, #4E88FF)" stop-opacity="0.32" />
                        <stop offset="100%" stop-color="var(--accent-primary, #4E88FF)" stop-opacity="0.01" />
                    </linearGradient>
                    <linearGradient id="heroWaveGrad1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="var(--accent-primary, #4E88FF)" stop-opacity="0.22" />
                        <stop offset="100%" stop-color="var(--accent-primary, #4E88FF)" stop-opacity="0.01" />
                    </linearGradient>
                    <linearGradient id="heroWaveGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="var(--accent-primary, #4E88FF)" stop-opacity="0.14" />
                        <stop offset="100%" stop-color="var(--accent-primary, #4E88FF)" stop-opacity="0.01" />
                    </linearGradient>
                </defs>
                <path class="hero-wave-path-2" fill="url(#heroWaveGrad2)" d=""></path>
                <path class="hero-wave-path-1" fill="url(#heroWaveGrad1)" d=""></path>
                <path class="hero-wave-path-0" fill="url(#heroWaveGrad0)" d=""></path>
            `;
            _wavePaths = [
                _heroSvg.querySelector('.hero-wave-path-0'),
                _heroSvg.querySelector('.hero-wave-path-1'),
                _heroSvg.querySelector('.hero-wave-path-2')
            ];
            _waveGradStops = _heroSvg.querySelectorAll('linearGradient stop:first-child');
        } else if (_heroCanvas) {
            _heroCtx = _heroCanvas.getContext('2d');
            function resize() {
                if (!_heroCanvas) return;
                const rect = _heroCanvas.parentElement.getBoundingClientRect();
                _heroCanvas.width = rect.width;
                _heroCanvas.height = rect.height;
            }
            window.addEventListener('resize', resize);
            resize();
        }

        // Populate initial wave history
        for (let i = 0; i < 40; i++) {
            _waveHistory.push(20 + Math.random() * 20);
        }

        _renderAmbientWave();
    }

    function _renderAmbientWave() {
        if (!_heroSvg && !_heroCanvas) return;

        _wavePhase += 0.02;

        // Color tint based on overallStatus
        let activeColor = 'var(--accent-primary, #4E88FF)';
        let stopColor = 'rgba(78, 136, 255, 0.35)';
        if (_overallStatus === 'critical') {
            activeColor = 'var(--status-critical, #e8442c)';
            stopColor = 'rgba(232, 68, 44, 0.45)';
        } else if (_overallStatus === 'warning') {
            activeColor = 'var(--status-warning, #f5b942)';
            stopColor = 'rgba(245, 185, 66, 0.40)';
        }

        if (_heroSvg) {
            // Update stop colors if status changed
            if (_waveGradStops && _waveGradStops.length > 0) {
                _waveGradStops.forEach(stop => stop.setAttribute('stop-color', activeColor));
            }

            const w = 800;
            const h = 300;
            const baseline = h * 0.65;
            const pts = 36;
            const step = w / pts;

            const layers = [
                { amplitude: 28, freq: 0.008, speed: 1.0 },
                { amplitude: 20, freq: 0.012, speed: -0.7 },
                { amplitude: 14, freq: 0.016, speed: 1.3 }
            ];

            layers.forEach((layer, idx) => {
                if (!_wavePaths[idx]) return;
                let d = `M 0 ${h} L 0 `;

                for (let i = 0; i <= pts; i++) {
                    const x = i * step;
                    const histIdx = Math.floor((i / pts) * (_waveHistory.length - 1));
                    const histVal = (_waveHistory[histIdx] || 25) / 100;
                    const yOffset = Math.sin(x * layer.freq + _wavePhase * layer.speed + idx) * layer.amplitude * (0.6 + histVal * 0.8);
                    const y = baseline - (histVal * 100) + yOffset;

                    if (i === 0) d += `${y.toFixed(1)}`;
                    else d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
                }

                d += ` L ${w} ${h} Z`;
                _wavePaths[idx].setAttribute('d', d);
            });
        } else if (_heroCanvas && _heroCtx) {
            const ctx = _heroCtx;
            const w = _heroCanvas.width;
            const h = _heroCanvas.height;
            ctx.clearRect(0, 0, w, h);

            let waveColor1 = stopColor;
            let waveColor2 = 'rgba(20, 24, 30, 0.02)';

            const layers = [
                { amplitude: 35, freq: 0.008, speed: 1.0 },
                { amplitude: 25, freq: 0.012, speed: -0.7 },
                { amplitude: 15, freq: 0.016, speed: 1.3 }
            ];

            layers.forEach((layer, idx) => {
                ctx.beginPath();
                ctx.moveTo(0, h);
                const baseline = h * 0.65;
                const pts = 50;
                const step = w / pts;

                for (let i = 0; i <= pts; i++) {
                    const x = i * step;
                    const histIdx = Math.floor((i / pts) * (_waveHistory.length - 1));
                    const histVal = (_waveHistory[histIdx] || 25) / 100;
                    const yOffset = Math.sin(x * layer.freq + _wavePhase * layer.speed + idx) * layer.amplitude * (0.6 + histVal * 0.8);
                    const y = baseline - (histVal * 120) + yOffset;
                    ctx.lineTo(x, y);
                }

                ctx.lineTo(w, h);
                ctx.closePath();

                const grad = ctx.createLinearGradient(0, baseline - 150, 0, h);
                grad.addColorStop(0, waveColor1);
                grad.addColorStop(1, waveColor2);
                ctx.fillStyle = grad;
                ctx.fill();
            });
        }

        _animFrameId = requestAnimationFrame(_renderAmbientWave);
    }

    return {
        init,
        subscribe,
        unsubscribe,
        setActiveMetricTab,
        setPaused,
        getLatest,
        getOverallStatus
    };
})();
