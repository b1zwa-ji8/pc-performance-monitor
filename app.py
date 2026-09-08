"""
PC Performance Monitor — Flask Application
Main entry point with page routes, API endpoints, and SSE streaming.
"""

import os
import sys
import time
import json
import platform

from flask import Flask, render_template, jsonify, request, Response

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.collector import collector
from services.settings import get_settings, update_settings, load_settings
from services.history import get_history, delete_all_history, delete_metric_history
from monitor.processes import get_processes, kill_process
from monitor.disk import analyze_directory
from database.db import init_db, get_speed_test_history
from monitor.speedtest_service import speedtest_service
from services.stress_test import (
    get_stress_telemetry,
    save_stress_test_run,
    get_stress_test_history,
    get_stress_test_run,
    init_stress_db,
)

import psutil

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True


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

@app.route('/history')
def history_page():
    return render_template('history.html', page='history')

@app.route('/benchmark')
def benchmark_page():
    return render_template('benchmark.html', page='benchmark')

@app.route('/stress-test')
def stress_test_page():
    return render_template('stress_test.html', page='stress_test')

@app.route('/speed-test')
def speed_test_page():
    return render_template('speed_test.html', page='speed_test')

@app.route('/fans')
def fans_page():
    return render_template('fans.html', page='fans')

@app.route('/multi-pc')
def multipc_page():
    return render_template('multipc.html', page='multipc')

@app.route('/settings')
def settings_page():
    return render_template('settings.html', page='settings')


# ─── SSE Streaming ──────────────────────────────────────────────────────────

@app.route('/api/stream')
def api_stream():
    """Server-Sent Events endpoint for live metric push.
    Pushes a full metrics snapshot every ~1 second.
    """
    def generate():
        while True:
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

                # Process count (lightweight)
                try:
                    process_count = len(psutil.pids())
                except Exception:
                    process_count = 0

                payload = {
                    **latest,
                    'uptime': uptime_fmt,
                    'uptime_seconds': uptime_seconds,
                    'process_count': process_count,
                    'alerts': alerts,
                    'system_info': collector.system_info,
                }

                data = json.dumps(payload, default=str)
                yield f"data: {data}\n\n"
            except GeneratorExit:
                return
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

            time.sleep(1)

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )


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


@app.route('/api/diagnostics')
def api_diagnostics():
    """Get system and hardware backend diagnostics report."""
    try:
        from services.diagnostics import get_diagnostics_report
        report = get_diagnostics_report()
        return jsonify({'success': True, 'data': report})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/fps')
def api_fps():
    """Get live FPS telemetry captured via PresentMon."""
    try:
        from monitor.presentmon import live_fps_monitor
        status = live_fps_monitor.get_status()
        return jsonify({'success': True, 'data': status})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/benchmark/start', methods=['POST'])
def api_benchmark_start():
    """Start a timed benchmark session."""
    try:
        from monitor.presentmon import benchmark_session
        data = request.get_json() or {}
        duration = int(data.get('duration', 30))
        ok, msg = benchmark_session.start(duration=duration)
        if not ok:
            return jsonify({'success': False, 'error': msg}), 400
        return jsonify({'success': True, 'message': msg, 'duration': benchmark_session.target_duration})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/benchmark/status')
