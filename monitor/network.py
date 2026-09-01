"""
Network monitoring module.
Tracks upload/download speeds using psutil counters.
"""

import psutil
import time
import threading

_prev_net = None
_prev_net_time = None
_net_lock = threading.Lock()


def _format_speed(bps):
    """Format bytes per second to human-readable string."""
    for unit in ['B/s', 'KB/s', 'MB/s', 'GB/s']:
        if bps < 1024:
            return f"{bps:.1f} {unit}"
        bps /= 1024
    return f"{bps:.1f} TB/s"


def get_network():
    """Get current network metrics.
    
    Returns:
        dict with keys: bytes_sent, bytes_recv, upload_speed, download_speed,
                       upload_speed_fmt, download_speed_fmt, connections
    """
    global _prev_net, _prev_net_time

    data = {
        'bytes_sent': 0, 'bytes_recv': 0,
        'upload_speed': 0, 'download_speed': 0,
        'upload_speed_fmt': '0 B/s', 'download_speed_fmt': '0 B/s',
        'connections': 0,
    }

    try:
        with _net_lock:
            counters = psutil.net_io_counters()
            now = time.time()

            if counters:
                data['bytes_sent'] = counters.bytes_sent
                data['bytes_recv'] = counters.bytes_recv

                if _prev_net is not None and _prev_net_time is not None:
                    dt = now - _prev_net_time
                    if dt > 0:
                        upload = (counters.bytes_sent - _prev_net.bytes_sent) / dt
                        download = (counters.bytes_recv - _prev_net.bytes_recv) / dt
                        data['upload_speed'] = max(0, upload)
                        data['download_speed'] = max(0, download)
                        data['upload_speed_fmt'] = _format_speed(max(0, upload))
                        data['download_speed_fmt'] = _format_speed(max(0, download))

                _prev_net = counters
                _prev_net_time = now
    except Exception:
        pass

    try:
        data['connections'] = len(psutil.net_connections(kind='inet'))
    except (psutil.AccessDenied, OSError):
        data['connections'] = 0

    return data
