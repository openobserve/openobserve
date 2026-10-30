"""Dashboard panels running CTE / subquery queries that contain `match_all`.

Scope is deliberately narrow: every case here puts a `match_all` predicate
*inside* a nested query block — a `WITH … AS (…)` body or a derived table in
FROM position — and then runs it as a real dashboard panel.

Why that shape specifically. The `match_all` + FST projection rewrite fixed in
#13808 has to preserve the projection of the block the predicate sits in. When
that block is the whole statement, the projection is obvious. When it is a CTE
body feeding a JOIN, a window, or a four-branch UNION ALL, the rewrite has to
preserve the *CTE's* output schema while the outer query reads different columns
from it — and that is where it went wrong. #13824 added 70 sentinel queries to
pin the behaviour down; 65 of them are nested-query shapes, and this module runs
every one of them through the dashboard panel path.

The corpus is shared with the query-agent suite, which verifies the same SQL via
the Logs path (`search_type=ui`). This module verifies the dashboard path
(`search_type=dashboards`), so a rewrite that fires on only one of the two
routes shows up as a diff rather than passing quietly on both.

Cases are discovered by classifying the SQL, not by a hand-written ID list, so a
new CTE combination added to the corpus is picked up without touching this file.
Runs on a branch without #13824 simply discover fewer cases.
"""
from __future__ import annotations

import logging

import pytest

from support.factories import panel_payload
from support.panel_queries import (
    BASE_TS,
    add_panel,
    discover_nested_match_all,
    drop_panel,
    expected_non_null_columns,
    panel_axes,
    panel_type_for,
    query_window,
    render_sql,
    result_set_mismatch,
    row_count_is_comparable,
)

logger = logging.getLogger(__name__)

# full_text_search holds the #13824 sentinels; cte_subquery holds the older
# nested-query cases that also happen to use match_all.
_CATEGORIES = ("full_text_search", "cte_subquery")

_CASES = discover_nested_match_all(_CATEGORIES)

# id reads as e.g. `Q1022-cte1_union_cdist_4ma`, so a failure names the
# combination without anyone opening the corpus.
_IDS = [f"{qid}-{family}" for qid, family, _ in _CASES]


def _query_number(query_id: str) -> int:
    """Numeric part of a `Qnnn` id, or -1 for anything that does not parse."""
    try:
        return int(query_id.lstrip("Qq"))
    except ValueError:
        return -1


# #13824 adds Q1003–Q1072. Q1000–Q1002 predate it, so the threshold is 1003.
# Used to gate the corpus-breadth guard: on a branch without the sentinels the
# corpus genuinely lacks whole families, and that is not a regression.
_HAS_SENTINELS = any(_query_number(qid) >= 1003 for qid, _, _ in _CASES)



def test_corpus_is_present():
    """Guard: a silently empty corpus would turn this whole module into a no-op.

    Skips (rather than fails) when the catalog predates #13824, but never lets
    an all-green run be mistaken for coverage that did not happen.
    """
    if not _CASES:
        pytest.skip("no nested match_all queries in the catalog — predates PR #13824")
    logger.info("discovered %d nested match_all queries", len(_CASES))


def test_all_nested_families_represented():
    """The discovered set spans every combination this module claims to cover.

    If a corpus change quietly drops, say, every cross-stream CTE join, the
    per-query tests all still pass — this is what notices.
    """
    if not _HAS_SENTINELS:
        pytest.skip(
            f"catalog predates PR #13824 ({len(_CASES)} nested cases, no Q1003+) — "
            "whole combination families are legitimately absent"
        )

    families = {family for _, family, _ in _CASES}
    tags = {tag for family in families for tag in family.split("_")}

    for required in ("union", "join", "window", "not", "hist", "cdist", "case"):
        assert required in tags, (
            f"no nested match_all query combines with '{required}' — "
            f"corpus coverage regressed; found tags: {sorted(tags)}"
        )
    assert any(f.startswith("cte") for f in families), "no CTE-based cases discovered"
    assert any("derived" in f for f in families), "no derived-table cases discovered"


