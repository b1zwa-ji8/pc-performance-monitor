"""
Hardware & Backend Diagnostics Service.

Provides a unified diagnostics registry for:
- GPU backend detection (pynvml, nvidia-smi, WMI, ADLX/Intel)
- CPU telemetry backend
- Fan sensor backend
- PresentMon ETW FPS backend
- Memory, Disk, Network backends
- Automated startup self-check logging to pc_monitor.log and in-memory buffer
"""

import os
import sys
import time
import logging
import platform
import psutil

logger = logging.getLogger('pc_monitor.diagnostics')

# In-memory log buffer for the Diagnostics panel
_diagnostic_logs = []
LOG_FILE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'pc_monitor.log')


def log_diagnostic(level, message):
    """Log a diagnostic entry to logger, file, and in-memory buffer."""
    timestamp_str = time.strftime('%Y-%m-%d %H:%M:%S')
    entry = {
        'timestamp': timestamp_str,
        'level': level.upper(),
        'message': message,
    }
    _diagnostic_logs.append(entry)
    if len(_diagnostic_logs) > 200:
        _diagnostic_logs.pop(0)

    # Write to log file
    try:
        with open(LOG_FILE_PATH, 'a', encoding='utf-8') as f:
            f.write(f"[{timestamp_str}] [{level.upper()}] {message}\n")
    except Exception:
        pass

    if level.lower() == 'error':
        logger.error(message)
    elif level.lower() == 'warning':
        logger.warning(message)
    else:
        logger.info(message)


def run_startup_self_check():
    """Run an automated self-check on startup and log all detection results."""
    log_diagnostic('info', "=== PC Performance Monitor — Startup Hardware Self-Check ===")
    log_diagnostic('info', f"Operating System: {platform.system()} {platform.release()} ({platform.version()})")
    log_diagnostic('info', f"Architecture: {platform.machine()} | Python: {platform.python_version()}")

    # 1. CPU Telemetry Check
    try:
        import cpuinfo
        cpu_brand = cpuinfo.get_cpu_info().get('brand_raw', 'Unknown CPU')
    except Exception:
        cpu_brand = platform.processor() or 'Standard x86/x64 CPU'
    cpu_cores = psutil.cpu_count(logical=False) or psutil.cpu_count()
    cpu_threads = psutil.cpu_count(logical=True)
    log_diagnostic('info', f"CPU Detected: {cpu_brand} ({cpu_cores} cores / {cpu_threads} threads via psutil)")

    # 2. GPU Telemetry Check
    from monitor.gpu import get_gpu, get_gpu_diagnostics
    gpu_data = get_gpu()
    gpu_diag = get_gpu_diagnostics()
    backend = gpu_diag.get('selected_backend', 'None')
    device_name = gpu_diag.get('device_name', 'None')
    if gpu_data.get('available'):
        load_str = f"{gpu_data['load']}%" if gpu_data.get('load') is not None else "Unavailable"
        temp_str = f"{gpu_data['temperature']}°C" if gpu_data.get('temperature') is not None else "Unavailable"
        log_diagnostic('info', f"GPU Backend Selected: {backend} -> SUCCESS ({device_name})")
        log_diagnostic('info', f"GPU Initial Telemetry: Load={load_str}, Temp={temp_str}, VRAM={gpu_data.get('memory_total')} GB")
    else:
        log_diagnostic('warning', f"GPU Backend Selected: {backend} -> UNAVAILABLE (No active GPU sensor found)")

    # 3. PresentMon / FPS Capture Check
    try:
        from monitor.presentmon import check_presentmon_availability
        pm_avail, pm_msg = check_presentmon_availability()
        if pm_avail:
            log_diagnostic('info', f"PresentMon FPS Backend: {pm_msg} -> READY")
        else:
            log_diagnostic('warning', f"PresentMon FPS Backend: {pm_msg} -> FPS capture in 'Unavailable' standby")
    except Exception as e:
        log_diagnostic('warning', f"PresentMon FPS Backend check error: {e}")

    # 4. Fan Sensor Check
    try:
        from monitor.fans import get_fans
        fan_data = get_fans()
        if fan_data.get('available'):
            log_diagnostic('info', f"Fan RPM Sensor: {fan_data.get('backend')} -> {fan_data.get('rpm')} RPM")
        else:
            log_diagnostic('info', f"Fan RPM Sensor: {fan_data.get('backend', 'None')} -> Unavailable (BIOS/EC controlled)")
    except Exception as e:
        log_diagnostic('warning', f"Fan sensor check: {e}")

    log_diagnostic('info', "=== Startup Hardware Self-Check Complete ===")


