"""
Fan Speed & Thermal Monitoring Module.

Read-only hardware sensor monitoring:
- Attempts to query fan speeds from NVML, LibreHardwareMonitor WMI, or Win32_Fan
- If unavailable, returns explicit "Unavailable" (never guesses or fabricates RPM)
- Does NOT attempt fan control (Windows does not support standard fan control without vendor-proprietary SDKs)
"""

import subprocess
import json
import logging

logger = logging.getLogger('pc_monitor.fans')

_last_fan_check = 0
_cached_fan_data = None


def get_fans():
    """Query available fan sensors across NVML, LHM, and WMI."""
    # 1. Try NVIDIA NVML fan speed
    try:
        from monitor.gpu import _nvml_initialized, _pynvml_lib, _nvml_device_handle
        if _nvml_initialized and _pynvml_lib and _nvml_device_handle:
            try:
                # Returns fan speed as a percentage (0-100)
                speed_pct = _pynvml_lib.nvmlDeviceGetFanSpeed(_nvml_device_handle)
                if speed_pct is not None:
                    return {
                        'available': True,
                        'rpm': None,
                        'percent': speed_pct,
                        'speed_display': f"{speed_pct}%",
                        'backend': 'pynvml',
                        'status': f"NVIDIA GPU Fan ({speed_pct}%)",
                        'fans': [{'name': 'GPU Fan', 'speed': speed_pct, 'unit': '%'}],
                        'is_read_only': True,
                    }
            except Exception:
                # Often NVMLError_NotSupported on laptops/integrated cooling
                pass
    except Exception:
        pass

    # 2. Try LibreHardwareMonitor or OpenHardwareMonitor WMI
    try:
        ps_cmd = (
            "$s = Get-CimInstance -Namespace root\\LibreHardwareMonitor -ClassName Sensor "
            "-Filter \"SensorType = 'Fan'\" -ErrorAction SilentlyContinue; "
            "if (!$s) { $s = Get-CimInstance -Namespace root\\OpenHardwareMonitor -ClassName Sensor "
            "-Filter \"SensorType = 'Fan'\" -ErrorAction SilentlyContinue }; "
            "if ($s) { $s | Select-Object Name, Value | ConvertTo-Json } else { 'null' }"
        )
        res = subprocess.run(
            ['powershell', '-NoProfile', '-Command', ps_cmd],
            capture_output=True, text=True, timeout=2,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        )
        if res.returncode == 0 and res.stdout.strip() and res.stdout.strip() != 'null':
            data = json.loads(res.stdout.strip())
            items = data if isinstance(data, list) else [data]
            fan_list = []
            max_rpm = 0
            for item in items:
                name = item.get('Name', 'System Fan')
                val = float(item.get('Value', 0))
                fan_list.append({'name': name, 'rpm': int(val), 'unit': 'RPM'})
                if val > max_rpm:
                    max_rpm = int(val)
            if fan_list and max_rpm > 0:
                return {
                    'available': True,
                    'rpm': max_rpm,
                    'percent': None,
                    'speed_display': f"{max_rpm} RPM",
                    'backend': 'LibreHardwareMonitor WMI',
                    'status': f"Hardware Fan Sensor ({max_rpm} RPM)",
                    'fans': fan_list,
                    'is_read_only': True,
                }
    except Exception:
        pass

    # 3. Try standard Win32_Fan
    try:
        ps_fan = (
            "Get-CimInstance Win32_Fan -ErrorAction SilentlyContinue | "
            "Select-Object Name, DesiredSpeed, VariableSpeed | ConvertTo-Json"
        )
        res = subprocess.run(
            ['powershell', '-NoProfile', '-Command', ps_fan],
            capture_output=True, text=True, timeout=2,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        )
        if res.returncode == 0 and res.stdout.strip():
            raw = res.stdout.strip()
            if raw and raw != 'null':
                data = json.loads(raw)
                desired = (data.get('DesiredSpeed') if isinstance(data, dict) else None)
                if desired and desired > 0:
                    return {
                        'available': True,
                        'rpm': int(desired),
                        'percent': None,
                        'speed_display': f"{int(desired)} RPM",
                        'backend': 'Win32_Fan WMI',
                        'status': f"ACPI Fan Sensor ({int(desired)} RPM)",
                        'fans': [{'name': 'Chassis Fan', 'rpm': int(desired), 'unit': 'RPM'}],
                        'is_read_only': True,
                    }
    except Exception:
        pass

    # 4. Explicit Unavailable fallback (Zero fabricated values)
    return {
        'available': False,
        'rpm': None,
        'percent': None,
        'speed_display': 'Unavailable',
        'backend': 'None',
        'status': 'Unavailable (OEM ACPI / BIOS managed)',
        'fans': [],
        'is_read_only': True,
        'note': 'Direct RPM query not exposed by motherboard ACPI without vendor driver.',
    }
