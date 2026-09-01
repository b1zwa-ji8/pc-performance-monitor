"""
Settings service.
Manages application settings via a local JSON file.
"""

import json
import os
import threading

SETTINGS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'settings.json')

_lock = threading.Lock()

DEFAULT_SETTINGS = {
    'refresh_interval': 2,
    'cpu_warning': 90,
    'ram_warning': 90,
    'disk_warning': 90,
    'gpu_temp_warning': 85,
    'battery_warning': 20,
    'history_enabled': True,
    'alerts_enabled': True,
    'theme': 'dark',
    'auto_start': True,
    'history_retention_days': 30,
}

# In-memory cache
_settings = None


def load_settings():
    """Load settings from disk, creating defaults if file doesn't exist.
    
    Returns:
        dict of current settings.
    """
    global _settings

    with _lock:
        if os.path.exists(SETTINGS_PATH):
            try:
                with open(SETTINGS_PATH, 'r') as f:
                    _settings = json.load(f)
                # Merge with defaults for any missing keys
                for key, value in DEFAULT_SETTINGS.items():
                    if key not in _settings:
                        _settings[key] = value
            except (json.JSONDecodeError, IOError):
                _settings = DEFAULT_SETTINGS.copy()
                _save_to_disk()
        else:
            _settings = DEFAULT_SETTINGS.copy()
            _save_to_disk()

    return _settings.copy()


def get_settings():
    """Get current settings (from cache or disk).
    
    Returns:
        dict of current settings.
    """
    global _settings
    if _settings is None:
        return load_settings()
    return _settings.copy()


def update_settings(new_settings):
    """Update settings with validated values.
    
    Args:
        new_settings: Dict of setting keys to update.
    
    Returns:
        dict of updated settings.
    """
    global _settings

    with _lock:
        if _settings is None:
            load_settings()

        # Validate and apply each setting
        validators = {
            'refresh_interval': lambda v: max(1, min(30, int(v))),
            'cpu_warning': lambda v: max(50, min(100, int(v))),
            'ram_warning': lambda v: max(50, min(100, int(v))),
            'disk_warning': lambda v: max(50, min(100, int(v))),
            'gpu_temp_warning': lambda v: max(50, min(120, int(v))),
            'battery_warning': lambda v: max(5, min(50, int(v))),
            'history_enabled': lambda v: bool(v),
            'alerts_enabled': lambda v: bool(v),
            'theme': lambda v: v if v in ('dark', 'light') else 'dark',
            'auto_start': lambda v: bool(v),
            'history_retention_days': lambda v: max(1, min(365, int(v))),
        }

        for key, value in new_settings.items():
            if key in validators:
                try:
                    _settings[key] = validators[key](value)
                except (ValueError, TypeError):
                    pass  # Skip invalid values

        _save_to_disk()

    return _settings.copy()


def _save_to_disk():
    """Write current settings to disk."""
    try:
        with open(SETTINGS_PATH, 'w') as f:
            json.dump(_settings, f, indent=2)
    except IOError:
        pass  # Fail silently on write errors
