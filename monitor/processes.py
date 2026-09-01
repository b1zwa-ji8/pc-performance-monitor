"""
Process monitoring module.
Lists running processes and provides kill functionality via psutil.
"""

import psutil
import os


def get_processes(sort_by='cpu', search=None, limit=100):
    """Get list of running processes.
    
    Args:
        sort_by: 'cpu', 'memory', 'name', 'pid'.
        search: Filter string for process name.
        limit: Max processes to return.
    
    Returns:
        dict with keys: processes (list), total_count
    """
    processes = []
    total_count = 0

    try:
        for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent',
                                          'status', 'username', 'memory_info']):
            try:
                info = proc.info
                total_count += 1

                # Apply search filter
                if search:
                    name = (info.get('name') or '').lower()
                    if search.lower() not in name:
                        continue

                mem_info = info.get('memory_info')
                mem_bytes = mem_info.rss if mem_info else 0

                processes.append({
                    'pid': info.get('pid', 0),
                    'name': info.get('name', 'Unknown'),
                    'cpu_percent': round(info.get('cpu_percent', 0) or 0, 1),
                    'memory_percent': round(info.get('memory_percent', 0) or 0, 1),
                    'memory_mb': round(mem_bytes / (1024 * 1024), 1),
                    'status': info.get('status', 'unknown'),
                    'username': info.get('username', 'N/A') or 'N/A',
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

    except Exception:
        pass

    # Sort
    sort_keys = {
        'cpu': lambda x: x['cpu_percent'],
        'memory': lambda x: x['memory_percent'],
        'name': lambda x: x['name'].lower(),
        'pid': lambda x: x['pid'],
    }
    sort_fn = sort_keys.get(sort_by, sort_keys['cpu'])
    reverse = sort_by in ('cpu', 'memory')
    processes.sort(key=sort_fn, reverse=reverse)

    return {
        'processes': processes[:limit],
        'total_count': total_count,
    }


def kill_process(pid):
    """Terminate a process by PID.
    
    Args:
        pid: Process ID to terminate.
    
    Returns:
        dict with success status and message.
    """
    try:
        pid = int(pid)
    except (ValueError, TypeError):
        return {'success': False, 'message': 'Invalid PID'}

    # Safety: don't kill PID 0, 4 (System), or our own process
    if pid in (0, 4):
        return {'success': False, 'message': 'Cannot terminate system process'}
    if pid == os.getpid():
        return {'success': False, 'message': 'Cannot terminate the monitor application'}

    try:
        proc = psutil.Process(pid)
        proc_name = proc.name()
        proc.terminate()

        # Wait up to 3 seconds for graceful termination
        try:
            proc.wait(timeout=3)
        except psutil.TimeoutExpired:
            # Force kill if still running
            try:
                proc.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        return {'success': True, 'message': f'Process "{proc_name}" (PID {pid}) terminated'}

    except psutil.NoSuchProcess:
        return {'success': False, 'message': f'Process with PID {pid} not found'}
    except psutil.AccessDenied:
        return {'success': False, 'message': f'Access denied. Try running as administrator.'}
    except Exception as e:
        return {'success': False, 'message': f'Error: {str(e)}'}
