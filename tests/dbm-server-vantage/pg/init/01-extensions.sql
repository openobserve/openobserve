-- Runs inside dbmlab as superuser dbm on first container start.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ---------------------------------------------------------------------------
-- Schema: an orders/inventory toy with a DELIBERATELY missing index on
-- orders.customer_ref (drives seq scans + the "missing index" recommendation
-- input) and a wide text column to force big sorts -> temp-file spill.
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id          int PRIMARY KEY,
  balance     bigint NOT NULL,
  owner       text   NOT NULL,
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE inventory (
  id          int PRIMARY KEY,
  sku         text NOT NULL,
  qty         int  NOT NULL,
  warehouse   text NOT NULL,
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE orders (
  id           bigserial PRIMARY KEY,
  customer_ref text NOT NULL,          -- NO INDEX on purpose
  account_id   int  NOT NULL,
  sku          text NOT NULL,
  amount       bigint NOT NULL,
  note         text,                   -- wide payload -> sort spill
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE order_lines (
  id        bigserial PRIMARY KEY,
  order_id  bigint NOT NULL,
  sku       text   NOT NULL,
  qty       int    NOT NULL
);
CREATE INDEX ON order_lines (order_id);

CREATE TABLE audit_log (
  id       bigserial PRIMARY KEY,
  actor    text,
  action   text,
  at       timestamptz DEFAULT now()
);

INSERT INTO accounts (id, balance, owner)
SELECT g, 100000 + g, 'owner-' || g FROM generate_series(1, 50) g;

INSERT INTO inventory (id, sku, qty, warehouse)
SELECT g, 'SKU-' || lpad(g::text, 5, '0'), 1000 + g,
       'wh-' || (g % 5) FROM generate_series(1, 500) g;

INSERT INTO orders (customer_ref, account_id, sku, amount, note)
SELECT 'CUST-' || lpad((g % 997)::text, 5, '0'),
       (g % 50) + 1,
       'SKU-' || lpad(((g % 500) + 1)::text, 5, '0'),
       (g * 37) % 9999,
       repeat(md5(g::text), 6)
FROM generate_series(1, 60000) g;

INSERT INTO order_lines (order_id, sku, qty)
SELECT (g % 60000) + 1, 'SKU-' || lpad(((g % 500) + 1)::text, 5, '0'), (g % 9) + 1
FROM generate_series(1, 120000) g;

-- An index that is created but never used: "unused index" recommendation input.
CREATE INDEX idx_orders_note_unused ON orders ((left(note, 8)));

ANALYZE;

-- ---------------------------------------------------------------------------
-- Monitoring role used by the collector's postgresql + sqlquery receivers.
-- pg_monitor grants pg_stat_statements / pg_stat_activity full visibility
-- (query text of OTHER sessions) without superuser.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'o2_monitor') THEN
    CREATE ROLE o2_monitor LOGIN PASSWORD 'o2_monitor';
  END IF;
END $$;
GRANT pg_monitor TO o2_monitor;
GRANT CONNECT ON DATABASE dbmlab TO o2_monitor;
GRANT USAGE ON SCHEMA public TO o2_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO o2_monitor;

-- ---------------------------------------------------------------------------
-- EXPLAIN helper. Postgres does NOT allow EXPLAIN inside a subquery
--   (ERROR: syntax error at or near "FORMAT"), so sqlqueryreceiver — which can
-- only run a single row-returning statement — cannot EXPLAIN directly. The fix
-- is a SECURITY DEFINER function that runs EXPLAIN through a cursor and returns
-- the plan as JSON. This is the SAME mechanism Datadog requires a DBA to install
-- (datadog.explain_statement) — i.e. an identical prerequisite, not extra cost.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION o2_explain_statement(l_query text, OUT explain json)
RETURNS SETOF json AS $$
DECLARE curs REFCURSOR; plan json;
BEGIN
  OPEN curs FOR EXECUTE pg_catalog.concat('EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE TRUE) ', l_query);
  FETCH curs INTO plan;
  CLOSE curs;
  RETURN QUERY SELECT plan;
END;
$$ LANGUAGE plpgsql RETURNS NULL ON NULL INPUT SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION o2_explain_statement(text) TO o2_monitor;
