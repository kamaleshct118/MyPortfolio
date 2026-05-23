import secrets
from fastapi import Header, HTTPException, status
import app.config as config

# In-memory session store for validated admin tokens
# Since there is only one admin, this is highly efficient and secure.
ACTIVE_SESSIONS = set()

def validate_key(submitted_key: str) -> str:
    """
    Validates the admin secret key against the configured key.
    If valid, generates and returns a new session token.
    """
    if submitted_key == config.ADMIN_SECRET_KEY:
        token = secrets.token_hex(32)
        ACTIVE_SESSIONS.add(token)
        return token
    return ""

def verify_token(token: str) -> bool:
    """
    Checks if a session token is active.
    """
    return token in ACTIVE_SESSIONS

def invalidate_token(token: str):
    """
    Removes a session token, logging the admin out.
    """
    if token in ACTIVE_SESSIONS:
        ACTIVE_SESSIONS.remove(token)

async def require_admin(authorization: str = Header(None)):
    """
    FastAPI dependency to secure admin CRUD routes.
    Checks the Bearer token in the Authorization header.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing"
        )
    
    # Expecting format: Bearer <token>
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization format. Use 'Bearer <token>'"
        )
        
    token = parts[1]
    if not verify_token(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token"
        )
    
    return True
