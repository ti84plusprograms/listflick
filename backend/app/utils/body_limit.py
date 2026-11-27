"""Reject oversized video uploads from their Content-Length, before the body is read.

FastAPI parses a multipart form (spooling file parts to disk) before any dependency runs, so
the auth check and the streaming size check in video_service only happen after the whole
upload has arrived. This ASGI middleware turns away a declared-too-large video request up front.
"""

from __future__ import annotations

import json
import re
from typing import Any, Awaitable, Callable

from app.config import settings

_VIDEO_UPLOAD_PATHS = (
    re.compile(r"^/api/items/upload-video/?$"),
    re.compile(r"^/api/items/[^/]+/video/?$"),
)
# Room for the candidate frames (up to 24 x 4 MB) and multipart overhead on top of the video.
_FRAMES_AND_OVERHEAD_BYTES = 24 * 4 * 1024 * 1024 + 2 * 1024 * 1024

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


def video_request_body_limit() -> int:
    return settings.max_video_upload_mb * 1024 * 1024 + _FRAMES_AND_OVERHEAD_BYTES


def _is_video_upload(scope: Scope) -> bool:
    if scope.get("type") != "http" or scope.get("method") not in {"POST", "PUT"}:
        return False
    path = scope.get("path") or ""
    return any(pattern.match(path) for pattern in _VIDEO_UPLOAD_PATHS)


def _content_length(scope: Scope) -> int | None:
    for name, value in scope.get("headers") or []:
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


class VideoUploadSizeLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if _is_video_upload(scope):
            length = _content_length(scope)
            if length is not None and length > video_request_body_limit():
                body = json.dumps(
                    {"detail": f"Video must be under {settings.max_video_upload_mb} MB"}
                ).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                            (b"connection", b"close"),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)
