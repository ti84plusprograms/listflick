"""Compatibility façade for the storage contract and configured backend."""

from app.config import settings
from app.services.storage_backends import (
    InMemoryStorage,
    SupabaseStorage,
    storage_service,
)
from app.services.storage_contract import (
    ImageAsset,
    Storage,
    StorageError,
    StorageErrorCode,
)

__all__ = [
    "ImageAsset",
    "InMemoryStorage",
    "Storage",
    "StorageError",
    "StorageErrorCode",
    "SupabaseStorage",
    "settings",
    "storage_service",
]
