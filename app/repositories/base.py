"""Base for future repositories; SQL methods do not own transactions."""

import sqlite3


class Repository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
