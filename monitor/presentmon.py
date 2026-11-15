"""
PresentMon Integration & FPS / Benchmarking Module.

Non-invasive ETW-based frame-time capture:
- No DLL injection
- No process hooking
- Real frame-time and FPS data directly from DirectX / Vulkan / Desktop Window Manager flip queue.
- If PresentMon is unavailable or fails to initialize, returns explicit "Unavailable" — never fabricated numbers.
"""

import os
import sys
import time
import shutil
import ctypes
import threading
import subprocess
import json
import logging
from collections import deque

logger = logging.getLogger('pc_monitor.presentmon')

BIN_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bin')
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_presentmon_path():
    """Locate PresentMon executable."""
    candidates = [
        os.path.join(BIN_DIR, 'PresentMon.exe'),
        os.path.join(BIN_DIR, 'PresentMon-2.5.1-x64.exe'),
        shutil.which('PresentMon.exe'),
        shutil.which('PresentMon'),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return os.path.abspath(c)
    return None


def check_presentmon_availability():
    """Check if PresentMon executable is available and runnable."""
    path = get_presentmon_path()
    if not path:
        return False, "PresentMon binary not found in bin/ or PATH. Download via Settings or CLI."
    try:
        res = subprocess.run(
            [path, '--help'],
            capture_output=True, text=True, timeout=3,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        )
        if 'PresentMon' in (res.stdout or '') or 'PresentMon' in (res.stderr or ''):
            return True, f"PresentMon ready ({os.path.basename(path)})"
        return True, "PresentMon executable detected"
    except Exception as e:
        return False, f"PresentMon execution check failed: {e}"


def get_foreground_window_info():
    """Detect the active foreground window, process name, PID, and fullscreen mode."""
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return {'pid': 0, 'name': 'Unknown', 'title': '', 'is_fullscreen': False, 'is_exclusive': False}

        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

        title_buf = ctypes.create_unicode_buffer(512)
        user32.GetWindowTextW(hwnd, title_buf, 512)
        title = title_buf.value

        name = 'Unknown'
        if pid.value:
            import psutil
            try:
                proc = psutil.Process(pid.value)
                name = proc.name()
            except Exception:
                pass

        # Check window rect vs monitor rect
        class RECT(ctypes.Structure):
            _fields_ = [('left', ctypes.c_long), ('top', ctypes.c_long),
                        ('right', ctypes.c_long), ('bottom', ctypes.c_long)]

        rect = RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        w = rect.right - rect.left
        h = rect.bottom - rect.top

        screen_w = user32.GetSystemMetrics(0)  # SM_CXSCREEN
        screen_h = user32.GetSystemMetrics(1)  # SM_CYSCREEN

        is_fullscreen = (w >= screen_w and h >= screen_h and rect.left <= 0 and rect.top <= 0)

        # Style check: GWL_STYLE = -16
        # WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000
        style = user32.GetWindowLongW(hwnd, -16)
        has_decorations = bool(style & (0x00C00000 | 0x00040000))

        # True exclusive fullscreen typically covers screen and has no standard window decorations
        is_exclusive = is_fullscreen and not has_decorations

        return {
            'pid': pid.value,
            'name': name,
            'title': title,
            'is_fullscreen': is_fullscreen,
            'is_exclusive': is_exclusive,
            'resolution': f"{w}x{h}",
        }
    except Exception as e:
        logger.debug("Foreground window query error: %s", e)
        return {'pid': 0, 'name': 'Unknown', 'title': '', 'is_fullscreen': False, 'is_exclusive': False}


# ── Continuous Live FPS Streamer for Overlay ────────────────────────────────
class LiveFPSMonitor:
    """Lightweight background ETW frame poller for live overlay / dashboard."""

    def __init__(self):
        self._running = False
        self._thread = None
        self._process = None
        self._lock = threading.Lock()
        self._frame_times = deque(maxlen=60)
        self._latest_fps = None
        self._latest_frametime = None
        self._latest_app = 'None'
        self._last_frame_ts = 0

    def start(self):
        """Start the background FPS monitoring stream if PresentMon is available."""
        if self._running:
            return
        pm_path = get_presentmon_path()
        if not pm_path:
            return

        self._running = True
        self._thread = threading.Thread(target=self._stream_worker, daemon=True, name='PresentMonLiveFPS')
        self._thread.start()

    def stop(self):
        """Stop PresentMon process."""
        self._running = False
        if self._process:
            try:
                self._process.terminate()
            except Exception:
                pass
            self._process = None

    def _stream_worker(self):
        pm_path = get_presentmon_path()
        if not pm_path:
            return

        while self._running:
            try:
                # Run PresentMon with stdout stream
                cmd = [
                    pm_path,
                    '--stop_existing_session',
                    '--output_stdout',
                    '--no_console_stats',
                    '--v1_metrics',  # standard reliable columns: Application, ProcessID, MsBetweenPresents
                ]
                self._process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
                )

                header = None
                ms_idx = None
                app_idx = None

                for line in iter(self._process.stdout.readline, ''):
                    if not self._running:
                        break
                    line = line.strip()
                    if not line:
                        continue

                    parts = [p.strip() for p in line.split(',')]
                    if header is None:
                        if 'MsBetweenPresents' in parts or 'MsBetweenDisplayChange' in parts:
                            header = parts
                            ms_idx = parts.index('MsBetweenPresents') if 'MsBetweenPresents' in parts else parts.index('MsBetweenDisplayChange')
                            app_idx = parts.index('Application') if 'Application' in parts else 0
                        continue

                    if ms_idx is not None and len(parts) > ms_idx:
                        try:
                            raw_ms = parts[ms_idx]
                            if raw_ms != 'NA':
                                ft_ms = float(raw_ms)
                                if 0.5 <= ft_ms <= 1000.0:
                                    app_name = parts[app_idx] if app_idx < len(parts) else 'App'
                                    with self._lock:
                                        self._frame_times.append(ft_ms)
                                        self._latest_frametime = ft_ms
                                        self._latest_app = app_name
                                        self._last_frame_ts = time.time()
                        except (ValueError, IndexError):
                            pass

                if self._process:
                    self._process.wait(timeout=2)
            except Exception as e:
                logger.debug("PresentMon stream worker iteration: %s", e)

            if self._running:
                time.sleep(2)

    def get_status(self):
        """Get the current live FPS telemetry."""
        now = time.time()
        with self._lock:
            # Check if we have recent frame presents within the last 1.5 seconds
            has_recent = (now - self._last_frame_ts) <= 1.5 and len(self._frame_times) >= 2
            if has_recent:
                avg_ms = sum(self._frame_times) / len(self._frame_times)
                fps = round(1000.0 / avg_ms, 1) if avg_ms > 0 else None
                fg_info = get_foreground_window_info()
                return {
                    'available': True,
                    'fps': fps,
                    'fps_display': f"{int(fps)} FPS",
                    'frame_time_ms': round(self._latest_frametime, 2) if self._latest_frametime else None,
                    'frame_time_display': f"{round(self._latest_frametime, 1)} ms" if self._latest_frametime else "—",
                    'app_name': fg_info.get('name') or self._latest_app,
                    'window_title': fg_info.get('title', ''),
                    'is_exclusive_fullscreen': fg_info.get('is_exclusive', False),
                    'status': 'Tracking',
                }
            else:
                pm_avail, _ = check_presentmon_availability()
                fg_info = get_foreground_window_info()
                if not pm_avail:
                    return {
                        'available': False,
                        'fps': None,
                        'fps_display': 'Unavailable',
                        'frame_time_ms': None,
                        'frame_time_display': 'Unavailable',
                        'app_name': fg_info.get('name', 'None'),
                        'window_title': fg_info.get('title', ''),
                        'is_exclusive_fullscreen': fg_info.get('is_exclusive', False),
                        'status': 'FPS capture unavailable (PresentMon not installed)',
                    }
                return {
                    'available': True,
                    'fps': None,
                    'fps_display': 'Standby',
                    'frame_time_ms': None,
                    'frame_time_display': 'Standby',
                    'app_name': fg_info.get('name', 'None'),
                    'window_title': fg_info.get('title', ''),
                    'is_exclusive_fullscreen': fg_info.get('is_exclusive', False),
                    'status': 'Standby (No active 3D application presents)',
                }


