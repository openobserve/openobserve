/**
 * DBM capture cell: node-<engine>-<era> (pg | mysql2 | redis | mongodb).
 *
 * Executes the canonical workload from apps/WORKLOAD.md for the engine picked
 * by DBM_ENGINE. Each step is wrapped in a span carrying `test.step_id`.
 *
 * Era is a PACKAGE-PIN mechanism (see package.cur.json / package.era.json,
 * selected by the ERA docker build arg):
 *   cur — latest contrib instrumentations (hard cutover, expected new-only
 *         regardless of OTEL_SEMCONV_STABILITY_OPT_IN)
 *   era — 2026-06-11 wave (instrumentation-pg 0.71.0 etc.), env var honored.
 *
 * Setup ordering trick: instrumentations are constructed (patching require)
 * BEFORE drivers are required, but the real TracerProvider is wired only after
 * connect + mongo replica-set init, so bootstrap traffic emits no recorded spans.
 */
'use strict';

const ENGINE = process.env.DBM_ENGINE || 'postgres';
const SERVICE = process.env.SERVICE_NAME || `dbm-node-${ENGINE}`;

const api = require('@opentelemetry/api');
const { NodeTracerProvider, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');

// --- construct instrumentations FIRST (require hooks), provider wired later ---
const instrumentations = [];
if (ENGINE === 'postgres') {
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
  instrumentations.push(new PgInstrumentation());
} else if (ENGINE === 'mysql') {
  const { MySQL2Instrumentation } = require('@opentelemetry/instrumentation-mysql2');
  instrumentations.push(new MySQL2Instrumentation());
} else if (ENGINE === 'redis') {
  const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');
  instrumentations.push(new RedisInstrumentation());
} else if (ENGINE === 'mongo') {
  const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
  // mongodb driver >=6.4 executes commands from its own wait-queue async context,
  // so the caller's ALS context (our step wrapper span) is NOT active inside the
  // patched Connection.command. With the default requireParentSpan=true the
  // instrumentation therefore skips EVERY span (verified empirically, drivers
  // 6.21.0 and 7.5.0, instr 0.72.0/0.74.0). requireParentSpan:false makes spans
  // appear — but as ROOT spans (step attribution = timestamp containment).
  instrumentations.push(new MongoDBInstrumentation({ requireParentSpan: false }));
} else {
  throw new Error(`unknown DBM_ENGINE ${ENGINE}`);
}

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    'service.name': SERVICE,
    'deployment.environment.name': process.env.DEPLOY_ENV || 'capture-env-a',
  }),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
});

const fs = require('fs');
const pins = fs.readFileSync('/app/pins.txt', 'utf8').trim();
console.log(`[node-${ENGINE}] service=${SERVICE} OTEL_SEMCONV_STABILITY_OPT_IN=` +
  JSON.stringify(process.env.OTEL_SEMCONV_STABILITY_OPT_IN || ''));
console.log(`[node-${ENGINE}] pins:\n${pins}`);

let tracer; // set after provider wiring

async function step(id, fn) {
  await tracer.startActiveSpan(id, async (span) => {
    span.setAttribute('test.step_id', id);
    try {
      await fn();
    } finally {
      span.end();
    }
  });
  console.log(`[node-${ENGINE}] ${id} done`);
}

function wireProvider() {
  registerInstrumentations({ instrumentations, tracerProvider: provider });
  api.trace.setGlobalTracerProvider(provider);
  tracer = api.trace.getTracer('dbm-capture-workload');
}

