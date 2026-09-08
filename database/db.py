"""
SQLite database module for PC Performance Monitor.
Handles initialization, metric storage, and history queries.
Uses WAL mode for concurrent read/write access.
"""

import sqlite3
import os
import time
import threading
from datetime import datetime, timedelta

# Database file path (same directory as the project root)
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'pc_monitor.db')

# Thread-local storage for connections
_local = threading.local()


def get_connection():
    """Get a thread-local database connection."""
    if not hasattr(_local, 'connection') or _local.connection is None:
        _local.connection = sqlite3.connect(DB_PATH, timeout=10)
        _local.connection.row_factory = sqlite3.Row
        _local.connection.execute("PRAGMA journal_mode=WAL")
        _local.connection.execute("PRAGMA synchronous=NORMAL")
    return _local.connection


def init_db():
    """Initialize the database with all required tables."""
    conn = get_connection()
    cursor = conn.cursor()

    # CPU history
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cpu_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            usage_percent REAL,
            core_data TEXT,
            frequency REAL
        )
    ''')

    # Memory history
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS memory_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            total REAL,
            used REAL,
            available REAL,
            percent REAL
        )
    ''')

    # GPU history
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS gpu_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            gpu_name TEXT,
            load_percent REAL,
            temperature REAL,
            memory_used REAL,
            memory_total REAL,
            memory_percent REAL
        )
    ''')

    # Network history
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS network_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            upload_speed REAL,
            download_speed REAL,
            bytes_sent REAL,
            bytes_recv REAL
        )
    ''')

    # Disk I/O history
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS disk_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            read_speed REAL,
            write_speed REAL,
            read_bytes REAL,
            write_bytes REAL
        )
    ''')

    # Alerts log
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS alerts_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            alert_type TEXT NOT NULL,
            message TEXT NOT NULL,
            severity TEXT DEFAULT 'warning',
            value REAL
        )
    ''')

    # Benchmark runs history
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS benchmark_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            target_app TEXT,
            duration_seconds REAL,
            avg_fps REAL,
            low_1_fps REAL,
            low_01_fps REAL,
            total_frames INTEGER,
            summary_json TEXT,
            timeline_json TEXT
        )
    ''')

    # Speed tests history
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS speed_tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            ping_ms REAL,
            download_mbps REAL,
            upload_mbps REAL,
            server_name TEXT,
            server_country TEXT,
            server_sponsor TEXT,
            client_ip TEXT,
            isp TEXT,
            status TEXT DEFAULT 'completed'
        )
    ''')

    # Create indexes for faster time-range queries
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_cpu_ts ON cpu_history(timestamp)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_mem_ts ON memory_history(timestamp)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_gpu_ts ON gpu_history(timestamp)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_net_ts ON network_history(timestamp)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_disk_ts ON disk_history(timestamp)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_alert_ts ON alerts_log(timestamp)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_bench_ts ON benchmark_history(timestamp)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_speed_ts ON speed_tests(timestamp)')

    conn.commit()


def insert_metric(table, data):
    """Insert a metric record into the specified table.
    
    Args:
        table: Table name (must be one of the known tables).
        data: Dict of column_name -> value.
    """
    allowed_tables = {'cpu_history', 'memory_history', 'gpu_history',
                      'network_history', 'disk_history', 'alerts_log'}
    if table not in allowed_tables:
        raise ValueError(f"Unknown table: {table}")

    conn = get_connection()
    columns = ', '.join(data.keys())
    placeholders = ', '.join(['?'] * len(data))
    query = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
    conn.execute(query, list(data.values()))
    conn.commit()


def query_metrics(table, time_range='1h', limit=1000):
    """Query metrics for a given time range.
    
    Args:
        table: Table name.
        time_range: One of '1h', '6h', '24h', '7d', 'all'.
        limit: Maximum rows to return.
    
    Returns:
        List of dicts with metric data.
    """
    allowed_tables = {'cpu_history', 'memory_history', 'gpu_history',
                      'network_history', 'disk_history', 'alerts_log'}
    if table not in allowed_tables:
        raise ValueError(f"Unknown table: {table}")

    range_map = {
        '1h': 3600,
        '6h': 21600,
        '24h': 86400,
        '7d': 604800,
    }

    conn = get_connection()
    if time_range == 'all':
        query = f"SELECT * FROM {table} ORDER BY timestamp DESC LIMIT ?"
        rows = conn.execute(query, (limit,)).fetchall()
    else:
        seconds = range_map.get(time_range, 3600)
        cutoff = time.time() - seconds
        query = f"SELECT * FROM {table} WHERE timestamp >= ? ORDER BY timestamp ASC LIMIT ?"
        rows = conn.execute(query, (cutoff, limit)).fetchall()

    return [dict(row) for row in rows]


