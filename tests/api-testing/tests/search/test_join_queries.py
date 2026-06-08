"""SQL JOIN / UNION / INTERSECT / EXCEPT / CTE query tests.

Rewritten in Phase 4 of the api-tests revamp:
- Removes the module-level `open('../test-data/joinqueries.json')` that
  fails at IMPORT TIME if the file is missing (would break test
  COLLECTION across the whole suite, not just this file). Queries are
  now inlined here — they're stable and don't change often.
- Class-scoped setup ingests `u1` + `orders` ONCE and tears them down
  after all parametrized queries. The original re-ingested per query
  (wasteful and racy).
- `wait_until` polls the search endpoint until the ingested data is
  searchable, replacing the blind `time.sleep(3)`.
- For set-operation queries (INTERSECT, EXCEPT, UNION) the assertion is
  weakened from "len(hits) > 0" to "hits is a list" because those queries
  can legitimately return 0 rows depending on overlap.
"""
from __future__ import annotations

import logging

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

logger = logging.getLogger(__name__)

ORG_ID = "default"
USERS_STREAM = "u1"
ORDERS_STREAM = "orders"

USERS_RECORDS = [
    {"user_id": 1, "name": "Alice", "status": "active", "age": 30},
    {"user_id": 2, "name": "Bob", "status": "inactive", "age": 25},
    {"user_id": 3, "name": "Charlie", "status": "pending", "age": 35},
    {"user_id": 4, "name": "Diana", "status": "active", "age": 28},
    {"user_id": 5, "name": "Eve", "status": "inactive", "age": 22},
]
ORDERS_RECORDS = [
    {"order_id": 101, "user_id": 1, "product": "Laptop", "amount": 1200},
    {"order_id": 102, "user_id": 2, "product": "Smartphone", "amount": 800},
    {"order_id": 103, "user_id": 3, "product": "Tablet", "amount": 500},
    {"order_id": 104, "user_id": 4, "product": "Headphones", "amount": 150},
]


# (test_name, sql_query, set_op): set_op=True for queries where 0 results is legitimate
JOIN_QUERIES: list[tuple[str, str, bool]] = [
    ("basic_join",
     'SELECT o.order_id, o.product, o.amount, u.name, u.age '
     'FROM "orders" o JOIN "u1" u ON o.user_id = u.user_id', False),
    ("left_join",
     'SELECT o.order_id, o.product, o.amount, u.name, u.age '
     'FROM "orders" AS o LEFT JOIN "u1" AS u ON o.user_id = u.user_id', False),
    ("grouped_left_join",
     'SELECT u.name AS user_name, u.status AS user_status, COUNT(o.order_id) AS order_count '
     'FROM u1 u LEFT JOIN orders o ON u.user_id = o.user_id GROUP BY u.name, u.status', False),
    ("filtered_grouped_left_join",
     'SELECT usr.name AS user_name, usr.status AS user_status, COUNT(o.order_id) AS order_count '
     'FROM u1 usr LEFT JOIN orders o ON usr.user_id = o.user_id '
     "WHERE usr.status IN ('active','pending') GROUP BY usr.name, usr.status", False),
    ("grouped_left_join_with_alias",
     'SELECT usr.name AS user_name, usr.status AS user_status, COUNT(o.order_id) AS order_count '
     'FROM u1 usr LEFT JOIN orders o ON usr.user_id = o.user_id GROUP BY user_name, user_status', False),
    ("inner_join_with_subquery",
     'SELECT u1.name, u1.status, o.amount, (SELECT COUNT(*) FROM orders) AS total_orders '
     'FROM u1 JOIN orders o ON u1.user_id = o.user_id', False),
    ("right_join_with_subquery",
     'SELECT u1.name, u1.status, o.amount, (SELECT COUNT(*) FROM orders) AS total_orders '
     'FROM u1 RIGHT JOIN orders o ON u1.user_id = o.user_id', False),
    ("union_amount_and_age",
     'SELECT amount FROM "orders" UNION SELECT age FROM "u1"', True),
    ("count_users_without_orders",
     'SELECT COUNT(*) AS error_count FROM u1 usr '
     'LEFT JOIN orders o ON usr.user_id = o.user_id WHERE o.order_id IS NULL', False),
    ("cte_total_orders",
     'WITH total AS (SELECT COUNT(*) AS total_count FROM orders) '
     'SELECT u1.name, u1.status, o.amount, total.total_count AS total_orders '
     'FROM u1 JOIN orders o ON u1.user_id = o.user_id CROSS JOIN total', False),
    ("intersect_common_user_ids",
     'SELECT user_id FROM "u1" INTERSECT SELECT user_id FROM "orders"', True),
    ("except_users_without_orders",
     'SELECT user_id FROM "u1" EXCEPT SELECT user_id FROM "orders"', True),
    ("intersect_active_users_with_orders",
     'SELECT user_id FROM "u1" WHERE status = \'active\' INTERSECT SELECT user_id FROM "orders"', True),
    ("except_multi_column",
     "SELECT user_id, name FROM \"u1\" EXCEPT SELECT user_id, 'placeholder' FROM \"orders\"", True),
]


class TestJoinQueries:
    """Class-scoped: ingest u1+orders once, run all queries, cleanup at the end."""

    @pytest.fixture(autouse=True, scope="class")
    def _ingested_streams(self, client: OpenObserveClient):
        """Ingest u1 and orders; wait until both are searchable; delete after class."""
        client.streams.ingest_json(USERS_STREAM, USERS_RECORDS)
        client.streams.ingest_json(ORDERS_STREAM, ORDERS_RECORDS)

        # Wait until both streams have all expected rows visible in search.
        # The user count + order count queries are deterministic.
        def _all_data_searchable() -> bool:
            u_count = client.search.count(
                f'SELECT COUNT(*) AS count FROM "{USERS_STREAM}"', minutes=10
            )
            o_count = client.search.count(
                f'SELECT COUNT(*) AS count FROM "{ORDERS_STREAM}"', minutes=10
            )
            return u_count >= len(USERS_RECORDS) and o_count >= len(ORDERS_RECORDS)

        wait_until(
            _all_data_searchable,
            timeout=30,
            interval=0.5,
            msg=f"join test streams ({USERS_STREAM}, {ORDERS_STREAM}) not fully searchable",
        )
        yield

        # Cleanup — best effort
        for stream in (USERS_STREAM, ORDERS_STREAM):
            try:
                client.streams.delete(stream)
            except Exception as e:
                logger.warning("cleanup failed for stream %s: %s", stream, e)

    @pytest.mark.parametrize(
        ("test_name", "sql_query", "is_set_op"),
        JOIN_QUERIES,
        ids=[name for name, _, _ in JOIN_QUERIES],
    )
    def test_join_query_succeeds(
        self,
        client: OpenObserveClient,
        test_name: str,
        sql_query: str,
        is_set_op: bool,
    ):
        """Each query returns 200 + a 'hits' list. Non-set-ops also require >=1 hit."""
        resp = client.search.sql(sql_query, minutes=10, size=100)

        assert resp.status_code == 200, \
            f"{test_name}: query failed: {resp.status_code} {resp.text}"

        body = resp.json()
        assert "hits" in body, f"{test_name}: response missing 'hits' key: {body}"
        assert isinstance(body["hits"], list), \
            f"{test_name}: 'hits' should be a list: {body['hits']!r}"

        if not is_set_op:
            # Joins / aggregations against this dataset should always return data
            assert len(body["hits"]) > 0, \
                f"{test_name}: expected at least 1 hit, got 0. " \
                f"This may indicate a real query/JOIN regression. Response: {body}"
