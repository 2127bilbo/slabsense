"""TAG public API: request signing, response decryption, async client (spec §3)."""
from __future__ import annotations

import hashlib
import json

import aiohttp
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

BASE_URL = "https://api.taggrading.com"
SIGNING_SECRET = "TZY0j76MKF1AA0QK0ppAGySAaCNgKG"
AES_KEY_STRING = "K5ucGQIf7vigW9ITOXLak5MjSIxxsgixqj"

HEADERS_BASE = {
    "Accept": "application/json, text/plain, */*",
    "Pragma": "no-cache",
    "Content-Type": "application/json",
    "Origin": "https://my.taggrading.com",
    "Referer": "https://my.taggrading.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

TIMEOUT = aiohttp.ClientTimeout(total=30)


def make_key(*args) -> str:
    payload = SIGNING_SECRET + ":" + ",".join(str(a) for a in args)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def decrypt(body: str) -> dict:
    """Return the JSON payload of a TAG response.

    Responses are either plain JSON or `<iv_hex>:<ciphertext_hex>` (AES-CBC).
    Anything else (an HTML page, an error string) raises ValueError.
    """
    text = body.strip()
    if text.startswith("{") or text.startswith("["):
        return json.loads(text)
    if ":" not in text:
        raise ValueError(f"not a TAG payload: {text[:60]!r}")
    iv_hex, c_hex = text.split(":", 1)
    key = hashlib.sha256(AES_KEY_STRING.encode()).digest()
    cipher = AES.new(key, AES.MODE_CBC, bytes.fromhex(iv_hex))
    return json.loads(unpad(cipher.decrypt(bytes.fromhex(c_hex)), 16).decode("utf-8"))


class TagHttpError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


class TagClient:
    def __init__(self, session: aiohttp.ClientSession):
        self.session = session

    async def _get(self, url: str, key: str) -> dict:
        headers = {**HEADERS_BASE, "x-tag-key": key}
        async with self.session.get(url, headers=headers, timeout=TIMEOUT) as r:
            text = await r.text()
            if r.status != 200:
                raise TagHttpError(r.status, text[:200])
            return decrypt(text)

    async def detail(self, cert: str) -> dict:
        return await self._get(f"{BASE_URL}/graded-cards/public/detail/{cert}", make_key(cert))

    async def score(self, cert: str) -> dict:
        return await self._get(
            f"{BASE_URL}/graded-cards/public/score/{cert}?includeAnnotation=true",
            make_key(cert, "true"),
        )
