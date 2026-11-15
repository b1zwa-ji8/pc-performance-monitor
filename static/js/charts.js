/**
 * Chart.js wrapper utilities — Melius Design System
 * Creates and manages reusable chart instances with design token styling.
 */

const defaultChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: 'rgba(20, 20, 22, 0.95)',
            titleColor: '#f5f5f3',
            bodyColor: '#9a9a9e',
            borderColor: 'rgba(255, 255, 255, 0.08)',
            borderWidth: 1,
            cornerRadius: 10,
            padding: 12,
            titleFont: { family: 'Inter', weight: '600', size: 12 },
            bodyFont: { family: 'Inter', size: 12 },
        },
    },
    scales: {
        x: {
            display: true,
            grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
            ticks: {
                color: '#9a9a9e',
                font: { family: 'Inter', size: 10 },
                maxTicksLimit: 8,
                maxRotation: 0,
            },
        },
        y: {
            display: true,
            grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
            ticks: {
                color: '#9a9a9e',
                font: { family: 'Inter', size: 10 },
            },
            min: 0,
        },
    },
};

function createLineChart(canvasId, options = {}) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return null;

    const color = options.color || '#e8442c';
    const maxVal = options.max !== undefined ? options.max : 100;
    const label = options.label || 'Usage';
    const showLegend = options.showLegend || false;
    const yCallback = options.yCallback || null;

    const datasets = options.datasets || [{
        label: label,
        data: [],
        borderColor: color,
        backgroundColor: hexToRgba(color, 0.08),
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
    }];

    const config = {
        type: 'line',
        data: { labels: [], datasets: datasets },
        options: {
            ...defaultChartOptions,
            plugins: {
                ...defaultChartOptions.plugins,
                legend: { display: showLegend, labels: { color: '#9a9a9e', font: { family: 'Inter', size: 11 } } },
            },
            scales: {
                ...defaultChartOptions.scales,
                y: {
                    ...defaultChartOptions.scales.y,
                    max: maxVal || undefined,
                    ticks: {
                        ...defaultChartOptions.scales.y.ticks,
                        callback: yCallback || undefined,
                    },
                },
            },
        },
    };

    return new Chart(ctx, config);
}

function createDoughnutChart(canvasId, options = {}) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return null;

    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: options.labels || ['Used', 'Free'],
            datasets: [{
                data: options.data || [0, 100],
                backgroundColor: options.colors || ['#e8442c', 'rgba(255,255,255,0.06)'],
                borderWidth: 0,
                cutout: '72%',
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: '#9a9a9e', font: { family: 'Inter', size: 11 }, padding: 16 },
                },
                tooltip: defaultChartOptions.plugins.tooltip,
            },
        },
    });
}

function updateLineChartFromBuffer(chart, buffer, valueKey = 'value', maxPoints = 60) {
    if (!chart || !buffer) return;

    const recent = buffer.slice(-maxPoints);
    const labels = recent.map(p => {
        const d = new Date(p.timestamp * 1000);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    });

    chart.data.labels = labels;
    chart.data.datasets[0].data = recent.map(p => p[valueKey] || 0);
    chart.update('none');
}

function updateMultiLineChart(chart, buffer, keys, maxPoints = 60) {
    if (!chart || !buffer) return;

    const recent = buffer.slice(-maxPoints);
    const labels = recent.map(p => {
        const d = new Date(p.timestamp * 1000);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    });

    chart.data.labels = labels;
    keys.forEach((key, i) => {
        if (chart.data.datasets[i]) {
            chart.data.datasets[i].data = recent.map(p => p[key] || 0);
        }
    });
    chart.update('none');
}

function updateHistoryChart(chart, historyData, valueKey, maxPoints = 200) {
    if (!chart || !historyData) return;

    let data = historyData;
    if (data.length > maxPoints) {
        const step = Math.ceil(data.length / maxPoints);
        data = data.filter((_, i) => i % step === 0);
    }

    const labels = data.map(p => {
        const d = new Date(p.timestamp * 1000);
        return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    });

    chart.data.labels = labels;
    chart.data.datasets[0].data = data.map(p => p[valueKey] || 0);
    chart.update('none');
}

function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
