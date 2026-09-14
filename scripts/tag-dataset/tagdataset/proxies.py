"""Proxy rotation for distributed fetching across multiple IPs."""
from __future__ import annotations

import asyncio
import itertools
from dataclasses import dataclass
from pathlib import Path

import aiohttp

from .tagapi import TagClient


@dataclass
class Proxy:
    host: str
    port: int
    user: str
    password: str

    @property
    def url(self) -> str:
        return f"http://{self.user}:{self.password}@{self.host}:{self.port}"

    def __str__(self) -> str:
        return f"{self.host}:{self.port}"


def load_proxies(path: str | Path) -> list[Proxy]:
    """Load proxies from file. Format: host:port:user:pass per line."""
    proxies = []
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(":")
        if len(parts) >= 4:
            host, port, user, password = parts[0], int(parts[1]), parts[2], ":".join(parts[3:])
            proxies.append(Proxy(host, port, user, password))
    return proxies


class ProxyPool:
    """Manages multiple aiohttp sessions with rotating proxies."""

    def __init__(self, proxies: list[Proxy]):
        self.proxies = proxies
        self._sessions: list[aiohttp.ClientSession] = []
        self._clients: list[TagClient] = []
        self._cycle = itertools.cycle(range(len(proxies)))
        self._lock = asyncio.Lock()

    async def __aenter__(self) -> "ProxyPool":
        connector_kwargs = {"limit_per_host": 10, "force_close": False}
        for proxy in self.proxies:
            connector = aiohttp.TCPConnector(**connector_kwargs)
            # Use cookie jar to persist session cookies (may help with rate limiting)
            cookie_jar = aiohttp.CookieJar()
            session = aiohttp.ClientSession(connector=connector, cookie_jar=cookie_jar)
            self._sessions.append(session)
            self._clients.append(TagClient(session, proxy_url=proxy.url))
        return self

    async def __aexit__(self, *args):
        for session in self._sessions:
            await session.close()

    def get_client(self, index: int) -> TagClient:
        """Get client by index (for worker assignment)."""
        return self._clients[index % len(self._clients)]

    async def next_client(self) -> tuple[int, TagClient]:
        """Get next client in rotation."""
        async with self._lock:
            idx = next(self._cycle)
        return idx, self._clients[idx]

    def __len__(self) -> int:
        return len(self.proxies)
