/**
 * Processes page — searchable, sortable process table with termination modal.
 * Melius design system integration.
 */

let currentSort = 'cpu';
let currentSearch = '';
let autoRefresh = true;

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // Sort tabs
    document.querySelectorAll('#processSortTabs .editorial-pill-btn').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('#processSortTabs .editorial-pill-btn').forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentSort = e.currentTarget.getAttribute('data-sort');
            fetchProcesses();
        });
    });

    // Search input
    const searchInput = document.getElementById('processSearch');
    let searchTimer = null;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                currentSearch = searchInput.value.trim();
                fetchProcesses();
            }, 250);
        });
    }

    // Refresh button
    document.getElementById('refreshProcesses')?.addEventListener('click', fetchProcesses);

    fetchProcesses();
    setInterval(() => {
        if (autoRefresh) fetchProcesses();
    }, 4000);
});

async function fetchProcesses() {
    try {
        let url = `/api/processes?sort=${currentSort}&limit=200`;
        if (currentSearch) url += `&search=${encodeURIComponent(currentSearch)}`;

        const resp = await fetch(url);
        const json = await resp.json();
        if (!json.success) return;

        const totalEl = document.getElementById('processTotal');
        if (totalEl) totalEl.textContent = json.total_count || 0;

        const tbody = document.getElementById('processBody');
        const procs = json.processes || [];

        if (!tbody) return;

        if (procs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:48px;color:var(--text-on-dark-muted);">No matching processes found</td></tr>';
            return;
        }

        tbody.innerHTML = procs.map(p => {
            const cpuColor = p.cpu_percent > 50 ? 'var(--status-critical)' : p.cpu_percent > 20 ? 'var(--status-warning)' : 'var(--text-on-dark)';
            const memColor = p.memory_percent > 50 ? 'var(--status-critical)' : p.memory_percent > 20 ? 'var(--status-warning)' : 'var(--text-on-dark)';
            const statusBadgeColor = p.status === 'running' ? 'var(--status-normal)' : 'var(--text-on-dark-muted)';

            return `
                <tr>
                    <td style="font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(p.name)}">
                        ${escapeHtml(p.name)}
                    </td>
                    <td style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-on-dark-muted);">${p.pid}</td>
                    <td style="color:${cpuColor};font-weight:600;">${p.cpu_percent}%</td>
                    <td style="color:${memColor};font-weight:600;">${p.memory_percent}%</td>
                    <td>${p.memory_mb} MB</td>
                    <td>
                        <span style="display:inline-flex;align-items:center;gap:6px;font-size:0.8rem;color:${statusBadgeColor}">
                            <span style="width:6px;height:6px;border-radius:50%;background:${statusBadgeColor}"></span>
                            ${p.status}
                        </span>
                    </td>
                    <td style="color:var(--text-on-dark-muted);font-size:0.82rem;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${escapeHtml(p.username)}
                    </td>
                    <td style="text-align:right;">
                        <button class="btn btn-ghost" style="padding:4px 12px;font-size:0.75rem;color:var(--status-critical);border-color:rgba(232,68,44,0.3);" onclick="showKillModal(${p.pid}, '${escapeHtml(p.name).replace(/'/g, "\\'")}')">
                            Terminate
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (e) { /* retry */ }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

window.fetchProcesses = fetchProcesses;
