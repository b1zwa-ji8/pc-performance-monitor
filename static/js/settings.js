/**
 * Settings page — load, edit, and save configuration.
 */

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();

    document.getElementById('saveSettings')?.addEventListener('click', saveSettings);
    document.getElementById('deleteHistory')?.addEventListener('click', deleteAllHistory);

    // Theme select sync
    document.getElementById('settingTheme')?.addEventListener('change', (e) => {
        setTheme(e.target.value);
    });
});

async function loadSettings() {
    try {
        const resp = await fetch('/api/settings');
        const json = await resp.json();
        if (!json.success) return;
        const s = json.settings;

        setInput('settingRefreshInterval', s.refresh_interval);
        setInput('settingCpuWarning', s.cpu_warning);
        setInput('settingRamWarning', s.ram_warning);
        setInput('settingDiskWarning', s.disk_warning);
        setInput('settingGpuTemp', s.gpu_temp_warning);
        setInput('settingBatteryWarning', s.battery_warning);
        setInput('settingRetention', s.history_retention_days);

        setSelect('settingTheme', s.theme);
        setCheckbox('settingHistory', s.history_enabled);
        setCheckbox('settingAlerts', s.alerts_enabled);

    } catch (e) {
        showToast('Failed to load settings', 'error');
    }
}

async function saveSettings() {
    try {
        const settings = {
            refresh_interval: getInputValue('settingRefreshInterval'),
            cpu_warning: getInputValue('settingCpuWarning'),
            ram_warning: getInputValue('settingRamWarning'),
            disk_warning: getInputValue('settingDiskWarning'),
            gpu_temp_warning: getInputValue('settingGpuTemp'),
            battery_warning: getInputValue('settingBatteryWarning'),
            history_retention_days: getInputValue('settingRetention'),
            theme: getSelectValue('settingTheme'),
            history_enabled: getCheckboxValue('settingHistory'),
            alerts_enabled: getCheckboxValue('settingAlerts'),
        };

        const resp = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
        const json = await resp.json();
        if (json.success) {
            showToast('Settings saved successfully', 'success');
        } else {
            showToast('Failed to save settings', 'error');
        }
    } catch (e) {
        showToast('Failed to save settings', 'error');
    }
}

async function deleteAllHistory() {
    if (!confirm('Are you sure you want to delete ALL performance history? This cannot be undone.')) {
        return;
    }

    try {
        const resp = await fetch('/api/history', { method: 'DELETE' });
        const json = await resp.json();
        if (json.success) {
            showToast('All history deleted', 'success');
        } else {
            showToast('Failed to delete history', 'error');
        }
    } catch (e) {
        showToast('Failed to delete history', 'error');
    }
}

// Helpers
function setInput(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function setSelect(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function setCheckbox(id, value) {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
}

function getInputValue(id) {
    const el = document.getElementById(id);
    return el ? parseInt(el.value, 10) : 0;
}

function getSelectValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function getCheckboxValue(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
}
