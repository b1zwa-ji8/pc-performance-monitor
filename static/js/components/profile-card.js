/**
 * ProfileCard Component — Melius Plan-Card Pattern for Performance Profiles
 * Renders 3 side-by-side cards (Light, Balanced, Detailed) with large serif interval numbers,
 * featured glow ring, feature checklist, and real-time settings application.
 */

class ProfileCardSelector {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.activeProfile = options.initialProfile || 'balanced';
        this.onProfileSelect = options.onProfileSelect || (() => {});
        this.profiles = [
            {
                id: 'light',
                name: 'Light',
                tagline: 'Minimal background footprint',
                interval: '10s',
                intervalLabel: 'telemetry cycle',
                featured: false,
                icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
                features: [
                    'Lowest background CPU cost (<0.1%)',
                    'Basic system load & memory tracking',
                    'Hourly SQLite snapshot',
                    'Passive alert checks'
                ],
                settings: { refresh_interval: 10, history_enabled: true }
            },
            {
                id: 'balanced',
                name: 'Balanced',
                tagline: 'Recommended for daily monitoring',
                interval: '2s',
                intervalLabel: 'standard refresh',
                featured: true,
                badge: 'Recommended',
                icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M3 9l9-6 9 6M6 12l-3 6h6l-3-6zm12 0l-3 6h6l-3-6z"/></svg>',
                features: [
                    'Real-time responsiveness (<0.5% CPU)',
                    'Full per-core CPU & memory telemetry',
                    'Network I/O & active socket tracking',
                    'Continuous anomaly & threshold detection'
                ],
                settings: { refresh_interval: 2, history_enabled: true }
            },
            {
                id: 'detailed',
                name: 'Detailed',
                tagline: 'High-frequency telemetry logging',
                interval: '1s',
                intervalLabel: 'sub-second precision',
                featured: false,
                icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
                features: [
                    '1-second high-rate push via SSE',
                    'Per-core frequency & load monitoring',
                    'NVIDIA NVML deep sensor telemetry',
                    'Instant alert dispatching'
                ],
                settings: { refresh_interval: 1, history_enabled: true }
            }
        ];

        this._render();
    }

    _render() {
        if (!this.container) return;

        this.container.className = 'profile-cards-grid';
        this.container.innerHTML = this.profiles.map(p => {
            const isSelected = p.id === this.activeProfile;
            return `
                <div class="profile-card ${p.featured ? 'featured' : ''} ${isSelected ? 'selected' : ''}" data-profile="${p.id}">
                    ${p.badge ? `<div class="profile-card-badge">${p.badge}</div>` : ''}
                    <div class="profile-icon-container">
                        <div class="profile-icon-ring"></div>
                        <div class="profile-icon-glyph">${p.icon}</div>
                    </div>
                    <div class="profile-card-header">
                        <h3 class="profile-name">${p.name}</h3>
                        <p class="profile-tagline">${p.tagline}</p>
                    </div>
                    <div class="profile-interval-row">
                        <span class="profile-interval-num">${p.interval}</span>
                        <span class="profile-interval-sub">${p.intervalLabel}</span>
                    </div>
                    <div class="profile-features-divider">
                        <span class="profile-features-pill">Capabilities</span>
                    </div>
                    <ul class="profile-checklist">
                        ${p.features.map(f => `
                            <li>
                                <svg class="check-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <circle cx="8" cy="8" r="7" stroke="var(--status-normal)" stroke-width="1.5"/>
                                    <path d="M5 8l2 2 4-4" stroke="var(--status-normal)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                                <span>${f}</span>
                            </li>
                        `).join('')}
                    </ul>
                    <button class="btn profile-select-btn ${isSelected ? 'btn-primary' : 'btn-outline-dark'}" data-select="${p.id}">
                        ${isSelected ? 'Active Profile' : 'Select Profile'}
                    </button>
                </div>
            `;
        }).join('');

        this._bindEvents();
    }

    _bindEvents() {
        if (!this.container) return;

        this.container.querySelectorAll('[data-select]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const profileId = e.currentTarget.getAttribute('data-select');
                this.selectProfile(profileId);
            });
        });
    }

    selectProfile(profileId) {
        const p = this.profiles.find(x => x.id === profileId);
        if (!p) return;

        this.activeProfile = profileId;
        this.container.querySelectorAll('.profile-card').forEach(card => {
            const cId = card.getAttribute('data-profile');
            const isSel = cId === profileId;
            card.classList.toggle('selected', isSel);
            const btn = card.querySelector('[data-select]');
            if (btn) {
                btn.className = `btn profile-select-btn ${isSel ? 'btn-primary' : 'btn-outline-dark'}`;
                btn.textContent = isSel ? 'Active Profile' : 'Select Profile';
            }
        });

        // Apply settings to backend
        fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(p.settings)
        })
        .then(r => r.json())
        .then(res => {
            if (res.success && typeof showToast === 'function') {
                showToast(`Switched to ${p.name} Profile (${p.interval})`, 'success');
            }
        })
        .catch(() => {});

        this.onProfileSelect(p);
    }
}

window.ProfileCardSelector = ProfileCardSelector;
