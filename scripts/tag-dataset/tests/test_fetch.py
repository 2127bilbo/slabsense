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


class FakeClock:
    """Mutable fake monotonic clock; call it to read, or await .sleep(s) to advance it."""

    def __init__(self, start: float = 0.0):
        self.t = start

    def __call__(self) -> float:
        return self.t

    async def sleep(self, seconds: float) -> None:
        self.t += seconds


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

    result = run(fetch.fetch_one(client, store, "A", "7", fetch.Throttle(1000), sleep))
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

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.Throttle(1000), sleep)) == "gone"
    assert store.has_raw("A") and store.get_raw("A") == (None, None)
    assert slept == [] and len(client.calls) == 1
    assert store.list_failures("fetch") == []


def test_fetch_one_retries_with_backoff_then_succeeds(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    client = ScriptedClient({"A": [TagHttpError(500, "x"), TagHttpError(502, "y"), detail_fixture, score_fixture]})
    slept = []

    async def sleep(s):
        slept.append(s)

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.Throttle(1000), sleep)) == "ok"
    assert slept == [1, 4]
    assert store.list_failures("fetch") == []


def test_fetch_one_gives_up_after_backoff(tmp_path):
    store = make(tmp_path)
    client = ScriptedClient({"A": [TagHttpError(500, "x")] * 4})
    slept = []

    async def sleep(s):
        slept.append(s)

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.Throttle(1000), sleep)) == "failed"
    assert slept == [1, 4, 16]
    assert not store.has_raw("A")
    assert store.list_failures("fetch") == [("A", "", "HTTP 500", 1)]


def test_fetch_one_network_and_decrypt_errors_are_retried(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    client = ScriptedClient({"A": [aiohttp.ClientConnectionError("down"), detail_fixture,
                                   ValueError("not a TAG payload"), detail_fixture, score_fixture]})

    async def sleep(s):
        pass

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.Throttle(1000), sleep)) == "ok"


def test_fetch_one_429_is_throttled_without_backoff_or_failure(tmp_path):
    store = make(tmp_path)
    client = ScriptedClient({"A": [TagHttpError(429, "Too Many Requests")]})
    slept = []

    async def sleep(s):
        slept.append(s)

    throttle = fetch.Throttle(1000, sleep=sleep)
    assert run(fetch.fetch_one(client, store, "A", "9", throttle, sleep)) == "throttled"
    assert throttle.trips == 1
    assert slept == []
    assert store.list_failures("fetch") == []
    assert not store.has_raw("A")


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
    assert counts == {"ok": 1, "gone": 1, "failed": 1, "skipped": 1, "throttled": 0}
    assert ("detail", "HAVE") not in client.calls


def test_throttle_spaces_calls():
    async def go():
        throttle = fetch.Throttle(per_second=50)   # 20 ms apart
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        for _ in range(6):
            await throttle.wait()
        return loop.time() - t0

    assert run(go()) >= 0.09


def test_throttle_trip_doubles_cooldown_and_succeed_resets():
    clock = FakeClock(1000.0)
    throttle = fetch.Throttle(per_second=1000, cooldown_start=300.0, cooldown_max=900.0, clock=clock)

    throttle.trip()
    assert throttle.cooldown_until == 1300.0
    assert throttle.current_cooldown == 600.0
    assert throttle.trips == 1

    # a second trip while the cooldown is still active extends nothing
    throttle.trip()
    assert throttle.cooldown_until == 1300.0
    assert throttle.current_cooldown == 600.0
    assert throttle.trips == 1

    throttle.succeed()
    assert throttle.current_cooldown == 300.0

    # repeated trips (each after the previous cooldown has lapsed) cap at cooldown_max
    for _ in range(6):
        clock.t = throttle.cooldown_until + 1
        throttle.trip()
    assert throttle.current_cooldown == 900.0


def test_throttle_wait_sleeps_out_cooldown_then_applies_spacing():
    clock = FakeClock(1000.0)
    sleeps = []

    async def sleep(s):
        sleeps.append(s)
        clock.t += s

    throttle = fetch.Throttle(per_second=2, cooldown_start=300.0, clock=clock, sleep=sleep)  # 0.5s spacing
    throttle.trip()  # cooldown_until = 1300.0

    run(throttle.wait())
    assert sleeps == [300.0]  # slept the remaining cooldown, clock now 1300.0

    run(throttle.wait())
    assert sleeps[-1] == 0.5  # normal spacing applied after the cooldown ended


def test_fetch_one_429_then_success_reports_throttled(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    client = ScriptedClient({"A": [TagHttpError(429, "Too Many Requests"), detail_fixture, score_fixture]})
    clock = FakeClock()

    async def sleep(s):
        clock.t += s

    counts = run(fetch.run_fetch(client, store, [("A", "7")], rate=1000, workers=1, sleep=sleep,
                                 cooldown_start=300.0, cooldown_max=900.0, clock=clock))
    assert counts == {"ok": 1, "gone": 0, "failed": 0, "skipped": 0, "throttled": 1}
    assert store.has_raw("A")


def test_run_fetch_parks_cert_throttled_more_than_20_times(tmp_path):
    store = make(tmp_path)
    client = ScriptedClient({"B": [TagHttpError(429, "Too Many Requests")] * 20})
    clock = FakeClock()

    async def sleep(s):
        clock.t += s

    counts = run(fetch.run_fetch(client, store, [("B", "9")], rate=1000, workers=1, sleep=sleep,
                                 cooldown_start=300.0, cooldown_max=900.0, clock=clock))
    assert counts["failed"] == 1
    assert counts["throttled"] == 20
    assert store.list_failures("fetch") == [("B", "", "HTTP 429 x20", 1)]
