# Database Validation Tests

This directory contains database validation tests for OpenObserve. These tests ingest data via the API and then validate the database state by directly querying the metadata database.

## Purpose

These tests are separate from:
- **Rust integration tests** (`tests/integration_test.rs`) - To avoid increasing PR CI time
- **API tests** (`tests/api-testing/`) - Different concern: DB state validation vs API endpoint testing

## Structure

```
tests/db-testing/
├── README.md              # This file
├── pyproject.toml         # Python project configuration (auto-generated in CI)
├── requirements.lock      # Locked dependencies (managed by rye)
└── tests/
    ├── conftest.py        # Pytest fixtures and configuration
    └── test_*.py          # Test files
```

## Dependencies

- `pytest` - Test framework
- `requests` - HTTP client for API calls
- `psycopg2-binary` - PostgreSQL database driver
- `python-dotenv` - Environment variable management

## Running Tests Locally

### Prerequisites

1. Install [rye](https://rye-up.com/):
   ```bash
   curl -sSf https://rye.astral.sh/get | bash
   ```

2. Build OpenObserve:
   ```bash
   cargo build --features mimalloc
   ```

3. Start a PostgreSQL instance:
   ```bash
   docker run -d \
     --name postgres-test \
     -e POSTGRES_PASSWORD=password \
     -p 5432:5432 \
     postgres:17.5-alpine3.22
   ```

### Run Tests

1. Start OpenObserve with Postgres backend:
   ```bash
   export ZO_META_STORE=postgres
   export ZO_META_POSTGRES_DSN=postgres://postgres:password@localhost:5432/postgres
   export ZO_ROOT_USER_EMAIL=root@example.com
   export ZO_ROOT_USER_PASSWORD=Complexpass#123
   target/debug/openobserve
   ```

2. In another terminal, run the tests:
   ```bash
   cd tests/db-testing
   rye sync  # Install dependencies
   rye run pytest -v
   ```

## Writing Tests

### Test Structure

Each test should follow this pattern:

1. **Ingest data** via the OpenObserve API
2. **Query the database** directly to validate state
3. **Assert** that the database state matches expectations

### Example Test

```python
def test_my_validation(ingest_test_data, db_cursor, test_org, test_stream):
    """Test description."""
    # 1. Ingest test data
    test_data = [{"timestamp": "...", "field": "value"}]
    ingest_test_data(test_data)

    # 2. Query database
    db_cursor.execute("""
        SELECT * FROM meta
        WHERE org_id = %s
        AND key2 = %s
    """, (test_org, test_stream))

    results = db_cursor.fetchall()

    # 3. Validate
    assert len(results) > 0, "Expected data not found"
```

### Available Fixtures

- `db_connection` - PostgreSQL connection (session-scoped)
- `db_cursor` - Database cursor for queries
- `ingest_test_data` - Function to ingest data via API
- `query_api` - Function to query OpenObserve search API
- `openobserve_base_url` - OpenObserve API base URL
- `auth_credentials` - Authentication credentials tuple
- `test_org` - Test organization name (default: "default")
- `test_stream` - Test stream name (default: "db_test_stream")

## CI Integration

Tests run automatically in the `db-testing.yml` GitHub Actions workflow on:
- Push to `main` branch
- Pull requests to any branch

The workflow:
1. Starts a PostgreSQL service
2. Builds OpenObserve
3. Configures OpenObserve to use Postgres
4. Runs pytest tests
5. Uploads logs on failure

## Database Schema Reference

The `meta` table structure (adjust based on your actual schema):

```sql
CREATE TABLE meta (
    id SERIAL PRIMARY KEY,
    org_id VARCHAR(100),
    module VARCHAR(100),
    key1 VARCHAR(256),
    key2 VARCHAR(256),
    start_dt BIGINT,
    value TEXT,
    -- ... other columns
);
```

Common modules:
- `schema` - Stream schemas
- `stream_settings` - Stream configuration
- `file_list` - File metadata
- `organization` - Organization settings
- `user` - User data

## Tips

1. **Use transactions** in tests when you need to clean up (though fixtures handle most cleanup)
2. **Wait for ingestion** - Data ingestion is async, use `wait_for_ingestion()` helper
3. **Print debug info** - Use `print()` statements to debug queries during development
4. **Test isolation** - Each test should be independent and not rely on other tests
5. **Database state** - Tests query a shared database; use unique stream names if needed

## Troubleshooting

### Tests fail with "connection refused"
- Ensure PostgreSQL is running and accessible
- Check `ZO_META_POSTGRES_DSN` environment variable

### Tests fail with "table not found"
- OpenObserve may not have initialized the database schema
- Check OpenObserve logs for migration errors

### Tests timeout
- Increase wait times in `wait_for_ingestion()`
- Check if OpenObserve is running and healthy

## Future Enhancements

- [ ] Add SQLite backend testing
- [ ] Add tests for data compaction
- [ ] Add tests for schema evolution
- [ ] Add tests for multi-tenancy
- [ ] Add performance/load tests
- [ ] Add tests for backup/restore operations
