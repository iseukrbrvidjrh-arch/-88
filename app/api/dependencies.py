"""Request-scoped SQLite connection boundary for later task routes."""

from contextlib import AbstractContextManager
import sqlite3

from fastapi import Request


def get_db_connection(request: Request) -> AbstractContextManager[sqlite3.Connection]:
    """Return a scope; a synchronous route enters it in its own worker thread."""
    return request.app.state.database.connection()
