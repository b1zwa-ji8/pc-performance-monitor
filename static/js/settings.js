/**
 * Settings Page Controller — Melius Reference Design System
 * Manages configuration persistence and ProfileCardSelector integration.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    let profileSelector = null;

    // Initialize Profile Selector
    profileSelector = new ProfileCardSelector('settingsProfileSelector', {
        initialProfile: 'balanced',
        onProfileSelect: (profile) => {
            const refreshInput = document.getElementById('settRefreshInterval');
            if (refreshInput && profile.settings?.refresh_interval) {
                refreshInput.value = profile.settings.refresh_interval;
            }
        }
    });

    loadSettings();
    loadDiagnostics();
    loadCompanionStatus();
    initAccentControls();

    document.getElementById('settSave')?.addEventListener('click', saveSettings);
    document.getElementById('settDeleteHistory')?.addEventListener('click', deleteHistory);
    document.getElementById('settReset')?.addEventListener('click', resetSettings);
    document.getElementById('settResetAccentBtn')?.addEventListener('click', resetAccentColors);
    document.getElementById('refreshDiagBtn')?.addEventListener('click', loadDiagnostics);
    document.getElementById('btnToggleCompanion')?.addEventListener('click', toggleCompanionProcess);
    document.getElementById('settStartupLaunch')?.addEventListener('change', toggleStartupShortcut);
    document.getElementById('toggleDiagLogsBtn')?.addEventListener('click', () => {
        const box = document.getElementById('diagLogBox');
        if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
    });
});

let isCompanionRunning = false;

async function loadCompanionStatus() {
    try {
        const resp = await fetch('/api/companion/status');
        const json = await resp.json();
        if (!json.success || !json.data) return;

        const d = json.data;
        isCompanionRunning = d.running;
        const badge = document.getElementById('companionRunningBadge');
        const btn = document.getElementById('btnToggleCompanion');

        if (badge) {
            badge.textContent = d.running ? 'Companion Running' : 'Companion Offline';
            badge.style.color = d.running ? 'var(--status-normal)' : 'var(--text-on-dark-muted)';
            badge.style.borderColor = d.running ? 'rgba(52, 199, 123, 0.3)' : 'rgba(255, 255, 255, 0.1)';
        }
        if (btn) {
            btn.textContent = d.running ? 'Stop Companion' : 'Start Companion';
            btn.className = d.running ? 'btn btn-ghost' : 'btn btn-primary';
        }

        setCheck('settStartupLaunch', d.startup_enabled);
    } catch (e) { /* retry */ }
}

async function toggleCompanionProcess() {
    const endpoint = isCompanionRunning ? '/api/companion/stop' : '/api/companion/start';
    try {
        const resp = await fetch(endpoint, { method: 'POST' });
        const json = await resp.json();
        if (typeof showToast === 'function') {
            showToast(json.message || (isCompanionRunning ? 'Companion stopped' : 'Companion started'), json.success ? 'success' : 'error');
        }
        setTimeout(loadCompanionStatus, 800);
    } catch (e) {
        if (typeof showToast === 'function') showToast('Failed to toggle companion', 'error');
    }
}

async function toggleStartupShortcut(e) {
    const enable = e.target.checked;
    try {
        const resp = await fetch('/api/companion/startup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enable })
        });
        const json = await resp.json();
        if (typeof showToast === 'function') {
            showToast(json.message, json.success ? 'success' : 'error');
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('Failed to configure startup shortcut', 'error');
    }
}

async function loadSettings() {
    try {
        const resp = await fetch('/api/settings');
        const json = await resp.json();
        if (!json.success || !json.settings) return;
        const s = json.settings;

        setValue('settRefreshInterval', s.refresh_interval || 2);
        setValue('settRetentionDays', s.history_retention_days || 30);
        setValue('settCpuWarning', s.cpu_warning || 90);
        setValue('settRamWarning', s.ram_warning || 90);
        setValue('settDiskWarning', s.disk_warning || 90);
        setValue('settGpuTempWarning', s.gpu_temp_warning || 85);
        setValue('settBatteryWarning', s.battery_warning || 20);

        setCheck('settHistoryEnabled', s.history_enabled !== false);
        setCheck('settAlertsEnabled', s.alerts_enabled !== false);

        // Overlay settings
        setCheck('settOverlayMaster', s.overlay_master_enabled !== false);
        setCheck('settOverlayIngame', s.overlay_ingame_enabled !== false);
        setCheck('settOverlayWidget', s.overlay_widget_enabled !== false);
        setCheck('settOverlayTray', s.overlay_tray_enabled !== false);
        setCheck('settWidgetClickThrough', !!s.widget_click_through);

        setValue('settOverlayCorner', s.overlay_corner || 'top-left');
        setValue('settOverlayOpacity', s.overlay_opacity || 92);

        // Accent settings
        currentAccentPreset = s.accent_preset || 'blue';
        currentAccentPrimary = s.accent_primary || '#4E88FF';
        currentAccentSecondary = s.accent_secondary || '#68D391';
        syncAccentInputs(currentAccentPrimary, currentAccentSecondary, currentAccentPreset);
        applyAccentColors(currentAccentPrimary, currentAccentSecondary, currentAccentPreset, false);

        // Multi-PC settings
        setValue('settMultipcRole', s.multipc_role || 'standalone');
        setValue('settMultipcPassphrase', s.multipc_passphrase || 'localpass');
        setValue('settMultipcPort', s.multipc_port || 5000);

    } catch (e) {
        if (typeof showToast === 'function') showToast('Failed to load settings', 'error');
    }
}

