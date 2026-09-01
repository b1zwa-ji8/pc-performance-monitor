/**
 * Processes page — searchable, sortable process table with kill functionality.
 */

let currentSort = 'cpu';
let currentSearch = '';
let autoRefresh = true;

document.addEventListener('DOMContentLoaded', () => {
    // Sort tabs
    document.querySelectorAll('#processSortTabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#processSortTabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentSort = tab.dataset.sort;
            fetchProcesses();
        });
    });

    // Search
    const searchInput = document.getElementById('processSearch');
    let searchTimer = null;
    searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            currentSearch = searchInput.value.trim();
            fetchProcesses();
        }, 300);
    });

    // Refresh button
    document.getElementById('refreshProcesses')?.addEventListener('click', fetchProcesses);

    fetchProcesses();
    setInterval(() => {
        if (autoRefresh) fetchProcesses();
    }, 5000);
});

async function fetchProcesses() {
    try {
        let url = `/api/processes?sort=${currentSort}&limit=200`;
        if (currentSearch) url += `&search=${encodeURIComponent(currentSearch)}`;

        const resp = await fetch(url);
        const json = await resp.json();
        if (!json.success) return;

        document.getElementById('processTotal').textContent = json.total_count || 0;

        const tbody = document.getElementById('processBody');
        const procs = json.processes || [];

        if (procs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:40px;color:var(--text-muted);">No processes found</td></tr>';
            return;
        }

        tbody.innerHTML = procs.map(p => {
            const cpuColor = p.cpu_percent > 50 ? 'var(--accent-red)' : p.cpu_percent > 20 ? 'var(--accent-yellow)' : 'var(--text-primary)';
            const memColor = p.memory_percent > 50 ? 'var(--accent-red)' : p.memory_percent > 20 ? 'var(--accent-yellow)' : 'var(--text-primary)';
            const statusColor = p.status === 'running' ? 'var(--accent-green)' : 'var(--text-muted)';

            return `
                <tr>
                    <td class="truncate" style="max-width:200px;" title="${p.name}">${escapeHtml(p.name)}</td>
                    <td style="font-family:monospace;font-size:0.8rem;">${p.pid}</td>
                    <td style="color:${cpuColor};font-weight:600;">${p.cpu_percent}%</td>
                    <td style="color:${memColor};font-weight:600;">${p.memory_percent}%</td>
                    <td>${p.memory_mb} MB</td>
                    <td><span style="color:${statusColor}">${p.status}</span></td>
                    <td class="truncate" style="max-width:120px;" title="${p.username}">${escapeHtml(p.username)}</td>
                    <td>
                        <button class="btn btn-danger btn-sm" onclick="showKillModal(${p.pid}, '${escapeHtml(p.name).replace(/'/g, "\\'")}')">
                            ✕ Kill
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
