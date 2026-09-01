"""
GPU monitoring module.
Uses GPUtil for NVIDIA GPUs. Gracefully handles unavailability.
"""

_gpu_available = False

try:
    import GPUtil
    _gpu_available = True
except ImportError:
    _gpu_available = False


def get_gpu():
    """Get GPU metrics.
    
    Returns:
        dict with keys: available, name, load, temperature,
                       memory_total, memory_used, memory_free, memory_percent
    """
    if not _gpu_available:
        return {
            'available': False,
            'name': 'Unavailable',
            'load': 0,
            'temperature': 0,
            'memory_total': 0,
            'memory_used': 0,
            'memory_free': 0,
            'memory_percent': 0,
        }

    try:
        gpus = GPUtil.getGPUs()
        if not gpus:
            return {
                'available': False,
                'name': 'No GPU detected',
                'load': 0,
                'temperature': 0,
                'memory_total': 0,
                'memory_used': 0,
                'memory_free': 0,
                'memory_percent': 0,
            }

        # Use the first GPU (primary)
        gpu = gpus[0]
        mem_total = round(gpu.memoryTotal / 1024, 2) if gpu.memoryTotal else 0
        mem_used = round(gpu.memoryUsed / 1024, 2) if gpu.memoryUsed else 0
        mem_free = round(gpu.memoryFree / 1024, 2) if gpu.memoryFree else 0
        mem_percent = round((gpu.memoryUsed / gpu.memoryTotal) * 100, 1) if gpu.memoryTotal else 0

        return {
            'available': True,
            'name': gpu.name or 'Unknown GPU',
            'load': round(gpu.load * 100, 1) if gpu.load is not None else 0,
            'temperature': gpu.temperature if gpu.temperature is not None else 0,
            'memory_total': mem_total,
            'memory_used': mem_used,
            'memory_free': mem_free,
            'memory_percent': mem_percent,
        }
    except Exception:
        return {
            'available': False,
            'name': 'Error reading GPU',
            'load': 0,
            'temperature': 0,
            'memory_total': 0,
            'memory_used': 0,
            'memory_free': 0,
            'memory_percent': 0,
        }