def get_stats(table, column, time_range='1h'):
    """Get avg, min, max for a specific column in a time range.
    
    Args:
        table: Table name.
        column: Column to aggregate.
        time_range: One of '1h', '6h', '24h', '7d', 'all'.
    
    Returns:
        Dict with avg, min, max values.
    """
    allowed_tables = {'cpu_history', 'memory_history', 'gpu_history',
                      'network_history', 'disk_history'}
    if table not in allowed_tables:
        raise ValueError(f"Unknown table: {table}")

    # Whitelist columns to prevent injection
    allowed_columns = {
        'cpu_history': ['usage_percent', 'frequency'],
        'memory_history': ['percent', 'used', 'available'],
        'gpu_history': ['load_percent', 'temperature', 'memory_percent'],
        'network_history': ['upload_speed', 'download_speed'],
        'disk_history': ['read_speed', 'write_speed'],
    }
    if column not in allowed_columns.get(table, []):
        raise ValueError(f"Unknown column: {column}")

    range_map = {
        '1h': 3600,
        '6h': 21600,
        '24h': 86400,
        '7d': 604800,
    }

    conn = get_connection()
    if time_range == 'all':
        query = f"SELECT AVG({column}) as avg, MIN({column}) as min, MAX({column}) as max FROM {table}"
        row = conn.execute(query).fetchone()
    else:
        seconds = range_map.get(time_range, 3600)
        cutoff = time.time() - seconds
        query = f"SELECT AVG({column}) as avg, MIN({column}) as min, MAX({column}) as max FROM {table} WHERE timestamp >= ?"
        row = conn.execute(query, (cutoff,)).fetchone()

    if row:
        return {
            'avg': round(row['avg'], 2) if row['avg'] is not None else None,
            'min': round(row['min'], 2) if row['min'] is not None else None,
            'max': round(row['max'], 2) if row['max'] is not None else None,
        }
    return {'avg': None, 'min': None, 'max': None}


def delete_history(table=None, before=None):
    """Delete history records.
    
    Args:
        table: Specific table to clear, or None for all tables.
        before: Unix timestamp; delete records before this time. None = delete all.
    """
    tables = ['cpu_history', 'memory_history', 'gpu_history',
              'network_history', 'disk_history', 'alerts_log']
    if table:
        if table not in tables:
            raise ValueError(f"Unknown table: {table}")
        tables = [table]

    conn = get_connection()
    for t in tables:
        if before:
            conn.execute(f"DELETE FROM {t} WHERE timestamp < ?", (before,))
        else:
            conn.execute(f"DELETE FROM {t}")
    conn.commit()


def cleanup_old_data(days=30):
    """Remove data older than the specified number of days."""
    cutoff = time.time() - (days * 86400)
    delete_history(before=cutoff)


def save_speed_test(ping_ms, download_mbps, upload_mbps, server_name='', server_country='', server_sponsor='', client_ip='', isp='', status='completed'):
    """Save a speed test result to SQLite."""
    conn = get_connection()
    ts = time.time()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO speed_tests (timestamp, ping_ms, download_mbps, upload_mbps, server_name, server_country, server_sponsor, client_ip, isp, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (ts, ping_ms, download_mbps, upload_mbps, server_name, server_country, server_sponsor, client_ip, isp, status))
    conn.commit()
    return cursor.lastrowid


def get_speed_test_history(limit=50):
    """Retrieve past speed test results ordered by timestamp descending."""
    conn = get_connection()
    cursor = conn.cursor()
    rows = cursor.execute('SELECT * FROM speed_tests ORDER BY timestamp DESC LIMIT ?', (limit,)).fetchall()
    return [dict(r) for r in rows]

