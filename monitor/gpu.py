"""
GPU Monitoring Module.

Principles:
1. NEVER fabricate data: No random, simulated, or fake placeholder values.
2. Real hardware query or explicit "Unavailable".
3. NVIDIA: Direct NVML via nvidia-ml-py / pynvml with clean lifecycle and NVMLError handling.
4. AMD / Intel: Real WMI / vendor queries; if load/temp are not exposed, return None / 'Unavailable'.
5. Diagnostics: Record which backend was attempted and the outcome for the Diagnostics panel.
"""

import atexit
import json
import logging
import os
import subprocess

logger = logging.getLogger('pc_monitor.gpu')

# ── NVML State ─────────────────────────────────────────────────────────────
_nvml_initialized = False
_pynvml_lib = None
_nvml_device_handle = None
_nvml_device_count = 0
_nvml_error_message = None

# Diagnostics tracking
_gpu_diagnostics = {
    'selected_backend': 'None',
    'pynvml': {'attempted': False, 'success': False, 'message': 'Not attempted'},
    'nvidia_smi': {'attempted': False, 'success': False, 'message': 'Not attempted'},
    'wmi': {'attempted': False, 'success': False, 'message': 'Not attempted'},
    'amd_backend': {'attempted': False, 'success': False, 'message': 'Not attempted'},
    'intel_backend': {'attempted': False, 'success': False, 'message': 'Not attempted'},
    'device_name': 'Unknown',
    'vendor': 'Unknown',
}


def _init_nvml():
    """Initialize NVML once at startup and register clean shutdown."""
    global _nvml_initialized, _pynvml_lib, _nvml_device_handle, _nvml_device_count, _nvml_error_message
    if _nvml_initialized:
        return True

    _gpu_diagnostics['pynvml']['attempted'] = True

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            try:
                import pynvml
                _pynvml_lib = pynvml
            except ImportError:
                import nvidia_smi as pynvml  # fallback alias if installed
                _pynvml_lib = pynvml

        _pynvml_lib.nvmlInit()
        _nvml_device_count = _pynvml_lib.nvmlDeviceGetCount()

        if _nvml_device_count > 0:
            _nvml_device_handle = _pynvml_lib.nvmlDeviceGetHandleByIndex(0)
            name = _pynvml_lib.nvmlDeviceGetName(_nvml_device_handle)
            if isinstance(name, bytes):
                name = name.decode('utf-8', errors='replace')
            _gpu_diagnostics['device_name'] = name
            _gpu_diagnostics['vendor'] = 'NVIDIA'
            _gpu_diagnostics['pynvml']['success'] = True
            _gpu_diagnostics['pynvml']['message'] = f"NVML initialized successfully ({name}, {_nvml_device_count} device(s))"
            _gpu_diagnostics['selected_backend'] = 'pynvml'
            _nvml_initialized = True
            logger.info("NVML initialized: %s (%d device(s))", name, _nvml_device_count)

            # Register clean shutdown
            atexit.register(_shutdown_nvml)
            return True
        else:
            _gpu_diagnostics['pynvml']['success'] = False
            _gpu_diagnostics['pynvml']['message'] = "NVML initialized but reported 0 devices"
            _nvml_error_message = "No NVIDIA devices found"
            return False

    except Exception as e:
        _nvml_initialized = False
        _nvml_device_handle = None
        _nvml_error_message = str(e)
        _gpu_diagnostics['pynvml']['success'] = False
        _gpu_diagnostics['pynvml']['message'] = f"NVML unavailable: {e}"
        logger.debug("NVML init failed: %s", e)
        return False


def _shutdown_nvml():
    """Clean shutdown of NVML."""
    global _nvml_initialized, _pynvml_lib, _nvml_device_handle
    if _nvml_initialized and _pynvml_lib:
        try:
            _pynvml_lib.nvmlShutdown()
            logger.info("NVML cleanly shut down")
        except Exception as e:
            logger.debug("Error during NVML shutdown: %s", e)
        finally:
            _nvml_initialized = False
            _nvml_device_handle = None


# Initial attempt at module load
_init_nvml()


