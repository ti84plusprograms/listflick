"""One optional video per listing: upload limits, storage, frames and responses.

Facebook Marketplace takes one video per listing through a separate "Add video" button,
so the cover is always a photo. The video is stored next to the item's photos (same
storage backend, same item-scoped paths) and owned by the same authenticated user. The
best still frames are kept too so the vision model can use them.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from app.config import settings
from app.models.database import item_image_paths, item_video_paths, item_video_record
from app.schemas.listing import ItemVideo
from app.services.item_api_service import storage_http_exception
from app.services.storage import Storage, StorageError
from app.services.video_frames import (
    MAX_FRAME_CANDIDATES,
    MAX_VIDEO_FRAMES,
    SelectedFrame,
    build_candidates,
    normalize_frame,
    select_frames,
)

logger = logging.getLogger("uvicorn.error")

ItemRecord = dict[str, Any]
UpdateItemVideo = Callable[[str, str, dict | None], Awaitable[None]]

VIDEO_CONTENT_TYPES: dict[str, str] = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/x-m4v": ".m4v",
    "video/webm": ".webm",
}
VIDEO_EXTENSIONS: dict[str, str] = {extension: content_type for content_type, extension in VIDEO_CONTENT_TYPES.items()}
MAX_FRAME_BYTES = 4 * 1024 * 1024
MAX_VIDEO_DURATION_SECONDS = 60 * 60
READ_CHUNK_BYTES = 1024 * 1024


def max_video_bytes() -> int:
    return settings.max_video_upload_mb * 1024 * 1024


@dataclass(frozen=True)
class VideoUpload:
    content: bytes
    content_type: str
    extension: str
    duration_seconds: float
    frames: list[bytes]
    frame_times: list[float]

    @property
    def fingerprint(self) -> str:
        return "video:" + hashlib.sha256(self.content).hexdigest()


def _video_type(file: UploadFile) -> tuple[str, str]:
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type in VIDEO_CONTENT_TYPES:
        return content_type, VIDEO_CONTENT_TYPES[content_type]
    # Some pickers send a generic type; fall back to a known video file extension.
    match = re.search(r"(\.[a-z0-9]{2,5})$", (file.filename or "").lower())
    if content_type in {"", "application/octet-stream"} and match and match.group(1) in VIDEO_EXTENSIONS:
        extension = match.group(1)
        return VIDEO_EXTENSIONS[extension], extension
    raise HTTPException(status_code=415, detail="Video must be an MP4, MOV, M4V or WebM file")


async def _read_limited(file: UploadFile, limit: int, too_large_detail: str) -> bytes:
    # One growing buffer instead of keeping every chunk alive until a join.
    buffer = bytearray()
    while True:
        chunk = await file.read(READ_CHUNK_BYTES)
        if not chunk:
            break
        if len(buffer) + len(chunk) > limit:
            raise HTTPException(status_code=413, detail=too_large_detail)
        buffer.extend(chunk)
    return bytes(buffer)


def parse_frame_times(raw: str | None) -> list[float]:
    """Frame timestamps in seconds, sent as a JSON list or comma-separated numbers."""
    if not isinstance(raw, str) or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
        values = parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        values = [part for part in raw.split(",") if part.strip()]
    times: list[float] = []
    for value in values[:MAX_FRAME_CANDIDATES]:
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="frame_times must be numbers") from None
        times.append(max(0.0, min(number, float(MAX_VIDEO_DURATION_SECONDS))))
    return times


def parse_duration(raw: float | str | None) -> float:
    if not isinstance(raw, (int, float, str)):
        return 0.0
    try:
        duration = float(raw) if raw != "" else 0.0
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="duration must be a number of seconds") from None
    if duration != duration or duration < 0:  # NaN or negative
        raise HTTPException(status_code=400, detail="duration must be a number of seconds")
    return min(duration, float(MAX_VIDEO_DURATION_SECONDS))


async def read_video_upload(
    file: UploadFile,
    frames: list[UploadFile] | None,
    *,
    frame_times: str | None,
    duration: float | str | None,
) -> VideoUpload:
    """Validate the video and its candidate frames before anything is stored."""
    content_type, extension = _video_type(file)
    limit_mb = settings.max_video_upload_mb
    content = await _read_limited(file, max_video_bytes(), f"Video must be under {limit_mb} MB")
    if not content:
        raise HTTPException(status_code=400, detail="The video file is empty")

    frame_files = [frame for frame in frames if frame is not None] if isinstance(frames, list) else []
    if len(frame_files) > MAX_FRAME_CANDIDATES:
        raise HTTPException(status_code=400, detail=f"Send at most {MAX_FRAME_CANDIDATES} video frames")
    frame_bytes: list[bytes] = []
    for frame in frame_files:
        if not frame.content_type or not frame.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Video frames must be images")
        frame_bytes.append(await _read_limited(frame, MAX_FRAME_BYTES, "Each video frame must be under 4 MB"))

    times = parse_frame_times(frame_times)
    seconds = parse_duration(duration)
    if not seconds and times:
        seconds = max(times)
    logger.info(
        "Video upload validated bytes=%d content_type=%s duration=%.1fs frames=%d",
        len(content),
        content_type,
        seconds,
        len(frame_bytes),
    )
    return VideoUpload(
        content=content,
        content_type=content_type,
        extension=extension,
        duration_seconds=seconds,
        frames=frame_bytes,
        frame_times=times,
    )


def select_upload_frames(upload: VideoUpload) -> list[SelectedFrame]:
    """Pick the frames worth keeping for analysis (and, for a video-only listing, the cover)."""
    candidates = build_candidates(upload.frames, upload.frame_times)
    return select_frames(candidates, MAX_VIDEO_FRAMES, upload.duration_seconds)


def cover_frame(selected: list[SelectedFrame]) -> SelectedFrame | None:
    """The sharpest selected frame (selection starts with it)."""
    return min(selected, key=lambda frame: frame.rank) if selected else None


async def store_item_video(
    item: ItemRecord,
    uid: str,
    upload: VideoUpload,
    *,
    storage: Storage,
    update_video: UpdateItemVideo,
    selected: list[SelectedFrame] | None = None,
    cover: SelectedFrame | None = None,
    cover_path: str | None = None,
) -> dict:
    """Store the video and its frames, point the item at them, then drop any older video."""
    item_id = item["id"]
    video_id = uuid.uuid4().hex[:16]
    if selected is None:
        selected = await asyncio.to_thread(select_upload_frames, upload)
    video_path = f"{item_id}/video/{video_id}{upload.extension}"
    written: list[str] = []
    frames: list[dict] = []
    try:
        await storage.upload(video_path, upload.content, upload.content_type)
        written.append(video_path)
        for frame in selected:
            if cover is not None and frame.candidate.index == cover.candidate.index:
                continue
            try:
                content = await asyncio.to_thread(normalize_frame, frame.candidate.content)
            except Exception:
                logger.warning("Skipping unreadable video frame index=%d", frame.candidate.index)
                continue
            frame_path = f"{item_id}/video/{video_id}-frame-{len(frames) + 1}.jpg"
            await storage.upload(frame_path, content)
            written.append(frame_path)
            frames.append({
                "path": frame_path,
                "time": round(frame.candidate.time, 2),
                "rank": frame.rank,
                "sharpness": round(frame.candidate.sharpness, 2),
            })
        record = {
            "id": video_id,
            "path": video_path,
            "content_type": upload.content_type,
            "size_bytes": len(upload.content),
            "duration_seconds": round(upload.duration_seconds, 2),
            "frames": frames,
            "cover_frame_path": cover_path,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await update_video(item_id, uid, record)
    except Exception as exc:
        logger.error("Failed to store video for item %s: %s", item_id, exc, exc_info=True)
        try:
            await storage.delete(written)
        except Exception:
            logger.warning("Could not compensate failed video upload for %s", item_id, exc_info=True)
        if isinstance(exc, HTTPException):
            raise
        if isinstance(exc, StorageError):
            raise HTTPException(status_code=502, detail="Could not store video") from exc
        raise HTTPException(status_code=500, detail="Could not save video") from exc

    old_paths = [path for path in item_video_paths(item) if path not in written]
    if old_paths:
        try:
            await storage.delete(old_paths)
        except StorageError:
            logger.warning("Could not remove superseded video for item %s", item_id, exc_info=True)
    logger.info(
        "Stored video for item_id=%s video_id=%s bytes=%d frames=%d",
        item_id,
        video_id,
        len(upload.content),
        len(frames),
    )
    return record


async def remove_item_video(
    item: ItemRecord,
    uid: str,
    *,
    storage: Storage,
    update_video: UpdateItemVideo,
) -> None:
    paths = item_video_paths(item)
    await update_video(item["id"], uid, None)
    if paths:
        try:
            await storage.delete(paths)
        except StorageError:
            logger.warning("Removed video left orphaned storage item_id=%s", item["id"], exc_info=True)


def video_url(item_id: str, video_id: str) -> str:
    # The id is part of the path so a replaced video never reuses a cached signed URL.
    return f"/api/items/{item_id}/video/{video_id}"


def item_video_payload(item: ItemRecord) -> ItemVideo | None:
    video = item_video_record(item)
    if not video:
        return None
    video_id = str(video.get("id") or "video")
    cover_path = video.get("cover_frame_path")
    return ItemVideo(
        id=video_id,
        url=video_url(item["id"], video_id),
        content_type=str(video.get("content_type") or "video/mp4"),
        size_bytes=int(video.get("size_bytes") or 0),
        duration_seconds=float(video.get("duration_seconds") or 0),
        frame_count=len(video.get("frames") or []),
        cover_from_video=bool(cover_path) and cover_path in item_image_paths(item),
    )


def video_cover_paths(item: ItemRecord) -> set[str]:
    """Image paths that are frames from the video rather than real photos."""
    video = item_video_record(item)
    cover_path = video.get("cover_frame_path") if video else None
    return {cover_path} if cover_path else set()


def require_video(item: ItemRecord, video_id: str | None = None) -> dict:
    video = item_video_record(item)
    if not video or (video_id is not None and str(video.get("id")) != video_id):
        raise HTTPException(status_code=404, detail="Video not found")
    return video


_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


def ranged_response(content: bytes, content_type: str, range_header: str | None) -> Response:
    """Serve bytes with single-range support; iOS players request ranges for video."""
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}
    size = len(content)
    match = _RANGE.match((range_header or "").strip())
    if not match or (not match.group(1) and not match.group(2)):
        return Response(content=content, media_type=content_type, headers=headers)
    start_text, end_text = match.groups()
    if start_text:
        start = int(start_text)
        end = min(int(end_text), size - 1) if end_text else size - 1
    else:
        length = int(end_text)
        start = max(0, size - length)
        end = size - 1
    if start >= size or start > end:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return Response(content=content[start:end + 1], status_code=206, media_type=content_type, headers=headers)


async def video_file_response(
    item: ItemRecord,
    video_id: str,
    *,
    storage: Storage,
    range_header: str | None = None,
) -> Response:
    video = require_video(item, video_id)
    path = str(video["path"])
    content_type = str(video.get("content_type") or "video/mp4")
    local = storage.local_path(path)
    if local is not None:
        return FileResponse(local, media_type=content_type, headers={"Cache-Control": "private, max-age=3600"})
    try:
        asset = await storage.read(path)
    except StorageError as exc:
        raise storage_http_exception(
            exc,
            not_found_detail="Video not found in storage",
            fallback_detail="Video temporarily unavailable",
        ) from exc
    return ranged_response(asset.content, content_type, range_header)


async def signed_video_url(item: ItemRecord, video_id: str, *, storage: Storage) -> dict[str, int | str | None]:
    video = require_video(item, video_id)
    try:
        url = await storage.signed_url(str(video["path"]), expires_in=3600)
    except StorageError as exc:
        raise storage_http_exception(
            exc,
            not_found_detail="Video not found in storage",
            fallback_detail="Video URL temporarily unavailable",
        ) from exc
    return {"url": url, "expires_in": 3600 if url else 0}