// ---------------------------------------------------------------- postgres --
async function runPostgres() {
  const { Client } = require('pg');
  const client = new Client({
    host: 'postgres', port: 5432, user: 'dbm', password: 'dbm', database: 'dbm',
  });
  await client.connect(); // pre-provider: connection chatter not recorded
  wireProvider();

  await step('S00', async () => {
    await client.query('DROP TABLE IF EXISTS dbm_items');
    await client.query('CREATE TABLE dbm_items (id INT PRIMARY KEY, name VARCHAR(64), price INT, category VARCHAR(32))');
    await client.query(
      "INSERT INTO dbm_items (id, name, price, category) VALUES " +
      "(1,'alpha',10,'a'),(2,'beta',20,'a'),(3,'gamma',30,'b'),(4,'delta',40,'b')," +
      "(5,'epsilon',50,'c'),(6,'zeta',60,'c'),(7,'eta',70,'d'),(8,'theta',80,'d')," +
      "(9,'iota',90,'e'),(10,'kappa',100,'e')");
    await client.query('DROP TABLE IF EXISTS deadlock_t');
    await client.query('CREATE TABLE deadlock_t (id INT PRIMARY KEY, v INT)');
    await client.query('INSERT INTO deadlock_t (id, v) VALUES (1,0),(2,0)');
  });
  await step('S01', () => client.query('SELECT id, name, price FROM dbm_items WHERE id = $1', [3]));
  await step('S02', () => client.query('SELECT id, name FROM dbm_items WHERE price > $1 AND category = $2', [25, 'b']));
  for (const [sid, arity] of [['S03', 3], ['S04', 8], ['S05', 20]]) {
    await step(sid, () => {
      const ph = Array.from({ length: arity }, (_, i) => `$${i + 1}`).join(', ');
      const params = Array.from({ length: arity }, (_, i) => i + 1);
      return client.query(`SELECT id, name FROM dbm_items WHERE id IN (${ph})`, params);
    });
  }
  await step('S06', () => client.query(
    'INSERT INTO dbm_items (id, name, price, category) VALUES ($1, $2, $3, $4)',
    [101, 'ins-1', 11, 'x']));
  await step('S07', () => {
    const rows = [1, 2, 3, 4, 5].map((i) => [110 + i, `batch-${i}`, 10 * i, 'y']);
    const ph = rows.map((_, r) => `($${r * 4 + 1}, $${r * 4 + 2}, $${r * 4 + 3}, $${r * 4 + 4})`).join(', ');
    return client.query(
      `INSERT INTO dbm_items (id, name, price, category) VALUES ${ph}`, rows.flat());
  });
  await step('S08', async () => {
    // node-pg has no executemany/addBatch: 10 sequential parameterized INSERTs
    for (let i = 1; i <= 10; i++) {
      await client.query(
        'INSERT INTO dbm_items (id, name, price, category) VALUES ($1, $2, $3, $4)',
        [120 + i, `many-${i}`, 10 * i, 'z']);
    }
  });
  await step('S09', async () => {
    await client.query('BEGIN');
    await client.query('UPDATE dbm_items SET price = price + 1 WHERE id = $1', [1]);
    await client.query('SAVEPOINT sp1');
    await client.query('UPDATE dbm_items SET price = price + 100 WHERE id = $1', [2]);
    await client.query('ROLLBACK TO SAVEPOINT sp1');
    await client.query('COMMIT');
  });
  await step('S10', () => client.query('SELECT 1'));
  await step('S11', async () => {
    try {
      await client.query('SELECT no_such_column FROM dbm_items');
      console.log(`[node-${ENGINE}] S11 UNEXPECTEDLY SUCCEEDED`); process.exit(1);
    } catch (e) {
      console.log(`[node-${ENGINE}] S11 expected error: ${e.code}`);
    }
  });
  await client.end();
}

