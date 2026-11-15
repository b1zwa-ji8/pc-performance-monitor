/**
 * Multi-PC Fleet Monitoring Page Controller
 * Local-network zeroconf discovery and remote node metrics grid.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    let currentRole = 'standalone';
    let pollInterval = null;

    loadMultiPCConfig();
    fetchHubNodes();

    // Poll discovered nodes every 3 seconds
    pollInterval = setInterval(fetchHubNodes, 3000);

    // Role tabs
    document.querySelectorAll('#multipcRoleTabs .editorial-pill-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const newRole = e.currentTarget.getAttribute('data-role');
            await setRole(newRole);
        });
    });

    // Passphrase save
    document.getElementById('savePassphraseBtn')?.addEventListener('click', async () => {
        const pass = document.getElementById('inputPassphrase')?.value.trim();
        await setRole(currentRole, pass);
    });

    // Modal controls
    const modal = document.getElementById('addNodeModal');
    document.getElementById('openAddNodeModalBtn')?.addEventListener('click', () => {
        if (modal) modal.style.display = 'flex';
    });
    document.getElementById('closeAddNodeModal')?.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
    });
    document.getElementById('cancelManualNodeBtn')?.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
    });
    document.getElementById('saveManualNodeBtn')?.addEventListener('click', saveManualNode);

    async function loadMultiPCConfig() {
        try {
            const resp = await fetch('/api/settings');
            const json = await resp.json();
            if (!json.success || !json.settings) return;

            const s = json.settings;
            currentRole = s.multipc_role || 'standalone';
            const passInput = document.getElementById('inputPassphrase');
            if (passInput && s.multipc_passphrase) {
                passInput.value = s.multipc_passphrase;
            }

            updateRoleUI(currentRole);
        } catch (e) { /* retry */ }
    }

    function updateRoleUI(role) {
        currentRole = role;
        document.querySelectorAll('#multipcRoleTabs .editorial-pill-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-role') === role);
        });

        const badge = document.getElementById('roleIndicatorBadge');
        if (badge) {
            if (role === 'hub') {
                badge.textContent = 'Hub Mode (Active Polling)';
                badge.style.color = 'var(--status-normal)';
                badge.style.borderColor = 'rgba(52, 199, 123, 0.3)';
            } else if (role === 'node') {
                badge.textContent = 'Node Mode (Broadcasting LAN)';
                badge.style.color = '#38bdf8';
                badge.style.borderColor = 'rgba(56, 189, 248, 0.3)';
            } else {
                badge.textContent = 'Mode: Standalone';
                badge.style.color = 'var(--text-on-dark-muted)';
                badge.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }
        }
    }

    async function setRole(role, passphrase = null) {
        const pass = passphrase || document.getElementById('inputPassphrase')?.value.trim() || 'localpass';
        try {
            const resp = await fetch('/api/multipc/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, passphrase: pass })
            });
            const json = await resp.json();
            if (json.success) {
                updateRoleUI(role);
                fetchHubNodes();
            }
        } catch (e) { /* retry */ }
    }

    async function fetchHubNodes() {
        try {
            const resp = await fetch('/api/hub/nodes');
            const json = await resp.json();
            if (!json.success) return;

            const grid = document.getElementById('nodesGrid');
            const countEl = document.getElementById('nodeCountText');
            const nodes = json.nodes || [];

            if (countEl) countEl.textContent = `${nodes.length} machine(s) registered`;
            if (!grid) return;

            if (json.role !== 'hub' && nodes.length === 0) {
                grid.innerHTML = `
                    <div class="card-dark" style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--text-on-dark-muted);">
                        <div style="font-size: 2rem; margin-bottom: 12px;">🖥️</div>
                        <h3 style="font-size: 1.1rem; color: var(--text-on-dark); margin-bottom: 8px;">Fleet Discovery Inactive</h3>
                        <p style="font-size: 0.88rem; max-width: 480px; margin: 0 auto 20px;">
                            This machine is currently running in <strong>${json.role.toUpperCase()}</strong> mode. Click <strong>Hub Mode</strong> above to discover all PC Monitor nodes broadcasting on this local network.
                        </p>
                    </div>
                `;
                return;
            }

            if (nodes.length === 0) {
                grid.innerHTML = `
                    <div class="card-dark" style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--text-on-dark-muted);">
                        <div style="font-size: 2rem; margin-bottom: 12px;">📡</div>
                        <h3 style="font-size: 1.1rem; color: var(--text-on-dark); margin-bottom: 8px;">Listening for LAN Nodes...</h3>
                        <p style="font-size: 0.88rem; max-width: 480px; margin: 0 auto;">
                            Zeroconf mDNS listener active. Launch PC Monitor on other PCs on this network and set them to <strong>Node Mode</strong>, or click <strong>+ Add Node Manually</strong> above.
                        </p>
                    </div>
                `;
                return;
            }

            let cardsHtml = '';
            nodes.forEach(n => {
                const isOnline = n.is_online;
                const statusDot = isOnline ? 'var(--status-normal)' : 'var(--status-warning)';
                const statusBg = isOnline ? 'rgba(52, 199, 123, 0.15)' : 'rgba(245, 185, 66, 0.15)';
                const statusBorder = isOnline ? 'rgba(52, 199, 123, 0.3)' : 'rgba(245, 185, 66, 0.3)';
                const statusText = isOnline ? 'Online' : `Offline (Last seen ${n.last_seen_fmt})`;

                const cpuVal = n.cpu_percent !== null && n.cpu_percent !== undefined ? `${Math.round(n.cpu_percent)}%` : '—';
                const ramVal = n.ram_percent !== null && n.ram_percent !== undefined ? `${Math.round(n.ram_percent)}%` : '—';
                const gpuVal = n.gpu_load !== null && n.gpu_load !== undefined ? `${Math.round(n.gpu_load)}%` : '—';
                const gpuTempVal = n.gpu_temp !== null && n.gpu_temp !== undefined ? `${Math.round(n.gpu_temp)}°C` : '—';

                cardsHtml += `
                    <div class="card-dark" style="padding: 24px; display: flex; flex-direction: column; justify-content: space-between; border-color: ${isOnline ? 'rgba(255,255,255,0.08)' : 'rgba(245,185,66,0.2)'};">
                        <div>
                            <!-- Card Header -->
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                                <div>
                                    <h3 style="font-size: 1.15rem; color: var(--text-on-dark); font-weight: 600;">${n.hostname}</h3>
                                    <div style="font-size: 0.8rem; color: #a5b4fc; font-family: monospace; margin-top: 2px;">
                                        http://${n.ip}:${n.port}
                                    </div>
                                </div>
                                <span style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 9999px; font-size: 0.74rem; font-weight: 600; background: ${statusBg}; color: ${statusDot}; border: 1px solid ${statusBorder};">
                                    <span style="width: 6px; height: 6px; border-radius: 50%; background: ${statusDot};"></span>
                                    ${statusText}
                                </span>
                            </div>

                            <!-- Metrics Row (Node-Card visual style) -->
                            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
                                <div style="background: rgba(255,255,255,0.03); border-radius: 6px; padding: 10px; text-align: center;">
                                    <div style="font-size: 0.72rem; color: var(--text-on-dark-muted); text-transform: uppercase;">CPU</div>
                                    <div style="font-size: 1.3rem; font-weight: 700; color: #e8442c; margin-top: 2px;">${cpuVal}</div>
                                </div>
                                <div style="background: rgba(255,255,255,0.03); border-radius: 6px; padding: 10px; text-align: center;">
                                    <div style="font-size: 0.72rem; color: var(--text-on-dark-muted); text-transform: uppercase;">RAM</div>
                                    <div style="font-size: 1.3rem; font-weight: 700; color: #a5b4fc; margin-top: 2px;">${ramVal}</div>
                                </div>
                                <div style="background: rgba(255,255,255,0.03); border-radius: 6px; padding: 10px; text-align: center;">
                                    <div style="font-size: 0.72rem; color: var(--text-on-dark-muted); text-transform: uppercase;">GPU</div>
                                    <div style="font-size: 1.3rem; font-weight: 700; color: #34c77b; margin-top: 2px;">${gpuVal}</div>
                                    <div style="font-size: 0.7rem; color: #f5b942;">${gpuTempVal}</div>
                                </div>
                            </div>
                        </div>

                        <!-- Card Footer -->
                        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 14px; margin-top: 4px;">
                            <span style="font-size: 0.76rem; color: var(--text-on-dark-muted);">Uptime: ${n.uptime || '—'}</span>
                            <div style="display: flex; gap: 8px;">
                                ${n.is_manual ? `<button class="btn btn-ghost remove-node-btn" data-id="${n.node_id}" style="font-size: 0.74rem; padding: 4px 10px; color: var(--status-critical);">Remove</button>` : ''}
                                <a href="http://${n.ip}:${n.port}" target="_blank" class="btn btn-primary" style="font-size: 0.78rem; padding: 6px 14px; text-decoration: none;">
                                    Inspect Dashboard &rarr;
                                </a>
                            </div>
                        </div>
                    </div>
                `;
            });

            grid.innerHTML = cardsHtml;

            // Wire remove buttons
            document.querySelectorAll('.remove-node-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (confirm('Remove this node from your fleet view?')) {
                        await fetch('/api/hub/nodes/remove', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ node_id: id })
                        });
                        fetchHubNodes();
                    }
                });
            });

        } catch (e) { /* retry */ }
    }

    async function saveManualNode() {
        const ip = document.getElementById('manualNodeIp')?.value.trim();
        const port = document.getElementById('manualNodePort')?.value.trim() || '5000';
        const hostname = document.getElementById('manualNodeName')?.value.trim() || `Node-${ip}`;
        const pass = document.getElementById('manualNodePass')?.value.trim() || null;

        if (!ip) {
            alert('Please enter a valid IP address or hostname');
            return;
        }

        try {
            const resp = await fetch('/api/hub/nodes/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, port, hostname, passphrase: pass })
            });
            const json = await resp.json();
            if (json.success) {
                const modal = document.getElementById('addNodeModal');
                if (modal) modal.style.display = 'none';
                fetchHubNodes();
            } else {
                alert(json.error || 'Failed to add node');
            }
        } catch (e) {
            alert('Error connecting node: ' + e);
        }
    }
});
