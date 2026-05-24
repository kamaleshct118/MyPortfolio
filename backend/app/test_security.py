import os
import sys
import unittest
from unittest.mock import patch

# Setup sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class TestSecurityHardening(unittest.TestCase):
    def test_rate_limiter_chat(self):
        from app.rate_limiter import InMemoryRateLimiter
        
        # Test rate limiter with a limit of 3 requests per 2 seconds
        limiter = InMemoryRateLimiter(requests_limit=3, window_seconds=2)
        ip = "192.168.1.100"
        
        # First 3 requests should be allowed
        self.assertTrue(limiter.is_allowed(ip))
        self.assertTrue(limiter.is_allowed(ip))
        self.assertTrue(limiter.is_allowed(ip))
        
        # 4th request within the window should be blocked
        self.assertFalse(limiter.is_allowed(ip))
        
        # Different IP should be allowed
        self.assertTrue(limiter.is_allowed("192.168.1.101"))

    @patch.dict(os.environ, {"ADMIN_SECRET_KEY": "testkey123", "ALLOWED_ORIGINS": "http://example.com, https://myportfolio.com"})
    def test_config_loading(self):
        # Force reload of config module to read the patched environment
        if "app.config" in sys.modules:
            del sys.modules["app.config"]
        
        import app.config as config
        self.assertEqual(config.ADMIN_SECRET_KEY, "testkey123")
        self.assertEqual(config.ALLOWED_ORIGINS, ["http://example.com", "https://myportfolio.com"])

    @patch.dict(os.environ, {"ADMIN_SECRET_KEY": ""})
    def test_missing_admin_key_raises_error(self):
        if "app.config" in sys.modules:
            del sys.modules["app.config"]
            
        with self.assertRaises(ValueError) as context:
            import app.config as config
        self.assertIn("ADMIN_SECRET_KEY is not set", str(context.exception))

if __name__ == "__main__":
    unittest.main()
