"""Storage abstraction for uploaded images."""

from __future__ import annotations

import asyncio
import mimetypes
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from pathlib import PurePosixPath

import logging
from httpx import Client as HttpxClient

from app.config import settings
from app.services.storage_contract import ImageAsset, Storage, StorageError, StorageErrorCode

logger = logging.getLogger("uvicorn.error")

def _provider_error_code(exc: Exception, fallback: StorageErrorCode) -> tuple[StorageErrorCode, bool]:
    """Map provider HTTP statuses without exposing provider details upstream."""
    status = getattr(exc, "status", None)
    try:
        status_code = int(status)
    except (TypeError, ValueError):
        status_code = None
    if status_code == 404:
        return StorageErrorCode.NOT_FOUND, False
    if status_code in {401, 403}:
        return StorageErrorCode.FORBIDDEN, False
    return fallback, True


class SupabaseStorage:
    def __init__(self, bucket: str = "images") -> None:
        self.bucket = bucket.strip() or "images"
        self._client_instance = None

    @property
    def remote_enabled(self) -> bool:
        return bool(settings.supabase_url.strip() and settings.supabase_service_role_key.strip())

    def _client(self):
        if not self.remote_enabled:
            raise StorageError("Storage provider is not configured", StorageErrorCode.PROVIDER_UNAVAILABLE)
        if self._client_instance is not None:
            return self._client_instance

        from supabase import Client, create_client
        from supabase.client import ClientOptions

        # Supabase-py 2.31 passes timeout/verify into storage3 when it creates
        # the default client. storage3 now deprecates those constructor
        # arguments, so provide an explicitly configured httpx client instead.
        http_client = HttpxClient(timeout=60.0)
        client: Client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
            options=ClientOptions(httpx_client=http_client),
        )
        self._client_instance = client
        return self._client_instance

    @staticmethod
    def _content_type(path: str, fallback: str = "image/jpeg") -> str:
        return mimetypes.guess_type(path)[0] or fallback

    @staticmethod
    def _validate_object_path(path: str) -> str:
        object_path = PurePosixPath(path)
        if object_path.is_absolute() or ".." in object_path.parts or "\\" in path:
            raise StorageError("Invalid storage path", StorageErrorCode.INVALID_IMAGE)
        return path

    def _local_root(self) -> Path:
        return Path("uploads").resolve()

    async def upload(
        self,
        path: str,
        content: bytes,
        content_type: str = "image/jpeg",
        *,
        replace_existing: bool = False,
    ) -> None:
        self._validate_object_path(path)
        backend = "supabase" if self.remote_enabled else "local"
        logger.info(
            "Storage upload started path=%s backend=%s bytes=%d content_type=%s",
            path, backend, len(content), content_type,
        )

        def upload_sync() -> None:
            if not self.remote_enabled:
                local = self._local_root() / path
                local.parent.mkdir(parents=True, exist_ok=True)
                local.write_bytes(content)
                return

            self._client().storage.from_(self.bucket).upload(
                file=content,
                path=path,
                file_options={
                    "content-type": content_type,
                    "cache-control": "3600",
                    "upsert": "true" if replace_existing else "false",
                },
            )

        try:
            await asyncio.to_thread(upload_sync)
            logger.info("Storage upload completed path=%s backend=%s", path, backend)
        except Exception as exc:
            logger.warning("Storage upload failed path=%s backend=%s error_type=%s", path, backend, type(exc).__name__)
            raise StorageError("Could not upload image", StorageErrorCode.UPLOAD_FAILED, retryable=True) from exc

    async def read(self, path: str) -> ImageAsset:
        local = self.local_path(path)
        if local is not None:
            logger.info("Storage read started path=%s backend=local resolved_path=%s", path, local)
            try:
                content = await asyncio.to_thread(local.read_bytes)
            except OSError as exc:
                logger.warning("Local storage read failed path=%s resolved_path=%s error_type=%s", path, local, type(exc).__name__)
                raise StorageError("Could not read image", StorageErrorCode.DOWNLOAD_FAILED) from exc
            logger.info("Storage read completed path=%s backend=local bytes=%d", path, len(content))
            return ImageAsset(
                path=path,
                content=content,
                filename=local.name,
                content_type=self._content_type(local.name),
            )

        self._validate_object_path(path)
        logger.info("Storage read started path=%s backend=supabase bucket=%s", path, self.bucket)

        def download_sync() -> bytes:
            return self._client().storage.from_(self.bucket).download(path)

        try:
            content = await asyncio.to_thread(download_sync)
        except Exception as exc:
            code, retryable = _provider_error_code(exc, StorageErrorCode.DOWNLOAD_FAILED)
            logger.warning("Supabase storage read failed path=%s bucket=%s error_type=%s code=%s", path, self.bucket, type(exc).__name__, code.value)
            raise StorageError("Could not read image", code, retryable=retryable) from exc
        logger.info("Storage read completed path=%s backend=supabase bytes=%d", path, len(content))
        return ImageAsset(
            path=path,
            content=content,
            filename=Path(path).name,
            content_type=self._content_type(path),
        )

    async def delete(self, paths: list[str]) -> None:
        if not paths:
            return
        logger.info("Storage delete started paths=%s", paths)
        local_paths: list[tuple[str, Path]] = []
        remote_paths: list[str] = []
        for path in paths:
            if not self.remote_enabled:
                if not Path(path).is_absolute():
                    self._validate_object_path(path)
                local_paths.append((path, Path(path) if Path(path).is_absolute() else self._local_root() / path))
                continue
            local = self.local_path(path)
            if local is None:
                remote_paths.append(path)
            else:
                local_paths.append((path, local))

        for _, local in local_paths:
            try:
                await asyncio.to_thread(local.unlink, missing_ok=True)
            except OSError as exc:
                logger.warning("Local storage delete failed path=%s error_type=%s", local, type(exc).__name__)
                raise StorageError("Could not delete local image", StorageErrorCode.DELETE_FAILED, retryable=True) from exc

        if remote_paths:
            for path in remote_paths:
                self._validate_object_path(path)
            try:
                await asyncio.to_thread(
                    lambda: self._client().storage.from_(self.bucket).remove(remote_paths)
                )
            except Exception as exc:
                logger.warning("Supabase storage delete failed paths=%s bucket=%s error_type=%s", remote_paths, self.bucket, type(exc).__name__)
                raise StorageError("Could not delete image", StorageErrorCode.DELETE_FAILED, retryable=True) from exc
        logger.info("Storage delete completed local_count=%d remote_count=%d", len(local_paths), len(remote_paths))

    async def signed_url(self, path: str, expires_in: int = 3600) -> str | None:
        if self.local_path(path) is not None:
            logger.info("Storage signed URL skipped path=%s reason=local_file", path)
            return None

        self._validate_object_path(path)
        logger.info("Storage signed URL requested path=%s bucket=%s expires_in=%d", path, self.bucket, expires_in)

        def sign_sync():
            return self._client().storage.from_(self.bucket).create_signed_url(path, expires_in)

        try:
            result = await asyncio.to_thread(sign_sync)
        except Exception as exc:
            logger.warning("Supabase signed URL failed path=%s bucket=%s error_type=%s", path, self.bucket, type(exc).__name__)
            raise StorageError("Could not generate image URL", StorageErrorCode.PROVIDER_UNAVAILABLE, retryable=True) from exc
        if isinstance(result, str):
            logger.info("Storage signed URL generated path=%s response_type=str", path)
            return result
        if isinstance(result, dict):
            signed_url = result.get("signedURL") or result.get("signedUrl")
            logger.info("Storage signed URL generated path=%s response_type=dict has_url=%s", path, bool(signed_url))
            return signed_url
        for attribute in ("signedURL", "signedUrl", "signed_url"):
            value = getattr(result, attribute, None)
            if isinstance(value, str):
                logger.info("Storage signed URL generated path=%s response_type=%s", path, type(result).__name__)
                return value
        logger.warning("Storage signed URL returned unrecognized response path=%s response_type=%s", path, type(result).__name__)
        raise StorageError("Could not generate image URL", StorageErrorCode.PROVIDER_UNAVAILABLE)

    def local_path(self, path: str) -> Path | None:
        candidate = Path(path)
        if candidate.is_absolute():
            return candidate if candidate.is_file() else None

        # Pending files are deliberately local only when Supabase is not configured.
        # In remote mode, a path such as "item-id/image.jpg" must never be
        # mistaken for a same-named file on the server.
        if not self.remote_enabled:
            candidate = self._local_root() / candidate
        elif not str(candidate).startswith("uploads/"):
            return None

        try:
            resolved = candidate.resolve()
            root = self._local_root()
            resolved.relative_to(root)
        except ValueError:
            return None
        return resolved if resolved.is_file() else None

    async def stage_pending(
        self,
        item_id: str,
        images: list[bytes],
        *,
        replace_existing: bool = False,
    ) -> list[str]:
        logger.info(
            "Storage pending stage started item_id=%s image_count=%d backend=%s replace_existing=%s",
            item_id,
            len(images),
            "supabase" if self.remote_enabled else "local",
            replace_existing,
        )
        paths: list[str] = []
        try:
            for index, content in enumerate(images):
                path = f"pending/{item_id}/{index + 1}.jpg"
                await self.upload(path, content, replace_existing=replace_existing)
                paths.append(path)
            logger.info("Storage pending stage completed item_id=%s paths=%s", item_id, paths)
            return paths
        except Exception as exc:
            logger.warning("Storage pending stage failed item_id=%s paths=%s error_type=%s", item_id, paths, type(exc).__name__)
            # Idempotent uploads share deterministic object paths. Deleting a
            # successfully replaced prefix here could race with another
            # same-key request that is about to commit those paths. Preserve
            # partial objects so the next same-key retry can replace all of
            # them safely.
            if not replace_existing:
                await self.delete_pending(paths)
            if isinstance(exc, StorageError):
                raise
            raise StorageError("Could not stage image", StorageErrorCode.UPLOAD_FAILED, retryable=True) from exc

    async def delete_pending(self, paths: list[str]) -> None:
        logger.info("Storage pending delete started paths=%s", paths)
        local_directories: set[Path] = set()
        for raw_path in paths:
            local = self.local_path(raw_path)
            if local is not None:
                local_directories.update({local.parent, local.parent.parent})

        await self.delete(paths)
        for directory in local_directories:
            try:
                await asyncio.to_thread(directory.rmdir)
            except OSError:
                pass
        logger.info("Storage pending delete completed paths=%s", paths)

    async def delete_pending_item(self, item_id: str) -> None:
        prefix = self._validate_object_path(f"pending/{item_id}")
        logger.info("Storage pending item delete started item_id=%s", item_id)

        if self.remote_enabled:
            def list_paths_sync() -> list[str]:
                entries = self._client().storage.from_(self.bucket).list(
                    prefix,
                    {"limit": 1000},
                ) or []
                return [
                    f"{prefix}/{name}"
                    for entry in entries
                    if isinstance(entry, dict)
                    and (name := entry.get("name"))
                ]

            try:
                paths = await asyncio.to_thread(list_paths_sync)
            except Exception as exc:
                logger.warning(
                    "Supabase pending item listing failed item_id=%s bucket=%s error_type=%s",
                    item_id,
                    self.bucket,
                    type(exc).__name__,
                )
                raise StorageError(
                    "Could not list pending images",
                    StorageErrorCode.DELETE_FAILED,
                    retryable=True,
                ) from exc
        else:
            root = self._local_root()
            directory = (root / prefix).resolve()
            try:
                directory.relative_to(root)
            except ValueError as exc:
                raise StorageError(
                    "Invalid pending image directory",
                    StorageErrorCode.DELETE_FAILED,
                ) from exc
            paths = [
                path.relative_to(root).as_posix()
                for path in directory.rglob("*")
                if path.is_file()
            ] if directory.exists() else []

        await self.delete_pending(paths)
        logger.info(
            "Storage pending item delete completed item_id=%s path_count=%d",
            item_id,
            len(paths),
        )

    async def promote_pending(self, item_id: str, paths: list[str]) -> list[str]:
        logger.info("Storage pending promotion started item_id=%s paths=%s", item_id, paths)
        remote_paths: list[str] = []
        created_paths: list[str] = []
        try:
            for index, raw_path in enumerate(paths):
                asset = await self.read(raw_path)
                remote_path = f"{item_id}/{item_id}-{index + 1}.jpg"
                try:
                    await self.upload(remote_path, asset.content, asset.content_type)
                    created_paths.append(remote_path)
                except StorageError as exc:
                    # Promotion may be retried after the database write succeeds.
                    # Treat an identical permanent object as already promoted.
                    try:
                        existing = await self.read(remote_path)
                    except StorageError:
                        raise StorageError("Could not promote pending image", StorageErrorCode.PROMOTION_FAILED, retryable=True) from exc
                    if existing.content != asset.content:
                        raise StorageError("Could not promote pending image", StorageErrorCode.PROMOTION_FAILED) from exc
                remote_paths.append(remote_path)
            logger.info("Storage pending promotion completed item_id=%s paths=%s", item_id, remote_paths)
            return remote_paths
        except Exception as exc:
            logger.warning("Storage pending promotion failed item_id=%s source_paths=%s error_type=%s", item_id, paths, type(exc).__name__)
            if created_paths:
                await self.delete(created_paths)
            if isinstance(exc, StorageError):
                raise exc
            raise StorageError("Could not promote pending image", StorageErrorCode.PROMOTION_FAILED, retryable=True) from exc

    async def cleanup_pending(
        self,
        max_age_hours: int = 24,
        preserve_paths: set[str] | None = None,
    ) -> dict[str, int]:
        preserve_paths = preserve_paths or set()
        if self.remote_enabled:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)

            def list_stale_sync() -> list[str]:
                bucket = self._client().storage.from_(self.bucket)
                stale: list[str] = []
                folders = bucket.list("pending", {"limit": 1000}) or []
                for folder in folders:
                    folder_name = folder.get("name") if isinstance(folder, dict) else None
                    if not folder_name:
                        continue
                    files = bucket.list(f"pending/{folder_name}", {"limit": 1000}) or []
                    for file in files:
                        file_name = file.get("name") if isinstance(file, dict) else None
                        timestamp = (file.get("updated_at") or file.get("created_at")) if isinstance(file, dict) else None
                        if not file_name or not timestamp:
                            continue
                        try:
                            modified_at = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
                        except ValueError:
                            continue
                        object_path = f"pending/{folder_name}/{file_name}"
                        if modified_at < cutoff and object_path not in preserve_paths:
                            stale.append(object_path)
                return stale

            try:
                stale_paths = await asyncio.to_thread(list_stale_sync)
                await self.delete(stale_paths)
                return {"scanned": len(stale_paths), "deleted": len(stale_paths), "failed": 0}
            except Exception as exc:
                logger.warning("Could not clean up stale Supabase pending images error_type=%s", type(exc).__name__, exc_info=True)
                return {"scanned": len(locals().get("stale_paths", [])), "deleted": 0, "failed": 1}
        storage_root = self._local_root()
        root = storage_root / "pending"
        if not root.exists():
            return {"scanned": 0, "deleted": 0, "failed": 0}
        cutoff = time.time() - (max_age_hours * 60 * 60)
        scanned = deleted = failed = 0
        for path in root.rglob("*.jpg"):
            scanned += 1
            try:
                object_path = path.relative_to(storage_root).as_posix()
                if path.stat().st_mtime < cutoff and object_path not in preserve_paths:
                    await asyncio.to_thread(path.unlink)
                    deleted += 1
            except FileNotFoundError:
                continue
            except OSError:
                failed += 1
        for directory in sorted(root.glob("*"), reverse=True):
            try:
                await asyncio.to_thread(directory.rmdir)
            except OSError:
                pass
        return {"scanned": scanned, "deleted": deleted, "failed": failed}


