# PC Performance Monitor — Interactive Dashboard & Native Overlay System

A comprehensive, local-only desktop performance monitoring platform that combines a real-time web telemetry dashboard with a **native companion overlay system** (in-game HUD, floating desktop widget, system tray flyout), **ETW frame-time benchmarking (PresentMon)**, **read-only fan/thermal correlation**, and **zero-cloud LAN Multi-PC fleet monitoring**.

**Strictly local-network only. NO external API keys. NO paid services. NO cloud backend.**

---

## Architecture & System Overview

```
pc_monitor/
├── app.py                          # Flask web server + API endpoints + SSE stream
├── companion.py                    # PySide6 + pystray native companion process
├── requirements.txt                # Core & native companion dependencies
├── settings.json                   # Persisted configuration
├── pc_monitor.db                   # SQLite database (metrics & benchmark history)
├── pc_monitor.log                  # Diagnostics startup self-check & hardware log
├── bin/
│   └── PresentMon.exe              # Standalone Intel PresentMon ETW executable
│
├── monitor/                        # Real hardware telemetry modules (zero synthetic data)
│   ├── cpu.py                      # psutil + py-cpuinfo
│   ├── gpu.py                      # Audited real hardware queries (NVML / WMI / Unavailable)
│   ├── memory.py                   # psutil virtual memory & swap
│   ├── disk.py                     # Drive capacity, I/O rates, storage analyzer
│   ├── network.py                  # Packet and byte throughput rates
│   ├── battery.py                  # Power source and capacity telemetry
│   ├── fans.py                     # Read-only fan sensor queries (NVML / LHM / Win32_Fan)
│   ├── presentmon.py               # ETW frame capture, live FPS, 1% and 0.1% low engine
│   └── processes.py                # Process table with protected system PID safety
│
├── services/
│   ├── collector.py                # Background metric thread, ring buffers, SQLite writes
│   ├── diagnostics.py              # Hardware detection registry & startup self-check
│   ├── companion_manager.py        # Process lifecycle & Windows startup shortcut manager
│   ├── network_node.py             # LAN Node broadcasting & Hub discovery (zeroconf mDNS)
│   ├── alerts.py                   # Threshold evaluation & trigger state
│   ├── history.py                  # SQLite metric query helpers
│   └── settings.py                 # Configuration load/save with defaults
│
├── templates/                      # Clean Jinja2 web templates
│   ├── base.html                   # Global layout, header navigation, live status
│   ├── overview.html               # Node canvas, floating panel, system story
│   ├── cpu.html, memory.html, disk.html, network.html, gpu.html
│   ├── fans.html                   # Fan RPM vs. thermal load correlation view
│   ├── benchmark.html              # PresentMon capture, 1% lows, frame-time timeline
│   ├── multipc.html                # Multi-PC LAN fleet monitoring grid
│   ├── processes.html              # Process manager table
│   ├── history.html                # SQLite telemetry history
│   └── settings.html               # Configuration, overlays, Multi-PC, diagnostics panel
│
└── static/
    ├── css/tokens.css, style.css   # Dark luxury tokens, node cards, pill controls
    └── js/
        ├── overview.js, gpu.js, cpu.js, memory.js, disk.js, network.js
        ├── fans.js                 # Dual-axis correlation visualizer
        ├── benchmark.js            # PresentMon run lifecycle & frame-time charts
        ├── multipc.js              # Zeroconf LAN fleet poller & node card grid
        ├── settings.js             # Diagnostics table loader, overlay controls
        └── components/             # Reusable UI widgets (NodeCard, ConnectorManager)
```

---

## 0. GPU Bug Root Cause & Prevention

### Root Cause
In prior builds, hardware query failures or non-NVIDIA detection (such as AMD or Intel integrated GPUs on Windows) caught exceptions and returned synthetic placeholder values or fallback zeros (`load: 0, temperature: 0`). These fabricated zeros were indistinguishable from valid 0% and 0°C readings, leading to implausible telemetry and random fluctuations in charts.

