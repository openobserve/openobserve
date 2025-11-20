# Testing Session Migration with PostgreSQL

This guide will help you test the session table migration locally using PostgreSQL.

## Prerequisites

- Docker and Docker Compose installed
- PostgreSQL client tools (optional, for verification)

## Step 1: Start PostgreSQL Container

Create a Docker Compose file for PostgreSQL or run it directly:

```bash
# Option 1: Using docker run
docker run -d \
  --name openobserve-postgres \
  -e POSTGRES_USER=openobserve \
  -e POSTGRES_PASSWORD=openobserve123 \
  -e POSTGRES_DB=openobserve \
  -p 5432:5432 \
  postgres:15

# Option 2: Using docker-compose (create docker-compose.test.yml)
# See the file content below
```

### docker-compose.test.yml
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    container_name: openobserve-postgres
    environment:
      POSTGRES_USER: openobserve
      POSTGRES_PASSWORD: openobserve123
      POSTGRES_DB: openobserve
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Then run:
```bash
docker-compose -f docker-compose.test.yml up -d
```

## Step 2: Verify PostgreSQL is Running

```bash
# Check if container is running
docker ps | grep postgres

# Connect to PostgreSQL (optional)
docker exec -it openobserve-postgres psql -U openobserve -d openobserve
# Then type: \dt to list tables (should be empty initially)
# Type: \q to quit
```

## Step 3: Configure OpenObserve to Use PostgreSQL

Create or update your `.env` file:

```bash
cat > .env << 'EOF'
# Root user credentials
ZO_ROOT_USER_EMAIL=root@example.com
ZO_ROOT_USER_PASSWORD=Complexpass#123

# Meta store configuration - USE POSTGRESQL
ZO_META_STORE=postgres
ZO_META_POSTGRES_DSN=postgres://openobserve:openobserve123@localhost:5432/openobserve

# Optional: Read-only replica (use same for testing)
# ZO_META_POSTGRES_RO_DSN=postgres://openobserve:openobserve123@localhost:5432/openobserve

# Other settings
ZO_DATA_DIR=./data
ZO_LOCAL_MODE=true
RUST_LOG=info,openobserve=debug

# Disable S3 for local testing
ZO_S3_PROVIDER=local
EOF
```

## Step 4: Build OpenObserve

```bash
# Clean build (recommended)
cargo clean

# Build the project
cargo build --release

# Or for faster debug builds (during testing)
cargo build
```

## Step 5: Create Test Sessions in Meta Table (Before Migration)

First, let's add some test sessions to the old meta table format to verify migration works:

```bash
# Start OpenObserve temporarily to create the meta table
# This will also run any existing migrations
./target/debug/openobserve &
OPENOBSERVE_PID=$!

# Wait for startup (about 10 seconds)
sleep 10

# Kill it for now
kill $OPENOBSERVE_PID
```

Now insert test data directly into PostgreSQL:

```sql
-- Connect to PostgreSQL
docker exec -it openobserve-postgres psql -U openobserve -d openobserve

-- Insert test sessions into meta table (old format)
INSERT INTO meta (module, key1, key2, start_dt, value) VALUES
('user_sessions', '', 'test-session-id-1', 0, '"Bearer test-token-12345"'),
('user_sessions', '', 'test-session-id-2', 0, '"Bearer test-token-67890"'),
('user_sessions', '', 'test-session-id-3', 0, '"Bearer test-token-abcdef"');

-- Verify the data was inserted
SELECT id, module, key1, key2, value FROM meta WHERE module = 'user_sessions';

-- Exit psql
\q
```

## Step 6: Run OpenObserve with Migration

Now run OpenObserve - the migrations will execute automatically on startup:

```bash
# Set environment variables from .env
export $(cat .env | grep -v '^#' | xargs)

# Run OpenObserve (migrations will run automatically)
RUST_LOG=debug ./target/debug/openobserve
```

Watch the logs - you should see:

```
[INFO] Running migrations...
[INFO] Applying migration: m20251118_000001_create_sessions_table
[INFO] Applying migration: m20251118_000002_populate_sessions_table
[INFO] Applying migration: m20251118_000003_delete_meta_sessions
[INFO] Migrations completed successfully
[INFO] Start watching user sessions from database
[INFO] User Sessions Cached: 3 sessions loaded
```

## Step 7: Verify Migration Success

### Option A: Using psql

```sql
-- Connect to PostgreSQL
docker exec -it openobserve-postgres psql -U openobserve -d openobserve

-- Check if sessions table was created
\dt

-- Verify sessions data was migrated
SELECT id, session_id, LEFT(access_token, 20) as token_preview, created_at, updated_at
FROM sessions;

-- Verify sessions were removed from meta table
SELECT COUNT(*) FROM meta WHERE module = 'user_sessions';
-- Should return 0

-- Exit
\q
```

### Option B: Using SQL directly

```bash
docker exec openobserve-postgres psql -U openobserve -d openobserve \
  -c "SELECT id, session_id, LEFT(access_token, 30) as token_preview FROM sessions;"

docker exec openobserve-postgres psql -U openobserve -d openobserve \
  -c "SELECT COUNT(*) as old_sessions FROM meta WHERE module = 'user_sessions';"
```

