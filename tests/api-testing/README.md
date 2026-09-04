# OpenObserve API Tests

End-to-end pytest suite against the OpenObserve REST API. Runs in CI on every
PR (`.github/workflows/api-testing.yml`); also runnable locally.

## Quick start

```bash
# one-time setup
brew install rye           # or: curl -sSf https://rye.astral.sh/get | bash
rye sync                   # install Python + deps from requirements.lock
cargo build                # build the OO debug binary (~10 min first time)

# every run
ZO_ROOT_USER_EMAIL=root@example.com \
ZO_ROOT_USER_PASSWORD='Complexpass#123' \
ZO_BASE_URL=http://localhost:5080/ \
WS_ZO_BASE_URL=ws://localhost:5080/ \
target/debug/openobserve &
rye run pytest             # full suite
rye run pytest -m framework        # just the new-framework self-tests
rye run pytest tests/test_kvstore.py -v   # one file
```

## Layout

```
tests/api-testing/
├── pyproject.toml          # pytest + ruff config
├── conftest.py             # legacy session-wide fixtures (do not extend)
├── support/                # NEW FRAMEWORK — write new tests against this
│   ├── client.py           # OpenObserveClient: HTTP entry point
│   ├── endpoints/          # one wrapper class per resource group
│   │   ├── search.py       # client.search.sql(...), .hits(...), .count(...)
│   │   ├── streams.py      # client.streams.list(), .delete(...), .ingest_json(...)
│   │   ├── users.py
│   │   ├── dashboards.py
│   │   ├── alerts.py
│   │   ├── folders.py
│   │   └── kvstore.py
│   ├── factories.py        # payload builders (user_payload, dashboard_payload, …)
│   ├── wait.py             # wait_until(predicate, timeout, ...) — REPLACES time.sleep
│   └── fixtures.py         # client, temp_stream_name, temp_user_email, …
├── tests/                  # test files
│   ├── conftest.py
│   ├── test_framework_selfcheck.py   # 14 tests that prove support/ works
│   └── test_*.py           # 40+ legacy test files (in revamp progress)
├── helpers/                # non-test shared code
│   ├── sourcemap_helpers.py
│   └── workflow/           # workflow chain helpers (with embedded pages/)
├── fixtures/               # static test data
│   └── rum/                # RUM ingest scripts
└── README.md               # this file
```

## Writing a new test — the rules

**Use the new framework.** Don't copy-paste from old `test_*.py` files; they
are scheduled for rewrite (see [revamp plan](../../tests/ui-testing/MD_Files/api%20tests%20revamp/API_TESTS_REVAMP.md)).

```python
# tests/<area>/test_my_feature.py
from support.client import OpenObserveClient
from support.factories import user_payload
from support.fixtures import client, temp_user_email   # noqa: F401
from support.wait import wait_until


def test_create_user_returns_complete_record(client: OpenObserveClient, temp_user_email: str):
    """Create a user — verify the response has the email AND role we sent."""
    payload = user_payload(email=temp_user_email, role="admin")
    resp = client.users.create(payload)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # VALIDATE THE BODY, not just status_code
    assert body.get("data", {}).get("email") == temp_user_email
    assert body.get("data", {}).get("role") == "admin"
    # cleanup happens automatically via temp_user_email fixture
```

### Mandatory patterns

| ✅ Do | ❌ Don't |
|---|---|
| `from support.fixtures import client` | `session = create_session; url = base_url; org_id = "default"` (307 occurrences in legacy code) |
| `client.streams.list()` | `session.get(f"{url}api/{org_id}/streams")` |
| `body = resp.json(); assert body["foo"] == ...` | `assert resp.status_code == 200` and stop |
| `wait_until(lambda: client.search.count(sql) >= N, timeout=30)` | `time.sleep(5)` |
| `unique_email("user")` / `temp_user_email` fixture | hardcoded `pytests@gmail.com` |
| `logger.debug("got %s", resp.status_code)` | `print(resp.content)` |
| `start, end = time_window(minutes=15)` | hardcoded `start_time = 1700629279639000` |

### Anti-patterns that fail review

- `assert resp.status_code in [200, 400, 404, 500]` — pick one. If the API behaves wrongly, file a bug; don't paper over it.
- `pytest.skip(...)` when the test discovers the bug it's meant to catch — use `@pytest.mark.xfail(strict=True)`.
- Commented-out test functions — delete them.
- `pages.*` direct imports — that subtree is legacy. New tests use `support.client`.

### Lint

```bash
rye run ruff check support/ tests/test_framework_selfcheck.py  # strict mode
rye run ruff check --fix support/                              # autofix
```

Existing legacy tests have a per-file ruff-ignore (so `print` etc. don't fail
the whole suite); new tests under `support/` and any new well-formed test
file should pass strict ruff.

## Test markers

| Marker | Meaning |
|---|---|
| `framework` | Self-tests for `support/` framework. Run with `-m framework`. |
| `order(N)` | Run order pin (legacy — avoid in new tests). |

## Troubleshooting

- **`KeyError: 'ZO_BASE_URL'` on collection** — `conftest.py` reads env vars at import. Export them before running pytest (even `--collect-only`).
- **`test_workflow.py` fails with SMTP error** — `ZO_SMTP_ENABLED=true` not set. CI does this; locally you'd need to wire an SMTP env.
- **Test_organisations.py warning about `yield`** — `test_create_organization` uses pre-pytest-4 yield-style and is silently ignored. Scheduled for rewrite in Phase 4.

## Revamp in progress

This suite is being incrementally reworked. See:
- [`../../tests/ui-testing/MD_Files/api tests revamp/API_TESTS_REVAMP.md`](../../tests/ui-testing/MD_Files/api%20tests%20revamp/API_TESTS_REVAMP.md) — the plan
- [`../../tests/ui-testing/MD_Files/api tests revamp/oss_rework_progress/`](../../tests/ui-testing/MD_Files/api%20tests%20revamp/oss_rework_progress/) — phase-by-phase progress
