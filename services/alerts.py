"""
Alerts service.
Checks system metrics against configurable thresholds and manages alert state.
"""

import time
import threading
from collections import deque


class AlertManager:
    """Manages system alerts based on configurable thresholds."""

    def __init__(self):
        self._active_alerts = {}  # type -> alert_dict
        self._alert_history = deque(maxlen=100)
        self._cpu_high_count = 0  # For sustained CPU alert
        self._lock = threading.Lock()

    def check_alerts(self, metrics, settings):
        """Check current metrics against thresholds and update alerts.
        
        Args:
            metrics: Dict with keys 'cpu', 'memory', 'disk', 'gpu', 'battery'.
            settings: Current settings dict.
        """
        if not settings.get('alerts_enabled', True):
            with self._lock:
                self._active_alerts.clear()
            return

        new_alerts = {}

        # CPU sustained alert (must exceed threshold for ~10 seconds = 5 consecutive readings at 2s interval)
        cpu_data = metrics.get('cpu', {})
        cpu_percent = cpu_data.get('percent', 0)
        cpu_threshold = settings.get('cpu_warning', 90)

        if cpu_percent > cpu_threshold:
            self._cpu_high_count += 1
        else:
            self._cpu_high_count = 0

        if self._cpu_high_count >= 5:
            new_alerts['cpu'] = {
                'type': 'cpu',
                'severity': 'critical' if cpu_percent > 95 else 'warning',
                'message': f'CPU usage at {cpu_percent}% (threshold: {cpu_threshold}%)',
                'value': cpu_percent,
                'timestamp': time.time(),
            }

        # RAM alert
        mem_data = metrics.get('memory', {})
        mem_percent = mem_data.get('percent', 0)
        ram_threshold = settings.get('ram_warning', 90)

        if mem_percent > ram_threshold:
            new_alerts['ram'] = {
                'type': 'ram',
                'severity': 'critical' if mem_percent > 95 else 'warning',
                'message': f'RAM usage at {mem_percent}% (threshold: {ram_threshold}%)',
                'value': mem_percent,
                'timestamp': time.time(),
            }

        # Disk alerts (per partition)
        disk_data = metrics.get('disk', {})
        disk_threshold = settings.get('disk_warning', 90)
        for i, part in enumerate(disk_data.get('partitions', [])):
            if part.get('percent', 0) > disk_threshold:
                key = f'disk_{part.get("device", i)}'
                new_alerts[key] = {
                    'type': 'disk',
                    'severity': 'critical' if part['percent'] > 95 else 'warning',
                    'message': f'Disk {part.get("device", "?")} at {part["percent"]}% (threshold: {disk_threshold}%)',
                    'value': part['percent'],
                    'timestamp': time.time(),
                }

        # GPU temperature alert
        gpu_data = metrics.get('gpu', {})
        if gpu_data.get('available', False):
            gpu_temp = gpu_data.get('temperature', 0)
            gpu_threshold = settings.get('gpu_temp_warning', 85)
            if gpu_temp > gpu_threshold:
                new_alerts['gpu_temp'] = {
                    'type': 'gpu_temp',
                    'severity': 'critical' if gpu_temp > gpu_threshold + 10 else 'warning',
                    'message': f'GPU temperature at {gpu_temp}°C (threshold: {gpu_threshold}°C)',
                    'value': gpu_temp,
                    'timestamp': time.time(),
                }

        # Battery alert
        battery_data = metrics.get('battery', {})
        if battery_data.get('available', False) and not battery_data.get('plugged', False):
            bat_percent = battery_data.get('percent', 100)
            bat_threshold = settings.get('battery_warning', 20)
            if bat_percent < bat_threshold:
                new_alerts['battery'] = {
                    'type': 'battery',
                    'severity': 'critical' if bat_percent < 10 else 'warning',
                    'message': f'Battery at {bat_percent}% (threshold: {bat_threshold}%)',
                    'value': bat_percent,
                    'timestamp': time.time(),
                }

        # Update active alerts and log new ones
        with self._lock:
            for key, alert in new_alerts.items():
                if key not in self._active_alerts:
                    self._alert_history.appendleft(alert)
                self._active_alerts[key] = alert

            # Remove resolved alerts
            resolved_keys = [k for k in self._active_alerts if k not in new_alerts]
            for key in resolved_keys:
                del self._active_alerts[key]

    def get_active_alerts(self):
        """Get currently active alerts.
        
        Returns:
            List of active alert dicts.
        """
        with self._lock:
            return list(self._active_alerts.values())

    def get_alert_history(self, limit=50):
        """Get recent alert history.
        
        Args:
            limit: Max alerts to return.
        
        Returns:
            List of alert dicts (most recent first).
        """
        with self._lock:
            return list(self._alert_history)[:limit]

    def clear_alerts(self):
        """Clear all active alerts and history."""
        with self._lock:
            self._active_alerts.clear()
            self._alert_history.clear()
            self._cpu_high_count = 0