// ------------------------------------------------------------------- mysql --
async function runMysql() {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: 'mysql', port: 3306, user: 'dbm', password: 'dbm', database: 'dbm',
  });
  wireProvider();

  await step('S00', async () => {
    await conn.query('DROP TABLE IF EXISTS dbm_items');
    await conn.query('CREATE TABLE dbm_items (id INT PRIMARY KEY, name VARCHAR(64), price INT, category VARCHAR(32))');
    await conn.query(
      "INSERT INTO dbm_items (id, name, price, category) VALUES " +
      "(1,'alpha',10,'a'),(2,'beta',20,'a'),(3,'gamma',30,'b'),(4,'delta',40,'b')," +
      "(5,'epsilon',50,'c'),(6,'zeta',60,'c'),(7,'eta',70,'d'),(8,'theta',80,'d')," +
      "(9,'iota',90,'e'),(10,'kappa',100,'e')");
    await conn.query('DROP TABLE IF EXISTS deadlock_t');
    await conn.query('CREATE TABLE deadlock_t (id INT PRIMARY KEY, v INT)');
    await conn.query('INSERT INTO deadlock_t (id, v) VALUES (1,0),(2,0)');
  });
  await step('S01', () => conn.execute('SELECT id, name, price FROM dbm_items WHERE id = ?', [3]));
  await step('S02', () => conn.execute('SELECT id, name FROM dbm_items WHERE price > ? AND category = ?', [25, 'b']));
  for (const [sid, arity] of [['S03', 3], ['S04', 8], ['S05', 20]]) {
    await step(sid, () => {
      const ph = Array(arity).fill('?').join(', ');
      const params = Array.from({ length: arity }, (_, i) => i + 1);
      return conn.execute(`SELECT id, name FROM dbm_items WHERE id IN (${ph})`, params);
    });
  }
  await step('S06', () => conn.execute(
    'INSERT INTO dbm_items (id, name, price, category) VALUES (?, ?, ?, ?)',
    [101, 'ins-1', 11, 'x']));
  await step('S07', () => {
    const rows = [1, 2, 3, 4, 5].map((i) => [110 + i, `batch-${i}`, 10 * i, 'y']);
    const ph = rows.map(() => '(?, ?, ?, ?)').join(', ');
    return conn.execute(
      `INSERT INTO dbm_items (id, name, price, category) VALUES ${ph}`, rows.flat());
  });
  await step('S08', async () => {
    // mysql2 has no executemany/addBatch: 10 sequential parameterized INSERTs
    for (let i = 1; i <= 10; i++) {
      await conn.execute(
        'INSERT INTO dbm_items (id, name, price, category) VALUES (?, ?, ?, ?)',
        [120 + i, `many-${i}`, 10 * i, 'z']);
    }
  });
  await step('S09', async () => {
    await conn.beginTransaction();
    await conn.execute('UPDATE dbm_items SET price = price + 1 WHERE id = ?', [1]);
    await conn.query('SAVEPOINT sp1');
    await conn.execute('UPDATE dbm_items SET price = price + 100 WHERE id = ?', [2]);
    await conn.query('ROLLBACK TO SAVEPOINT sp1');
    await conn.commit();
  });
  await step('S10', () => conn.query('SELECT 1'));
  await step('S11', async () => {
    try {
      await conn.execute('SELECT no_such_column FROM dbm_items');
      console.log(`[node-${ENGINE}] S11 UNEXPECTEDLY SUCCEEDED`); process.exit(1);
    } catch (e) {
      console.log(`[node-${ENGINE}] S11 expected error: ${e.code}`);
    }
  });
  await conn.end();
}

// ------------------------------------------------------------------- redis --
async function runRedis() {
  const { createClient } = require('redis');
  const c = createClient({ url: 'redis://redis:6379' });
  await c.connect();
  wireProvider();

  await step('S00', async () => {
    await c.flushDb();
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
    for (let n = 1; n <= 10; n++) await c.set(`item:${n}`, names[n - 1]);
  });
  await step('S01', () => c.get('item:3'));
  await step('S02', () => c.set('item:tmp', 'scratch', { EX: 60 }));
  for (const [sid, arity] of [['S03', 3], ['S04', 8], ['S05', 20]]) {
    await step(sid, () => c.mGet(Array.from({ length: arity }, (_, i) => `item:${i + 1}`)));
  }
  await step('S06', () => c.set('batch:1', 'v1'));
  // S07/S08: node-redis pipelines concurrent commands automatically
  await step('S07', () => Promise.all(
    [1, 2, 3, 4, 5].map((n) => c.set(`batch:${n}`, `v${n}`))));
  await step('S08', () => Promise.all(
    Array.from({ length: 10 }, (_, i) => c.set(`batch:${i + 1}`, `v${i + 1}`))));
  await step('S09', () => c.multi().incr('txn:counter').incr('txn:counter').exec());
  await step('S10', () => c.ping());
  await step('S11', async () => {
    try {
      await c.sendCommand(['MEMORY', 'DOCTOR-BOGUS']);
      console.log(`[node-${ENGINE}] S11 UNEXPECTEDLY SUCCEEDED`); process.exit(1);
    } catch (e) {
      console.log(`[node-${ENGINE}] S11 expected error: ${e.message}`);
    }
  });
  await c.quit();
}

