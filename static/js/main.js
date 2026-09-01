/**
 * PC Performance Monitor — Main JavaScript
 * Handles sidebar, theme, toast, modal, and alert polling.
 */

// ── Theme ───────────────────────────────────────────────────
function getTheme() {
    return localStorage.getItem('pcm-theme') || 'dark';
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pcm-theme', theme);
    updateThemeUI(theme);
}

function updateThemeUI(theme) {
    const icon = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');
    if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
    if (label) label.textContent = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
}

function toggleTheme() {
    const current = getTheme();
    setTheme(current === 'dark' ? 'light' : 'dark');
}

// Initialize theme
setTheme(getTheme());

// Theme toggle listeners
document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
document.getElementById('themeToggleMobile')?.addEventListener('click', toggleTheme);

// ── Sidebar (Mobile) ────────────────────────────────────────
const sidebar = document.getElementById('sidebar');
const menuBtn = document.getElementById('menuBtn');
const overlay = document.getElementById('sidebarOverlay');

menuBtn?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('show');
});

overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('show');
});

// ── Toast Notifications ─────────────────────────────────────
function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : '⚠️'}</span>
        <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ── Kill Process Modal ──────────────────────────────────────
let killPid = null;

function showKillModal(pid, name) {
    killPid = pid;
    const modal = document.getElementById('killModal');
    const text = document.getElementById('killModalText');
    if (text) text.textContent = `Are you sure you want to terminate "${name}" (PID: ${pid})?`;
    modal?.classList.add('show');
}

function hideKillModal() {
    killPid = null;
    document.getElementById('killModal')?.classList.remove('show');
}

document.getElementById('killCancel')?.addEventListener('click', hideKillModal);
document.getElementById('killConfirm')?.addEventListener('click', async () => {
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
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Failed to terminate process', 'error');
    }
    hideKillModal();
});

// Close modal on overlay click
document.getElementById('killModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'killModal') hideKillModal();
});

// ── Alert Polling ───────────────────────────────────────────
async function pollAlerts() {
    try {
        const resp = await fetch('/api/alerts');
        const data = await resp.json();
        if (!data.success) return;

        const area = document.getElementById('alertArea');
        const countEl = document.getElementById('alertCount');
        const active = data.active || [];

        // Update badge
        if (countEl) {
            if (active.length > 0) {
                countEl.textContent = active.length;
                countEl.className = 'alert-badge';
            } else {
                countEl.className = 'hidden';
            }
        }

        // Update alert banners
        if (area) {
            if (active.length === 0) {
                area.innerHTML = '';
                return;
            }
            area.innerHTML = active.map(a => `
                <div class="alert-banner ${a.severity}">
                    <span class="alert-icon">${a.severity === 'critical' ? '🔴' : '🟡'}</span>
                    <span class="alert-text">${a.message}</span>
                </div>
            `).join('');
        }
    } catch (e) {
        // Silently fail
    }
}

// Poll alerts every 5 seconds
setInterval(pollAlerts, 5000);
pollAlerts();

// ── Utility ─────────────────────────────────────────────────
function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatSpeed(bps) {
    return formatBytes(bps) + '/s';
}

function getStatusClass(percent, thresholds = { warning: 80, critical: 90 }) {
    if (percent >= thresholds.critical) return 'critical';
    if (percent >= thresholds.warning) return 'warning';
    return 'normal';
}

function getStatusText(percent, thresholds = { warning: 80, critical: 90 }) {
    if (percent >= thresholds.critical) return 'Critical';
    if (percent >= thresholds.warning) return 'Warning';
    return 'Normal';
}

function updateStatusBadge(elementId, percent, thresholds) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const status = getStatusClass(percent, thresholds);
    const text = getStatusText(percent, thresholds);
    el.className = `status-badge ${status}`;
    el.innerHTML = `<span class="status-dot"></span> ${text}`;
}

function getChartTextColor() {
    return getComputedStyle(document.documentElement)
        .getPropertyValue('--chart-text').trim() || '#8b8fa3';
}

function getChartGridColor() {
    return getComputedStyle(document.documentElement)
        .getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,0.05)';
}