async function saveSettings() {
    try {
        const role = document.getElementById('settMultipcRole')?.value || 'standalone';
        const pass = document.getElementById('settMultipcPassphrase')?.value || 'localpass';
        const port = getInt('settMultipcPort', 5000);

        const settings = {
            refresh_interval: getInt('settRefreshInterval', 2),
            history_retention_days: getInt('settRetentionDays', 30),
            cpu_warning: getInt('settCpuWarning', 90),
            ram_warning: getInt('settRamWarning', 90),
            disk_warning: getInt('settDiskWarning', 90),
            gpu_temp_warning: getInt('settGpuTempWarning', 85),
            battery_warning: getInt('settBatteryWarning', 20),
            history_enabled: getCheck('settHistoryEnabled'),
            alerts_enabled: getCheck('settAlertsEnabled'),

            accent_preset: currentAccentPreset,
            accent_primary: currentAccentPrimary,
            accent_secondary: currentAccentSecondary,

            overlay_master_enabled: getCheck('settOverlayMaster'),
            overlay_ingame_enabled: getCheck('settOverlayIngame'),
            overlay_widget_enabled: getCheck('settOverlayWidget'),
            overlay_tray_enabled: getCheck('settOverlayTray'),
            widget_click_through: getCheck('settWidgetClickThrough'),
            overlay_corner: document.getElementById('settOverlayCorner')?.value || 'top-left',
            overlay_opacity: getInt('settOverlayOpacity', 92),

            multipc_role: role,
            multipc_passphrase: pass,
            multipc_port: port
        };

        const resp = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        const json = await resp.json();

        // Also update multipc runtime service
        await fetch('/api/multipc/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, passphrase: pass, port })
        });

        if (json.success) {
            if (typeof showToast === 'function') showToast('Preferences saved successfully!', 'success');
        } else {
            if (typeof showToast === 'function') showToast('Failed to save preferences', 'error');
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('Error saving settings', 'error');
    }
}

async function deleteHistory() {
    if (!confirm('Are you sure you want to delete ALL performance history? This cannot be undone.')) {
        return;
    }
    try {
        const resp = await fetch('/api/history', { method: 'DELETE' });
        const json = await resp.json();
        if (json.success && typeof showToast === 'function') {
            showToast('All performance history deleted', 'success');
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('Failed to delete history', 'error');
    }
}

async function resetSettings() {
    if (!confirm('Reset all settings to factory defaults?')) return;
    const defaults = {
        refresh_interval: 2,
        history_retention_days: 30,
        cpu_warning: 90,
        ram_warning: 90,
        disk_warning: 90,
        gpu_temp_warning: 85,
        battery_warning: 20,
        history_enabled: true,
        alerts_enabled: true,
        accent_preset: 'blue',
        accent_primary: '#4E88FF',
        accent_secondary: '#68D391'
    };
    try {
        const resp = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(defaults)
        });
        const json = await resp.json();
        if (json.success) {
            if (typeof showToast === 'function') showToast('Settings restored to defaults', 'success');
            loadSettings();
        }
    } catch (e) { /* retry */ }
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function setCheck(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
}

function getInt(id, fallback = 0) {
    const el = document.getElementById(id);
    return el ? parseInt(el.value, 10) || fallback : fallback;
}

function getCheck(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
}