// ------------------------------------------------------------------- mongo --
async function runMongo() {
  if (process.env.DBM_WIRE_FIRST === '1') wireProvider(); // diagnostic ordering
  const { MongoClient } = require('mongodb');
  // replica-set init pre-provider (no recorded spans)
  const boot = new MongoClient('mongodb://mongo:27017/?directConnection=true', {
    serverSelectionTimeoutMS: 5000,
  });
  await boot.connect();
  try {
    await boot.db('admin').command({
      replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] },
    });
    console.log(`[node-${ENGINE}] replSetInitiate issued`);
  } catch (e) {
    console.log(`[node-${ENGINE}] replSetInitiate skipped: ${e.codeName}`);
  }
  for (let i = 0; i < 60; i++) {
    try {
      const hello = await boot.db('admin').command({ hello: 1 });
      if (hello.isWritablePrimary) break;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await boot.close();

  const client = new MongoClient('mongodb://mongo:27017/?directConnection=true');
  await client.connect();
  if (process.env.DBM_WIRE_FIRST !== '1') wireProvider();
  const col = client.db('dbm').collection('dbm_items');

  await step('S00', async () => {
    await col.drop().catch(() => {});
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
    const cats = ['a', 'a', 'b', 'b', 'c', 'c', 'd', 'd', 'e', 'e'];
    await col.insertMany(Array.from({ length: 10 }, (_, i) => ({
      _id: i + 1, name: names[i], price: 10 * (i + 1), category: cats[i],
    })));
  });
  await step('S01', () => col.find({ _id: 3 }).toArray());
  await step('S02', () => col.find({ price: { $gt: 25 }, category: 'b' }).toArray());
  for (const [sid, arity] of [['S03', 3], ['S04', 8], ['S05', 20]]) {
    await step(sid, () => col.find({
      _id: { $in: Array.from({ length: arity }, (_, i) => i + 1) },
    }).toArray());
  }
  await step('S06', () => col.insertOne({ _id: 101, name: 'ins-1', price: 11, category: 'x' }));
  await step('S07', () => col.insertMany([1, 2, 3, 4, 5].map((i) => ({
    _id: 110 + i, name: `batch-${i}`, price: 10 * i, category: 'y',
  }))));
  await step('S08', () => col.insertMany(Array.from({ length: 10 }, (_, i) => ({
    _id: 121 + i, name: `many-${i + 1}`, price: 10 * (i + 1), category: 'z',
  }))));
  await step('S09', async () => {
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await col.updateOne({ _id: 1 }, { $inc: { price: 1 } }, { session });
        await col.updateOne({ _id: 2 }, { $inc: { price: 100 } }, { session });
      });
    } finally {
      await session.endSession();
    }
  });
  await step('S10', () => client.db('admin').command({ ping: 1 }));
  await step('S11', async () => {
    try {
      await col.find({ price: { $badOperator: 1 } }).toArray();
      console.log(`[node-${ENGINE}] S11 UNEXPECTEDLY SUCCEEDED`); process.exit(1);
    } catch (e) {
      console.log(`[node-${ENGINE}] S11 expected error: ${e.codeName || e.code}`);
    }
  });
  await client.close();
}

// S12 — deadlock: NOT run in node cells (Java×PG / .NET×PG only per spec)

(async () => {
  if (ENGINE === 'postgres') await runPostgres();
  else if (ENGINE === 'mysql') await runMysql();
  else if (ENGINE === 'redis') await runRedis();
  else if (ENGINE === 'mongo') await runMongo();
  await provider.shutdown(); // flush BatchSpanProcessor
  console.log(`[node-${ENGINE}] workload complete`);
})().catch((e) => {
  console.error(`[node-${ENGINE}] FATAL`, e);
  process.exit(1);
});
