"""Safe Notion capability and failure categories shared by API responses."""

from typing import Literal, TypedDict

from app.config import settings

NotionCapabilityReason = Literal[
    "configured",
    "backend_disabled",
    "missing_credentials",
]
NotionSyncErrorCode = Literal[
    "timeout",
    "network",
    "tls",
    "rate_limited",
    "authorization",
    "schema",
    "not_found",
    "provider_rejected",
    "unknown",
]


class NotionCapability(TypedDict):
    configured: bool
    creation_enabled: bool
    client_override_allowed: bool
    effective_request_enabled: bool
    reason: NotionCapabilityReason


def notion_capability(
    *,
    creation_enabled: bool | None = None,
    api_key: str | None = None,
    data_source_id: str | None = None,
    database_id: str | None = None,
    client_override_allowed: bool | None = None,
) -> NotionCapability:
    enabled = settings.notion_create_entries if creation_enabled is None else creation_enabled
    resolved_api_key = settings.notion_api_key if api_key is None else api_key
    resolved_data_source_id = (
        settings.notion_data_source_id if data_source_id is None else data_source_id
    )
    resolved_database_id = settings.notion_database_id if database_id is None else database_id
    override_allowed = (
        settings.notion_allow_client_override
        if client_override_allowed is None
        else client_override_allowed
    )
    destination_present = bool(resolved_data_source_id or resolved_database_id)
    configured = bool(enabled and resolved_api_key and destination_present)
    reason: NotionCapabilityReason
    if not enabled:
        reason = "backend_disabled"
    elif not resolved_api_key or not destination_present:
        reason = "missing_credentials"
    else:
        reason = "configured"
    return {
        "configured": configured,
        "creation_enabled": enabled,
        "client_override_allowed": override_allowed,
        "effective_request_enabled": configured,
        "reason": reason,
    }


def notion_error_code_from_message(message: str | None) -> NotionSyncErrorCode | None:
    if not message:
        return None
    normalized = message.lower()
    if "timed out" in normalized or "timeout" in normalized:
        return "timeout"
    if "verify the notion connection" in normalized or "ssl" in normalized or "certificate" in normalized:
        return "tls"
    if "could not reach" in normalized or (
        "connection" in normalized and "authorized" not in normalized
    ):
        return "network"
    if "rate limit" in normalized or "http 429" in normalized:
        return "rate_limited"
    if (
        "not authorized" in normalized
        or "permission" in normalized
        or "http 401" in normalized
        or "http 403" in normalized
    ):
        return "authorization"
    if "listing fields" in normalized or "database schema" in normalized or "http 400" in normalized:
        return "schema"
    if "could not find" in normalized or "http 404" in normalized:
        return "not_found"
    if "rejected" in normalized:
        return "provider_rejected"
    return "unknown"


def notion_error_message(code: NotionSyncErrorCode) -> str:
    return {
        "timeout": "Notion sync timed out. Please try again.",
        "network": "Could not reach Notion. Check your connection and try again.",
        "tls": "Could not verify the Notion connection. Please try again.",
        "rate_limited": "Notion rate limit reached. Please try again shortly.",
        "authorization": (
            "Notion connection is not authorized. Check the integration permissions."
        ),
        "schema": (
            "Notion rejected the listing fields. Check the database schema and try again."
        ),
        "not_found": "Could not find the Notion database or page.",
        "provider_rejected": "Notion rejected the sync request.",
        "unknown": "Notion sync failed. Please try again.",
    }[code]
