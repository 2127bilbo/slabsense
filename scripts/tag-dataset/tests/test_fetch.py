import asyncio

import aiohttp

from tagdataset import fetch
from tagdataset.store import Store
from tagdataset.tagapi import TagHttpError


class ScriptedClient:
    """detail()/score() pop the next scripted outcome for that cert.

    An outcome is a dict (returned) or an Exception (raised).
    """

    def __init__(self, script: dict[str, list]):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls: list[tuple[str, str]] = []

    async def _next(self, kind, cert):
        self.calls.append((kind, cert))
        outcome = self.script[cert].pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    async def detail(self, cert):
        return await self._next("detail", cert)

    async def score(self, cert):
        return await self._next("score", cert)


def run(coro):
    return asyncio.run(coro)


def make(tmp_path):
    return Store(str(tmp_path / "t.sqlite"))


def test_fetch_one_ok(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    client = ScriptedClient({"A": [detail_fixture, score_fixture]})
    slept = []

    async def sleep(s):
        slept.append(s)

    result = run(fetch.fetch_one(client, store, "A", "7", fetch.RateLimiter(1000), sleep))
    assert result == "ok"
    assert store.get_raw("A") == (detail_fixture, score_fixture)
    assert store.grade_key_for("A") == "7"
    assert slept == []


def test_fetch_one_404_is_gone_without_retry(tmp_path):
    store = make(tmp_path)
    client = ScriptedClient({"A": [TagHttpError(404, "Not Found")]})
    slept = []

    async def sleep(s):
        slept.append(s)

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.RateLimiter(1000), sleep)) == "gone"
    assert store.has_raw("A") and store.get_raw("A") == (None, None)
    assert slept == [] and len(client.calls) == 1
    assert store.list_failures("fetch") == []


def test_fetch_one_retries_with_backoff_then_succeeds(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    client = ScriptedClient({"A": [TagHttpError(500, "x"), TagHttpError(502, "y"), detail_fixture, score_fixture]})
    slept = []

    async def sleep(s):
        slept.append(s)

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.RateLimiter(1000), sleep)) == "ok"
    assert slept == [1, 4]
    assert store.list_failures("fetch") == []


def test_fetch_one_gives_up_after_backoff(tmp_path):
    store = make(tmp_path)
    client = ScriptedClient({"A": [TagHttpError(500, "x")] * 4})
    slept = []

    async def sleep(s):
        slept.append(s)

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.RateLimiter(1000), sleep)) == "failed"
    assert slept == [1, 4, 16]
    assert not store.has_raw("A")
    assert store.list_failures("fetch") == [("A", "", "HTTP 500", 1)]


def test_fetch_one_network_and_decrypt_errors_are_retried(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    client = ScriptedClient({"A": [aiohttp.ClientConnectionError("down"), detail_fixture,
                                   ValueError("not a TAG payload"), detail_fixture, score_fixture]})

    async def sleep(s):
        pass

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.RateLimiter(1000), sleep)) == "ok"


def test_run_fetch_skips_existing_and_counts(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    store.put_raw("HAVE", "9", detail_fixture, score_fixture, 200, None)
    client = ScriptedClient({
        "A": [detail_fixture, score_fixture],
        "B": [TagHttpError(403, "Forbidden")],
        "C": [TagHttpError(500, "x")] * 4,
    })

    async def sleep(s):
        pass

    counts = run(fetch.run_fetch(client, store, [("HAVE", "9"), ("A", "7"), ("B", "9"), ("C", "9")],
                                 rate=1000, workers=3, sleep=sleep))
    assert counts == {"ok": 1, "gone": 1, "failed": 1, "skipped": 1}
    assert ("detail", "HAVE") not in client.calls


def test_rate_limiter_spaces_calls():
    async def go():
        limiter = fetch.RateLimiter(per_second=50)   # 20 ms apart
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        for _ in range(6):
            await limiter.wait()
        return loop.time() - t0

    assert run(go()) >= 0.09
