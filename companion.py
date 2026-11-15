"""
Native Companion for Personal PC Performance Monitor.
Built with PySide6 & Windows API.

Includes:
1a. In-Game Overlay: Transparent, click-through, always-on-top HUD with FPS & thermals
1b. Desktop Widget: Draggable, semi-transparent floating stats card with sparklines
1c. System Tray Flyout: Light background tray icon with live popup stats and context menu
Global Hotkeys: Non-invasive toggle via pynput
"""

import os
import sys
import json
import time
import ctypes
import logging
import urllib.request
from collections import deque

from PySide6.QtCore import Qt, QTimer, QPoint, QRect, QRectF, Signal, QObject
from PySide6.QtGui import (
    QPainter, QColor, QFont, QPen, QBrush, QIcon, QPixmap,
    QLinearGradient, QAction, QPainterPath
)
from PySide6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QSystemTrayIcon, QMenu, QGraphicsDropShadowEffect
)

logger = logging.getLogger('pc_monitor.companion')

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
SETTINGS_FILE = os.path.join(PROJECT_ROOT, 'settings.json')
SERVER_URL = "http://127.0.0.1:5000"


def load_local_settings():
    """Load settings from settings.json."""
    if os.path.isfile(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_local_settings(data):
    """Update settings.json with new keys."""
    current = load_local_settings()
    current.update(data)
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(current, f, indent=2)
    except Exception:
        pass


def make_click_through(hwnd):
    """Apply WS_EX_TRANSPARENT and WS_EX_LAYERED via Windows API so clicks pass through."""
    try:
        user32 = ctypes.windll.user32
        GWL_EXSTYLE = -20
        WS_EX_LAYERED = 0x00080000
        WS_EX_TRANSPARENT = 0x00000020
        style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED | WS_EX_TRANSPARENT)
    except Exception as e:
        logger.debug("make_click_through error: %s", e)


def remove_click_through(hwnd):
    """Remove WS_EX_TRANSPARENT so window accepts mouse events."""
    try:
        user32 = ctypes.windll.user32
        GWL_EXSTYLE = -20
        WS_EX_TRANSPARENT = 0x00000020
        style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style & ~WS_EX_TRANSPARENT)
    except Exception as e:
        logger.debug("remove_click_through error: %s", e)


# ── Global Signal Bridge for Hotkeys ─────────────────────────────────────────
class HotkeySignals(QObject):
    toggle_overlay = Signal()
    toggle_widget = Signal()


