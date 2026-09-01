"""
History service.
Provides query helpers for historical metric data stored in SQLite.
"""

import time
from database.db import query_metrics, get_stats, delete_history


def get_history(metric, time_range='1h'):
    """Get historical data for a specific metric type.
    
    Args:
        metric: One of 'cpu', 'memory', 'gpu', 'network', 'disk'.
        time_range: One of '1h', '6h', '24h', '7d'.
    
    Returns:
        dict with 'data' list and 'stats' dict.
    """
    table_map = {
        'cpu': 'cpu_history',
        'memory': 'memory_history',
        'gpu': 'gpu_history',
        'network': 'network_history',
        'disk': 'disk_history',
    }

    stat_column_map = {
        'cpu': 'usage_percent',
        'memory': 'percent',
        'gpu': 'load_percent',
        'network': 'download_speed',
        'disk': 'read_speed',
    }

    table = table_map.get(metric)
    if not table:
        return {'data': [], 'stats': {'avg': None, 'min': None, 'max': None}}

    # Determine appropriate limit based on time range
    limit_map = {
        '1h': 1800,
        '6h': 5000,
        '24h': 10000,
        '7d': 20000,
    }
    limit = limit_map.get(time_range, 1800)

    data = query_metrics(table, time_range, limit=limit)
    stats = get_stats(table, stat_column_map[metric], time_range)

    return {
        'data': data,
        'stats': stats,
    }


def delete_all_history():
    """Delete all history from all tables."""
    delete_history()
    return {'success': True, 'message': 'All history deleted'}


def delete_metric_history(metric):
    """Delete history for a specific metric.
    
    Args:
        metric: One of 'cpu', 'memory', 'gpu', 'network', 'disk', 'alerts'.
    """
    table_map = {
        'cpu': 'cpu_history',
        'memory': 'memory_history',
        'gpu': 'gpu_history',
        'network': 'network_history',
        'disk': 'disk_history',
        'alerts': 'alerts_log',
    }

    table = table_map.get(metric)
    if not table:
        return {'success': False, 'message': f'Unknown metric: {metric}'}

    delete_history(table=table)
    return {'success': True, 'message': f'{metric} history deleted'}