# Global live FPS monitor instance
live_fps_monitor = LiveFPSMonitor()


# ── Timed Benchmark Capture Engine ──────────────────────────────────────────
class BenchmarkSession:
    """Manages an active or completed benchmarking run."""

    def __init__(self):
        self.state = 'idle'  # 'idle', 'running', 'completed', 'error'
        self.start_time = 0
        self.target_duration = 30
        self.target_app = 'System / Foreground'
        self.frame_times = []
        self.hardware_samples = []
        self.report = None
        self.error_message = None
        self._thread = None
        self._stop_event = threading.Event()

    def start(self, duration=30):
        """Start a timed capture session."""
        if self.state == 'running':
            return False, "Benchmark already running"

        pm_path = get_presentmon_path()
        if not pm_path:
            return False, "PresentMon executable not found. Please verify bin/PresentMon.exe is present."

        self.state = 'running'
        self.target_duration = max(5, min(int(duration), 300))
        self.frame_times = []
        self.hardware_samples = []
        self.report = None
        self.error_message = None
        self._stop_event.clear()

        fg = get_foreground_window_info()
        self.target_app = fg.get('name') or 'System 3D Workload'

        self._thread = threading.Thread(target=self._run_session, daemon=True, name='BenchmarkSession')
        self._thread.start()
        return True, "Benchmark session initiated"

    def stop(self):
        """Manually stop a running benchmark."""
        if self.state == 'running':
            self._stop_event.set()
            return True, "Stopping benchmark"
        return False, "No benchmark running"

    def _run_session(self):
        from monitor.cpu import get_cpu
        from monitor.gpu import get_gpu
        from monitor.memory import get_memory

        pm_path = get_presentmon_path()
        duration = self.target_duration
        self.start_time = time.time()

        cmd = [
            pm_path,
            '--stop_existing_session',
            '--timed', str(duration),
            '--terminate_after_timed',
            '--output_stdout',
            '--no_console_stats',
            '--v1_metrics',
        ]

        proc = None
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )

            # Concurrent hardware sampler thread
            def sample_hardware():
                t0 = time.time()
                while not self._stop_event.is_set() and (time.time() - t0) <= duration + 1:
                    now = time.time()
                    try:
                        c = get_cpu()
                        g = get_gpu()
                        m = get_memory()
                        self.hardware_samples.append({
                            't': round(now - t0, 2),
                            'cpu_percent': c.get('percent', 0),
                            'gpu_load': g.get('load') if g.get('load') is not None else None,
                            'gpu_temp': g.get('temperature') if g.get('temperature') is not None else None,
                            'ram_percent': m.get('percent', 0),
                        })
                    except Exception:
                        pass
                    time.sleep(0.25)

            hw_thread = threading.Thread(target=sample_hardware, daemon=True)
            hw_thread.start()

            header = None
            ms_idx = None

            for line in iter(proc.stdout.readline, ''):
                if self._stop_event.is_set():
                    break
                line = line.strip()
                if not line:
                    continue

                parts = [p.strip() for p in line.split(',')]
                if header is None:
                    if 'MsBetweenPresents' in parts or 'MsBetweenDisplayChange' in parts:
                        header = parts
                        ms_idx = parts.index('MsBetweenPresents') if 'MsBetweenPresents' in parts else parts.index('MsBetweenDisplayChange')
                    continue

                if ms_idx is not None and len(parts) > ms_idx:
                    try:
                        raw = parts[ms_idx]
                        if raw != 'NA':
                            val = float(raw)
                            if 0.2 <= val <= 2000.0:
                                self.frame_times.append({
                                    't': round(time.time() - self.start_time, 3),
                                    'ms': val,
                                    'fps': round(1000.0 / val, 1),
                                })
                    except (ValueError, IndexError):
                        pass

            self._stop_event.set()
            hw_thread.join(timeout=2)
            try:
                proc.terminate()
            except Exception:
                pass

            # Calculate report metrics
            self._finalize_report()

        except Exception as e:
            self.state = 'error'
            self.error_message = str(e)
            logger.error("Benchmark session error: %s", e)

    def _finalize_report(self):
        """Calculate statistical metrics and save to SQLite."""
        duration_elapsed = round(time.time() - self.start_time, 1)

        if not self.frame_times:
            report = {
                'timestamp': time.time(),
                'target_app': self.target_app,
                'duration_seconds': duration_elapsed,
                'total_frames': 0,
                'avg_fps': None,
                'low_1_fps': None,
                'low_01_fps': None,
                'frame_times': [],
                'hardware_timeline': self.hardware_samples,
                'message': 'No 3D frame presents captured during the run window.',
            }
        else:
            ms_vals = [f['ms'] for f in self.frame_times]
            sorted_ms = sorted(ms_vals)
            n = len(sorted_ms)

            total_time_s = sum(ms_vals) / 1000.0
            avg_fps = round(n / total_time_s, 1) if total_time_s > 0 else 0

            # 1% low: worst 1% of frame times
            idx_1 = max(0, int(n * 0.99))
            p99_frametime = sorted_ms[min(idx_1, n - 1)]
            low_1_fps = round(1000.0 / p99_frametime, 1) if p99_frametime > 0 else 0

            # 0.1% low: worst 0.1% of frame times
            idx_01 = max(0, int(n * 0.999))
            p999_frametime = sorted_ms[min(idx_01, n - 1)]
            low_01_fps = round(1000.0 / p999_frametime, 1) if p999_frametime > 0 else 0

            # Downsample frame times for graph if very dense
            step = max(1, len(self.frame_times) // 800)
            display_frame_times = self.frame_times[::step]

            report = {
                'timestamp': time.time(),
                'target_app': self.target_app,
                'duration_seconds': round(self.frame_times[-1]['t'], 1) if self.frame_times else duration_elapsed,
                'total_frames': n,
                'avg_fps': avg_fps,
                'low_1_fps': low_1_fps,
                'low_01_fps': low_01_fps,
                'frame_times': display_frame_times,
                'hardware_timeline': self.hardware_samples,
            }

        # Store to SQLite
        try:
            from database.db import get_connection
            conn = get_connection()
            conn.execute('''
                INSERT INTO benchmark_history (
                    timestamp, target_app, duration_seconds, avg_fps, low_1_fps, low_01_fps, total_frames, summary_json, timeline_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                report['timestamp'],
                report['target_app'],
                report['duration_seconds'],
                report['avg_fps'],
                report['low_1_fps'],
                report['low_01_fps'],
                report['total_frames'],
                json.dumps({
                    'avg_fps': report['avg_fps'],
                    'low_1_fps': report['low_1_fps'],
                    'low_01_fps': report['low_01_fps'],
                    'total_frames': report['total_frames'],
                }),
                json.dumps({
                    'frame_times': report.get('frame_times', []),
                    'hardware_timeline': report.get('hardware_timeline', []),
                })
            ))
            conn.commit()
        except Exception as e:
            logger.error("Failed to save benchmark to SQLite: %s", e)

        self.report = report
        self.state = 'completed'


# Global benchmark session
benchmark_session = BenchmarkSession()


def get_benchmark_history(limit=10):
    """Retrieve saved benchmark reports from SQLite."""
    from database.db import get_connection
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, timestamp, target_app, duration_seconds, avg_fps, low_1_fps, low_01_fps, total_frames, summary_json
        FROM benchmark_history
        ORDER BY timestamp DESC
        LIMIT ?
    ''', (limit,))
    rows = cursor.fetchall()
    results = []
    for r in rows:
        results.append({
            'id': r['id'],
            'timestamp': r['timestamp'],
            'target_app': r['target_app'],
            'duration_seconds': r['duration_seconds'],
            'avg_fps': r['avg_fps'],
            'low_1_fps': r['low_1_fps'],
            'low_01_fps': r['low_01_fps'],
            'total_frames': r['total_frames'],
            'summary': json.loads(r['summary_json']) if r['summary_json'] else {},
        })
    return results


def get_benchmark_run(run_id):
    """Retrieve a single benchmark run with full timeline data."""
    from database.db import get_connection
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM benchmark_history WHERE id = ?', (run_id,))
    row = cursor.fetchone()
    if not row:
        return None
    timeline = json.loads(row['timeline_json']) if row['timeline_json'] else {}
    return {
        'id': row['id'],
        'timestamp': row['timestamp'],
        'target_app': row['target_app'],
        'duration_seconds': row['duration_seconds'],
        'avg_fps': row['avg_fps'],
        'low_1_fps': row['low_1_fps'],
        'low_01_fps': row['low_01_fps'],
        'total_frames': row['total_frames'],
        'summary': json.loads(row['summary_json']) if row['summary_json'] else {},
        'frame_times': timeline.get('frame_times', []),
        'hardware_timeline': timeline.get('hardware_timeline', []),
    }
