"""Grade keys, eras, and the dataset composition rule (spec §2, §5.1)."""
from __future__ import annotations

FULL_GRADE_KEYS = frozenset({"1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "5.5", "10P"})
CAPPED_GRADE_KEYS = frozenset({"6", "6.5", "7", "7.5", "8", "8.5", "9", "10"})
SKIP_GRADE_KEYS = frozenset({"VA"})

CAP_PER_GRADE = 1500
ERA_FLOOR = 150
ERAS = ("1999-2003", "2004-2010", "2011-2016", "2017-2022", "2023+")


def era_for_year(year) -> str:
    y = int(year)
    if y <= 2003:
        return "1999-2003"
    if y <= 2010:
        return "2004-2010"
    if y <= 2016:
        return "2011-2016"
    if y <= 2022:
        return "2017-2022"
    return "2023+"


def grade_num(key: str) -> float:
    return 10.0 if key == "10P" else float(key)


def is_pristine(key: str) -> bool:
    return key == "10P"


def allocate(avail: dict[str, int], cap: int = CAP_PER_GRADE, floor: int = ERA_FLOOR) -> dict[str, int]:
    """Split `cap` picks across eras.

    Each era first gets min(available, floor). The remainder is handed out
    proportionally to the spare availability of each era, repeatedly, until
    the cap is met or nothing is left to give. Deterministic.
    """
    total = sum(avail.values())
    if total <= cap:
        return dict(avail)
    quota = {era: min(n, floor) for era, n in avail.items()}
    remaining = cap - sum(quota.values())
    while remaining > 0:
        spare = {era: avail[era] - quota[era] for era in avail if avail[era] > quota[era]}
        if not spare:
            break
        spare_total = sum(spare.values())
        adds = {era: min(s, int(remaining * s / spare_total)) for era, s in spare.items()}
        if sum(adds.values()) == 0:
            top = max(sorted(spare), key=spare.get)
            adds = {top: 1}
        for era, a in adds.items():
            quota[era] += a
            remaining -= a
    return quota
