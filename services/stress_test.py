"""
GPU Stress Test Service.
Manages stress test history in SQLite and provides fast hardware telemetry polling
for real-time FPS/thermal correlation.
"""

import json
import logging
import time
import psutil

from database.db import get_connection
from monitor.gpu import get_gpu, _nvml_initialized, _pynvml_lib, _nvml_device_handle
from services.settings import load_settings

logger = logging.getLogger('pc_monitor.stress_test')


def init_stress_db():
    """Ensure the stress_test_history table exists in SQLite."""
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS stress_test_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                duration_seconds REAL NOT NULL,
                preset TEXT NOT NULL,
                avg_fps REAL,
                min_fps REAL,
                one_percent_low_fps REAL,
                stability_score REAL,
                peak_gpu_temp REAL,
                peak_gpu_load REAL,
                peak_vram_used REAL,
                aborted INTEGER DEFAULT 0,
                abort_reason TEXT,
                timeline_json TEXT
            )
        ''')
        conn.commit()
    except Exception as e:
        logger.error("Failed to init stress_test_history table: %s", e)


def get_gpu_clock_mhz():
    """Query current GPU graphics clock speed in MHz via NVML if active."""
    try:
        if _nvml_initialized and _pynvml_lib and _nvml_device_handle:
            clock = _pynvml_lib.nvmlDeviceGetClockInfo(
                _nvml_device_handle,
                _pynvml_lib.NVML_CLOCK_GRAPHICS
            )
            return int(clock)
    except Exception as e:
        logger.debug("Could not query GPU clock info: %s", e)
    return None


def get_stress_telemetry():
    """Fetch high-frequency telemetry snapshot for correlation during stress testing.
    
    Includes GPU temp, load, VRAM, clock speed, CPU load, and safety temp threshold.
    Returns 100% real hardware values (no fabricated or placeholder data).
    """
    settings = load_settings()
    safety_temp_threshold = float(settings.get('gpu_temp_warning', 85))

    gpu = get_gpu()
    clock_mhz = get_gpu_clock_mhz()

    # CPU load (non-blocking)
    cpu_percent = psutil.cpu_percent(interval=None)
    
    cpu_freq_mhz = None
    try:
        freq = psutil.cpu_freq()
        if freq:
            cpu_freq_mhz = round(freq.current, 0)
    except Exception:
        pass

    return {
        'timestamp': time.time(),
        'gpu_available': bool(gpu.get('available')),
        'gpu_name': gpu.get('name', 'Unavailable'),
        'gpu_load': gpu.get('load'),
        'gpu_temp': gpu.get('temperature'),
        'gpu_vram_used': gpu.get('memory_used'),
        'gpu_vram_total': gpu.get('memory_total'),
        'gpu_vram_percent': gpu.get('memory_percent'),
        'gpu_clock_mhz': clock_mhz,
        'cpu_load': cpu_percent,
        'cpu_freq_mhz': cpu_freq_mhz,
        'safety_temp_threshold': safety_temp_threshold,
    }


def save_stress_test_run(data):
    """Save a completed or aborted stress test run into SQLite.
    
    Args:
        data (dict): Result metrics including avg_fps, 1% low, stability,
                     peaks, aborted status, and timeline samples.
    Returns:
        int: The inserted record ID.
    """
    init_stress_db()
    conn = get_connection()
    cursor = conn.cursor()

    timeline_str = None
    if 'timeline' in data:
        if isinstance(data['timeline'], (dict, list)):
            timeline_str = json.dumps(data['timeline'])
        else:
            timeline_str = str(data['timeline'])

    cursor.execute('''
        INSERT INTO stress_test_history (
            timestamp,
            duration_seconds,
            preset,
            avg_fps,
            min_fps,
            one_percent_low_fps,
            stability_score,
            peak_gpu_temp,
            peak_gpu_load,
            peak_vram_used,
            aborted,
            abort_reason,
            timeline_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data.get('timestamp', time.time()),
        float(data.get('duration_seconds', 0.0)),
        str(data.get('preset', 'medium')),
        data.get('avg_fps'),
        data.get('min_fps'),
        data.get('one_percent_low_fps'),
        data.get('stability_score'),
        data.get('peak_gpu_temp'),
        data.get('peak_gpu_load'),
        data.get('peak_vram_used'),
        1 if data.get('aborted') else 0,
        data.get('abort_reason', ''),
        timeline_str
    ))
    conn.commit()
    return cursor.lastrowid


def get_stress_test_history(limit=20):
    """Retrieve recent stress test runs from SQLite.
    
    Args:
        limit (int): Max records to retrieve.
    Returns:
        list[dict]: List of stress test runs without raw timeline blobs (for light list display).
    """
    init_stress_db()
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT 
            id,
            timestamp,
            duration_seconds,
            preset,
            avg_fps,
            min_fps,
            one_percent_low_fps,
            stability_score,
            peak_gpu_temp,
            peak_gpu_load,
            peak_vram_used,
            aborted,
            abort_reason
        FROM stress_test_history
        ORDER BY id DESC
        LIMIT ?
    ''', (limit,))

    rows = cursor.fetchall()
    return [dict(row) for row in rows]


def get_stress_test_run(run_id):
    """Retrieve a single stress test run with full timeline data.
    
    Args:
        run_id (int): Record ID.
    Returns:
        dict or None.
    """
    init_stress_db()
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute('SELECT * FROM stress_test_history WHERE id = ?', (run_id,))
    row = cursor.fetchone()
    if not row:
        return None

    res = dict(row)
    if res.get('timeline_json'):
        try:
            res['timeline'] = json.loads(res['timeline_json'])
        except Exception:
            res['timeline'] = []
    else:
        res['timeline'] = []
    return res