@pytest.mark.parametrize(("query_id", "family", "query"), _CASES, ids=_IDS)
def test_nested_match_all_panel(
    client, panel_dashboard, panel_streams, query_id, family, query
):
    """A CTE/subquery `match_all` query runs correctly as a dashboard panel.

    Three assertions carry the weight:

    * the cardinality matches the DuckDB oracle exactly;
    * every cell matches the oracle (float-tolerant, order-insensitive) — without
      this, a regression returning right-shaped rows with wrong values passes;
    * the projection survives — every column the oracle proves is non-NULL appears
      somewhere in the result set. This is what #13808 broke: 200 OK, columns
      silently dropped.

    Histogram cases skip the first two: their bucket timestamps are anchored to a
    BASE_TS that differs between the oracle run and this one.
    """
    stream, stream2 = panel_streams
    sql = render_sql(query, stream, stream2)
    start_time, end_time = query_window(query, BASE_TS)
    x_alias, y_alias = panel_axes(query)

    panel = panel_payload(
        stream=stream,
        sql=sql,
        x_alias=x_alias,
        y_alias=y_alias,
        title=f"{query_id} — {family}",
        panel_type=panel_type_for(family, query),
    )
    add_panel(client, panel_dashboard, panel)

    try:
        resp = client.search.dashboard_panel(
            sql, dashboard_id=panel_dashboard, start_time=start_time, end_time=end_time
        )
        assert resp.status_code == 200, (
            f"{query_id} ({family}) failed via search_type=dashboards: "
            f"{resp.status_code} {resp.text[:500]}"
        )

        hits = resp.json().get("hits", [])
        expected_rows = len(query["expected"]["results"])

        if row_count_is_comparable(query_id, query):
            assert len(hits) == expected_rows, (
                f"{query_id} ({family}): dashboard path returned {len(hits)} rows, "
                f"oracle expects {expected_rows}"
            )
            # Row count and projection alone would pass a regression that returned
            # correctly-shaped rows holding wrong values — which is the bug class
            # this corpus exists to pin down. Compare the cells too.
            mismatch = result_set_mismatch(hits, query)
            assert mismatch is None, (
                f"{query_id} ({family}): dashboard path disagrees with the oracle — {mismatch}"
            )
        elif expected_rows:
            assert hits, f"{query_id} ({family}) returned no rows through the dashboard path"

        # Projection is a property of the result set, not of each row: OO drops
        # NULL-valued keys per row, so a column legitimately missing from some
        # rows is not a dropped projection. It is dropped only if it is absent
        # from every row.
        if hits:
            present = set().union(*(set(hit) for hit in hits))
            missing = [c for c in expected_non_null_columns(query) if c not in present]
            assert not missing, (
                f"{query_id} ({family}): projection dropped {missing} — "
                f"result set carried only {sorted(present)}"
            )
    finally:
        drop_panel(client, panel_dashboard, panel["id"])


@pytest.mark.parametrize(
    ("query_id", "family", "query"),
    # The dashboard-vs-Logs comparison is the expensive assertion (two searches
    # per case), so it runs on the combinations most likely to diverge rather
    # than on all of them: anything where the CTE feeds a second operator.
    [c for c in _CASES if any(t in c[1] for t in ("union", "join", "window", "not"))],
    ids=[
        f"{qid}-{family}"
        for qid, family, _ in _CASES
        if any(t in family for t in ("union", "join", "window", "not"))
    ],
)
def test_nested_match_all_agrees_with_logs_path(
    client, panel_dashboard, panel_streams, query_id, family, query
):
    """The same nested query returns identical rows via Logs and via a dashboard.

    `search_type=ui` and `search_type=dashboards` take different routes into the
    engine. If the FST rewrite fires on one and not the other, the result sets
    diverge here even though both calls return 200.
    """
    stream, stream2 = panel_streams
    sql = render_sql(query, stream, stream2)
    start_time, end_time = query_window(query, BASE_TS)

    body = {
        "query": {
            "sql": sql,
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": 500,
        }
    }
    logs_resp = client.post("_search?type=logs&search_type=ui", json=body)
    assert logs_resp.status_code == 200, (
        f"{query_id} ({family}) failed on the Logs path: "
        f"{logs_resp.status_code} {logs_resp.text[:300]}"
    )

    dash_resp = client.search.dashboard_panel(
        sql, dashboard_id=panel_dashboard, start_time=start_time, end_time=end_time
    )
    assert dash_resp.status_code == 200, (
        f"{query_id} ({family}) failed on the dashboard path: "
        f"{dash_resp.status_code} {dash_resp.text[:300]}"
    )

    columns = query["expected"]["columns"]

    def _normalise(hits: list[dict]) -> list[list[str]]:
        return sorted([str(h.get(c, "")) for c in columns] for h in hits)

    logs_rows = _normalise(logs_resp.json().get("hits", []))
    dash_rows = _normalise(dash_resp.json().get("hits", []))
    assert logs_rows == dash_rows, (
        f"{query_id} ({family}): results diverge between search_type=ui and "
        f"search_type=dashboards — Logs returned {len(logs_rows)} rows, "
        f"dashboard returned {len(dash_rows)}"
    )
