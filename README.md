# 🖥️ PC Performance Monitor

A fully local, privacy-first Windows PC monitoring dashboard with real-time metrics, historical data, and a professional UI.

**No API keys. No cloud. No external services. Everything runs on your machine.**

![Python](https://img.shields.io/badge/Python-3.8+-blue) ![Flask](https://img.shields.io/badge/Flask-3.0+-green) ![SQLite](https://img.shields.io/badge/SQLite-local-orange) ![License](https://img.shields.io/badge/License-MIT-yellow)

---

## ✨ Features

### Real-Time Monitoring
- **CPU**: Usage %, per-core breakdown, frequency, model info
- **Memory**: RAM & swap usage, available/total
- **Disk**: Partition usage, read/write speeds, storage analyzer
- **Network**: Upload/download speeds, active connections
- **GPU**: Load, temperature, VRAM usage (NVIDIA GPUs via GPUtil)
- **Battery**: Charge level, charging status, time remaining
- **Processes**: Full process list with search, sort, and terminate

### Dashboard
- 📊 Overview with 6 metric cards (CPU, RAM, GPU, Disk, Network, Battery)
- 📈 Live charts updating every 2 seconds
- 🔔 Configurable alert system with threshold warnings
- 📋 Historical data with selectable time ranges (1h, 6h, 24h, 7d)
- 🌙 Dark mode (default) and light mode
- 📱 Responsive layout (desktop + tablet)

### Data Management
- SQLite-backed performance history
- Avg/min/max statistics per metric
- Delete history per metric or all at once
- Configurable retention period

---

## 🚀 Quick Start

### Prerequisites
- **Python 3.8+** installed on Windows
- **pip** (comes with Python)

### Installation

1. **Clone or download** this project:
   ```bash
   cd C:\projects\pc_monitor
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the application**:
   ```bash
   python app.py
   ```

4. **Open your browser** to:
   ```
   http://localhost:5000
   ```

That's it! The database and settings file are created automatically on first run.

---

## 📁 Project Structure

```
pc_monitor/
├── app.py                  # Flask entry point & routes
├── requirements.txt        # Python dependencies
├── settings.json           # Auto-generated settings (persisted)
├── pc_monitor.db           # SQLite database (auto-created)
├── database/
│   └── db.py               # SQLite init, queries, helpers
├── monitor/                # Hardware monitoring modules
│   ├── cpu.py
│   ├── memory.py
│   ├── disk.py
│   ├── network.py
│   ├── gpu.py
│   ├── battery.py
│   └── processes.py
├── services/               # Business logic
│   ├── collector.py        # Background metric collection
│   ├── alerts.py           # Threshold-based alert system
│   ├── history.py          # Historical data queries
│   └── settings.py         # Settings management
├── templates/              # Jinja2 HTML templates
│   ├── base.html
│   ├── overview.html
│   ├── cpu.html
│   ├── memory.html
│   ├── disk.html
│   ├── network.html
│   ├── gpu.html
│   ├── processes.html
│   └── settings.html
└── static/
    ├── css/style.css       # Complete theme (dark + light)
    └── js/                 # Page-specific JavaScript
        ├── main.js
        ├── charts.js
        ├── overview.js
        ├── cpu.js
        ├── memory.js
        ├── disk.js
        ├── network.js
        ├── gpu.js
        ├── processes.js
        └── settings.js
```

---

## ⚙️ Configuration

Settings are stored in `settings.json` and can be modified through the Settings page:

| Setting | Default | Range |
|---------|---------|-------|
| Refresh Interval | 2 sec | 1–30 sec |
| CPU Warning | 90% | 50–100% |
| RAM Warning | 90% | 50–100% |
| Disk Warning | 90% | 50–100% |
| GPU Temp Warning | 85°C | 50–120°C |
| Battery Warning | 20% | 5–50% |
| History Retention | 30 days | 1–365 days |

---

## 🔧 Troubleshooting

### "ModuleNotFoundError: No module named 'psutil'"
```bash
pip install psutil
```

### "ModuleNotFoundError: No module named 'GPUtil'"
```bash
pip install GPUtil
```
> Note: GPUtil only works with NVIDIA GPUs. AMD/Intel GPUs will show as "unavailable" — this is expected.

### GPU page shows "Unavailable"
- Ensure you have an NVIDIA GPU with drivers installed
- Install the latest NVIDIA drivers from https://www.nvidia.com/drivers
- AMD and Intel integrated GPUs are not supported by GPUtil

### "Access denied" when killing a process
- Some system processes require administrator privileges
- Run the command prompt as Administrator, then start the app

### Port 5000 already in use
Edit `app.py` and change the port number:
```python
app.run(host='127.0.0.1', port=8080, debug=False, threaded=True)
```

### Charts not loading
- Ensure you have an internet connection on first load (Chart.js loads from CDN)
- After first load, the browser caches it

### High memory usage from the monitor itself
- Increase the refresh interval in Settings
- Disable history collection if not needed
- Data buffers are capped at 300 points per metric

---

## 🛡️ Privacy & Security

- **100% local**: No data leaves your machine
- **No API keys**: Zero external service dependencies
- **No telemetry**: Nothing is tracked or reported
- **SQLite storage**: All data in a local file (`pc_monitor.db`)
- **Process kill safety**: System processes (PID 0, 4) are protected; confirmation required

---

## 📄 License

MIT License — free for personal and commercial use.
