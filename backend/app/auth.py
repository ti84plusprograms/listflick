import logging
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import auth

security = HTTPBearer(auto_error=False)
logger = logging.getLogger("uvicorn.error")

def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> str:
    """
    Verify the Firebase ID token and return the user's UID.
    """
    if credentials is None:
        logger.warning("Firebase ID token verification failed: missing bearer credentials")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token, check_revoked=True)
        uid = decoded_token.get("uid")
        if not uid:
            raise ValueError("No UID found in token")
        return uid
    except Exception as exc:
        # Do not return Firebase/provider exception text to the client. It can
        # disclose token state, project details, or implementation internals.
        logger.warning(
            "Firebase ID token verification failed exception_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