### The Fix & Prevention
1. **Line-by-Line Audit**: All synthetic fallbacks, hardcoded numbers, and placeholder assignments were eliminated from `monitor/gpu.py`.
2. **Direct NVML Lifecycle**: NVIDIA GPUs communicate directly with `nvidia-ml-py` (`pynvml`), initializing once at startup, handling `NVMLError` explicitly, and cleanly executing `nvmlShutdown()` on process termination via Python's `atexit`.
3. **Strict "Unavailable" Policy**: AMD and Intel graphics on Windows (which do not expose standard ACPI load/temperature without vendor proprietary SDKs) return `'load': None` and `'temperature': None`. The frontend explicitly displays `"Unavailable"` or `"Sensor N/A"` instead of misleading 0s.
4. **Hardware Diagnostics Panel**: Accessible under **Settings → Hardware Diagnostics**, this panel inspects every detection backend per metric (e.g. `GPU: pynvml → Success`, `Fan RPM: Unavailable (OEM ACPI / BIOS managed)`) with live logs from `pc_monitor.log`.

---

## 1. Native Overlay & Widget System

Because browser tabs cannot render on top of external native desktop games or applications, a dedicated **native companion** (`companion.py`) powered by **PySide6** and **pystray** runs alongside the Flask web application.

### Modes
1. **In-Game Overlay (1a)**:
   - Transparent, click-through (`WS_EX_LAYERED | WS_EX_TRANSPARENT`), always-on-top HUD.
   - Sits over gaming sessions showing live **FPS**, **CPU%**, **GPU%**, and **GPU Temp**.
   - Corner snapping: Top-Left (default), Top-Right, Bottom-Left, Bottom-Right.
   - Configurable opacity and font size.
   - **Global Hotkey**: `Ctrl+Shift+O` toggles the overlay instantly.
   - **Fullscreen Advisory**: Works over **Borderless-Windowed** or **Windowed** games. It does not render over true exclusive fullscreen. The system detects exclusive fullscreen and displays an in-overlay advisory recommending borderless mode.
2. **Desktop Floating Widget (1b)**:
   - Draggable, semi-transparent card matching the web dashboard's dark theme with Inter typography.
   - Live CPU%, RAM%, GPU%, GPU Temp, and an animated live sparkline.
   - Remembers position across launches (saved automatically on drag release).
   - Toggleable click-through mode.
   - **Global Hotkey**: `Ctrl+Shift+W` toggles the widget.
3. **System Tray Flyout (1c)**:
   - Lightweight system tray icon. Left-click opens a quick popup card with one-line stats (CPU, RAM, GPU, Disk, Network, FPS) without needing a browser window open.
   - Right-click context menu provides quick links to Open Dashboard, Pause Telemetry, Toggle HUD, and Exit.