async function loadDiagnostics() {
    const tbody = document.getElementById('diagTableBody');
    const logBox = document.getElementById('diagLogBox');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--text-on-dark-muted);">Polling hardware interfaces...</td></tr>`;

    try {
        const resp = await fetch('/api/diagnostics');
        const json = await resp.json();
        if (!json.success || !json.data) {
            tbody.innerHTML = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--status-critical);">Failed to load diagnostics report</td></tr>`;
            return;
        }

        const d = json.data;
        let rows = '';

        (d.metrics || []).forEach(m => {
            const isSuccess = m.status === 'Success';
            const badgeBg = isSuccess ? 'rgba(52, 199, 123, 0.15)' : 'rgba(245, 185, 66, 0.15)';
            const badgeColor = isSuccess ? 'var(--status-normal)' : 'var(--status-warning)';
            const badgeBorder = isSuccess ? 'rgba(52, 199, 123, 0.3)' : 'rgba(245, 185, 66, 0.3)';

            rows += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 12px 14px; font-weight: 500; color: var(--text-on-dark);">${m.metric}</td>
                    <td style="padding: 12px 14px; font-family: monospace; font-size: 0.82rem; color: #a5b4fc;">${m.backend}</td>
                    <td style="padding: 12px 14px;">
                        <span style="display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 0.74rem; font-weight: 600; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder};">
                            ${m.status}
                        </span>
                    </td>
                    <td style="padding: 12px 14px; color: var(--text-on-dark-muted);">${m.details || '—'}</td>
                </tr>
            `;
        });

        tbody.innerHTML = rows;

        if (logBox && d.recent_logs) {
            logBox.textContent = d.recent_logs.map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n') || 'No logs recorded yet.';
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--status-critical);">Error contacting diagnostics API</td></tr>`;
    }
}

// ── Accent Color Customization (Part D) ──────────────────────────────────
let currentAccentPreset = 'blue';
let currentAccentPrimary = '#4E88FF';
let currentAccentSecondary = '#68D391';

function initAccentControls() {
    // Preset buttons
    const presetPills = document.querySelectorAll('#presetPillsRow .preset-pill-btn');
    presetPills.forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            const primary = btn.dataset.primary;
            const secondary = btn.dataset.secondary;
            currentAccentPreset = preset;
            currentAccentPrimary = primary;
            currentAccentSecondary = secondary;

            syncAccentInputs(primary, secondary, preset);
            applyAccentColors(primary, secondary, preset, true);
        });
    });

    // Color pickers & hex inputs
    const primaryPicker = document.getElementById('settAccentPrimaryPicker');
    const primaryHex = document.getElementById('settAccentPrimaryHex');
    const secondaryPicker = document.getElementById('settAccentSecondaryPicker');
    const secondaryHex = document.getElementById('settAccentSecondaryHex');

    if (primaryPicker) {
        primaryPicker.addEventListener('input', (e) => {
            const val = e.target.value.toUpperCase();
            if (primaryHex) primaryHex.value = val;
            currentAccentPreset = 'custom';
            currentAccentPrimary = val;
            highlightActivePreset(null);
            applyAccentColors(val, currentAccentSecondary, 'custom', true);
        });
    }

    if (primaryHex) {
        primaryHex.addEventListener('input', (e) => {
            let val = e.target.value.trim().toUpperCase();
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-F]{6}$/i.test(val)) {
                if (primaryPicker) primaryPicker.value = val;
                currentAccentPreset = 'custom';
                currentAccentPrimary = val;
                highlightActivePreset(null);
                applyAccentColors(val, currentAccentSecondary, 'custom', true);
            }
        });
    }

    if (secondaryPicker) {
        secondaryPicker.addEventListener('input', (e) => {
            const val = e.target.value.toUpperCase();
            if (secondaryHex) secondaryHex.value = val;
            currentAccentPreset = 'custom';
            currentAccentSecondary = val;
            highlightActivePreset(null);
            applyAccentColors(currentAccentPrimary, val, 'custom', true);
        });
    }

    if (secondaryHex) {
        secondaryHex.addEventListener('input', (e) => {
            let val = e.target.value.trim().toUpperCase();
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-F]{6}$/i.test(val)) {
                if (secondaryPicker) secondaryPicker.value = val;
                currentAccentPreset = 'custom';
                currentAccentSecondary = val;
                highlightActivePreset(null);
                applyAccentColors(currentAccentPrimary, val, 'custom', true);
            }
        });
    }

    // Load cached from localStorage immediately for live responsiveness
    try {
        const p = localStorage.getItem('pc_monitor_accent_primary');
        const s = localStorage.getItem('pc_monitor_accent_secondary');
        const pr = localStorage.getItem('pc_monitor_accent_preset') || 'blue';
        if (p) {
            currentAccentPrimary = p;
            if (s) currentAccentSecondary = s;
            currentAccentPreset = pr;
            syncAccentInputs(currentAccentPrimary, currentAccentSecondary, currentAccentPreset);
            applyAccentColors(currentAccentPrimary, currentAccentSecondary, currentAccentPreset, false);
        }
    } catch (e) {}
}

function syncAccentInputs(primary, secondary, preset) {
    const primaryPicker = document.getElementById('settAccentPrimaryPicker');
    const primaryHex = document.getElementById('settAccentPrimaryHex');
    const secondaryPicker = document.getElementById('settAccentSecondaryPicker');
    const secondaryHex = document.getElementById('settAccentSecondaryHex');

    if (primaryPicker) primaryPicker.value = primary;
    if (primaryHex) primaryHex.value = primary.toUpperCase();
    if (secondaryPicker) secondaryPicker.value = secondary;
    if (secondaryHex) secondaryHex.value = secondary.toUpperCase();

    highlightActivePreset(preset);
}