def api_benchmark_status():
    """Poll the status of an ongoing or completed benchmark session."""
    try:
        from monitor.presentmon import benchmark_session
        elapsed = round(time.time() - benchmark_session.start_time, 1) if benchmark_session.start_time else 0
        return jsonify({
            'success': True,
            'state': benchmark_session.state,
            'target_duration': benchmark_session.target_duration,
            'elapsed_seconds': min(elapsed, benchmark_session.target_duration) if benchmark_session.state == 'running' else elapsed,
            'target_app': benchmark_session.target_app,
            'report': benchmark_session.report,
            'error': benchmark_session.error_message,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/benchmark/stop', methods=['POST'])
def api_benchmark_stop():
    """Manually abort or stop a running benchmark."""
    try:
        from monitor.presentmon import benchmark_session
        ok, msg = benchmark_session.stop()
        return jsonify({'success': ok, 'message': msg})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/benchmark/history')
def api_benchmark_history():
    """Get previous benchmark runs."""
    try:
        from monitor.presentmon import get_benchmark_history
        limit = min(int(request.args.get('limit', 20)), 100)
        runs = get_benchmark_history(limit=limit)
        return jsonify({'success': True, 'data': runs})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/benchmark/history/<int:run_id>')
def api_benchmark_run(run_id):
    """Get single benchmark run with full timeline."""
    try:
        from monitor.presentmon import get_benchmark_run
        run = get_benchmark_run(run_id)
        if not run:
            return jsonify({'success': False, 'error': 'Run not found'}), 404
        return jsonify({'success': True, 'data': run})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/companion/status')
def api_companion_status():
    """Get status of native companion (overlay, widget, tray)."""
    try:
        from services.companion_manager import get_companion_status
        status = get_companion_status()
        return jsonify({'success': True, 'data': status})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/companion/start', methods=['POST'])
def api_companion_start():
    """Start the native companion process."""
    try:
        from services.companion_manager import start_companion
        ok, msg = start_companion()
        return jsonify({'success': ok, 'message': msg})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/companion/stop', methods=['POST'])
def api_companion_stop():
    """Stop the native companion process."""
    try:
        from services.companion_manager import stop_companion
        ok, msg = stop_companion()
        return jsonify({'success': ok, 'message': msg})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/companion/startup', methods=['POST'])
def api_companion_startup():
    """Toggle launch on Windows system startup."""
    try:
        from services.companion_manager import set_startup_shortcut
        data = request.get_json() or {}
        enable = bool(data.get('enable', True))
        ok, msg = set_startup_shortcut(enable=enable)
        return jsonify({'success': ok, 'message': msg})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/fans')
def api_fans():
    """Get current fan sensor and thermal telemetry."""
    try:
        from monitor.fans import get_fans
        from monitor.gpu import get_gpu
        fan_data = get_fans()
        gpu_data = get_gpu()
        return jsonify({
            'success': True,
            'data': {
                'fan': fan_data,
                'gpu_temp': gpu_data.get('temperature'),
                'cpu_temp': None,
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/fans/history')
def api_fans_history():
    """Get thermal and fan correlation history."""
    try:
        from services.history import get_history
        time_range = request.args.get('range', '1h')
        gpu_hist = get_history('gpu', time_range)
        history_points = []
        for pt in (gpu_hist.get('data') or []):
            history_points.append({
                'timestamp': pt.get('timestamp'),
                'fan_rpm': None,
                'gpu_temp': pt.get('temperature'),
                'cpu_temp': None,
            })
        return jsonify({'success': True, 'data': history_points})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ─── Multi-PC Monitoring (Local Network Only) ──────────────────────────────

@app.route('/api/node/metrics')
def api_node_metrics():
    """Lightweight authenticated read-only endpoint for Node instances to serve Hubs."""
    from services.network_node import multipc_manager, get_local_ip
    import socket

    # Authenticate via shared local passphrase
    provided_key = request.headers.get('X-Node-Passphrase') or request.args.get('passphrase')
    if provided_key != multipc_manager.passphrase:
        return jsonify({'success': False, 'error': 'Unauthorized: invalid node passphrase'}), 401

    try:
        latest = collector.get_latest()
        boot_time = psutil.boot_time()
        uptime_seconds = time.time() - boot_time
        days = int(uptime_seconds // 86400)
        hours = int((uptime_seconds % 86400) // 3600)
        minutes = int((uptime_seconds % 3600) // 60)
        uptime_fmt = f"{days}d {hours}h {minutes}m"

        hostname = socket.gethostname()
        local_ip = get_local_ip()

        return jsonify({
            'success': True,
            'node_id': f"{hostname}_{local_ip}",
            'hostname': hostname,
            'ip': local_ip,
            'port': multipc_manager.port,
            'timestamp': time.time(),
            'uptime': uptime_fmt,
            'cpu': latest.get('cpu', {}),
            'memory': latest.get('memory', {}),
            'gpu': latest.get('gpu', {}),
            'disk': latest.get('disk', {}),
            'network': latest.get('network', {}),
            'system_info': collector.system_info,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/hub/nodes')
def api_hub_nodes():
    """Get discovered/tracked nodes on the local network (Hub mode)."""
    from services.network_node import multipc_manager
    try:
        nodes = multipc_manager.get_nodes_summary()
        return jsonify({
            'success': True,
            'role': multipc_manager.role,
            'port': multipc_manager.port,
            'passphrase_configured': bool(multipc_manager.passphrase),
            'nodes': nodes,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/hub/nodes/add', methods=['POST'])
def api_hub_nodes_add():
    """Manually register a node by IP:Port."""
    from services.network_node import multipc_manager
    try:
        data = request.get_json() or {}
        ip = data.get('ip', '').strip()
        port = int(data.get('port', 5000))
        hostname = data.get('hostname', '').strip() or f"Node-{ip}"
        passphrase = data.get('passphrase')

        if not ip:
            return jsonify({'success': False, 'error': 'IP address required'}), 400

        ok, msg = multipc_manager.add_manual_node(ip, port, hostname, passphrase)
        return jsonify({'success': ok, 'message': msg})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/hub/nodes/remove', methods=['POST'])
def api_hub_nodes_remove():
    """Remove a node from the Hub registry."""
    from services.network_node import multipc_manager
    try:
        data = request.get_json() or {}
        node_id = data.get('node_id')
        if not node_id:
            return jsonify({'success': False, 'error': 'Node ID required'}), 400

        ok, msg = multipc_manager.remove_node(node_id)
        return jsonify({'success': ok, 'message': msg})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/multipc/config', methods=['POST'])
def api_multipc_config():
    """Configure Multi-PC mode (standalone, node, hub) and passphrase."""
    from services.network_node import multipc_manager
    try:
        data = request.get_json() or {}
        role = data.get('role', 'standalone')
        passphrase = data.get('passphrase')
        port = int(data.get('port', 5000))

        if role not in ['standalone', 'node', 'hub']:
            return jsonify({'success': False, 'error': f'Invalid role: {role}'}), 400

        multipc_manager.set_role(role, passphrase, port)
        return jsonify({
            'success': True,
            'role': multipc_manager.role,
            'message': f"Multi-PC mode set to {role.upper()}"
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ─── GPU Stress Test APIs ───────────────────────────────────────────────────

@app.route('/api/stress-test/telemetry')
def api_stress_test_telemetry():
    """Fetch live real-time hardware telemetry snapshot for stress testing correlation."""
    try:
        telemetry = get_stress_telemetry()
        return jsonify({'success': True, 'data': telemetry})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stress-test/save', methods=['POST'])
def api_stress_test_save():
    """Save completed or aborted stress test run metrics and timeline samples."""
    try:
        data = request.get_json() or {}
        run_id = save_stress_test_run(data)
        return jsonify({'success': True, 'id': run_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stress-test/history')
def api_stress_test_history():
    """Get recent stress test run summaries from SQLite."""
    try:
        limit = request.args.get('limit', default=20, type=int)
        history = get_stress_test_history(limit=limit)
        return jsonify({'success': True, 'data': history})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stress-test/run/<int:run_id>')
def api_stress_test_run_detail(run_id):
    """Get full details and timeline points for a specific past stress test run."""
    try:
        run_data = get_stress_test_run(run_id)
        if not run_data:
            return jsonify({'success': False, 'error': 'Run not found'}), 404
        return jsonify({'success': True, 'data': run_data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ─── Network Speed Test API ──────────────────────────────────────────────────

@app.route('/api/speedtest/run', methods=['POST'])
def api_speedtest_run():
    """Trigger an asynchronous network speed test."""
    try:
        res = speedtest_service.start_test()
        code = res.get('code', 200)
        return jsonify(res), code
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/speedtest/status')
def api_speedtest_status():
    """Get the current progress and live telemetry of the speed test service."""
    try:
        status = speedtest_service.get_status()
        return jsonify({'success': True, 'data': status})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/speedtest/history')
def api_speedtest_history():
    """Get past network speed test records from SQLite."""
    try:
        limit = request.args.get('limit', default=50, type=int)
        history = get_speed_test_history(limit=limit)
        return jsonify({'success': True, 'data': history})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ─── Application Startup ────────────────────────────────────────────────────

def start_app():
    """Initialize and start the application."""
    # Load settings
    load_settings()

    # Initialize database
    init_db()
    init_stress_db()

    # Start background collector
    collector.start()

    # Initialize Multi-PC LAN services
    try:
        from services.network_node import multipc_manager
        multipc_manager.initialize_from_settings()
    except Exception as e:
        print("Warning: could not initialize Multi-PC network node:", e)

    print("\n" + "=" * 60)
    print("  PC Performance Monitor — 3D Dashboard")
    print("  Open http://localhost:5000 in your browser")
    print("=" * 60 + "\n")

    # Run Flask (bind 0.0.0.0 so local network nodes can communicate)
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)


if __name__ == '__main__':
    start_app()
