"""
Companion Process Manager.

Manages the lifecycle of the PySide6 / pystray companion process:
- Start / Stop / Status
- Automatic launch when enabled in Settings
- Windows Startup registration (via User Startup folder shortcut)
"""

import os
import sys
import subprocess
import logging
import psutil
from services.settings import get_settings, update_settings

logger = logging.getLogger('pc_monitor.companion_manager')

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANION_SCRIPT = os.path.join(PROJECT_ROOT, 'companion.py')
_companion_process = None


def is_companion_running():
    """Check if companion.py is currently running."""
    global _companion_process
    if _companion_process is not None and _companion_process.poll() is None:
        return True

    # Check via psutil process list
    for p in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            cmd = p.info.get('cmdline') or []
            cmd_str = ' '.join(cmd).lower()
            if 'companion.py' in cmd_str:
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return False


def start_companion():
    """Start companion.py as a detached background process."""
    global _companion_process
    if is_companion_running():
        return True, "Companion already running"

    if not os.path.isfile(COMPANION_SCRIPT):
        return False, "companion.py not found"

    try:
        python_exe = sys.executable
        # Use pythonw if available on Windows to avoid console window popup
        pythonw = os.path.join(os.path.dirname(python_exe), 'pythonw.exe')
        exe_to_use = pythonw if os.path.isfile(pythonw) else python_exe

        _companion_process = subprocess.Popen(
            [exe_to_use, COMPANION_SCRIPT],
            cwd=PROJECT_ROOT,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        )
        logger.info("Started companion process (PID: %d)", _companion_process.pid)
        return True, f"Companion launched (PID: {_companion_process.pid})"
    except Exception as e:
        logger.error("Failed to start companion: %s", e)
        return False, str(e)


def stop_companion():
    """Stop the companion process."""
    global _companion_process
    stopped = False

    if _companion_process and _companion_process.poll() is None:
        try:
            _companion_process.terminate()
            stopped = True
        except Exception:
            pass
        _companion_process = None

    # Kill any dangling companion.py instances
    for p in psutil.process_iter(['pid', 'cmdline']):
        try:
            cmd = p.info.get('cmdline') or []
            if any('companion.py' in str(arg).lower() for arg in cmd):
                p.terminate()
                stopped = True
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    return True, "Companion stopped" if stopped else "Companion was not running"


def get_companion_status():
    """Get status of companion and its configured modes."""
    settings = get_settings()
    running = is_companion_running()

    return {
        'running': running,
        'overlay_enabled': settings.get('overlay_master_enabled', False),
        'ingame_overlay': settings.get('overlay_ingame_enabled', True),
        'desktop_widget': settings.get('overlay_widget_enabled', True),
        'tray_flyout': settings.get('overlay_tray_enabled', True),
        'startup_enabled': is_startup_shortcut_installed(),
        'hotkey_overlay': settings.get('overlay_hotkey', '<ctrl>+<shift>+o'),
        'hotkey_widget': settings.get('widget_hotkey', '<ctrl>+<shift>+w'),
    }


def set_startup_shortcut(enable=True):
    """Enable or disable Windows startup launch via User Startup Folder shortcut."""
    appdata = os.environ.get('APPDATA', '')
    if not appdata:
        return False, "APPDATA environment variable not found"

    startup_dir = os.path.join(appdata, r'Microsoft\Windows\Start Menu\Programs\Startup')
    shortcut_vbs = os.path.join(startup_dir, 'PC_Performance_Monitor.vbs')

    if enable:
        try:
            python_exe = sys.executable
            pythonw = os.path.join(os.path.dirname(python_exe), 'pythonw.exe')
            runner = pythonw if os.path.isfile(pythonw) else python_exe
            script = os.path.join(PROJECT_ROOT, 'app.py')

            # Clean VBScript launcher that starts monitor silently on login
            vbs_content = f'''Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "{PROJECT_ROOT}"
WshShell.Run """{runner}"" ""{script}""", 0, False
'''
            with open(shortcut_vbs, 'w', encoding='utf-8') as f:
                f.write(vbs_content)

            update_settings({'launch_on_startup': True})
            return True, "Startup launcher created in Windows Startup folder"
        except Exception as e:
            return False, f"Failed to create startup launcher: {e}"
    else:
        try:
            if os.path.exists(shortcut_vbs):
                os.remove(shortcut_vbs)
            update_settings({'launch_on_startup': False})
            return True, "Startup launcher removed"
        except Exception as e:
            return False, f"Failed to remove startup launcher: {e}"


def is_startup_shortcut_installed():
    """Check if startup launcher exists."""
    appdata = os.environ.get('APPDATA', '')
    if not appdata:
        return False
    startup_dir = os.path.join(appdata, r'Microsoft\Windows\Start Menu\Programs\Startup')
    return os.path.isfile(os.path.join(startup_dir, 'PC_Performance_Monitor.vbs'))
