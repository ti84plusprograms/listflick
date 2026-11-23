import os
from pathlib import Path

import pytest

from app.services.storage import InMemoryStorage, StorageError, StorageErrorCode, SupabaseStorage


@pytest.mark.asyncio
async def test_in_memory_storage_round_trip_and_cleanup():
    storage = InMemoryStorage()
    await storage.upload("item-1/photo.jpg", b"image")

    asset = await storage.read("item-1/photo.jpg")

    assert asset.path == "item-1/photo.jpg"
    assert asset.content == b"image"
    assert await storage.signed_url("item-1/photo.jpg")

    await storage.delete(["item-1/photo.jpg"])

    assert "item-1/photo.jpg" in storage.deleted
    with pytest.raises(StorageError) as exc_info:
        await storage.read("item-1/photo.jpg")
    assert exc_info.value.code == StorageErrorCode.NOT_FOUND


@pytest.mark.asyncio
async def test_supabase_storage_reads_legacy_local_file(tmp_path: Path):
    image_path = tmp_path / "legacy.jpg"
    image_path.write_bytes(b"legacy image")
    storage = SupabaseStorage()

    asset = await storage.read(str(image_path))

    assert asset.content == b"legacy image"
    assert asset.filename == "legacy.jpg"
    assert await storage.signed_url(str(image_path)) is None


class _FakeBucket:
    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.upload_options: dict[str, dict] = {}

    def upload(self, *, file: bytes, path: str, file_options: dict):
        if path in self.objects and file_options.get("upsert") != "true":
            raise _ProviderError(409)
        self.objects[path] = file
        self.upload_options[path] = file_options

    def download(self, path: str) -> bytes:
        return self.objects[path]

    def remove(self, paths: list[str]):
        for path in paths:
            self.objects.pop(path, None)

    def list(self, prefix: str, options: dict):
        assert options["limit"] == 1000
        marker = f"{prefix.rstrip('/')}/"
        return [
            {"name": path.removeprefix(marker)}
            for path in self.objects
            if path.startswith(marker) and "/" not in path.removeprefix(marker)
        ]

    def create_signed_url(self, path: str, expires_in: int):
        if path not in self.objects:
            raise KeyError(path)
        return {"signedURL": f"https://storage.test/{path}?expires_in={expires_in}"}


class _ProviderError(Exception):
    def __init__(self, status: int):
        self.status = status


class _FakeStorage:
    def __init__(self, bucket: _FakeBucket):
        self.bucket = bucket

    def from_(self, name: str):
        assert name == "images"
        return self.bucket


class _FakeClient:
    def __init__(self, bucket: _FakeBucket):
        self.storage = _FakeStorage(bucket)


@pytest.mark.asyncio
async def test_supabase_storage_remote_lifecycle(monkeypatch):
    monkeypatch.setattr("app.services.storage.settings.supabase_url", "https://example.supabase.co")
    monkeypatch.setattr("app.services.storage.settings.supabase_service_role_key", "service-role")
    bucket = _FakeBucket()
    storage = SupabaseStorage("images")
    monkeypatch.setattr(storage, "_client", lambda: _FakeClient(bucket))

    await storage.upload("item-1/photo.jpg", b"remote", "image/jpeg")
    assert bucket.objects["item-1/photo.jpg"] == b"remote"
    assert bucket.upload_options["item-1/photo.jpg"]["upsert"] == "false"

    asset = await storage.read("item-1/photo.jpg")
    assert asset.content == b"remote"
    assert asset.content_type == "image/jpeg"
    assert await storage.signed_url("item-1/photo.jpg", 60) == "https://storage.test/item-1/photo.jpg?expires_in=60"

    pending = await storage.stage_pending("item-1", [b"pending"])
    assert pending == ["pending/item-1/1.jpg"]
    permanent = await storage.promote_pending("item-1", pending)
    assert permanent == ["item-1/item-1-1.jpg"]
    await storage.delete_pending(pending)
    assert "pending/item-1/1.jpg" not in bucket.objects
    assert bucket.objects[permanent[0]] == b"pending"

    await storage.delete(permanent)
    assert permanent[0] not in bucket.objects


@pytest.mark.asyncio
async def test_supabase_idempotent_pending_stage_replaces_partial_objects(monkeypatch):
    monkeypatch.setattr("app.services.storage.settings.supabase_url", "https://example.supabase.co")
    monkeypatch.setattr("app.services.storage.settings.supabase_service_role_key", "service-role")
    bucket = _FakeBucket()
    storage = SupabaseStorage("images")
    monkeypatch.setattr(storage, "_client", lambda: _FakeClient(bucket))
    bucket.objects["pending/item-1/1.jpg"] = b"partial"

    paths = await storage.stage_pending(
        "item-1",
        [b"complete", b"second"],
        replace_existing=True,
    )

    assert paths == ["pending/item-1/1.jpg", "pending/item-1/2.jpg"]
    assert bucket.objects[paths[0]] == b"complete"
    assert bucket.objects[paths[1]] == b"second"
    assert bucket.upload_options[paths[0]]["upsert"] == "true"


