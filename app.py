"""
PC Performance Monitor — Flask Application
Main entry point with page routes and API endpoints.
"""

import os
import sys
import time
import platform

from flask import Flask, render_template, jsonify, request

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.collector import collector
from services.settings import get_settings, update_settings, load_settings
from services.history import get_history, delete_all_history, delete_metric_history
from monitor.processes import get_processes, kill_process
from monitor.disk import analyze_directory
from database.db import init_db

import psutil

app = Flask(__name__)


# ─── Page Routes ─────────────────────────────────────────────────────────────

@app.route('/')
def overview():
    return render_template('overview.html', page='overview')

@app.route('/cpu')
def cpu_page():
    return render_template('cpu.html', page='cpu')

@app.route('/memory')
def memory_page():
    return render_template('memory.html', page='memory')

@app.route('/disk')
def disk_page():
    return render_template('disk.html', page='disk')

@app.route('/network')
def network_page():
    return render_template('network.html', page='network')

@app.route('/gpu')
def gpu_page():
    return render_template('gpu.html', page='gpu')

@app.route('/processes')
def processes_page():
    return render_template('processes.html', page='processes')

@app.route('/settings')
def settings_page():
    return render_template('settings.html', page='settings')


# ─── API Routes ──────────────────────────────────────────────────────────────

@app.route('/api/overview')
def api_overview():
    """Get all current metrics for the overview page."""
    try:
        latest = collector.get_latest()
        alerts = collector.alert_manager.get_active_alerts()

        # System uptime
        boot_time = psutil.boot_time()
        uptime_seconds = time.time() - boot_time
        days = int(uptime_seconds // 86400)
        hours = int((uptime_seconds % 86400) // 3600)
        minutes = int((uptime_seconds % 3600) // 60)
        uptime_fmt = f"{days}d {hours}h {minutes}m"

        # Process count
        process_count = len(list(psutil.process_iter()))

        return jsonify({
            'success': True,
            'data': {
                **latest,
                'uptime': uptime_fmt,
                'uptime_seconds': uptime_seconds,
                'process_count': process_count,
                'alerts': alerts,
                'system_info': collector.system_info,
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/cpu')
def api_cpu():
    """Get detailed CPU data with live buffer."""
    try:
        latest = collector.get_latest()
        buffer = collector.get_buffer('cpu')
        return jsonify({
            'success': True,
            'data': latest.get('cpu', {}),
            'buffer': buffer,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/memory')
def api_memory():
    """Get detailed memory data with live buffer."""
    try:
        latest = collector.get_latest()
        buffer = collector.get_buffer('memory')
        return jsonify({
            'success': True,
            'data': latest.get('memory', {}),
            'buffer': buffer,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/disk')
def api_disk():
    """Get disk partition and I/O data."""
    try:
        latest = collector.get_latest()
        buffer = collector.get_buffer('disk')
        return jsonify({
            'success': True,
            'data': latest.get('disk', {}),
            'buffer': buffer,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/disk/analyze')
def api_disk_analyze():
    """Analyze a directory for large files/folders."""
    try:
        path = request.args.get('path', '')
        if not path:
            return jsonify({'success': False, 'error': 'Path parameter required'}), 400

        # Basic validation
        if not os.path.isabs(path):
            return jsonify({'success': False, 'error': 'Path must be absolute'}), 400

        result = analyze_directory(path)
        return jsonify({'success': True, 'data': result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/network')
def api_network():
    """Get network data with live buffer."""
    try:
        latest = collector.get_latest()
        buffer = collector.get_buffer('network')
        return jsonify({
            'success': True,
            'data': latest.get('network', {}),
            'buffer': buffer,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/gpu')
def api_gpu():
    """Get GPU data with live buffer."""
    try:
        latest = collector.get_latest()
        buffer = collector.get_buffer('gpu')
        return jsonify({
            'success': True,
            'data': latest.get('gpu', {}),
            'buffer': buffer,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/processes')
def api_processes():
    """Get process list with search and sort."""
    try:
        sort_by = request.args.get('sort', 'cpu')
        search = request.args.get('search', '').strip() or None
        limit = min(int(request.args.get('limit', 100)), 500)

        result = get_processes(sort_by=sort_by, search=search, limit=limit)
        return jsonify({'success': True, **result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/processes/kill', methods=['POST'])
def api_kill_process():
    """Kill a process by PID."""
    try:
        data = request.get_json()
        if not data or 'pid' not in data:
            return jsonify({'success': False, 'message': 'PID required'}), 400

        result = kill_process(data['pid'])
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/history/<metric>')
def api_history(metric):
    """Get historical data for a metric."""
    try:
        valid_metrics = ['cpu', 'memory', 'gpu', 'network', 'disk']
        if metric not in valid_metrics:
            return jsonify({'success': False, 'error': f'Invalid metric: {metric}'}), 400

        time_range = request.args.get('range', '1h')
        valid_ranges = ['1h', '6h', '24h', '7d', 'all']
        if time_range not in valid_ranges:
            time_range = '1h'

        result = get_history(metric, time_range)
        return jsonify({'success': True, **result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/history', methods=['DELETE'])
def api_delete_history():
    """Delete all history data."""
    try:
        metric = request.args.get('metric')
        if metric:
            result = delete_metric_history(metric)
        else:
            result = delete_all_history()
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/alerts')
def api_alerts():
    """Get active alerts and alert history."""
    try:
        active = collector.alert_manager.get_active_alerts()
        history = collector.alert_manager.get_alert_history()
        return jsonify({
            'success': True,
            'active': active,
            'history': history,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/settings', methods=['GET'])
def api_get_settings():
    """Get current settings."""
    try:
        settings = get_settings()
        return jsonify({'success': True, 'settings': settings})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/settings', methods=['POST'])
def api_update_settings():
    """Update settings."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400

        settings = update_settings(data)
        return jsonify({'success': True, 'settings': settings})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/buffer/<metric>')
def api_buffer(metric):
    """Get the live buffer data for charts."""
    try:
        valid_metrics = ['cpu', 'memory', 'gpu', 'network', 'disk']
        if metric not in valid_metrics:
            return jsonify({'success': False, 'error': f'Invalid metric: {metric}'}), 400

        buffer = collector.get_buffer(metric)
        return jsonify({'success': True, 'buffer': buffer})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ─── Application Startup ────────────────────────────────────────────────────

def start_app():
    """Initialize and start the application."""
    # Load settings
    load_settings()

    # Initialize database
    init_db()

    # Start background collector
    collector.start()
    print("\n" + "=" * 60)
    print("  PC Performance Monitor")
    print("  Open http://localhost:5000 in your browser")
    print("=" * 60 + "\n")

    # Run Flask
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)


if __name__ == '__main__':
    start_app()