storage_service = SupabaseStorage(settings.supabase_storage_bucket)


class InMemoryStorage:
    """Small test double with the same behavior as the production abstraction."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    async def upload(
        self,
        path: str,
        content: bytes,
        content_type: str = "image/jpeg",
        *,
        replace_existing: bool = False,
    ) -> None:
        self.objects[path] = content

    async def stage_pending(
        self,
        item_id: str,
        images: list[bytes],
        *,
        replace_existing: bool = False,
    ) -> list[str]:
        paths = [f"pending/{item_id}/{index + 1}.jpg" for index in range(len(images))]
        for path, content in zip(paths, images):
            self.objects[path] = content
        return paths

    async def delete_pending(self, paths: list[str]) -> None:
        await self.delete(paths)

    async def delete_pending_item(self, item_id: str) -> None:
        prefix = f"pending/{item_id}/"
        await self.delete([path for path in self.objects if path.startswith(prefix)])

    async def promote_pending(self, item_id: str, paths: list[str]) -> list[str]:
        remote_paths: list[str] = []
        for index, path in enumerate(paths):
            remote_path = f"{item_id}/{item_id}-{index + 1}.jpg"
            if path not in self.objects:
                raise StorageError("Could not promote pending image", StorageErrorCode.PROMOTION_FAILED)
            self.objects[remote_path] = self.objects[path]
            remote_paths.append(remote_path)
        return remote_paths

    async def read(self, path: str) -> ImageAsset:
        if path in self.objects:
            content = self.objects[path]
        else:
            local = Path(path)
            if local.is_file():
                import asyncio
                content = await asyncio.to_thread(local.read_bytes)
            else:
                raise StorageError("Could not read image", StorageErrorCode.NOT_FOUND)
        return ImageAsset(path=path, content=content, filename=Path(path).name)

    async def delete(self, paths: list[str]) -> None:
        for path in paths:
            self.objects.pop(path, None)
            self.deleted.append(path)

    async def signed_url(self, path: str, expires_in: int = 3600) -> str | None:
        if path not in self.objects:
            raise StorageError("Could not generate image URL", StorageErrorCode.NOT_FOUND)
        return f"https://storage.test/{path}?expires_in={expires_in}"

    def local_path(self, path: str) -> Path | None:
        return None

    async def cleanup_pending(
        self,
        max_age_hours: int = 24,
        preserve_paths: set[str] | None = None,
    ) -> dict[str, int]:
        return {"scanned": 0, "deleted": 0, "failed": 0}
