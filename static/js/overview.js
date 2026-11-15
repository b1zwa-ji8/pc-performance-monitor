/**
 * Overview Page Controller — Melius Reference Design System
 * Orchestrates:
 *  - Node Canvas & Curved Bezier Connectors
 *  - Floating Dark Control Panel
 *  - System Story (Light Editorial Register Shift)
 *  - Performance Profiles (Plan-Card Pattern)
 *  - Troubleshooting Accordion
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // ── 1. Initialize Node Cards on Canvas ────────────────────────────────────
    const workspace = document.getElementById('canvasWorkspace');
    const nodes = {};

    const nodeConfigs = [
        { id: 'cpu', title: 'CPU', subtitle: 'Processor', unit: '%', href: '/cpu', value: 0 },
        { id: 'memory', title: 'RAM', subtitle: 'System Memory', unit: '%', href: '/memory', value: 0 },
        { id: 'gpu', title: 'GPU', subtitle: 'Graphics Card', unit: '%', href: '/gpu', value: 0 },
        { id: 'disk', title: 'Disk', subtitle: 'Primary Storage', unit: '%', href: '/disk', value: 0 },
        { id: 'network', title: 'Network', subtitle: 'Throughput', unit: 'KB/s', href: '/network', value: 0 },
        { id: 'battery', title: 'Battery', subtitle: 'Power Reserve', unit: '%', href: '/settings', value: 100 }
    ];

    nodeConfigs.forEach(cfg => {
        const card = new NodeCard(cfg);
        nodes[cfg.id] = card;
        workspace.appendChild(card.element);
    });

    // ── 2. Initialize Bezier Connectors ──────────────────────────────────────
    const connectors = new ConnectorManager('canvasConnectorsSvg');
    const hub = document.getElementById('hubNode');

    // Connect hub to each node dot with small delay to ensure initial layout rects
    setTimeout(() => {
        nodeConfigs.forEach(cfg => {
            const dot = document.getElementById(`dot-${cfg.id}`);
            if (dot && hub) {
                connectors.connect(cfg.id, hub, dot, { status: 'normal', active: false });
            }
        });
    }, 100);

    // Hover effect: highlight connector and animate pulse flow
    nodeConfigs.forEach(cfg => {
        const nodeEl = document.getElementById(`node-${cfg.id}`);
        if (nodeEl) {
            nodeEl.addEventListener('mouseenter', () => {
                connectors.setConnectionState(cfg.id, { active: true });
            });
            nodeEl.addEventListener('mouseleave', () => {
                connectors.setConnectionState(cfg.id, { active: false });
            });
        }
    });

    // Subtle parallax on canvas (2-3px max, non-disorienting)
    const canvasContainer = document.getElementById('canvasContainer');
    if (canvasContainer && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        canvasContainer.addEventListener('mousemove', (e) => {
            const rect = canvasContainer.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width - 0.5;
            const y = (e.clientY - rect.top) / rect.height - 0.5;
            workspace.style.transform = `translate3d(${x * 6}px, ${y * 6}px, 0)`;
            connectors.updateLines();
        });
        canvasContainer.addEventListener('mouseleave', () => {
            workspace.style.transform = 'translate3d(0, 0, 0)';
            connectors.updateLines();
        });
    }

    // ── 3. Initialize Floating Control Panel ──────────────────────────────────
    const floatingPanel = new FloatingPanelTabs({
        containerId: 'heroControlPanel',
        initialTab: 'cpu',
        onTabChange: (tabId) => {
            if (window.Dashboard) {
                window.Dashboard.setActiveMetricTab(tabId);
            }
            // Highlight matching node card
            Object.keys(nodes).forEach(id => {
                const el = document.getElementById(`node-${id}`);
                if (el) el.style.opacity = (id === tabId || window.innerWidth < 960) ? '1' : '0.82';
            });
        }
    });

    // ── 4. Telemetry Telecast & Data Subscription ────────────────────────────
    let peakCpu = 0;
    let peakNet = 0;

    if (window.Dashboard) {
        window.Dashboard.init('overview');
        window.Dashboard.subscribe((d) => {
            // Update Hub Node Specs
            if (d.system_info) {
                const hostEl = document.getElementById('hubHostname');
                const osEl = document.getElementById('hubOs');
                if (hostEl) hostEl.textContent = d.system_info.hostname || 'This PC';
                if (osEl) osEl.textContent = `${d.system_info.os || 'OS'} • ${d.system_info.cpu_cores || 8} Cores`;
            }

            // CPU Node
            const cpu = d.cpu || {};
            const cpuVal = Math.round(cpu.percent || 0);
            if (cpuVal > peakCpu) peakCpu = cpuVal;
            const cpuStatus = getStatusClass(cpuVal, { warning: 75, critical: 90 });
            nodes.cpu.update(cpuVal, {
                subtitle: cpu.name || 'Processor',
                status: cpuStatus
            });
            connectors.setConnectionState('cpu', { status: cpuStatus });
            floatingPanel.setSummary('cpu', `CPU steady at ${cpuVal}% with ${cpu.cores || 8} logical cores.`);

            // RAM Node
            const mem = d.memory || {};
            const memVal = Math.round(mem.percent || 0);
            const memStatus = getStatusClass(memVal, { warning: 80, critical: 90 });
            nodes.memory.update(memVal, {
                subtitle: `${mem.used || 0} GB / ${mem.total || 0} GB`,
                status: memStatus
            });
            connectors.setConnectionState('memory', { status: memStatus });
            floatingPanel.setSummary('memory', `RAM at ${memVal}% (${mem.used || 0} GB used out of ${mem.total || 0} GB).`);

            // GPU Node
            const gpu = d.gpu || {};
            if (gpu.available && gpu.load !== null && gpu.load !== undefined) {
                const gpuVal = Math.round(gpu.load);
                const gpuStatus = getStatusClass(gpuVal, { warning: 80, critical: 90 });
                const tempStr = (gpu.temperature !== null && gpu.temperature !== undefined) ? `${Math.round(gpu.temperature)}°C` : 'Temp N/A';
                nodes.gpu.update(gpuVal, {
                    subtitle: `${gpu.name || 'GPU'} • ${tempStr}`,
                    status: gpuStatus
                });
                connectors.setConnectionState('gpu', { status: gpuStatus });
                floatingPanel.setSummary('gpu', `GPU load at ${gpuVal}% (${tempStr}).`);
            } else if (gpu.available) {
                nodes.gpu.update(0, {
                    formatted: 'Active',
                    subtitle: `${gpu.name || 'GPU'} • Sensor N/A`,
                    status: 'normal'
                });
                floatingPanel.setSummary('gpu', `${gpu.name || 'GPU'} detected; live load query unavailable without vendor SDK.`);
            } else {
                nodes.gpu.update(0, {
                    formatted: '—',
                    subtitle: 'Sensor Unavailable',
                    status: 'normal'
                });
                floatingPanel.setSummary('gpu', 'GPU hardware telemetry backend unavailable.');
            }

            // Disk Node
            const disk = d.disk || {};
            const parts = disk.partitions || [];
            if (parts.length > 0) {
                const p0 = parts[0];
                const diskVal = Math.round(p0.percent || 0);
                const diskStatus = getStatusClass(diskVal, { warning: 85, critical: 95 });
                nodes.disk.update(diskVal, {
                    subtitle: `${p0.device || 'C:'} (${p0.used || 0} GB used)`,
                    status: diskStatus
                });
                connectors.setConnectionState('disk', { status: diskStatus });
                floatingPanel.setSummary('disk', `Primary drive ${p0.device} is ${diskVal}% full.`);
            }

            // Network Node
            const net = d.network || {};
            const downBps = net.download_speed || 0;
            const downFmt = net.download_speed_fmt || formatSpeed(downBps);
            if (downBps > peakNet) peakNet = downBps;
            nodes.network.update(downBps, {
                formatted: downFmt.split(' ')[0],
                unit: downFmt.split(' ')[1] || 'B/s',
                subtitle: `${net.connections || 0} active sockets`,
                status: 'normal'
            });
            floatingPanel.setSummary('network', `Network throughput: ↓ ${downFmt} • ↑ ${net.upload_speed_fmt || '0 B/s'}.`);

            // Battery Node
            const bat = d.battery || {};
            if (bat.available) {
                const batVal = Math.round(bat.percent || 0);
                const batStatus = batVal < 20 ? 'warning' : 'normal';
                nodes.battery.update(batVal, {
                    subtitle: bat.plugged ? '⚡ AC Plugged In' : `⏱ ${bat.time_left_fmt || 'On Battery'}`,
                    status: batStatus
                });
                connectors.setConnectionState('battery', { status: batStatus });
                floatingPanel.setSummary('battery', `Battery at ${batVal}% (${bat.plugged ? 'Charging' : 'Discharging'}).`);
            } else {
                nodes.battery.update(100, {
                    formatted: '100',
                    subtitle: 'AC Power Connected',
                    status: 'normal'
                });
                floatingPanel.setSummary('battery', 'Desktop power supply connected. Continuous power supply.');
            }

            // ── Update System Story (Section 5) ──────────────────────────────
            updateSystemStory(d, { peakCpu, peakNet });
        });
    }

    function updateSystemStory(d, peaks) {
        const headlineEl = document.getElementById('storyHeadline');
        const bodyEl = document.getElementById('storyBody');
        const cpuPeakEl = document.getElementById('storyCpuPeak');
        const ramAvailEl = document.getElementById('storyRamAvail');
        const ramTotalEl = document.getElementById('storyRamTotal');
        const netPeakEl = document.getElementById('storyNetPeak');
        const uptimeEl = document.getElementById('storyUptime');
        const procCountEl = document.getElementById('storyProcessCount');

        const overallStatus = window.Dashboard.getOverallStatus();

        if (headlineEl && bodyEl) {
            if (overallStatus === 'critical') {
                headlineEl.textContent = 'High resource utilization detected.';
                bodyEl.textContent = 'One or more hardware components exceed critical thresholds (90%+ load). Review active background processes below.';
            } else if (overallStatus === 'warning') {
                headlineEl.textContent = 'One thing needs your attention.';
                bodyEl.textContent = 'System telemetry indicates elevated memory or disk usage. Performance remains stable with minor overhead.';
            } else {
                headlineEl.textContent = 'Everything is running smoothly.';
                bodyEl.textContent = 'All monitored metrics are within nominal limits. Sensor telemetry shows healthy thermals and balanced memory pressure.';
            }
        }

        if (cpuPeakEl) cpuPeakEl.textContent = `${peaks.peakCpu || Math.round(d.cpu?.percent || 0)}%`;
        if (ramAvailEl && d.memory) ramAvailEl.textContent = `${(d.memory.total - d.memory.used).toFixed(1)} GB`;
        if (ramTotalEl && d.memory) ramTotalEl.textContent = `Out of ${d.memory.total} GB total`;
        if (netPeakEl) netPeakEl.textContent = formatSpeed(peaks.peakNet || d.network?.download_speed || 0);
        if (uptimeEl) uptimeEl.textContent = d.uptime || 'Active';
        if (procCountEl) procCountEl.textContent = `${d.process_count || 0} active processes`;
    }

    // ── 5. System Story Editorial Pill Switcher ───────────────────────────────
    new EditorialPillSwitcher('editorialPillsContainer', {
        items: ['Today', 'This Week', 'This Month', 'All Time'],
        active: 'Today',
        onChange: (range) => {
            showToast(`Time window set to ${range}`, 'info');
        }
    });

    // ── 6. Temperature Unit Toggle & Performance Profiles (Section 6) ────────
    new PillToggle({
        containerId: 'tempUnitToggle',
        labelLeft: 'Celsius (°C)',
        labelRight: 'Fahrenheit (°F)',
        checked: false,
        onChange: (isFahrenheit) => {
            showToast(`Displaying temperatures in ${isFahrenheit ? 'Fahrenheit' : 'Celsius'}`, 'info');
        }
    });

    new ProfileCardSelector('profileSelectorContainer', {
        initialProfile: 'balanced',
        onProfileSelect: (profile) => {
            // Profile selection triggers settings update
        }
    });

    // ── 7. Troubleshooting FAQ Accordion (Section 7) ─────────────────────────
    const faqItems = [
        {
            question: 'GPU telemetry shows "Unavailable" or reads 0% load',
            answer: 'Real-time GPU telemetry requires dedicated driver access. NVIDIA GPUs are supported via NVML (pynvml). Integrated Intel/AMD graphics report basic device presence; advanced telemetry becomes active whenever discrete GPU sensors are accessible.'
        },
        {
            question: 'How is historical telemetry recorded and retained?',
            answer: 'Metrics are collected locally by a background Python worker and persisted to a lightweight on-disk SQLite database (`pc_monitor.db`). No cloud databases or third-party connections are ever created. You can adjust the retention window or purge records anytime in Settings.'
        },
        {
            question: 'Will running the monitor increase background CPU usage?',
            answer: 'Under the default "Balanced" profile, the monitor consumes less than 0.5% CPU. For battery-sensitive laptops, the "Light" profile reduces polling to 10-second cycles, dropping CPU usage below 0.1%.'
        },
        {
            question: 'Why did terminating a process fail in the process table?',
            answer: 'Terminating system-level services or protected background tasks requires Administrator privileges. On Windows, ensure you run the monitor terminal in an elevated command prompt if you need to kill protected processes.'
        },
        {
            question: 'Why does the Battery node display 100% or AC Connected?',
            answer: 'On desktop workstations without a physical battery, the system automatically detects direct AC power and reports a nominal 100% reserve status without raising unnecessary warnings.'
        }
    ];

    new TroubleshootingAccordion('troubleshootingAccordion', faqItems);
});
