"""
Unit tests for application services and database layer.
"""

import pytest
import time
from database.db import (
    init_db,
    insert_metric,
    query_metrics,
    get_stats,
    save_speed_test,
    get_speed_test_history,
)
from services.settings import load_settings, get_settings, update_settings, validate_hex_color
from services.alerts import AlertManager
from services.diagnostics import run_startup_self_check, get_diagnostics_report
from services.history import get_history
from services.companion_manager import get_companion_status
from services.network_node import MultiPCManager, get_local_ip
from services.stress_test import get_stress_telemetry, init_stress_db
from monitor.speedtest_service import speedtest_service


def test_database_init_and_query():
    init_db()
    # Test inserting into cpu_history
    ts = time.time()
    insert_metric('cpu_history', {
        'timestamp': ts,
        'usage_percent': 42.5,
        'core_data': '[42.5]',
        'frequency': 3200.0,
    })

    rows = query_metrics('cpu_history', time_range='1h', limit=5)
    assert len(rows) > 0
    assert any(abs(r['timestamp'] - ts) < 0.1 for r in rows)

    stats = get_stats('cpu_history', 'usage_percent', time_range='1h')
    assert stats['avg'] is not None
    assert stats['min'] is not None
    assert stats['max'] is not None


def test_history_service():
    res = get_history('cpu', time_range='1h')
    assert 'data' in res
    assert 'stats' in res


def test_settings_service():
    current = get_settings()
    assert isinstance(current, dict)
    assert 'refresh_interval' in current

    # Test update settings
    updated = update_settings({'refresh_interval': 3})
    assert updated['refresh_interval'] == 3

    # Revert
    update_settings({'refresh_interval': 2})

    # Test validate_hex_color
    assert validate_hex_color('#FF0000') == '#FF0000'
    assert validate_hex_color('00ff00') == '#00FF00'
    assert validate_hex_color('invalid') == '#4E88FF'


def test_alert_manager():
    mgr = AlertManager()
    settings = get_settings()

    # Normal metrics should produce no alerts
    metrics = {
        'cpu': {'percent': 10},
        'memory': {'percent': 20},
        'disk': {'partitions': [{'device': 'C:', 'percent': 30}]},
        'gpu': {'available': True, 'temperature': 45},
        'battery': {'available': True, 'percent': 80, 'plugged': False},
    }
    mgr.check_alerts(metrics, settings)
    assert len(mgr.get_active_alerts()) == 0

    # High RAM metric should trigger alert
    metrics_high_ram = {
        'cpu': {'percent': 10},
        'memory': {'percent': 98},
        'disk': {'partitions': []},
        'gpu': {'available': False},
        'battery': {'available': False},
    }
    mgr.check_alerts(metrics_high_ram, settings)
    active = mgr.get_active_alerts()
    assert any(a['type'] == 'ram' for a in active)


def test_diagnostics_service():
    run_startup_self_check()
    report = get_diagnostics_report()
    assert isinstance(report, dict)
    assert 'system' in report
    assert 'metrics' in report
    assert 'recent_logs' in report
    assert len(report['recent_logs']) > 0


def test_companion_status():
    status = get_companion_status()
    assert isinstance(status, dict)
    assert 'running' in status
    assert 'ingame_overlay' in status
    assert 'desktop_widget' in status
    assert 'tray_flyout' in status


def test_network_node_manager():
    local_ip = get_local_ip()
    assert isinstance(local_ip, str)
    assert len(local_ip) > 0

    mpc = MultiPCManager()
    assert mpc.role == 'standalone'
    summary = mpc.get_nodes_summary()
    assert isinstance(summary, list)


def test_stress_telemetry():
    init_stress_db()
    telemetry = get_stress_telemetry()
    assert isinstance(telemetry, dict)
    assert 'timestamp' in telemetry
    assert 'gpu_available' in telemetry
    assert 'cpu_load' in telemetry


def test_speedtest_status():
    status = speedtest_service.get_status()
    assert isinstance(status, dict)
    assert 'status' in status
    assert 'is_running' in status