@pytest.mark.asyncio
async def test_supabase_storage_deletes_every_object_in_pending_item_prefix(monkeypatch):
    monkeypatch.setattr("app.services.storage.settings.supabase_url", "https://example.supabase.co")
    monkeypatch.setattr("app.services.storage.settings.supabase_service_role_key", "service-role")
    bucket = _FakeBucket()
    storage = SupabaseStorage("images")
    monkeypatch.setattr(storage, "_client", lambda: _FakeClient(bucket))
    bucket.objects.update(
        {
            "pending/item-1/1.jpg": b"first",
            "pending/item-1/2.jpg": b"second",
            "pending/item-2/1.jpg": b"other",
        }
    )

    await storage.delete_pending_item("item-1")

    assert "pending/item-1/1.jpg" not in bucket.objects
    assert "pending/item-1/2.jpg" not in bucket.objects
    assert bucket.objects["pending/item-2/1.jpg"] == b"other"


@pytest.mark.asyncio
async def test_supabase_storage_uses_local_fallback_without_credentials(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("app.services.storage.settings.supabase_url", "")
    monkeypatch.setattr("app.services.storage.settings.supabase_service_role_key", "")
    isolated_root = tmp_path / "isolated-uploads"
    monkeypatch.setattr("app.services.storage.settings.upload_dir", str(isolated_root))
    storage = SupabaseStorage()

    assert storage._local_root() == isolated_root.resolve()

    await storage.upload("item-1/photo.jpg", b"local")
    assert (isolated_root / "item-1" / "photo.jpg").read_bytes() == b"local"
    asset = await storage.read("item-1/photo.jpg")
    assert asset.content == b"local"
    assert asset.path == "item-1/photo.jpg"

    await storage.delete(["item-1/photo.jpg"])
    with pytest.raises(StorageError) as exc_info:
        await storage.read("item-1/photo.jpg")
    assert exc_info.value.code == StorageErrorCode.DOWNLOAD_FAILED

    # Deleting an already-missing local object remains idempotent and must not
    # attempt to initialize a remote Supabase client.
    await storage.delete(["item-1/missing.jpg"])


@pytest.mark.asyncio
async def test_pending_cleanup_preserves_database_referenced_paths(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("app.services.storage.settings.supabase_url", "")
    monkeypatch.setattr("app.services.storage.settings.supabase_service_role_key", "")
    storage_root = tmp_path / "e2e-uploads"
    monkeypatch.setattr("app.services.storage.settings.upload_dir", str(storage_root))
    storage = SupabaseStorage()
    protected = storage_root / "pending" / "protected" / "1.jpg"
    orphaned = storage_root / "pending" / "orphaned" / "1.jpg"
    normal_development_file = tmp_path / "uploads" / "pending" / "normal-draft" / "1.jpg"
    protected.parent.mkdir(parents=True)
    orphaned.parent.mkdir(parents=True)
    normal_development_file.parent.mkdir(parents=True)
    protected.write_bytes(b"protected")
    orphaned.write_bytes(b"orphaned")
    normal_development_file.write_bytes(b"normal development")
    old = 1_600_000_000
    os.utime(protected, (old, old))
    os.utime(orphaned, (old, old))
    os.utime(normal_development_file, (old, old))

    result = await storage.cleanup_pending(
        max_age_hours=1,
        preserve_paths={"pending/protected/1.jpg"},
    )

    assert protected.exists()
    assert not orphaned.exists()
    assert normal_development_file.exists()
    assert result == {"scanned": 2, "deleted": 1, "failed": 0}


@pytest.mark.asyncio
async def test_supabase_storage_classifies_provider_not_found(monkeypatch):
    monkeypatch.setattr("app.services.storage.settings.supabase_url", "https://example.supabase.co")
    monkeypatch.setattr("app.services.storage.settings.supabase_service_role_key", "service-role")
    storage = SupabaseStorage("images")

    class _MissingBucket:
        def download(self, path: str):
            raise _ProviderError(404)

    class _MissingClient:
        class storage:
            @staticmethod
            def from_(name: str):
                return _MissingBucket()

    monkeypatch.setattr(storage, "_client", lambda: _MissingClient())

    with pytest.raises(StorageError) as exc_info:
        await storage.read("item-1/missing.jpg")

    assert exc_info.value.code == StorageErrorCode.NOT_FOUND
    assert exc_info.value.retryable is False


@pytest.mark.asyncio
async def test_supabase_storage_classifies_provider_outage_as_retryable(monkeypatch):
    monkeypatch.setattr("app.services.storage.settings.supabase_url", "https://example.supabase.co")
    monkeypatch.setattr("app.services.storage.settings.supabase_service_role_key", "service-role")
    storage = SupabaseStorage("images")

    class _UnavailableBucket:
        def download(self, path: str):
            raise _ProviderError(503)

    class _UnavailableClient:
        class storage:
            @staticmethod
            def from_(name: str):
                return _UnavailableBucket()

    monkeypatch.setattr(storage, "_client", lambda: _UnavailableClient())

    with pytest.raises(StorageError) as exc_info:
        await storage.read("item-1/image.jpg")

    assert exc_info.value.code == StorageErrorCode.DOWNLOAD_FAILED
    assert exc_info.value.retryable is True


@pytest.mark.asyncio
async def test_supabase_storage_rejects_traversal_paths(monkeypatch):
    monkeypatch.setattr("app.services.storage.settings.supabase_url", "https://example.supabase.co")
    monkeypatch.setattr("app.services.storage.settings.supabase_service_role_key", "service-role")
    storage = SupabaseStorage()

    with pytest.raises(StorageError, match="Invalid storage path") as exc_info:
        await storage.upload("../outside.jpg", b"unsafe")
    assert exc_info.value.code == StorageErrorCode.INVALID_IMAGE
