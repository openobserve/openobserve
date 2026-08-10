-- SQL Server fixture — mirrors the Postgres/MySQL shape so the three engines
-- are comparable.
--
-- WHY THIS CONTAINER EXISTS. `sqlquery/mssql_blocking` ALREADY SHIPS in the
-- product (dbmShared.ts) but has never been executed against a real SQL Server:
-- the rig ran Postgres and MySQL only. It was written from the DMV docs and
-- reviewed, which is exactly the state the Postgres filelog regex was in when
-- it turned out to be silently broken. This fixture makes the shipped recipe
-- runnable so "reviewed-correct" can become "live-verified".
--
-- Second job: capture a real deadlock XML graph from the system_health Extended
-- Events session, which is what dbm-engine-support.md §4 needs before an MSSQL
-- deadlock recipe can be written.
IF DB_ID('dbmlab') IS NULL
  CREATE DATABASE dbmlab;
GO

USE dbmlab;
GO

CREATE TABLE accounts (
  id      INT PRIMARY KEY,
  balance BIGINT      NOT NULL,
  owner   VARCHAR(64) NOT NULL
);
GO

CREATE TABLE inventory (
  id        INT PRIMARY KEY,
  sku       VARCHAR(32) NOT NULL,
  qty       INT         NOT NULL,
  warehouse VARCHAR(16) NOT NULL
);
GO

-- customer_ref deliberately unindexed -> full scans
CREATE TABLE orders (
  id           BIGINT IDENTITY(1,1) PRIMARY KEY,
  customer_ref VARCHAR(32) NOT NULL,
  account_id   INT         NOT NULL,
  sku          VARCHAR(32) NOT NULL,
  amount       BIGINT      NOT NULL,
  note         VARCHAR(MAX)
);
GO

-- 50 accounts. Ids 11/12 are the deadlock pair, matching the PG/MySQL workload.
WITH n AS (
  SELECT TOP (50) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i
  FROM sys.all_columns
)
INSERT INTO accounts (id, balance, owner)
SELECT i, 100000 + i, CONCAT('owner-', i) FROM n;
GO

WITH n AS (
  SELECT TOP (500) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i
  FROM sys.all_columns
)
INSERT INTO inventory (id, sku, qty, warehouse)
SELECT i, CONCAT('SKU-', RIGHT('00000' + CAST(i AS VARCHAR(5)), 5)),
       1000 + i, CONCAT('wh-', i % 5)
FROM n;
GO

-- Enough rows that an unindexed predicate is a genuine scan.
WITH n AS (
  SELECT TOP (40000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i
  FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO orders (customer_ref, account_id, sku, amount, note)
SELECT CONCAT('CUST-', RIGHT('00000' + CAST(i % 997 AS VARCHAR(5)), 5)),
       (i % 50) + 1,
       CONCAT('SKU-', RIGHT('00000' + CAST((i % 500) + 1 AS VARCHAR(5)), 5)),
       (i * 37) % 9999,
       REPLICATE(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(i AS VARCHAR(16))), 2), 4)
FROM n;
GO

-- The monitoring login the shipped recipe assumes. VIEW SERVER STATE is the
-- grant dbmShared.ts's MSSQL_DBM_GRANT_SQL tells users to run — the whole point
-- is to exercise the same privilege level a real user would have.
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'o2_monitor')
BEGIN
  CREATE LOGIN o2_monitor WITH PASSWORD = 'o2_Monitor#123', CHECK_POLICY = OFF;
  -- Blocking DMVs (sys.dm_exec_requests / _sessions).
  GRANT VIEW SERVER STATE TO o2_monitor;
  -- REQUIRED for deadlocks: sys.fn_xe_file_target_read_file reads the
  -- system_health Extended Events target and fails with msg 300 without this.
  -- Measured, not assumed — with only VIEW SERVER STATE the deadlock shred
  -- errors while blocking keeps working, so the two grants are not redundant.
  GRANT VIEW SERVER PERFORMANCE STATE TO o2_monitor;
  GRANT VIEW ANY DEFINITION TO o2_monitor;
END
GO

USE dbmlab;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'o2_monitor')
  CREATE USER o2_monitor FOR LOGIN o2_monitor;
GO
ALTER ROLE db_datareader ADD MEMBER o2_monitor;
GO
