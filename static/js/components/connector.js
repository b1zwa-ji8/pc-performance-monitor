/**
 * Connector Component — Melius Curved Bezier Connectors
 * Renders SVG curved connector lines and joint dots between the Hub node and each Node Card.
 * Includes traveling highlight pulse animation for live data flow.
 */

class ConnectorManager {
    constructor(svgElementId = 'canvas-connectors-svg') {
        this.svg = document.getElementById(svgElementId);
        this.connections = []; // { fromEl, toEl, id, status, active }
        this._resizeObserver = null;
        this._init();
    }

    _init() {
        if (!this.svg) {
            console.warn('ConnectorManager: SVG element not found.');
            return;
        }

        window.addEventListener('resize', () => this.updateLines());
        window.addEventListener('scroll', () => this.updateLines(), { passive: true });
    }

    setSvgElement(el) {
        this.svg = el;
    }

    /**
     * Register a connection between two elements
     * @param {string} id - unique ID
     * @param {HTMLElement|string} from - Source element or selector (e.g. Hub)
     * @param {HTMLElement|string} to - Destination element or selector (e.g. Node dot)
     * @param {Object} options - { status: 'normal'|'warning'|'critical', active: false }
     */
    connect(id, from, to, options = {}) {
        const fromEl = typeof from === 'string' ? document.querySelector(from) : from;
        const toEl = typeof to === 'string' ? document.querySelector(to) : to;

        // Remove existing if any
        this.disconnect(id);

        this.connections.push({
            id,
            fromEl,
            toEl,
            status: options.status || 'normal',
            active: options.active || false
        });

        this.updateLines();
    }

    disconnect(id) {
        this.connections = this.connections.filter(c => c.id !== id);
        const group = document.getElementById(`conn-grp-${id}`);
        if (group) group.remove();
    }

    clear() {
        this.connections = [];
        if (this.svg) this.svg.innerHTML = '';
    }

    setConnectionState(id, state = {}) {
        const conn = this.connections.find(c => c.id === id);
        if (!conn) return;
        if (state.status !== undefined) conn.status = state.status;
        if (state.active !== undefined) conn.active = state.active;
        this._updateSingleLine(conn);
    }

    updateLines() {
        if (!this.svg) return;

        const svgRect = this.svg.getBoundingClientRect();
        this.connections.forEach(conn => {
            this._renderLine(conn, svgRect);
        });
    }

    _renderLine(conn, svgRect) {
        if (!conn.fromEl || !conn.toEl) return;

        const fromRect = conn.fromEl.getBoundingClientRect();
        const toRect = conn.toEl.getBoundingClientRect();

        // Check if either is hidden
        if (fromRect.width === 0 || toRect.width === 0) return;

        // Coordinates relative to SVG canvas
        const x1 = fromRect.left + fromRect.width / 2 - svgRect.left;
        const y1 = fromRect.top + fromRect.height / 2 - svgRect.top;
        const x2 = toRect.left + toRect.width / 2 - svgRect.left;
        const y2 = toRect.top + toRect.height / 2 - svgRect.top;

        // Curved bezier calculation:
        // Gentle S-curve with horizontal departure and arrival
        const dx = x2 - x1;
        const dy = y2 - y1;
        const curvature = Math.min(Math.max(Math.abs(dx) * 0.5, 40), 160);

        // Control point 1 extends right from Hub, Control point 2 extends left from target card
        const cp1x = x1 + curvature;
        const cp1y = y1 + dy * 0.15;
        const cp2x = x2 - curvature;
        const cp2y = y2 - dy * 0.15;

        const pathD = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;

        // Color based on status
        let strokeColor = 'var(--accent-primary)';
        if (conn.status === 'warning') strokeColor = 'var(--status-warning)';
        else if (conn.status === 'critical') strokeColor = 'var(--status-critical)';

        let group = document.getElementById(`conn-grp-${conn.id}`);
        if (!group) {
            group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('id', `conn-grp-${conn.id}`);
            group.className.baseVal = 'connector-group';
            this.svg.appendChild(group);
        }

        group.innerHTML = `
            <!-- Background glow / hit area -->
            <path class="connector-glow" d="${pathD}" stroke="${strokeColor}"></path>
            <!-- Main smooth curved connector line -->
            <path class="connector-path" id="path-${conn.id}" d="${pathD}" stroke="${strokeColor}"></path>
            <!-- Animated traveling pulse line -->
            <path class="connector-pulse ${conn.active ? 'active' : ''}" d="${pathD}" stroke="${strokeColor}"></path>
            <!-- Endpoint dot at source (hub) -->
            <circle class="connector-endpoint" cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="3" fill="${strokeColor}"></circle>
            <!-- Endpoint dot at target card -->
            <circle class="connector-endpoint" cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3" fill="${strokeColor}"></circle>
        `;
    }

    _updateSingleLine(conn) {
        if (!this.svg) return;
        const svgRect = this.svg.getBoundingClientRect();
        this._renderLine(conn, svgRect);
    }
}

window.ConnectorManager = ConnectorManager;