# ── Tier 1: pynvml (NVIDIA) ────────────────────────────────────────────────
def _get_gpu_pynvml():
    """Read GPU stats via direct NVML handle."""
    if not _nvml_initialized or not _nvml_device_handle or not _pynvml_lib:
        return None

    try:
        h = _nvml_device_handle
        name = _pynvml_lib.nvmlDeviceGetName(h)
        if isinstance(name, bytes):
            name = name.decode('utf-8', errors='replace')

        # Utilization
        util = _pynvml_lib.nvmlDeviceGetUtilizationRates(h)
        gpu_load = float(util.gpu)

        # Temperature
        temp = float(_pynvml_lib.nvmlDeviceGetTemperature(h, _pynvml_lib.NVML_TEMPERATURE_GPU))

        # Memory
        mem = _pynvml_lib.nvmlDeviceGetMemoryInfo(h)
        mem_total = round(mem.total / (1024 ** 3), 2)
        mem_used = round(mem.used / (1024 ** 3), 2)
        mem_free = round(mem.free / (1024 ** 3), 2)
        mem_percent = round((mem.used / mem.total) * 100, 1) if mem.total else 0.0

        return {
            'available': True,
            'name': name,
            'vendor': 'NVIDIA',
            'load': gpu_load,
            'load_display': f"{int(gpu_load)}%",
            'temperature': temp,
            'temperature_display': f"{int(temp)}°C",
            'memory_total': mem_total,
            'memory_used': mem_used,
            'memory_free': mem_free,
            'memory_percent': mem_percent,
            'backend': 'pynvml',
        }
    except Exception as e:
        logger.debug("NVML query error: %s", e)
        return None


# ── Tier 2: nvidia-smi CLI (NVIDIA fallback) ────────────────────────────────
def _get_gpu_nvidia_smi():
    """Fallback read via nvidia-smi CLI."""
    _gpu_diagnostics['nvidia_smi']['attempted'] = True
    try:
        result = subprocess.run(
            ['nvidia-smi',
             '--query-gpu=name,utilization.gpu,temperature.gpu,memory.total,memory.used,memory.free',
             '--format=csv,noheader,nounits'],
            capture_output=True, text=True, timeout=3,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        if result.returncode != 0:
            _gpu_diagnostics['nvidia_smi']['success'] = False
            _gpu_diagnostics['nvidia_smi']['message'] = f"nvidia-smi exited with code {result.returncode}"
            return None

        line = result.stdout.strip().split('\n')[0]
        parts = [p.strip() for p in line.split(',')]
        if len(parts) < 6:
            _gpu_diagnostics['nvidia_smi']['success'] = False
            _gpu_diagnostics['nvidia_smi']['message'] = "Unexpected output format from nvidia-smi"
            return None

        name = parts[0]
        load = float(parts[1])
        temp = float(parts[2])
        mem_total_mb = float(parts[3])
        mem_used_mb = float(parts[4])
        mem_free_mb = float(parts[5])
        mem_total = round(mem_total_mb / 1024, 2)
        mem_used = round(mem_used_mb / 1024, 2)
        mem_free = round(mem_free_mb / 1024, 2)
        mem_percent = round((mem_used_mb / mem_total_mb) * 100, 1) if mem_total_mb else 0.0

        _gpu_diagnostics['nvidia_smi']['success'] = True
        _gpu_diagnostics['nvidia_smi']['message'] = f"nvidia-smi succeeded ({name})"
        if _gpu_diagnostics['selected_backend'] == 'None':
            _gpu_diagnostics['selected_backend'] = 'nvidia-smi'
            _gpu_diagnostics['device_name'] = name
            _gpu_diagnostics['vendor'] = 'NVIDIA'

        return {
            'available': True,
            'name': name,
            'vendor': 'NVIDIA',
            'load': load,
            'load_display': f"{int(load)}%",
            'temperature': temp,
            'temperature_display': f"{int(temp)}°C",
            'memory_total': mem_total,
            'memory_used': mem_used,
            'memory_free': mem_free,
            'memory_percent': mem_percent,
            'backend': 'nvidia-smi',
        }
    except FileNotFoundError:
        _gpu_diagnostics['nvidia_smi']['success'] = False
        _gpu_diagnostics['nvidia_smi']['message'] = "nvidia-smi executable not in PATH"
        return None
    except Exception as e:
        _gpu_diagnostics['nvidia_smi']['success'] = False
        _gpu_diagnostics['nvidia_smi']['message'] = f"nvidia-smi execution error: {e}"
        return None


# ── Tier 3: WMI (AMD, Intel, or generic fallback) ───────────────────────────
_wmi_cache_static = None


def _get_gpu_wmi():
    """Query Windows WMI for GPU hardware info.
    
    IMPORTANT: WMI Win32_VideoController DOES NOT provide live GPU utilization
    or temperature. In strict compliance with the 'NEVER fabricate data' principle,
    this function returns load=None and temperature=None, clearly marked as Unavailable,
    rather than fabricating 0 or random values.
    """
    global _wmi_cache_static
    _gpu_diagnostics['wmi']['attempted'] = True

    if _wmi_cache_static is not None:
        return _wmi_cache_static

    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command',
             'Get-CimInstance Win32_VideoController | '
             'Select-Object -First 1 Name, AdapterRAM, DriverVersion, VideoProcessor | '
             'ConvertTo-Json'],
            capture_output=True, text=True, timeout=5,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        if result.returncode != 0:
            _gpu_diagnostics['wmi']['success'] = False
            _gpu_diagnostics['wmi']['message'] = "WMI query returned non-zero exit code"
            return None

        data = json.loads(result.stdout.strip())
        name = data.get('Name', '').strip()
        if not name:
            _gpu_diagnostics['wmi']['success'] = False
            _gpu_diagnostics['wmi']['message'] = "WMI Win32_VideoController returned empty Name"
            return None

        adapter_ram = data.get('AdapterRAM', 0) or 0
        mem_total = round(adapter_ram / (1024 ** 3), 2) if adapter_ram > 0 else None

        vendor = 'Unknown'
        name_lower = name.lower()
        if 'nvidia' in name_lower or 'geforce' in name_lower or 'quadro' in name_lower or 'rtx' in name_lower:
            vendor = 'NVIDIA'
        elif 'amd' in name_lower or 'radeon' in name_lower:
            vendor = 'AMD'
            _gpu_diagnostics['amd_backend']['attempted'] = True
            _gpu_diagnostics['amd_backend']['message'] = "AMD GPU detected via WMI; no ADLX/pyadl runtime found for utilization/temp"
        elif 'intel' in name_lower or 'arc' in name_lower or 'iris' in name_lower or 'uhd' in name_lower:
            vendor = 'Intel'
            _gpu_diagnostics['intel_backend']['attempted'] = True
            _gpu_diagnostics['intel_backend']['message'] = "Intel GPU detected via WMI; live sensor queries unavailable without Intel IGCL SDK"

        _gpu_diagnostics['wmi']['success'] = True
        _gpu_diagnostics['wmi']['message'] = f"WMI query succeeded ({name})"
        if _gpu_diagnostics['selected_backend'] == 'None':
            _gpu_diagnostics['selected_backend'] = 'wmi'
            _gpu_diagnostics['device_name'] = name
            _gpu_diagnostics['vendor'] = vendor

        # Real data only: load and temperature are None because WMI doesn't provide them!
        _wmi_cache_static = {
            'available': True,
            'name': name,
            'vendor': vendor,
            'load': None,
            'load_display': 'Unavailable',
            'temperature': None,
            'temperature_display': 'Unavailable',
            'memory_total': mem_total,
            'memory_used': None,
            'memory_free': None,
            'memory_percent': None,
            'backend': 'wmi',
            'note': 'Utilization and temperature are unavailable without vendor SDK for this GPU.',
        }
        return _wmi_cache_static

    except Exception as e:
        _gpu_diagnostics['wmi']['success'] = False
        _gpu_diagnostics['wmi']['message'] = f"WMI query error: {e}"
        return None


