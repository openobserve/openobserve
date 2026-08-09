USE dbmlab;

CREATE TABLE accounts (
  id      INT PRIMARY KEY,
  balance BIGINT NOT NULL,
  owner   VARCHAR(64) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE inventory (
  id        INT PRIMARY KEY,
  sku       VARCHAR(32) NOT NULL,
  qty       INT NOT NULL,
  warehouse VARCHAR(16) NOT NULL
) ENGINE=InnoDB;

-- customer_ref deliberately unindexed -> full scans
CREATE TABLE orders (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_ref VARCHAR(32) NOT NULL,
  account_id   INT NOT NULL,
  sku          VARCHAR(32) NOT NULL,
  amount       BIGINT NOT NULL,
  note         TEXT
) ENGINE=InnoDB;

INSERT INTO accounts (id, balance, owner)
  SELECT n, 100000 + n, CONCAT('owner-', n) FROM
  (SELECT @r := @r + 1 AS n FROM information_schema.columns, (SELECT @r := 0) x LIMIT 50) s;

INSERT INTO inventory (id, sku, qty, warehouse)
  SELECT n, CONCAT('SKU-', LPAD(n, 5, '0')), 1000 + n, CONCAT('wh-', n % 5) FROM
  (SELECT @r2 := @r2 + 1 AS n FROM information_schema.columns, (SELECT @r2 := 0) x LIMIT 500) s;

INSERT INTO orders (customer_ref, account_id, sku, amount, note)
  SELECT CONCAT('CUST-', LPAD(n % 997, 5, '0')), (n % 50) + 1,
         CONCAT('SKU-', LPAD((n % 500) + 1, 5, '0')), (n * 37) % 9999, REPEAT(MD5(n), 4)
  FROM (SELECT @r3 := @r3 + 1 AS n FROM information_schema.columns c1,
        information_schema.columns c2, (SELECT @r3 := 0) x LIMIT 40000) s;

ANALYZE TABLE orders, accounts, inventory;

-- Monitoring user for the mysql + sqlquery receivers.
CREATE USER IF NOT EXISTS 'o2_monitor'@'%' IDENTIFIED BY 'o2_monitor';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'o2_monitor'@'%';
-- mysqlreceiver needs UPDATE on performance_schema to enable consumers.
GRANT UPDATE ON performance_schema.* TO 'o2_monitor'@'%';
FLUSH PRIVILEGES;