# ── 1a. In-Game Transparent Click-Through Overlay ───────────────────────────
class InGameOverlayWindow(QWidget):
    """Transparent, click-through HUD that sits over games & apps."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(
            Qt.WindowStaysOnTopHint |
            Qt.FramelessWindowHint |
            Qt.Tool |
            Qt.WindowTransparentForInput
        )
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WA_ShowWithoutActivating, True)

        self.corner = 'top-left'
        self.hud_opacity = 0.92
        self.font_size = 12
        self.fps_text = "— FPS"
        self.cpu_text = "CPU: —%"
        self.gpu_text = "GPU: —%"
        self.gpu_temp_text = "Temp: —"
        self.fullscreen_warning = False
        self.recommended_note_shown = False

        self.resize(320, 110)
        self.snap_to_corner(self.corner)

    def showEvent(self, event):
        super().showEvent(event)
        # Apply Windows API click-through after handle creation
        make_click_through(int(self.winId()))

    def snap_to_corner(self, corner='top-left'):
        self.corner = corner
        screen = QApplication.primaryScreen().geometry()
        margin = 24
        w, h = self.width(), self.height()

        if corner == 'top-left':
            self.move(margin, margin)
        elif corner == 'top-right':
            self.move(screen.width() - w - margin, margin)
        elif corner == 'bottom-left':
            self.move(margin, screen.height() - h - margin - 48)
        elif corner == 'bottom-right':
            self.move(screen.width() - w - margin, screen.height() - h - margin - 48)

    def update_telemetry(self, overview_data, fps_data):
        # FPS
        if fps_data and fps_data.get('available') and fps_data.get('fps') is not None:
            self.fps_text = f"{int(fps_data['fps'])} FPS ({fps_data.get('frame_time_display', '')})"
        else:
            self.fps_text = "FPS: Standby"

        # Fullscreen detection warning
        self.fullscreen_warning = bool(fps_data and fps_data.get('is_exclusive_fullscreen'))

        # CPU
        cpu = overview_data.get('cpu', {})
        cpu_val = cpu.get('percent')
        self.cpu_text = f"CPU: {int(cpu_val)}%" if cpu_val is not None else "CPU: —"

        # GPU
        gpu = overview_data.get('gpu', {})
        gpu_val = gpu.get('load')
        gpu_temp = gpu.get('temperature')
        self.gpu_text = f"GPU: {int(gpu_val)}%" if gpu_val is not None else "GPU: N/A"
        self.gpu_temp_text = f"{int(gpu_temp)}°C" if gpu_temp is not None else "Temp: N/A"

        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        # Background rounded card
        rect = self.rect().adjusted(2, 2, -2, -2)
        path = QPainterPath()
        path.addRoundedRect(rect, 8, 8)

        # Dark glass fill
        painter.fillPath(path, QColor(14, 14, 16, int(220 * self.hud_opacity)))

        # Border outline
        painter.setPen(QPen(QColor(255, 255, 255, 30), 1))
        painter.drawPath(path)

        # Draw Telemetry Lines
        font = QFont("Segoe UI", self.font_size, QFont.Bold)
        painter.setFont(font)

        # FPS line (Accent Green)
        painter.setPen(QColor(52, 199, 123))
        painter.drawText(16, 28, self.fps_text)

        # Hardware metrics line
        sub_font = QFont("Segoe UI", self.font_size - 1, QFont.Normal)
        painter.setFont(sub_font)
        painter.setPen(QColor(240, 240, 245))
        hw_line = f"{self.cpu_text}   |   {self.gpu_text}   |   {self.gpu_temp_text}"
        painter.drawText(16, 54, hw_line)

        # Fullscreen notice / Warning badge
        if self.fullscreen_warning:
            warn_font = QFont("Segoe UI", 8, QFont.Bold)
            painter.setFont(warn_font)
            painter.setPen(QColor(245, 185, 66))
            painter.drawText(16, 78, "⚠️ Exclusive Fullscreen detected — Borderless Windowed recommended")
        else:
            hint_font = QFont("Segoe UI", 7, QFont.Normal)
            painter.setFont(hint_font)
            painter.setPen(QColor(150, 150, 155, 180))
            painter.drawText(16, 78, "PC Monitor HUD • Press Ctrl+Shift+O to toggle")


# ── 1b. Desktop Floating Widget ─────────────────────────────────────────────
class DesktopWidgetWindow(QWidget):
    """Draggable, semi-transparent live desktop stats card with sparklines."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(
            Qt.WindowStaysOnTopHint |
            Qt.FramelessWindowHint |
            Qt.Tool
        )
        self.setAttribute(Qt.WA_TranslucentBackground, True)

        self._dragging = False
        self._drag_pos = QPoint()
        self.click_through = False
        self.cpu_history = deque([0] * 30, maxlen=30)
        self.current_cpu = 0
        self.current_ram = 0
        self.current_gpu = 0
        self.current_gpu_temp = "—"

        self.resize(260, 160)
        self._restore_position()

    def _restore_position(self):
        settings = load_local_settings()
        x = settings.get('widget_x', 80)
        y = settings.get('widget_y', 80)
        self.move(x, y)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._dragging = True
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if self._dragging and (event.buttons() & Qt.LeftButton):
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def mouseReleaseEvent(self, event):
        self._dragging = False
        save_local_settings({'widget_x': self.x(), 'widget_y': self.y()})

    def update_telemetry(self, overview_data):
        cpu = overview_data.get('cpu', {})
        mem = overview_data.get('memory', {})
        gpu = overview_data.get('gpu', {})

        c_val = cpu.get('percent', 0) or 0
        m_val = mem.get('percent', 0) or 0
        g_val = gpu.get('load', 0) or 0
        g_temp = gpu.get('temperature')

        self.current_cpu = int(c_val)
        self.current_ram = int(m_val)
        self.current_gpu = int(g_val) if gpu.get('load') is not None else None
        self.current_gpu_temp = f"{int(g_temp)}°C" if g_temp is not None else "—"

        self.cpu_history.append(c_val)
        self.update()

    def set_click_through(self, enabled=True):
        self.click_through = enabled
        hwnd = int(self.winId())
        if enabled:
            make_click_through(hwnd)
        else:
            remove_click_through(hwnd)
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        rect = self.rect().adjusted(2, 2, -2, -2)
        path = QPainterPath()
        path.addRoundedRect(rect, 10, 10)

        # Dark Card Fill
        painter.fillPath(path, QColor(18, 18, 20, 235))
        painter.setPen(QPen(QColor(255, 255, 255, 22), 1))
        painter.drawPath(path)

        # Title / Drag handle
        painter.setFont(QFont("Segoe UI", 8, QFont.Bold))
        painter.setPen(QColor(160, 160, 165))
        painter.drawText(16, 24, "PC PERFORMANCE MONITOR")

        # Metric gauges (CPU, RAM, GPU)
        y_metrics = 54
        painter.setFont(QFont("Segoe UI", 13, QFont.Bold))

        # CPU
        painter.setPen(QColor(232, 68, 44))
        painter.drawText(16, y_metrics, f"{self.current_cpu}%")
        # RAM
        painter.setPen(QColor(165, 180, 252))
        painter.drawText(95, y_metrics, f"{self.current_ram}%")
        # GPU
        painter.setPen(QColor(52, 199, 123))
        gpu_str = f"{self.current_gpu}%" if self.current_gpu is not None else "N/A"
        painter.drawText(175, y_metrics, gpu_str)

        # Labels
        painter.setFont(QFont("Segoe UI", 7, QFont.Normal))
        painter.setPen(QColor(130, 130, 135))
        painter.drawText(16, y_metrics + 14, "CPU LOAD")
        painter.drawText(95, y_metrics + 14, "RAM USE")
        painter.drawText(175, y_metrics + 14, f"GPU ({self.current_gpu_temp})")

        # Sparkline Graph (Bottom 40px)
        spark_rect = QRectF(16, 92, self.width() - 32, 42)
        painter.setPen(QPen(QColor(255, 255, 255, 10), 1))
        painter.drawRect(spark_rect)

        history = list(self.cpu_history)
        if len(history) >= 2:
            step = spark_rect.width() / (len(history) - 1)
            line_path = QPainterPath()
            for i, val in enumerate(history):
                # Map 0-100 to spark_rect
                clamped = max(0, min(100, val))
                x = spark_rect.left() + i * step
                y = spark_rect.bottom() - (clamped / 100.0) * spark_rect.height()
                if i == 0:
                    line_path.moveTo(x, y)
                else:
                    line_path.lineTo(x, y)

            painter.setPen(QPen(QColor(232, 68, 44, 220), 1.8))
            painter.drawPath(line_path)

        # Footer hint
        painter.setFont(QFont("Segoe UI", 7))
        painter.setPen(QColor(110, 110, 115))
        painter.drawText(16, 150, "Drag to move • Ctrl+Shift+W to toggle")


