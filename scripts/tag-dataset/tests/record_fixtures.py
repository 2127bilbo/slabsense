"""One-off: record real TAG responses for cert C1240631 as test fixtures.

Run from scripts/tag-dataset with the venv active:
    python tests/record_fixtures.py
"""
import asyncio
import json
from pathlib import Path

import aiohttp

from tagdataset import tagapi

CERT = "C1240631"
OUT = Path(__file__).parent / "fixtures"


async def main():
    OUT.mkdir(exist_ok=True)
    async with aiohttp.ClientSession() as session:
        url = f"{tagapi.BASE_URL}/graded-cards/public/detail/{CERT}"
        headers = {**tagapi.HEADERS_BASE, "x-tag-key": tagapi.make_key(CERT)}
        async with session.get(url, headers=headers, timeout=tagapi.TIMEOUT) as r:
            assert r.status == 200, r.status
            encrypted = await r.text()
        (OUT / f"{CERT}.encrypted.txt").write_text(encrypted, encoding="utf-8")
        client = tagapi.TagClient(session)
        detail = await client.detail(CERT)
        score = await client.score(CERT)
    (OUT / f"{CERT}.detail.json").write_text(json.dumps(detail, indent=1), encoding="utf-8")
    (OUT / f"{CERT}.score.json").write_text(json.dumps(score, indent=1), encoding="utf-8")
    print("recorded", CERT, "dings:", detail["data"]["dingsJSON"]["DingsCount"])


if __name__ == "__main__":
    asyncio.run(main())