# ── Public API ──────────────────────────────────────────────────────────────
_EXPLICIT_UNAVAILABLE = {
    'available': False,
    'name': 'Unavailable',
    'vendor': 'None',
    'load': None,
    'load_display': 'Unavailable',
    'temperature': None,
    'temperature_display': 'Unavailable',
    'memory_total': None,
    'memory_used': None,
    'memory_free': None,
    'memory_percent': None,
    'backend': 'None',
    'note': 'No GPU hardware query backend succeeded.',
}


def get_gpu():
    """Get GPU metrics using the best available real hardware backend.
    
    Zero simulated, placeholder, or fabricated values.
    Returns None for any metric that cannot be directly measured.
    """
    # 1. Direct NVML (NVIDIA)
    result = _get_gpu_pynvml()
    if result:
        return result

    # If NVML wasn't initialized or failed on this call, try re-init if not permanently failed
    if not _nvml_initialized and _pynvml_lib:
        if _init_nvml():
            result = _get_gpu_pynvml()
            if result:
                return result

    # 2. nvidia-smi CLI
    result = _get_gpu_nvidia_smi()
    if result:
        return result

    # 3. Windows WMI (detect name/VRAM, explicitly None for unmeasurable load/temp)
    result = _get_gpu_wmi()
    if result:
        return result

    # 4. Explicit Unavailable
    return _EXPLICIT_UNAVAILABLE.copy()


def get_gpu_diagnostics():
    """Return current GPU detection diagnostics for the Settings Diagnostics panel."""
    return dict(_gpu_diagnostics)


def get_gpu_clock_mhz():
    """Query current GPU graphics clock speed in MHz via NVML if active."""
    global _nvml_initialized, _pynvml_lib, _nvml_device_handle
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