# ── 1c. System Tray Flyout Popup ────────────────────────────────────────────
class TrayFlyoutWindow(QWidget):
    """Small popup panel shown on tray icon click with one-line stats."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(
            Qt.WindowStaysOnTopHint |
            Qt.FramelessWindowHint |
            Qt.Popup
        )
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.resize(240, 220)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(10)

        # Title
        title = QLabel("System Telemetry")
        title.setFont(QFont("Segoe UI", 10, QFont.Bold))
        title.setStyleSheet("color: #ffffff;")
        layout.addWidget(title)

        # Stat lines
        self.lbl_cpu = QLabel("CPU: —")
        self.lbl_ram = QLabel("RAM: —")
        self.lbl_gpu = QLabel("GPU: —")
        self.lbl_disk = QLabel("Disk: —")
        self.lbl_net = QLabel("Network: —")
        self.lbl_fps = QLabel("FPS: —")

        for lbl in [self.lbl_cpu, self.lbl_ram, self.lbl_gpu, self.lbl_disk, self.lbl_net, self.lbl_fps]:
            lbl.setFont(QFont("Segoe UI", 8))
            lbl.setStyleSheet("color: #d1d5db;")
            layout.addWidget(lbl)

        # Open Dashboard Button
        btn = QPushButton("Open Web Dashboard")
        btn.setStyleSheet("""
            QPushButton {
                background: #e8442c;
                color: #ffffff;
                border: none;
                border-radius: 4px;
                padding: 6px;
                font-weight: bold;
                font-size: 11px;
            }
            QPushButton:hover { background: #d03923; }
        """)
        btn.clicked.connect(lambda: os.system("start http://localhost:5000"))
        layout.addWidget(btn)

    def update_data(self, overview, fps):
        cpu = overview.get('cpu', {})
        mem = overview.get('memory', {})
        gpu = overview.get('gpu', {})
        net = overview.get('network', {})
        disk = overview.get('disk', {})

        self.lbl_cpu.setText(f"CPU: {cpu.get('percent', '—')}% ({cpu.get('cores', 8)} cores)")
        self.lbl_ram.setText(f"RAM: {mem.get('percent', '—')}% ({mem.get('used', '—')} / {mem.get('total', '—')} GB)")

        g_load = f"{gpu.get('load')}%" if gpu.get('load') is not None else "N/A"
        g_temp = f"{gpu.get('temperature')}°C" if gpu.get('temperature') is not None else "N/A"
        self.lbl_gpu.setText(f"GPU: {g_load} ({g_temp})")

        p0 = disk.get('partitions', [{}])[0] if disk.get('partitions') else {}
        self.lbl_disk.setText(f"Disk ({p0.get('device', 'C:')}): {p0.get('percent', '—')}% used")

        down = net.get('download_speed_fmt', '0 B/s')
        self.lbl_net.setText(f"Network: {down} down")

        fps_val = fps.get('fps_display', 'Standby') if fps else 'Standby'
        self.lbl_fps.setText(f"FPS: {fps_val}")

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        rect = self.rect().adjusted(1, 1, -1, -1)
        path = QPainterPath()
        path.addRoundedRect(rect, 8, 8)
        painter.fillPath(path, QColor(24, 24, 27, 245))
        painter.setPen(QPen(QColor(255, 255, 255, 35), 1))
        painter.drawPath(path)


def create_tray_icon_pixmap():
    """Generate a clean branded tray icon."""
    pixmap = QPixmap(32, 32)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing)
    # Circle background
    painter.setBrush(QBrush(QColor(24, 24, 27)))
    painter.setPen(QPen(QColor(255, 255, 255, 40), 1))
    painter.drawEllipse(2, 2, 28, 28)
    # Red accent center
    painter.setBrush(QBrush(QColor(232, 68, 44)))
    painter.setPen(Qt.NoPen)
    painter.drawEllipse(10, 10, 12, 12)
    painter.end()
    return pixmap


# ── Main Companion Orchestrator ──────────────────────────────────────────────
class CompanionApp:
    def __init__(self):
        self.app = QApplication.instance() or QApplication(sys.argv)
        self.signals = HotkeySignals()

        # Windows
        self.overlay = InGameOverlayWindow()
        self.widget = DesktopWidgetWindow()
        self.flyout = TrayFlyoutWindow()

        # State
        self.monitoring_paused = False
        self.latest_overview = {}
        self.latest_fps = {}

        # System Tray
        self.tray = QSystemTrayIcon(QIcon(create_tray_icon_pixmap()), self.app)
        self.tray.setToolTip("Personal PC Performance Monitor")
        self._build_tray_menu()
        self.tray.activated.connect(self._on_tray_activated)
        self.tray.show()

        # Connect hotkey signals
        self.signals.toggle_overlay.connect(self.toggle_overlay)
        self.signals.toggle_widget.connect(self.toggle_widget)

        # Timer to poll local Flask endpoints
        self.poll_timer = QTimer()
        self.poll_timer.timeout.connect(self.poll_telemetry)
        self.poll_timer.start(1000)

        # Start Global Hotkey Listener in background thread
        self._start_global_hotkeys()

        # Apply initial visibility based on settings
        settings = load_local_settings()
        if settings.get('overlay_master_enabled', True):
            if settings.get('overlay_ingame_enabled', True):
                self.overlay.show()
            if settings.get('overlay_widget_enabled', True):
                self.widget.show()

    def _build_tray_menu(self):
        menu = QMenu()
        menu.setStyleSheet("""
            QMenu { background: #18181b; color: #f4f4f5; border: 1px solid rgba(255,255,255,0.1); padding: 4px; }
            QMenu::item { padding: 6px 20px; border-radius: 4px; }
            QMenu::item:selected { background: #e8442c; color: #ffffff; }
        """)

        act_title = QAction("Personal PC Monitor", menu)
        act_title.setEnabled(False)
        menu.addAction(act_title)
        menu.addSeparator()

        act_dash = QAction("Open Dashboard", menu)
        act_dash.triggered.connect(lambda: os.system("start http://localhost:5000"))
        menu.addAction(act_dash)

        act_overlay = QAction("Toggle In-Game HUD (Ctrl+Shift+O)", menu)
        act_overlay.triggered.connect(self.toggle_overlay)
        menu.addAction(act_overlay)

        act_widget = QAction("Toggle Desktop Widget (Ctrl+Shift+W)", menu)
        act_widget.triggered.connect(self.toggle_widget)
        menu.addAction(act_widget)

        act_pause = QAction("Pause Telemetry", menu)
        act_pause.triggered.connect(self.toggle_pause)
        self.act_pause = act_pause
        menu.addAction(act_pause)

        menu.addSeparator()
        act_quit = QAction("Exit Companion", menu)
        act_quit.triggered.connect(self.quit)
        menu.addAction(act_quit)

        self.tray.setContextMenu(menu)

    def _on_tray_activated(self, reason):
        if reason == QSystemTrayIcon.Trigger:
            # Left click: toggle flyout
            if self.flyout.isVisible():
                self.flyout.hide()
            else:
                cursor_pos = QApplication.primaryScreen().geometry()
                self.flyout.move(cursor_pos.width() - self.flyout.width() - 20, cursor_pos.height() - self.flyout.height() - 60)
                self.flyout.show()

    def toggle_overlay(self):
        if self.overlay.isVisible():
            self.overlay.hide()
        else:
            self.overlay.show()

    def toggle_widget(self):
        if self.widget.isVisible():
            self.widget.hide()
        else:
            self.widget.show()

    def toggle_pause(self):
        self.monitoring_paused = not self.monitoring_paused
        if self.monitoring_paused:
            self.act_pause.setText("Resume Telemetry")
            self.poll_timer.stop()
        else:
            self.act_pause.setText("Pause Telemetry")
            self.poll_timer.start(1000)

    def poll_telemetry(self):
        """Fetch latest metrics from local Flask server."""
        try:
            req = urllib.request.Request(f"{SERVER_URL}/api/overview", headers={'User-Agent': 'PCMonitorCompanion'})
            with urllib.request.urlopen(req, timeout=0.8) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if data.get('success'):
                    self.latest_overview = data.get('data', {})

            fps_req = urllib.request.Request(f"{SERVER_URL}/api/fps", headers={'User-Agent': 'PCMonitorCompanion'})
            with urllib.request.urlopen(fps_req, timeout=0.8) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if data.get('success'):
                    self.latest_fps = data.get('data', {})

            # Update views
            if self.overlay.isVisible():
                self.overlay.update_telemetry(self.latest_overview, self.latest_fps)
            if self.widget.isVisible():
                self.widget.update_telemetry(self.latest_overview)
            if self.flyout.isVisible():
                self.flyout.update_data(self.latest_overview, self.latest_fps)

        except Exception:
            pass

    def _start_global_hotkeys(self):
        """Register global hotkeys via pynput."""
        try:
            from pynput import keyboard

            def on_overlay_hotkey():
                self.signals.toggle_overlay.emit()

            def on_widget_hotkey():
                self.signals.toggle_widget.emit()

            hotkeys = keyboard.GlobalHotKeys({
                '<ctrl>+<shift>+o': on_overlay_hotkey,
                '<ctrl>+<shift>+w': on_widget_hotkey,
            })
            hotkeys.daemon = True
            hotkeys.start()
            logger.info("Global hotkeys registered (Ctrl+Shift+O, Ctrl+Shift+W)")
        except Exception as e:
            logger.warning("Could not register global hotkeys: %s", e)

    def quit(self):
        self.tray.hide()
        self.app.quit()


def main():
    companion = CompanionApp()
    sys.exit(companion.app.exec())


if __name__ == '__main__':
    main()
