"""
Memory monitoring module.
Provides RAM and swap usage information via psutil.
"""

import psutil


def _bytes_to_gb(b):
    """Convert bytes to gigabytes, rounded to 2 decimals."""
    return round(b / (1024 ** 3), 2)


def get_memory():
    """Get current memory metrics.
    
    Returns:
        dict with keys: total, used, available, free, percent,
                       swap_total, swap_used, swap_free, swap_percent
    """
    try:
        vm = psutil.virtual_memory()
        total = _bytes_to_gb(vm.total)
        used = _bytes_to_gb(vm.used)
        available = _bytes_to_gb(vm.available)
        free = _bytes_to_gb(vm.free)
        percent = vm.percent
    except Exception:
        total = used = available = free = 0
        percent = 0.0

    try:
        swap = psutil.swap_memory()
        swap_total = _bytes_to_gb(swap.total)
        swap_used = _bytes_to_gb(swap.used)
        swap_free = _bytes_to_gb(swap.free)
        swap_percent = swap.percent
    except Exception:
        swap_total = swap_used = swap_free = 0
        swap_percent = 0.0

    return {
        'total': total,
        'used': used,
        'available': available,
        'free': free,
        'percent': percent,
        'swap_total': swap_total,
        'swap_used': swap_used,
        'swap_free': swap_free,
        'swap_percent': swap_percent,
    }
