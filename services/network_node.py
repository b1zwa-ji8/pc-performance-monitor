"""
Local-Network Multi-PC Monitoring Module (Zero Cloud, LAN Only).

Provides:
- Node Mode: Exposes authenticated local endpoint /api/node/metrics and broadcasts mDNS service via zeroconf
- Hub Mode: Discovers Node instances via zeroconf.ServiceBrowser + manual IP addition, polls on interval
- Graceful offline handling (marks Offline with last-seen timestamp)
- Remote proxying for inspecting node dashboards
"""

import os
import sys
import time
import json
import socket
import logging
import threading
import urllib.request
import urllib.error

from services.settings import get_settings, update_settings

logger = logging.getLogger('pc_monitor.multipc')

SERVICE_TYPE = "_pcmonitor._tcp.local."


def get_local_ip():
    """Determine the machine's primary local LAN IP address."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Does not actually transmit packets, just routes to local interface
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        try:
            ip = socket.gethostbyname(socket.gethostname())
        except Exception:
            ip = '127.0.0.1'
    finally:
        s.close()
    return ip


class MultiPCManager:
    """Manages Node broadcasting and Hub discovery polling."""

    def __init__(self):
        self.role = 'standalone'  # 'standalone', 'node', 'hub'
        self.passphrase = 'localpass'
        self.port = 5000
        self.zeroconf = None
        self.service_info = None
        self.browser = None

        self._lock = threading.Lock()
        self.discovered_nodes = {}  # key: node_id -> dict
        self._hub_running = False
        self._hub_thread = None

    def initialize_from_settings(self):
        """Read configuration and transition into configured role."""
        settings = get_settings()
        role = settings.get('multipc_role', 'standalone')
        passphrase = settings.get('multipc_passphrase', 'localpass')
        port = int(settings.get('multipc_port', 5000))

        self.set_role(role, passphrase, port)

        # Restore manually saved nodes
        saved_nodes = settings.get('multipc_manual_nodes', [])
        with self._lock:
            for n in saved_nodes:
                nid = n.get('node_id') or f"{n.get('ip')}:{n.get('port')}"
                if nid not in self.discovered_nodes:
                    self.discovered_nodes[nid] = {
                        'node_id': nid,
                        'hostname': n.get('hostname') or nid,
                        'ip': n.get('ip'),
                        'port': int(n.get('port', 5000)),
                        'passphrase': n.get('passphrase', self.passphrase),
                        'is_online': False,
                        'last_seen': 0,
                        'latest_metrics': {},
                        'is_manual': True,
                    }

    def set_role(self, role, passphrase=None, port=5000):
        """Switch operational role."""
        self.stop_services()
        self.role = role
        if passphrase is not None:
            self.passphrase = passphrase
        self.port = port

        update_settings({
            'multipc_role': self.role,
            'multipc_passphrase': self.passphrase,
            'multipc_port': self.port,
        })

        if self.role == 'node':
            self._start_node_broadcasting()
        elif self.role == 'hub':
            self._start_hub_discovery()

    def _start_node_broadcasting(self):
        """Broadcast mDNS service on local network using zeroconf."""
        try:
            from zeroconf import Zeroconf, ServiceInfo

            local_ip = get_local_ip()
            hostname = socket.gethostname()
            safe_name = f"PCMonitor-{hostname}".replace(' ', '-')
            full_name = f"{safe_name}.{SERVICE_TYPE}"

            ip_bytes = socket.inet_aton(local_ip)

            self.service_info = ServiceInfo(
                type_=SERVICE_TYPE,
                name=full_name,
                addresses=[ip_bytes],
                port=self.port,
                properties={
                    'hostname': hostname,
                    'version': '2.0',
                    'node_id': f"{hostname}_{local_ip}",
                }
            )

            self.zeroconf = Zeroconf()
            self.zeroconf.register_service(self.service_info)
            logger.info("Zeroconf: Broadcasting node as %s on %s:%d", full_name, local_ip, self.port)
        except Exception as e:
            logger.warning("Could not start Zeroconf node broadcaster: %s", e)

    def _start_hub_discovery(self):
        """Start mDNS listener and background polling thread for Hub mode."""
        try:
            from zeroconf import Zeroconf, ServiceBrowser

            class NodeListener:
                def __init__(self, manager):
                    self.manager = manager

                def add_service(self, zc, type_, name):
                    info = zc.get_service_info(type_, name)
                    if info:
                        ip = socket.inet_ntoa(info.addresses[0]) if info.addresses else '127.0.0.1'
                        port = info.port
                        hostname = info.properties.get(b'hostname', b'Node').decode('utf-8', errors='replace')
                        node_id = info.properties.get(b'node_id', b'').decode('utf-8', errors='replace') or f"{hostname}_{ip}"
                        self.manager.register_discovered_node(node_id, hostname, ip, port)

                def remove_service(self, zc, type_, name):
                    pass

                def update_service(self, zc, type_, name):
                    pass

            self.zeroconf = Zeroconf()
            self.browser = ServiceBrowser(self.zeroconf, SERVICE_TYPE, NodeListener(self))
            logger.info("Zeroconf: Hub listening for nodes on %s", SERVICE_TYPE)
        except Exception as e:
            logger.warning("Could not start Zeroconf Hub listener: %s", e)

        self._hub_running = True
        self._hub_thread = threading.Thread(target=self._hub_poll_loop, daemon=True, name='HubNodePoller')
        self._hub_thread.start()

    def register_discovered_node(self, node_id, hostname, ip, port, passphrase=None, is_manual=False):
        """Register or update a discovered LAN node."""
        with self._lock:
            if node_id not in self.discovered_nodes:
                self.discovered_nodes[node_id] = {
                    'node_id': node_id,
                    'hostname': hostname,
                    'ip': ip,
                    'port': port,
                    'passphrase': passphrase or self.passphrase,
                    'is_online': False,
                    'last_seen': 0,
                    'latest_metrics': {},
                    'is_manual': is_manual,
                }
            else:
                self.discovered_nodes[node_id]['ip'] = ip
                self.discovered_nodes[node_id]['port'] = port
                if passphrase:
                    self.discovered_nodes[node_id]['passphrase'] = passphrase

    def add_manual_node(self, ip, port=5000, hostname='Remote PC', passphrase=None):
        """Add a node manually by IP."""
        node_id = f"{hostname}_{ip}:{port}"
        self.register_discovered_node(node_id, hostname, ip, int(port), passphrase=passphrase, is_manual=True)

        # Persist to settings
        settings = get_settings()
        manual_list = settings.get('multipc_manual_nodes', [])
        manual_list = [n for n in manual_list if n.get('node_id') != node_id]
        manual_list.append({
            'node_id': node_id,
            'hostname': hostname,
            'ip': ip,
            'port': int(port),
            'passphrase': passphrase or self.passphrase,
        })
        update_settings({'multipc_manual_nodes': manual_list})
        return True, "Node added"

    def remove_node(self, node_id):
        """Remove a node from tracking."""
        with self._lock:
            if node_id in self.discovered_nodes:
                del self.discovered_nodes[node_id]

        settings = get_settings()
        manual_list = [n for n in settings.get('multipc_manual_nodes', []) if n.get('node_id') != node_id]
        update_settings({'multipc_manual_nodes': manual_list})
        return True, "Node removed"

    def _hub_poll_loop(self):
        """Background thread polling all known nodes every 3 seconds."""
        while self._hub_running:
            nodes_to_poll = []
            with self._lock:
                nodes_to_poll = list(self.discovered_nodes.values())

            for node in nodes_to_poll:
                self._poll_single_node(node)

            time.sleep(3)

    def _poll_single_node(self, node):
        """HTTP GET /api/node/metrics with passphrase."""
        url = f"http://{node['ip']}:{node['port']}/api/node/metrics"
        headers = {
            'X-Node-Passphrase': node.get('passphrase') or self.passphrase,
            'User-Agent': 'PCMonitorHub/2.0',
        }
        req = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=1.8) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode('utf-8'))
                    if data.get('success'):
                        with self._lock:
                            node_id = node['node_id']
                            if node_id in self.discovered_nodes:
                                self.discovered_nodes[node_id]['is_online'] = True
                                self.discovered_nodes[node_id]['last_seen'] = time.time()
                                self.discovered_nodes[node_id]['hostname'] = data.get('hostname') or node['hostname']
                                self.discovered_nodes[node_id]['latest_metrics'] = data
                                self.discovered_nodes[node_id]['error'] = None
                        return
        except Exception as e:
            # Graceful offline detection
            with self._lock:
                node_id = node['node_id']
                if node_id in self.discovered_nodes:
                    # Mark offline if last seen > 7s ago
                    if time.time() - self.discovered_nodes[node_id]['last_seen'] > 7:
                        self.discovered_nodes[node_id]['is_online'] = False
                    self.discovered_nodes[node_id]['error'] = str(e)

    def get_nodes_summary(self):
        """Get list of nodes with online/offline status and metric snapshots."""
        with self._lock:
            node_list = []
            for n in self.discovered_nodes.values():
                m = n.get('latest_metrics', {})
                node_list.append({
                    'node_id': n['node_id'],
                    'hostname': n.get('hostname', 'Remote PC'),
                    'ip': n['ip'],
                    'port': n['port'],
                    'is_online': n['is_online'],
                    'last_seen': n['last_seen'],
                    'last_seen_fmt': time.strftime('%H:%M:%S', time.localtime(n['last_seen'])) if n['last_seen'] else 'Never',
                    'is_manual': n.get('is_manual', False),
                    'cpu_percent': m.get('cpu', {}).get('percent'),
                    'ram_percent': m.get('memory', {}).get('percent'),
                    'gpu_load': m.get('gpu', {}).get('load'),
                    'gpu_temp': m.get('gpu', {}).get('temperature'),
                    'disk_percent': (m.get('disk', {}).get('partitions', [{}])[0].get('percent')
                                     if m.get('disk', {}).get('partitions') else None),
                    'uptime': m.get('uptime', '—'),
                })
            return node_list

    def stop_services(self):
        """Clean shutdown of Zeroconf and polling threads."""
        self._hub_running = False
        if self.zeroconf:
            try:
                if self.service_info:
                    self.zeroconf.unregister_service(self.service_info)
                self.zeroconf.close()
            except Exception:
                pass
            self.zeroconf = None
            self.service_info = None
            self.browser = None


# Global Multi-PC Manager instance
multipc_manager = MultiPCManager()
