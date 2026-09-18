"""
pytest configuration and shared fixtures for REACT-X backend tests.
"""
import pytest
import pytest_asyncio
import asyncio
import os

# Use in-memory SQLite for all tests
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SECRET_KEY",   "test-secret-key-for-pytest")
os.environ.setdefault("LOG_LEVEL",    "WARNING")


@pytest.fixture(scope="session")
def event_loop():
    """Use a single event loop for all async tests in a session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
