"""
Background collector service.
Runs as a daemon thread, collecting metrics at the configured interval.
Stores data in SQLite and maintains an in-memory buffer for live charts.
"""

import time
import threading
import json
import logging
from collections import deque

logger = logging.getLogger('pc_monitor.collector')

from monitor.cpu import get_cpu
from monitor.memory import get_memory
from monitor.disk import get_disk
from monitor.network import get_network
from monitor.gpu import get_gpu
from monitor.battery import get_battery
from database.db import insert_metric, init_db, cleanup_old_data
from services.settings import get_settings
from services.alerts import AlertManager


class Collector:
    """Background metric collector with in-memory buffer and SQLite persistence."""

    def __init__(self):
        self._thread = None
        self._running = False
        self._lock = threading.Lock()
        self.alert_manager = AlertManager()

        # In-memory ring buffers for live chart data (last 300 points)
        self.cpu_buffer = deque(maxlen=300)
        self.memory_buffer = deque(maxlen=300)
        self.gpu_buffer = deque(maxlen=300)
        self.network_buffer = deque(maxlen=300)
        self.disk_buffer = deque(maxlen=300)

        # Latest snapshot for quick access
        self._latest = {}
        self._latest_lock = threading.Lock()

        # System info (static)
        self.system_info = {}
        self._db_write_counter = 0

    def start(self):
        """Start the background collection thread."""
        if self._running:
            return

        # Initialize database
        init_db()

        # Run hardware diagnostic self-check on startup
        try:
            from services.diagnostics import run_startup_self_check
            run_startup_self_check()
        except Exception:
            pass

        # Start live PresentMon FPS sampler
        try:
            from monitor.presentmon import live_fps_monitor
            live_fps_monitor.start()
        except Exception:
            pass

        self._running = True
        self._thread = threading.Thread(target=self._collect_loop, daemon=True, name='MetricCollector')
        self._thread.start()

    def stop(self):
        """Stop the background collection thread."""
        self._running = False
        try:
            from monitor.presentmon import live_fps_monitor
            live_fps_monitor.stop()
        except Exception:
            pass
        if self._thread:
            self._thread.join(timeout=5)

    def _collect_loop(self):
        """Main collection loop running in background thread."""
        # Initial system info collection
        self._collect_system_info()

        # Clean up old data on startup
        try:
            settings = get_settings()
            retention_days = settings.get('history_retention_days', 30)
            cleanup_old_data(days=retention_days)
        except Exception:
            pass

        while self._running:
            try:
                settings = get_settings()
                interval = settings.get('refresh_interval', 2)

                # Collect all metrics
                cpu_data = get_cpu()
                mem_data = get_memory()
                disk_data = get_disk()
                net_data = get_network()
                gpu_data = get_gpu()
                bat_data = get_battery()

                now = time.time()

                # Update in-memory buffers
                self.cpu_buffer.append({'timestamp': now, 'value': cpu_data['percent']})
                self.memory_buffer.append({'timestamp': now, 'value': mem_data['percent']})
                self.gpu_buffer.append({'timestamp': now, 'value': gpu_data['load']})
                self.network_buffer.append({
                    'timestamp': now,
                    'upload': net_data['upload_speed'],
                    'download': net_data['download_speed'],
                })
                self.disk_buffer.append({
                    'timestamp': now,
                    'read': disk_data['io']['read_speed'],
                    'write': disk_data['io']['write_speed'],
                })

                # Update latest snapshot
                with self._latest_lock:
                    self._latest = {
                        'cpu': cpu_data,
                        'memory': mem_data,
                        'disk': disk_data,
                        'network': net_data,
                        'gpu': gpu_data,
                        'battery': bat_data,
                        'timestamp': now,
                    }

                # Check alerts
                self.alert_manager.check_alerts(self._latest, settings)

                # Store to database (every 5th collection to reduce writes)
                self._db_write_counter += 1
                if settings.get('history_enabled', True) and self._db_write_counter >= 5:
                    self._db_write_counter = 0
                    self._store_to_db(cpu_data, mem_data, disk_data, net_data, gpu_data, now)

            except Exception as e:
                # Don't crash the collector on errors
                logger.debug("Collector loop iteration error: %s", e)

            # Sleep in small increments so we can stop quickly
            for _ in range(int(interval * 10)):
                if not self._running:
                    break
                time.sleep(0.1)

    def _store_to_db(self, cpu, mem, disk, net, gpu, timestamp):
        """Persist metrics to SQLite."""
        try:
            insert_metric('cpu_history', {
                'timestamp': timestamp,
                'usage_percent': cpu['percent'],
                'core_data': json.dumps(cpu['per_core']),
                'frequency': cpu['frequency'],
            })
        except Exception:
            pass

        try:
            insert_metric('memory_history', {
                'timestamp': timestamp,
                'total': mem['total'],
                'used': mem['used'],
                'available': mem['available'],
                'percent': mem['percent'],
            })
        except Exception:
            pass

        try:
            insert_metric('gpu_history', {
                'timestamp': timestamp,
                'gpu_name': gpu.get('name', ''),
                'load_percent': gpu.get('load'),
                'temperature': gpu.get('temperature'),
                'memory_used': gpu.get('memory_used'),
                'memory_total': gpu.get('memory_total'),
                'memory_percent': gpu.get('memory_percent'),
            })
        except Exception:
            pass

        try:
            insert_metric('network_history', {
                'timestamp': timestamp,
                'upload_speed': net['upload_speed'],
                'download_speed': net['download_speed'],
                'bytes_sent': net['bytes_sent'],
                'bytes_recv': net['bytes_recv'],
            })
        except Exception:
            pass

        try:
            insert_metric('disk_history', {
                'timestamp': timestamp,
                'read_speed': disk['io']['read_speed'],
                'write_speed': disk['io']['write_speed'],
                'read_bytes': disk['io']['read_bytes'],
                'write_bytes': disk['io']['write_bytes'],
            })
        except Exception:
            pass

    def _collect_system_info(self):
        """Collect static system information."""
        import platform
        import psutil
        try:
            self.system_info = {
                'hostname': platform.node(),
                'os': f"{platform.system()} {platform.release()}",
                'os_version': platform.version(),
                'architecture': platform.machine(),
                'python': platform.python_version(),
                'cpu_cores': psutil.cpu_count(logical=True) or 8,
            }
        except Exception:
            self.system_info = {}

    def get_latest(self):
        """Get the latest metric snapshot.
        
        Returns:
            dict with latest metrics for all categories.
        """
        with self._latest_lock:
            return self._latest.copy()

    def get_buffer(self, metric):
        """Get the in-memory buffer for live charts.
        
        Args:
            metric: One of 'cpu', 'memory', 'gpu', 'network', 'disk'.
        
        Returns:
            List of data points.
        """
        buffers = {
            'cpu': self.cpu_buffer,
            'memory': self.memory_buffer,
            'gpu': self.gpu_buffer,
            'network': self.network_buffer,
            'disk': self.disk_buffer,
        }
        buf = buffers.get(metric)
        if buf:
            return list(buf)
        return []


# Global collector instance
collector = Collector()
