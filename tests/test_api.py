"""
Integration tests for Flask API endpoints and HTML pages.
"""

import pytest
from app import app
from services.collector import collector


@pytest.fixture
def client():
    app.config['TESTING'] = True
    # Ensure collector has a basic snapshot
    collector._collect_system_info()
    with app.test_client() as client:
        yield client


@pytest.mark.parametrize("route", [
    '/',
    '/cpu',
    '/memory',
    '/disk',
    '/network',
    '/gpu',
    '/processes',
    '/history',
    '/benchmark',
    '/stress-test',
    '/speed-test',
    '/fans',
    '/multi-pc',
    '/settings',
])
def test_page_routes(client, route):
    res = client.get(route)
    assert res.status_code == 200
    assert b'<!DOCTYPE html>' in res.data or b'<html' in res.data


def test_api_overview(client):
    res = client.get('/api/overview')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'data' in json_data


def test_api_hardware_endpoints(client):
    for metric in ['cpu', 'memory', 'disk', 'network', 'gpu']:
        res = client.get(f'/api/{metric}')
        assert res.status_code == 200
        json_data = res.get_json()
        assert json_data['success'] is True
        assert 'data' in json_data
        assert 'buffer' in json_data


def test_api_processes(client):
    res = client.get('/api/processes')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'processes' in json_data
    assert 'total_count' in json_data


def test_api_history(client):
    res = client.get('/api/history/cpu?range=1h')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'data' in json_data
    assert 'stats' in json_data


def test_api_alerts(client):
    res = client.get('/api/alerts')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'active' in json_data
    assert 'history' in json_data


def test_api_settings_get_post(client):
    res = client.get('/api/settings')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'settings' in json_data

    # POST update
    post_res = client.post('/api/settings', json={'theme': 'dark'})
    assert post_res.status_code == 200
    post_json = post_res.get_json()
    assert post_json['success'] is True


def test_api_diagnostics(client):
    res = client.get('/api/diagnostics')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'data' in json_data


def test_api_fps(client):
    res = client.get('/api/fps')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'data' in json_data


def test_api_companion_status(client):
    res = client.get('/api/companion/status')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'data' in json_data


def test_api_fans(client):
    res = client.get('/api/fans')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'data' in json_data


def test_api_hub_nodes(client):
    res = client.get('/api/hub/nodes')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'nodes' in json_data


def test_api_stress_telemetry(client):
    res = client.get('/api/stress-test/telemetry')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'data' in json_data


def test_api_speedtest_status(client):
    res = client.get('/api/speedtest/status')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['success'] is True
    assert 'data' in json_data
