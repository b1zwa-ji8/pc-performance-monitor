/**
 * TabSwitcher Component — Melius Floating Dark Control Panel & Pill Switcher
 * Manages pill tabs, active selection, live summary copy, and navigation trigger.
 */

class FloatingPanelTabs {
    /**
     * @param {Object} options
     * @param {string} options.containerId - Element ID for container
     * @param {Array<{id: string, label: string, href: string}>} options.tabs
     * @param {string} options.initialTab
     * @param {Function} options.onTabChange
     */
    constructor(options = {}) {
        this.container = document.getElementById(options.containerId);
        this.tabs = options.tabs || [
            { id: 'cpu', label: 'CPU', href: '/cpu' },
            { id: 'memory', label: 'Memory', href: '/memory' },
            { id: 'gpu', label: 'GPU', href: '/gpu' },
            { id: 'disk', label: 'Disk', href: '/disk' },
            { id: 'network', label: 'Network', href: '/network' },
            { id: 'battery', label: 'Battery', href: '/battery' }
        ];
        this.activeTab = options.initialTab || this.tabs[0].id;
        this.onTabChange = options.onTabChange || (() => {});
        this.summaries = {};

        this._render();
    }

    _render() {
        if (!this.container) return;

        const currentTabObj = this.tabs.find(t => t.id === this.activeTab) || this.tabs[0];

        this.container.className = 'floating-control-panel';
        this.container.innerHTML = `
            <div class="panel-pill-row">
                <div class="panel-tabs-list" role="tablist">
                    ${this.tabs.map(tab => `
                        <button class="panel-pill-tab ${tab.id === this.activeTab ? 'active' : ''}"
                                data-tab="${tab.id}"
                                role="tab"
                                aria-selected="${tab.id === this.activeTab}">
                            ${tab.label}
                        </button>
                    `).join('')}
                </div>
                <a href="${currentTabObj.href}" class="panel-circle-nav-btn" id="panelNavBtn" title="Open ${currentTabObj.label} detail page" aria-label="Open detail page">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8h10m0 0L8.5 3.5M13 8l-4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </a>
            </div>
            <div class="panel-summary-row">
                <span class="panel-summary-text" id="panelSummaryText">
                    ${this.summaries[this.activeTab] || 'Monitoring system telemetry in real time.'}
                </span>
            </div>
        `;

        this._bindEvents();
    }

    _bindEvents() {
        if (!this.container) return;

        this.container.querySelectorAll('.panel-pill-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = e.currentTarget.getAttribute('data-tab');
                this.setActiveTab(tabId);
            });
        });
    }

    setActiveTab(tabId) {
        if (this.activeTab === tabId) return;
        this.activeTab = tabId;

        // Update tabs active state
        this.container.querySelectorAll('.panel-pill-tab').forEach(btn => {
            const isActive = btn.getAttribute('data-tab') === tabId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive);
        });

        // Update navigation button href
        const tabObj = this.tabs.find(t => t.id === tabId);
        const navBtn = document.getElementById('panelNavBtn');
        if (navBtn && tabObj) {
            navBtn.href = tabObj.href;
            navBtn.title = `Open ${tabObj.label} detail page`;
        }

        // Update summary copy
        this.updateSummary(tabId, this.summaries[tabId]);

        // Callback
        this.onTabChange(tabId);
    }

    setSummary(tabId, text) {
        this.summaries[tabId] = text;
        if (this.activeTab === tabId) {
            this.updateSummary(tabId, text);
        }
    }

    updateSummary(tabId, text) {
        const textEl = document.getElementById('panelSummaryText');
        if (!textEl) return;

        textEl.style.opacity = '0';
        textEl.style.transform = 'translateY(4px)';
        setTimeout(() => {
            textEl.textContent = text || 'Monitoring system telemetry in real time.';
            textEl.style.opacity = '1';
            textEl.style.transform = 'translateY(0)';
        }, 150);
    }
}

/**
 * Reusable pill switcher for editorial time filters (Today / This Week / This Month / All Time)
 */
class EditorialPillSwitcher {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.items = options.items || ['Today', 'This Week', 'This Month', 'All Time'];
        this.active = options.active || this.items[0];
        this.onChange = options.onChange || (() => {});
        this._render();
    }

    _render() {
        if (!this.container) return;
        this.container.className = 'editorial-pill-row';
        this.container.innerHTML = this.items.map(item => `
            <button class="editorial-pill-btn ${item === this.active ? 'active' : ''}" data-val="${item}">
                ${item}
            </button>
        `).join('');

        this.container.querySelectorAll('.editorial-pill-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const val = e.currentTarget.getAttribute('data-val');
                if (val === this.active) return;
                this.active = val;
                this.container.querySelectorAll('.editorial-pill-btn').forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-val') === val);
                });
                this.onChange(val);
            });
        });
    }
}

window.FloatingPanelTabs = FloatingPanelTabs;
window.EditorialPillSwitcher = EditorialPillSwitcher;
