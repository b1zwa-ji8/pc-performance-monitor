"""
CPU monitoring module.
Uses psutil and py-cpuinfo for comprehensive CPU information.
"""

import psutil
import json

try:
    import cpuinfo
    _cpu_info_available = True
except ImportError:
    _cpu_info_available = False


# Cache CPU static info (doesn't change at runtime)
_cached_cpu_name = None
_cached_cpu_cores = None
_cached_cpu_threads = None


def _get_static_info():
    """Get static CPU info (cached after first call)."""
    global _cached_cpu_name, _cached_cpu_cores, _cached_cpu_threads

    if _cached_cpu_name is None:
        try:
            if _cpu_info_available:
                info = cpuinfo.get_cpu_info()
                _cached_cpu_name = info.get('brand_raw', 'Unknown CPU')
            else:
                _cached_cpu_name = 'Unknown CPU'
        except Exception:
            _cached_cpu_name = 'Unknown CPU'

    if _cached_cpu_cores is None:
        _cached_cpu_cores = psutil.cpu_count(logical=False) or 0
        _cached_cpu_threads = psutil.cpu_count(logical=True) or 0


def get_cpu():
    """Get current CPU metrics.
    
    Returns:
        dict with keys: name, cores, threads, percent, per_core, frequency,
                       frequency_min, frequency_max
    """
    _get_static_info()

    try:
        percent = psutil.cpu_percent(interval=0)
        per_core = psutil.cpu_percent(interval=0, percpu=True)
    except Exception:
        percent = 0.0
        per_core = []

    try:
        freq = psutil.cpu_freq()
        frequency = round(freq.current, 0) if freq else 0
        freq_min = round(freq.min, 0) if freq and freq.min else 0
        freq_max = round(freq.max, 0) if freq and freq.max else 0
    except Exception:
        frequency = 0
        freq_min = 0
        freq_max = 0

    return {
        'name': _cached_cpu_name,
        'cores': _cached_cpu_cores,
        'threads': _cached_cpu_threads,
        'percent': percent,
        'per_core': per_core,
        'frequency': frequency,
        'frequency_min': freq_min,
        'frequency_max': freq_max,
        'core_data_json': json.dumps(per_core),
    }
