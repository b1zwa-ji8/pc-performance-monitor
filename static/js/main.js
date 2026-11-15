/**
 * PC Performance Monitor — Main Global Script
 * Chrome controls: Live stream toggle, privacy modal, export report, toasts, kill process modal.
 */

(function () {
    'use strict';

    // ── Privacy Modal ────────────────────────────────────────────────────────
    const privacyModal = document.getElementById('privacyModal');
    const privacyLink = document.getElementById('privacyLink');
    const footerPrivacyLink = document.getElementById('footerPrivacyLink');
    const closePrivacyModal = document.getElementById('closePrivacyModal');
    const confirmPrivacyBtn = document.getElementById('confirmPrivacyBtn');

    function openPrivacy() {
        if (privacyModal) privacyModal.classList.add('active');
    }

    function closePrivacy() {
        if (privacyModal) privacyModal.classList.remove('active');
    }

    if (privacyLink) privacyLink.addEventListener('click', openPrivacy);
    if (footerPrivacyLink) footerPrivacyLink.addEventListener('click', (e) => { e.preventDefault(); openPrivacy(); });
    if (closePrivacyModal) closePrivacyModal.addEventListener('click', closePrivacy);
    if (confirmPrivacyBtn) confirmPrivacyBtn.addEventListener('click', closePrivacy);
    if (privacyModal) {
        privacyModal.addEventListener('click', (e) => {
            if (e.target === privacyModal) closePrivacy();
        });
    }

    // ── Toast Notifications ──────────────────────────────────────────────────
    function showToast(message, type = 'success', duration = 3200) {
        const shelf = document.getElementById('toastShelf');
        if (!shelf) return;

        const toast = document.createElement('div');
        toast.className = `editorial-toast toast-${type}`;
        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
        const color = type === 'success' ? 'var(--status-normal)' : type === 'error' ? 'var(--status-critical)' : 'var(--accent-primary)';

        toast.innerHTML = `
            <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:${color};color:#fff;font-size:11px;font-weight:700;">${icon}</span>
            <span>${message}</span>
        `;
        shelf.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.25s ease';
            setTimeout(() => toast.remove(), 250);
        }, duration);
    }
    window.showToast = showToast;

    // ── Live Stream Toggle (Pause / Resume) ──────────────────────────────────
    const liveBtn = document.getElementById('liveToggleBtn');
    const liveText = document.getElementById('liveToggleText');
    let isLiveActive = true;

    if (liveBtn) {
        liveBtn.addEventListener('click', () => {
            isLiveActive = !isLiveActive;
            liveBtn.classList.toggle('paused', !isLiveActive);
            if (liveText) liveText.textContent = isLiveActive ? 'Live' : 'Paused';

            if (window.Dashboard && typeof window.Dashboard.setPaused === 'function') {
                window.Dashboard.setPaused(!isLiveActive);
            }

            showToast(isLiveActive ? 'Live telemetry resumed' : 'Telemetry stream paused', 'info');
        });
    }

    // ── Export Telemetry Snapshot ────────────────────────────────────────────
    const exportBtn = document.getElementById('exportReportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            try {
                const resp = await fetch('/api/overview');
                const json = await resp.json();
                if (!json.success) throw new Error('Failed to retrieve overview data');

                const report = {
                    title: 'PC Performance Monitor — Telemetry Snapshot',
                    exported_at: new Date().toISOString(),
                    local_time: new Date().toLocaleString(),
                    telemetry: json.data,
                    system_info: json.data?.system_info || {}
                };

                const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `pc-monitor-report-${Date.now()}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                showToast('Telemetry report exported successfully!', 'success');
            } catch (err) {
                showToast('Could not export report: ' + err.message, 'error');
            }
        });
    }

    // ── Weekly Email Opt-in (LocalStorage persistence) ───────────────────────
    const emailInput = document.getElementById('footerEmailInput');
    const emailSubmit = document.getElementById('footerEmailSubmit');

    if (emailSubmit && emailInput) {
        emailSubmit.addEventListener('click', () => {
            const email = emailInput.value.trim();
            if (!email || !email.includes('@')) {
                showToast('Please enter a valid email address', 'error');
                return;
            }
            localStorage.setItem('pcm_summary_email', email);
            emailInput.value = '';
            showToast(`Subscribed ${email} to weekly offline summaries!`, 'success');
        });
    }

    // ── Mobile Navigation Drawer ─────────────────────────────────────────────
    const mobileToggle = document.getElementById('mobileNavToggle');
    const headerNav = document.getElementById('headerNav');

    if (mobileToggle && headerNav) {
        mobileToggle.addEventListener('click', () => {
            const isOpen = headerNav.style.display === 'flex';
            headerNav.style.display = isOpen ? 'none' : 'flex';
            if (!isOpen) {
                headerNav.style.position = 'absolute';
                headerNav.style.top = '68px';
                headerNav.style.left = '0';
                headerNav.style.width = '100%';
                headerNav.style.background = 'var(--bg-panel)';
                headerNav.style.flexDirection = 'column';
                headerNav.style.padding = '20px';
                headerNav.style.borderBottom = '1px solid var(--border-subtle)';
            }
        });
    }

    // ── Kill Process Modal ───────────────────────────────────────────────────
    let killPid = null;
    const killModal = document.getElementById('killModal');
    const killText = document.getElementById('killModalText');
    const closeKillModal = document.getElementById('closeKillModal');
    const killCancel = document.getElementById('killCancel');
    const killConfirm = document.getElementById('killConfirm');

    function showKillModal(pid, name) {
        killPid = pid;
        if (killText) killText.textContent = `Are you sure you want to terminate process "${name}" (PID: ${pid})?`;
        if (killModal) killModal.classList.add('active');
    }
    window.showKillModal = showKillModal;

    function hideKillModal() {
        killPid = null;
        if (killModal) killModal.classList.remove('active');
    }
    window.hideKillModal = hideKillModal;

    if (closeKillModal) closeKillModal.addEventListener('click', hideKillModal);
    if (killCancel) killCancel.addEventListener('click', hideKillModal);
    if (killModal) {
        killModal.addEventListener('click', (e) => {
            if (e.target === killModal) hideKillModal();
        });
    }

    if (killConfirm) {
        killConfirm.addEventListener('click', async () => {
            if (killPid === null) return;
            try {
                const resp = await fetch('/api/processes/kill', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pid: killPid }),
                });
                const data = await resp.json();
                if (data.success) {
                    showToast(data.message, 'success');
                    if (typeof window.fetchProcesses === 'function') {
                        window.fetchProcesses();
                    }
                } else {
                    showToast(data.message || 'Termination denied', 'error');
                }
            } catch (err) {
                showToast('Error terminating process', 'error');
            }
            hideKillModal();
        });
    }

    // ── Shared Number & Byte Helpers ─────────────────────────────────────────
    window.formatBytes = function (bytes, decimals = 1) {
        if (bytes === 0 || !bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    };

    window.formatSpeed = function (bps) {
        return window.formatBytes(bps) + '/s';
    };

    window.getStatusClass = function (percent, thresholds = { warning: 80, critical: 90 }) {
        if (percent >= thresholds.critical) return 'critical';
        if (percent >= thresholds.warning) return 'warning';
        return 'normal';
    };

})();
