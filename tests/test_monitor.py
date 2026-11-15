"""
Unit tests for hardware monitor modules.
"""

import os
import pytest
from monitor.cpu import get_cpu
from monitor.memory import get_memory
from monitor.disk import get_disk, analyze_directory
from monitor.network import get_network
from monitor.battery import get_battery
from monitor.gpu import get_gpu, get_gpu_diagnostics, get_gpu_clock_mhz
from monitor.fans import get_fans
from monitor.processes import get_processes, kill_process
from monitor.presentmon import check_presentmon_availability, get_foreground_window_info, live_fps_monitor


def test_cpu_metrics():
    data = get_cpu()
    assert isinstance(data, dict)
    assert 'name' in data
    assert 'cores' in data and data['cores'] > 0
    assert 'threads' in data and data['threads'] > 0
    assert 'percent' in data and isinstance(data['percent'], (int, float))
    assert 'per_core' in data and isinstance(data['per_core'], list)
    assert 'frequency' in data


def test_memory_metrics():
    data = get_memory()
    assert isinstance(data, dict)
    assert 'total' in data and data['total'] > 0
    assert 'used' in data and data['used'] >= 0
    assert 'available' in data and data['available'] >= 0
    assert 'percent' in data and 0 <= data['percent'] <= 100
    assert 'swap_total' in data
    assert 'swap_percent' in data


def test_disk_metrics():
    data = get_disk()
    assert isinstance(data, dict)
    assert 'partitions' in data and isinstance(data['partitions'], list)
    assert len(data['partitions']) > 0
    part = data['partitions'][0]
    assert 'device' in part
    assert 'mountpoint' in part
    assert 'total' in part and part['total'] > 0
    assert 'percent' in part
    assert 'io' in data
    assert 'read_speed' in data['io']
    assert 'write_speed' in data['io']


def test_disk_analyze():
    # Test directory analysis on a known directory
    test_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    res = analyze_directory(test_dir, max_items=5)
    assert isinstance(res, dict)
    assert 'path' in res
    assert 'total_size' in res
    assert 'items' in res and isinstance(res['items'], list)


def test_network_metrics():
    data = get_network()
    assert isinstance(data, dict)
    assert 'bytes_sent' in data and data['bytes_sent'] >= 0
    assert 'bytes_recv' in data and data['bytes_recv'] >= 0
    assert 'upload_speed' in data
    assert 'download_speed' in data
    assert 'connections' in data


def test_battery_metrics():
    data = get_battery()
    assert isinstance(data, dict)
    assert 'available' in data
    assert 'percent' in data
    assert 'plugged' in data
    assert 'time_left' in data
    assert 'time_left_fmt' in data
    # Ensure no runaway hours
    if data['available'] and not data['plugged']:
        assert '1193046h' not in data['time_left_fmt']


def test_gpu_metrics():
    data = get_gpu()
    assert isinstance(data, dict)
    assert 'available' in data
    assert 'name' in data
    assert 'vendor' in data
    assert 'load' in data
    assert 'temperature' in data

    diag = get_gpu_diagnostics()
    assert isinstance(diag, dict)
    assert 'selected_backend' in diag

    clock = get_gpu_clock_mhz()
    # clock may be None if non-NVML, or int if NVML
    if clock is not None:
        assert isinstance(clock, int) and clock > 0


def test_fans_metrics():
    data = get_fans()
    assert isinstance(data, dict)
    assert 'available' in data
    assert 'speed_display' in data
    assert 'is_read_only' in data
    assert data['is_read_only'] is True


def test_processes_metrics():
    res = get_processes(sort_by='cpu', limit=10)
    assert isinstance(res, dict)
    assert 'processes' in res
    assert 'total_count' in res
    assert len(res['processes']) <= 10
    if len(res['processes']) > 0:
        p = res['processes'][0]
        assert 'pid' in p
        assert 'name' in p
        assert 'cpu_percent' in p
        assert 'memory_percent' in p

    # Test search
    res_search = get_processes(search='python', limit=10)
    assert isinstance(res_search, dict)
    for p in res_search['processes']:
        assert 'python' in p['name'].lower()


def test_kill_process_safety():
    # Critical PIDs 0 and 4 must not be killable
    res_0 = kill_process(0)
    assert res_0['success'] is False
    assert 'Cannot terminate system process' in res_0['message']

    res_4 = kill_process(4)
    assert res_4['success'] is False
    assert 'Cannot terminate system process' in res_4['message']

    # Invalid PID
    res_inv = kill_process('invalid')
    assert res_inv['success'] is False


def test_presentmon():
    avail, msg = check_presentmon_availability()
    assert isinstance(avail, bool)
    assert isinstance(msg, str)

    fg = get_foreground_window_info()
    assert isinstance(fg, dict)
    assert 'pid' in fg
    assert 'name' in fg

    status = live_fps_monitor.get_status()
    assert isinstance(status, dict)
    assert 'available' in status
    assert 'status' in status
