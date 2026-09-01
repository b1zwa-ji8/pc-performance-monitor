"""
Disk monitoring module.
Provides partition info, I/O stats, and directory-level analysis.
"""

import psutil
import os
import time
import threading

# Track previous I/O counters for speed calculation
_prev_io = None
_prev_io_time = None
_io_lock = threading.Lock()


def _bytes_to_gb(b):
    """Convert bytes to gigabytes."""
    return round(b / (1024 ** 3), 2)


def _format_size(b):
    """Format bytes to human-readable string."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} PB"


def get_disk():
    """Get disk partition and I/O metrics.
    
    Returns:
        dict with keys: partitions (list), io (dict with speeds)
    """
    global _prev_io, _prev_io_time

    # Partition info
    partitions = []
    try:
        for part in psutil.disk_partitions(all=False):
            try:
                usage = psutil.disk_usage(part.mountpoint)
                partitions.append({
                    'device': part.device,
                    'mountpoint': part.mountpoint,
                    'fstype': part.fstype,
                    'total': _bytes_to_gb(usage.total),
                    'used': _bytes_to_gb(usage.used),
                    'free': _bytes_to_gb(usage.free),
                    'percent': usage.percent,
                    'total_bytes': usage.total,
                    'used_bytes': usage.used,
                    'free_bytes': usage.free,
                })
            except (PermissionError, OSError):
                partitions.append({
                    'device': part.device,
                    'mountpoint': part.mountpoint,
                    'fstype': part.fstype,
                    'total': 0, 'used': 0, 'free': 0, 'percent': 0,
                    'total_bytes': 0, 'used_bytes': 0, 'free_bytes': 0,
                })
    except Exception:
        pass

    # I/O counters
    io_data = {
        'read_bytes': 0, 'write_bytes': 0,
        'read_speed': 0, 'write_speed': 0,
        'read_speed_fmt': '0 B/s', 'write_speed_fmt': '0 B/s',
    }
    try:
        with _io_lock:
            counters = psutil.disk_io_counters()
            now = time.time()

            if counters:
                io_data['read_bytes'] = counters.read_bytes
                io_data['write_bytes'] = counters.write_bytes

                if _prev_io is not None and _prev_io_time is not None:
                    dt = now - _prev_io_time
                    if dt > 0:
                        read_speed = (counters.read_bytes - _prev_io.read_bytes) / dt
                        write_speed = (counters.write_bytes - _prev_io.write_bytes) / dt
                        io_data['read_speed'] = max(0, read_speed)
                        io_data['write_speed'] = max(0, write_speed)
                        io_data['read_speed_fmt'] = _format_size(max(0, read_speed)) + '/s'
                        io_data['write_speed_fmt'] = _format_size(max(0, write_speed)) + '/s'

                _prev_io = counters
                _prev_io_time = now
    except Exception:
        pass

    return {
        'partitions': partitions,
        'io': io_data,
    }


def analyze_directory(path, max_items=20):
    """Analyze a directory to find large files and folders.
    
    Args:
        path: Directory path to analyze.
        max_items: Maximum number of items to return.
    
    Returns:
        dict with items list and total size.
    """
    items = []
    total_size = 0

    try:
        if not os.path.isdir(path):
            return {'error': 'Invalid directory path', 'items': [], 'total_size': 0}

        for entry in os.scandir(path):
            try:
                if entry.is_file(follow_symlinks=False):
                    size = entry.stat().st_size
                    items.append({
                        'name': entry.name,
                        'path': entry.path,
                        'type': 'file',
                        'size': size,
                        'size_fmt': _format_size(size),
                    })
                    total_size += size
                elif entry.is_dir(follow_symlinks=False):
                    # Calculate folder size (limited depth to avoid slowness)
                    dir_size = _get_dir_size(entry.path, max_depth=2)
                    items.append({
                        'name': entry.name,
                        'path': entry.path,
                        'type': 'folder',
                        'size': dir_size,
                        'size_fmt': _format_size(dir_size),
                    })
                    total_size += dir_size
            except (PermissionError, OSError):
                continue

        # Sort by size descending
        items.sort(key=lambda x: x['size'], reverse=True)
        items = items[:max_items]

    except PermissionError:
        return {'error': 'Permission denied', 'items': [], 'total_size': 0}
    except Exception as e:
        return {'error': str(e), 'items': [], 'total_size': 0}

    return {
        'path': path,
        'items': items,
        'total_size': total_size,
        'total_size_fmt': _format_size(total_size),
    }


def _get_dir_size(path, max_depth=2, _current_depth=0):
    """Calculate directory size with depth limit."""
    total = 0
    if _current_depth >= max_depth:
        return total
    try:
        for entry in os.scandir(path):
            try:
                if entry.is_file(follow_symlinks=False):
                    total += entry.stat().st_size
                elif entry.is_dir(follow_symlinks=False):
                    total += _get_dir_size(entry.path, max_depth, _current_depth + 1)
            except (PermissionError, OSError):
                continue
    except (PermissionError, OSError):
        pass
    return total