## Step 8: Test Session Functionality

### 8.1: Login and Create a New Session

```bash
# Login to create a session
curl -X POST http://localhost:5080/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "name": "root@example.com",
    "password": "Complexpass#123"
  }' | jq .

# Save the session ID from the response
# Example: "session abc-def-123-456"
```

### 8.2: Verify New Session in Database

```bash
# Check sessions table
docker exec openobserve-postgres psql -U openobserve -d openobserve \
  -c "SELECT session_id, LEFT(access_token, 30) as token, created_at FROM sessions ORDER BY created_at DESC LIMIT 5;"
```

### 8.3: Test Session Retrieval

```bash
# Use the session token from login
SESSION_TOKEN="session abc-def-123-456"  # Replace with actual token

# Make an authenticated request
curl -X GET http://localhost:5080/api/default/streams \
  -H "Authorization: $SESSION_TOKEN"
```

### 8.4: Test Session Cache

Check the logs - you should see cache hits:
```
# In OpenObserve logs, you should see:
[DEBUG] Session retrieved from cache: abc-def-123-456
```

### 8.5: Test Session Watch (Cross-Node Sync)

```bash
# In one terminal, watch the sessions table
watch -n 2 'docker exec openobserve-postgres psql -U openobserve -d openobserve -c "SELECT COUNT(*) FROM sessions;"'

# In another terminal, create multiple sessions by logging in
for i in {1..5}; do
  curl -X POST http://localhost:5080/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "name": "root@example.com",
      "password": "Complexpass#123"
    }' | jq -r .data.access_token
  sleep 2
done

# Watch the OpenObserve logs - every 30 seconds you should see:
# [INFO] Start watching user sessions from database
# [DEBUG] Synced X sessions from database
```

## Step 9: Test Session Deletion

```bash
# Logout to delete session
curl -X POST http://localhost:5080/auth/logout \
  -H "Authorization: $SESSION_TOKEN"

# Verify session was deleted from database
docker exec openobserve-postgres psql -U openobserve -d openobserve \
  -c "SELECT COUNT(*) FROM sessions WHERE session_id = 'abc-def-123-456';"
# Should return 0
```

## Step 10: Performance Testing (Optional)

### Test with Many Sessions

```bash
# Create 100 sessions
for i in {1..100}; do
  curl -s -X POST http://localhost:5080/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "name": "root@example.com",
      "password": "Complexpass#123"
    }' > /dev/null
done

# Check session count
docker exec openobserve-postgres psql -U openobserve -d openobserve \
  -c "SELECT COUNT(*) as total_sessions FROM sessions;"

# Test query performance
docker exec openobserve-postgres psql -U openobserve -d openobserve \
  -c "EXPLAIN ANALYZE SELECT * FROM sessions WHERE session_id = 'some-session-id';"
```

## Step 11: Cleanup

```bash
# Stop OpenObserve
# Press Ctrl+C or kill the process

# Stop and remove PostgreSQL container
docker-compose -f docker-compose.test.yml down -v

# Or if using docker run:
docker stop openobserve-postgres
docker rm openobserve-postgres
docker volume rm $(docker volume ls -q | grep postgres)

# Clean up local data
rm -rf ./data
rm .env
```

## Troubleshooting

### Migration Failed

```bash
# Check OpenObserve logs for errors
tail -f openobserve.log

# Check PostgreSQL logs
docker logs openobserve-postgres

# Connect to DB and check migration status
docker exec -it openobserve-postgres psql -U openobserve -d openobserve
\dt  # List all tables
SELECT * FROM seaql_migrations ORDER BY version;  # Check which migrations ran
```

### Connection Refused

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Test connection
psql "postgres://openobserve:openobserve123@localhost:5432/openobserve" -c "\l"

# Check if port is available
netstat -an | grep 5432
```

### Sessions Not Syncing

```bash
# Check if watch is running
ps aux | grep openobserve

# Check database connection
docker exec openobserve-postgres psql -U openobserve -d openobserve -c "SELECT version();"

# Increase log level
export RUST_LOG=debug,sea_orm=debug
./target/debug/openobserve
```

## Expected Results

✅ **Successful Migration:**
- All 3 migrations complete without errors
- Sessions table exists with test data
- Meta table has no user_sessions entries
- New logins create sessions in the sessions table
- Session authentication works correctly
- Watch mechanism syncs every 30 seconds
- Cache provides fast session lookups

## Rollback (If Needed)

If you need to rollback:

```sql
-- Connect to PostgreSQL
docker exec -it openobserve-postgres psql -U openobserve -d openobserve

-- Drop the sessions table
DROP TABLE IF EXISTS sessions CASCADE;

-- Restore sessions to meta table (if you backed them up)
-- INSERT INTO meta ...

-- Remove migration records
DELETE FROM seaql_migrations WHERE version >= 20251118000001;

\q
```

## Next Steps

After successful local testing:
1. Test with MySQL/SQLite if needed
2. Test in a multi-node cluster setup
3. Test with production-like session volumes
4. Create backup/restore procedures
5. Deploy to staging environment
