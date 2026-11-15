"""
Battery monitoring module.
Uses psutil to read battery status. Handles desktops (no battery) gracefully.
"""

import psutil


def get_battery():
    """Get battery metrics.
    
    Returns:
        dict with keys: available, percent, plugged, time_left, time_left_fmt
    """
    try:
        battery = psutil.sensors_battery()
        if battery is None:
            return {
                'available': False,
                'percent': 0,
                'plugged': False,
                'time_left': 0,
                'time_left_fmt': 'N/A',
            }

        # Calculate time left
        time_left = battery.secsleft
        if time_left == psutil.POWER_TIME_UNLIMITED or (battery.power_plugged and battery.percent >= 99):
            time_left_fmt = 'Fully Charged' if battery.percent >= 99 else 'Plugged In'
            time_left = -1
        elif battery.power_plugged:
            time_left_fmt = 'Charging'
            time_left = -1
        elif time_left == psutil.POWER_TIME_UNKNOWN or time_left < 0 or time_left >= 86400 * 7 or time_left == 4294967295:
            time_left_fmt = 'Calculating...'
            time_left = -2
        else:
            hours = time_left // 3600
            minutes = (time_left % 3600) // 60
            time_left_fmt = f"{int(hours)}h {int(minutes)}m"

        return {
            'available': True,
            'percent': round(battery.percent, 1),
            'plugged': battery.power_plugged,
            'time_left': time_left,
            'time_left_fmt': time_left_fmt,
        }
    except Exception:
        return {
            'available': False,
            'percent': 0,
            'plugged': False,
            'time_left': 0,
            'time_left_fmt': 'N/A',
        }