def get_diagnostics_report():
    """Build the comprehensive diagnostics report for the UI."""
    from monitor.gpu import get_gpu, get_gpu_diagnostics
    gpu_data = get_gpu()
    gpu_diag = get_gpu_diagnostics()

    # Fan diagnostic
    try:
        from monitor.fans import get_fans
        fan_data = get_fans()
    except Exception:
        fan_data = {'available': False, 'backend': 'None', 'status': 'Unavailable'}

    # PresentMon diagnostic
    try:
        from monitor.presentmon import check_presentmon_availability
        pm_avail, pm_msg = check_presentmon_availability()
    except Exception:
        pm_avail, pm_msg = False, 'PresentMon monitor module not initialized'

    # CPU info
    try:
        import cpuinfo
        cpu_brand = cpuinfo.get_cpu_info().get('brand_raw', platform.processor())
    except Exception:
        cpu_brand = platform.processor()

    metrics = [
        {
            'metric': 'CPU Telemetry & Clock',
            'backend': 'psutil + py-cpuinfo',
            'status': 'Success',
            'details': f"{cpu_brand} ({psutil.cpu_count(logical=False)}C/{psutil.cpu_count(logical=True)}T)",
        },
        {
            'metric': 'GPU Identification & VRAM',
            'backend': f"{gpu_diag.get('selected_backend', 'pynvml')}",
            'status': 'Success' if gpu_data.get('available') else 'Unavailable',
            'details': f"{gpu_data.get('name', 'None')} (VRAM: {gpu_data.get('memory_total', 'N/A')} GB)",
        },
        {
            'metric': 'GPU Compute Utilization',
            'backend': gpu_diag.get('selected_backend', 'None'),
            'status': 'Success' if gpu_data.get('load') is not None else 'Unavailable',
            'details': f"{gpu_data.get('load')}%" if gpu_data.get('load') is not None else "Unavailable (requires vendor SDK on non-NVIDIA)",
        },
        {
            'metric': 'GPU Core Temperature',
            'backend': gpu_diag.get('selected_backend', 'None'),
            'status': 'Success' if gpu_data.get('temperature') is not None else 'Unavailable',
            'details': f"{gpu_data.get('temperature')}°C" if gpu_data.get('temperature') is not None else "Unavailable (requires vendor SDK on non-NVIDIA)",
        },
        {
            'metric': 'Fan Speed (RPM)',
            'backend': fan_data.get('backend', 'NVML / Win32_Fan'),
            'status': 'Success' if fan_data.get('available') else 'Unavailable',
            'details': f"{fan_data.get('rpm')} RPM" if fan_data.get('available') else "Unavailable (Managed by OEM ACPI Embedded Controller / BIOS)",
        },
        {
            'metric': 'FPS / Frame-Time Capture',
            'backend': 'Intel PresentMon ETW',
            'status': 'Success' if pm_avail else 'Unavailable',
            'details': pm_msg,
        },
        {
            'metric': 'System Memory & Swap',
            'backend': 'psutil.virtual_memory',
            'status': 'Success',
            'details': f"{round(psutil.virtual_memory().total / (1024**3), 1)} GB Total Installed RAM",
        },
        {
            'metric': 'Disk Partition & I/O Stats',
            'backend': 'psutil.disk_partitions / disk_io_counters',
            'status': 'Success',
            'details': f"{len(psutil.disk_partitions())} drive partition(s) monitored",
        },
        {
            'metric': 'Network Interface Telemetry',
            'backend': 'psutil.net_io_counters',
            'status': 'Success',
            'details': 'Active adapter packet & byte rate polling',
        },
    ]

    return {
        'system': {
            'os': f"{platform.system()} {platform.release()}",
            'os_version': platform.version(),
            'arch': platform.machine(),
            'python': platform.python_version(),
            'hostname': platform.node(),
        },
        'gpu_diagnostics': gpu_diag,
        'metrics': metrics,
        'recent_logs': list(_diagnostic_logs)[-50:],
    }
