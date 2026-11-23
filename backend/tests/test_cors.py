import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app


def test_cors_origin_list_strips_empty_values():
    configured = Settings(
        _env_file=None,
        cors_origins=" http://localhost:8081, ,https://app.example.com ",
    )

    assert configured.cors_origin_list == [
        "http://localhost:8081",
        "https://app.example.com",
    ]


def test_cors_origin_list_rejects_wildcard():
    configured = Settings(_env_file=None, cors_origins="*")

    with pytest.raises(ValueError, match="cannot contain"):
        _ = configured.cors_origin_list


def test_cors_preflight_allows_configured_origin():
    with TestClient(app) as client:
        response = client.options(
            "/health",
            headers={
                "Origin": "http://localhost:8081",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_preflight_rejects_unconfigured_origin():
    with TestClient(app) as client:
        response = client.options(
            "/health",
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
