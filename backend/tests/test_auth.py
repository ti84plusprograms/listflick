import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import auth


def test_missing_bearer_credentials_return_401():
    with pytest.raises(HTTPException) as raised:
        auth.get_current_user(None)

    assert raised.value.status_code == 401
    assert raised.value.detail == "Authentication required"


def test_invalid_firebase_token_does_not_leak_provider_error(monkeypatch):
    def reject_token(token: str, check_revoked: bool = False):
        raise ValueError("private provider detail")

    monkeypatch.setattr(auth.auth, "verify_id_token", reject_token)

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="not-a-token")
    with pytest.raises(HTTPException) as raised:
        auth.get_current_user(credentials)

    assert raised.value.status_code == 401
    assert raised.value.detail == "Invalid authentication credentials"
    assert "private provider detail" not in str(raised.value.detail)
