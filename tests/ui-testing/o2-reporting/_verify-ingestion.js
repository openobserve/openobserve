#!/usr/bin/env node
/**
 * Quick verification script — queries O2 to confirm ingested data.
 * Usage: node o2-reporting/_verify-ingestion.js [run_id]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const url = process.env.O2_REPORT_URL;
const org = process.env.O2_REPORT_ORG;
const email = process.env.O2_REPORT_EMAIL;
const password = process.env.O2_REPORT_PASSWORD;
const stream = process.env.O2_REPORT_STREAM || 'e2e_playwright_reports';
const auth = Buffer.from(`${email}:${password}`).toString('base64');
const runId = process.argv[2] || 'test_ingest_01';

async function verify() {
  // 1. Check stream exists
  console.log(`\nVerifying data in O2 (run_id: ${runId})`);
  console.log('='.repeat(50));

  const streamsRes = await fetch(`${url}/api/${org}/streams?type=logs`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const streams = await streamsRes.json();
  const found = (streams.list || []).find(s => s.name === stream);

  if (found) {
    console.log(`Stream: ${found.name}`);
    console.log(`  Doc count: ${found.stats?.doc_count || 'unknown'}`);
    console.log(`  Storage: ${found.stats?.storage_size || 'unknown'} bytes`);
  } else {
    console.log(`Stream "${stream}" not found yet (may take a moment).`);
    return;
  }

  // 2. Query grouped by shard + status
  const searchBody = {
    query: {
      sql: `SELECT shard, status, COUNT(*) as cnt FROM "${stream}" WHERE run_id = '${runId}' GROUP BY shard, status ORDER BY shard, status`,
      start_time: Date.now() * 1000 - (86400 * 1000000),
      end_time: Date.now() * 1000 + (3600 * 1000000),
      from: 0,
      size: 100,
    },
  };

  const searchRes = await fetch(`${url}/api/${org}/_search?type=logs`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(searchBody),
  });

  if (!searchRes.ok) {
    console.log(`Search failed: ${searchRes.status} ${await searchRes.text()}`);
    return;
  }

  const data = await searchRes.json();
  console.log(`\nResults for run_id = "${runId}":`);
  console.log(`  Total rows: ${data.total || data.hits?.length || 0}`);

  if (data.hits && data.hits.length > 0) {
    console.log('\n  Shard        | Status    | Count');
    console.log('  ' + '-'.repeat(40));
    for (const hit of data.hits) {
      const shard = (hit.shard || '').padEnd(12);
      const status = (hit.status || '').padEnd(9);
      console.log(`  ${shard} | ${status} | ${hit.cnt}`);
    }
  } else {
    console.log('  No data found. Data may still be processing.');
  }

  // 3. Query a sample entry to show all fields
  const sampleBody = {
    query: {
      sql: `SELECT * FROM "${stream}" WHERE run_id = '${runId}' LIMIT 1`,
      start_time: Date.now() * 1000 - (86400 * 1000000),
      end_time: Date.now() * 1000 + (3600 * 1000000),
      from: 0,
      size: 1,
    },
  };

  const sampleRes = await fetch(`${url}/api/${org}/_search?type=logs`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sampleBody),
  });

  if (sampleRes.ok) {
    const sampleData = await sampleRes.json();
    if (sampleData.hits && sampleData.hits.length > 0) {
      const entry = sampleData.hits[0];
      console.log('\n  Sample entry fields:');
      const keys = Object.keys(entry).sort();
      for (const key of keys) {
        const val = typeof entry[key] === 'string' && entry[key].length > 80
          ? entry[key].slice(0, 80) + '...'
          : entry[key];
        console.log(`    ${key}: ${JSON.stringify(val)}`);
      }
    }
  }

  console.log('\nDone!\n');
}

verify().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