### Launch on Windows Startup
- Can be toggled on/off in **Settings → Overlays & Widgets**.
- Uses a silent, non-elevated VBScript launcher placed in the user's personal startup folder:  
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PC_Performance_Monitor.vbs`
- Easily disabled with one click.

---

## 2. FPS Counter & Benchmarking (PresentMon)

Integrates Intel's open-source **PresentMon** (v2.5.1), an ETW-based frame-time capture tool.

- **Non-Invasive**: Does not inject DLLs or hook game memory, keeping it 100% safe from anti-cheat false positives.
- **Binary Location**: Looks for `bin/PresentMon.exe` or system `PATH`.
- **Live Reads**: Feeds real-time FPS into the In-Game Overlay and live telemetry stream.
- **Benchmark Page (`/benchmark`)**:
  - Timed capture window: 10s, 30s, 60s, 120s.
  - Automatically targets active foreground application.
  - Generates comprehensive post-run analysis:
    - **Average FPS**
    - **1% Low FPS** (99th percentile frame time inverted)
    - **0.1% Low FPS** (99.9th percentile frame time inverted — microstutter severity)
    - **Frame-Time Delivery Graph**: Visualizes frame consistency in milliseconds.
    - **Synchronized Hardware Timeline**: Overlays CPU%, GPU%, RAM%, and GPU temperature over the exact benchmark timeline.
  - Automatically saved to SQLite (`benchmark_history` table) with click-to-load review and JSON export.
  - If PresentMon is absent or permissions fail, displays clear `"FPS capture unavailable"` status.

---

## 3. Fan Speed & Thermal View

- **Read-Only Monitoring**: Windows ACPI does not expose universal software fan curve control without vendor proprietary drivers. This module strictly performs read-only sensor visualization and clearly displays an inline notice stating this limitation.
- **Sensor Queries**: Inspects NVIDIA NVML fan speed, LibreHardwareMonitor/OpenHardwareMonitor WMI (`SensorType='Fan'`), and `Win32_Fan`.
- **Zero Guessed Data**: If cooling is controlled by motherboard ACPI/BIOS without an exposed sensor, the field explicitly reports `"Unavailable"` rather than fabricating a fake RPM number.
- **Fan & Thermal Page (`/fans`)**: Dual-axis Chart.js visualization plotting **Fan Speed (RPM)** on the left axis against **CPU & GPU Temperatures (°C)** on the right axis over 1H, 6H, and 24H history windows.

---

## 4. Multi-PC Monitoring (Local Network Only)

A strictly local-network (LAN) fleet monitoring architecture requiring zero cloud accounts, external servers, or internet connectivity.

- **Node Mode**: Instances set to Node mode broadcast their presence via **mDNS/zeroconf** (`_pcmonitor._tcp.local.`) and expose a lightweight read-only endpoint at `/api/node/metrics`.
- **Authentication**: Protected by a shared local passphrase (configured in Settings) sent via `X-Node-Passphrase` header.
- **Hub Mode**: Discovers local nodes via `zeroconf.ServiceBrowser`, polls them every 3 seconds, and displays them on the **Multi-PC (`/multi-pc`)** grid.
- **Manual Node Addition**: Supports manual IP:Port entry for complex subnets where multicast UDP 5353 is blocked by network hardware.
- **Graceful Offline Detection**: If a machine disconnects, the node card displays `"Offline (Last seen XX:XX:XX)"` with an amber indicator rather than throwing exceptions or breaking the fleet dashboard.
- **Offline Guarantee**: Verified to run with internet connection completely disconnected.

---

## Installation & Setup

### Prerequisites
- Windows 10 or Windows 11 (64-bit)
- Python 3.10+ (tested with Python 3.14)
- Modern browser (Edge, Chrome, Firefox)

### 1. Install Dependencies

```powershell
cd c:\projects\pc_monitor
pip install -r requirements.txt
```

`requirements.txt` installs:
- `flask` (web server and SSE push)
- `psutil` (system hardware telemetry)
- `py-cpuinfo` (CPU architecture identification)
- `nvidia-ml-py` (direct NVIDIA GPU telemetry)
- `PySide6` (native transparent overlays & desktop widget)
- `pystray` & `pillow` (system tray icon and flyouts)
- `pynput` (global hotkeys Ctrl+Shift+O, Ctrl+Shift+W)
- `zeroconf` (local mDNS LAN discovery)

### 2. PresentMon Setup
The standalone `bin/PresentMon.exe` executable is bundled in the `bin/` directory. If PresentMon is ever missing, it can be fetched directly from Intel's official repository:
`https://github.com/GameTechDev/PresentMon/releases/download/v2.5.1/PresentMon-2.5.1-x64.exe`

### 3. Run Application

```powershell
python app.py
```

- Open **http://localhost:5000** in your browser.
- To start the native companion (Overlay, Widget, Tray), click **Start Companion** in **Settings → Overlays & Widgets** or run in a separate terminal:

```powershell
python companion.py
```

---

## Hotkey Cheatsheet

| Hotkey | Action |
|---|---|
| `Ctrl+Shift+O` | Toggle In-Game HUD Overlay |
| `Ctrl+Shift+W` | Toggle Desktop Floating Widget |
