import time
from fastapi import Request, HTTPException, status
from collections import defaultdict

class InMemoryRateLimiter:
    def __init__(self, requests_limit: int, window_seconds: int):
        self.requests_limit = requests_limit
        self.window_seconds = window_seconds
        # Stores client_ip -> list of timestamps of requests
        self.history = defaultdict(list)

    def is_allowed(self, client_ip: str) -> bool:
        now = time.time()
        # Clean up timestamps outside the sliding window
        self.history[client_ip] = [
            t for t in self.history[client_ip]
            if now - t < self.window_seconds
        ]
        
        if len(self.history[client_ip]) < self.requests_limit:
            self.history[client_ip].append(now)
            return True
        return False

# Limit chat to 10 requests per minute per IP to prevent spamming
chat_limiter = InMemoryRateLimiter(requests_limit=10, window_seconds=60)

# Limit login to 5 attempts per minute per IP to prevent brute forcing
login_limiter = InMemoryRateLimiter(requests_limit=5, window_seconds=60)

def rate_limit_chat(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    if not chat_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many queries. Chat limit is 10 requests per minute. Please try again shortly."
        )

def rate_limit_login(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    if not login_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Login limit is 5 attempts per minute. Please try again shortly."
        )