function highlightActivePreset(preset) {
    const presetPills = document.querySelectorAll('#presetPillsRow .preset-pill-btn');
    presetPills.forEach(btn => {
        if (preset && btn.dataset.preset === preset) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function resetAccentColors() {
    currentAccentPreset = 'blue';
    currentAccentPrimary = '#4E88FF';
    currentAccentSecondary = '#68D391';
    syncAccentInputs('#4E88FF', '#68D391', 'blue');
    applyAccentColors('#4E88FF', '#68D391', 'blue', true);
    if (typeof showToast === 'function') showToast('Accent colors reset to Default Blue', 'info');
}

function applyAccentColors(primary, secondary, preset, persist = false) {
    // 1. Live CSS variable mutation on :root
    document.documentElement.style.setProperty('--accent-primary', primary);
    const hoverColor = adjustBrightness(primary, -15);
    document.documentElement.style.setProperty('--accent-primary-hover', hoverColor);
    document.documentElement.style.setProperty('--accent-secondary', secondary);

    // 2. Update Live Mini Preview Card
    const miniDot = document.getElementById('miniNodeDot');
    const miniMetric = document.getElementById('miniMetricNum');
    const miniProgress = document.getElementById('miniProgressBar');
    const miniBtn = document.getElementById('miniActionBtn');
    const miniTag = document.getElementById('miniTagSecondary');
    const miniCard = document.getElementById('miniPreviewCard');

    if (miniDot) {
        miniDot.style.background = primary;
        miniDot.style.boxShadow = `0 0 8px ${primary}`;
    }
    if (miniMetric) miniMetric.style.color = primary;
    if (miniProgress) miniProgress.style.background = primary;
    if (miniBtn) miniBtn.style.background = primary;
    if (miniTag) {
        miniTag.style.color = secondary;
        miniTag.style.borderColor = secondary;
    }
    if (miniCard) {
        miniCard.style.borderColor = primary;
        miniCard.style.boxShadow = `0 0 0 1px ${primary}, 0 8px 24px rgba(0,0,0,0.4)`;
    }

    // 3. WCAG Contrast Check against obsidian (#0B0E14)
    updateContrastIndicator(primary);

    // 4. Persistence
    if (persist) {
        try {
            localStorage.setItem('pc_monitor_accent_preset', preset);
            localStorage.setItem('pc_monitor_accent_primary', primary);
            localStorage.setItem('pc_monitor_accent_secondary', secondary);
        } catch (e) {}

        // Persist to server
        fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accent_preset: preset,
                accent_primary: primary,
                accent_secondary: secondary
            })
        }).catch(err => console.error('Error saving accent color to server:', err));
    }
}

function updateContrastIndicator(primaryHex) {
    const indicator = document.getElementById('contrastIndicator');
    const title = document.getElementById('contrastStatusTitle');
    const detail = document.getElementById('contrastDetailText');
    if (!indicator || !title || !detail) return;

    const ratio = getContrastRatio(primaryHex, '#0B0E14');
    const formattedRatio = ratio.toFixed(1) + ':1';

    if (ratio < 4.5) {
        indicator.className = 'contrast-indicator-block contrast-warning';
        title.textContent = `Low Contrast Warning (${formattedRatio} contrast ratio)`;
        detail.textContent = `Primary accent is below the 4.5:1 WCAG AA minimum against obsidian background (#0B0E14). Small text and icons may be harder to distinguish.`;
    } else {
        indicator.className = 'contrast-indicator-block contrast-pass';
        title.textContent = `WCAG AA Compliant (${formattedRatio} contrast ratio)`;
        detail.textContent = `Primary accent comfortably exceeds the 4.5:1 WCAG AA legibility threshold against obsidian background (#0B0E14).`;
    }
}

function getLuminance(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const a = [r, g, b].map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function getContrastRatio(hex1, hex2) {
    const lum1 = getLuminance(hex1);
    const lum2 = getLuminance(hex2);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
}

function adjustBrightness(hex, percent) {
    let num = parseInt(hex.replace('#', ''), 16);
    let amt = Math.round(2.55 * percent);
    let r = (num >> 16) + amt;
    let g = (num >> 8 & 0x00FF) + amt;
    let b = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + (r < 255 ? (r < 1 ? 0 : r) : 255) * 0x10000 +
        (g < 255 ? (g < 1 ? 0 : g) : 255) * 0x100 +
        (b < 255 ? (b < 1 ? 0 : b) : 255))
        .toString(16).slice(1).toUpperCase();
}
