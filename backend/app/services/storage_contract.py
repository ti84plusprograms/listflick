"""Stable storage contract and provider-independent error types."""

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class ImageAsset:
    path: str
    content: bytes
    filename: str = "image.jpg"
    content_type: str = "image/jpeg"


class Storage(Protocol):
    async def upload(
        self,
        path: str,
        content: bytes,
        content_type: str = "image/jpeg",
        *,
        replace_existing: bool = False,
    ) -> None: ...

    async def read(self, path: str) -> ImageAsset: ...

    async def delete(self, paths: list[str]) -> None: ...

    async def signed_url(self, path: str, expires_in: int = 3600) -> str | None: ...

    def local_path(self, path: str) -> Path | None: ...

    async def stage_pending(
        self,
        item_id: str,
        images: list[bytes],
        *,
        replace_existing: bool = False,
    ) -> list[str]: ...

    async def delete_pending(self, paths: list[str]) -> None: ...

    async def delete_pending_item(self, item_id: str) -> None: ...

    async def promote_pending(self, item_id: str, paths: list[str]) -> list[str]: ...

    async def cleanup_pending(
        self,
        max_age_hours: int = 24,
        preserve_paths: set[str] | None = None,
    ) -> dict[str, int]: ...


class StorageErrorCode(str, Enum):
    NOT_FOUND = "NOT_FOUND"
    FORBIDDEN = "FORBIDDEN"
    INVALID_IMAGE = "INVALID_IMAGE"
    UPLOAD_FAILED = "UPLOAD_FAILED"
    DOWNLOAD_FAILED = "DOWNLOAD_FAILED"
    PROMOTION_FAILED = "PROMOTION_FAILED"
    DELETE_FAILED = "DELETE_FAILED"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"


class StorageError(RuntimeError):
    """Safe, stable storage failure exposed to application code."""

    def __init__(
        self,
        message: str,
        code: StorageErrorCode = StorageErrorCode.PROVIDER_UNAVAILABLE,
        *,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
