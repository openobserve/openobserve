#!/bin/bash
# VERSION-SPECIFIC GOTCHA (postgresqlreceiver 0.135.0):
# the receiver's top_query collector connects to the MAINTENANCE database
# (the `postgres` db) — NOT to the databases listed under `databases:`.
# pg_stat_statements is a per-database view, so without the extension installed
# in `postgres` the receiver logs, every interval:
#     getTopQuery failed getting log rows: pq: relation "pg_stat_statements" does not exist
# and emits ZERO db.server.top_query events. Installing it there fixes it;
# because pg_stat_statements' shared memory is instance-wide, the view in
# `postgres` reports statements from ALL databases.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-'EOSQL'
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EOSQL
