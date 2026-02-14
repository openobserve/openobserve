# Logs Query Builder - Behavior Guide

What happens in different scenarios when using the Build tab.

---

## Switching to Build Tab - Scenarios

### Scenario 1: No Query, SQL Mode OFF

**Starting state:**
- Query editor is empty
- SQL Mode is OFF
- Stream "default" is selected

**What happens when you click Build:**
1. SQL Mode turns ON automatically
2. Query is generated: `SELECT * FROM "default"`
3. Quick Mode turns ON (if enabled in config)
4. Build tab opens in **Custom SQL Mode** 
5. Chart type: **Table** (with dynamic columns = true)

---

### Scenario 2: No Query, SQL Mode ON

**Starting state:**
- Query editor is empty
- SQL Mode is ON
- Stream "default" is selected

**What happens when you click Build:**
1. Query is generated: `SELECT * FROM "default"`
2. Build tab opens in **Builder Mode**
3. Chart type: **Line** (default)

---

### Scenario 3: Simple SELECT * Query

**Starting state:**
- Query: `SELECT * FROM "logs"`
- SQL Mode is ON

**What happens when you click Build:**
1. Query is parsed but no explicit fields found (`*` = all columns)
2. Build tab opens in **Custom SQL Mode**
3. Chart type: **Table** (with dynamic columns)
4. Quick Mode turns ON (SELECT * pattern detected)
5. Query editor is **editable**

---

### Scenario 4: Histogram Query (Time Series)

**Starting state:**
- Query: `SELECT histogram(_timestamp) as time, count(*) as count FROM "logs" GROUP BY time`
- SQL Mode is ON

**What happens when you click Build:**
1. Query is parsed successfully
2. Build tab opens in **Builder Mode**
3. Chart type: **Bar** (default chart type)
4. Fields populated: X-axis = histogram, Y-axis = count

---

### Scenario 5: Count Only Query (No Grouping)

**Starting state:**
- Query: `SELECT count(*) as total FROM "logs"`
- SQL Mode is ON

**What happens when you click Build:**
1. Query is parsed successfully
2. Build tab opens in **Builder Mode**
3. Chart type: **Metric** (big number display - only Y-axis, no X-axis)

---

### Scenario 6: Query with 3+ GROUP BY Fields

**Starting state:**
- Query: `SELECT status, method, host, count(*) FROM "logs" GROUP BY status, method, host`
- SQL Mode is ON

**What happens when you click Build:**
1. Query is parsed successfully
2. Build tab opens in **Builder Mode**
3. Chart type: **Table** (too many grouping fields for chart)

---

### Scenario 7: Simple JOIN Query

**Starting state:**
- Query: `SELECT a.field, b.field FROM "stream1" a JOIN "stream2" b ON a.id = b.id`
- SQL Mode is ON

**What happens when you click Build:**
1. Query is parsed successfully
2. Build tab opens in **Builder Mode**
3. Chart type: **Bar** (default)
4. JOIN is recognized and shown in builder

---

### Scenario 8: Nested JOIN Query

**Starting state:**
- Query: `SELECT * FROM "a" JOIN ("b" JOIN "c" ON b.x = c.x) ON a.y = b.y`
- SQL Mode is ON

**What happens when you click Build:**
1. **Complex pattern detected** (nested JOIN with parentheses)
2. Build tab opens in **Custom SQL Mode**
3. Chart type: **Table** (with dynamic columns)
4. Query editor is **editable**
5. Field selectors are **hidden**

---

### Scenario 9: CTE Query (WITH clause)

**Starting state:**
- Query: `WITH recent AS (SELECT * FROM "logs" WHERE _timestamp > now() - interval '1 hour') SELECT * FROM recent`
- SQL Mode is ON

**What happens when you click Build:**
1. **Complex pattern detected** (CTE)
2. Build tab opens in **Custom SQL Mode**
3. Chart type: **Table** (with dynamic columns)
4. Query editor is **editable**

---

### Scenario 10: Subquery

**Starting state:**
- Query: `SELECT * FROM (SELECT status, count(*) FROM "logs" GROUP BY status) subq`
- SQL Mode is ON

**What happens when you click Build:**
1. **Complex pattern detected** (subquery)
2. Build tab opens in **Custom SQL Mode**
3. Chart type: **Table** (with dynamic columns)

---

### Scenario 11: UNION Query

**Starting state:**
- Query: `SELECT * FROM "logs1" UNION SELECT * FROM "logs2"`
- SQL Mode is ON

**What happens when you click Build:**
1. **Complex pattern detected** (UNION)
2. Build tab opens in **Custom SQL Mode**
3. Chart type: **Table** (with dynamic columns)

---

### Scenario 12: Window Function Query

**Starting state:**
- Query: `SELECT *, ROW_NUMBER() OVER (PARTITION BY status ORDER BY _timestamp) FROM "logs"`
- SQL Mode is ON

**What happens when you click Build:**
1. **Complex pattern detected** (window function)
2. Build tab opens in **Custom SQL Mode**
3. Chart type: **Table** (with dynamic columns)

---

### Scenario 13: Nested Function Query

**Starting state:**
- Query: `SELECT ceil(count(*)) as rounded_count FROM "logs"`
- SQL Mode is ON

**What happens when you click Build:**
1. **Complex pattern detected** (nested function - function inside function)
2. Build tab opens in **Custom SQL Mode**
3. Chart type: **Table** (with dynamic columns)

---

### Scenario 14: JSON Operations Query

**Starting state:**
- Query: `SELECT data->>'name' as name FROM "logs"`
- SQL Mode is ON

**What happens when you click Build:**
1. **Complex pattern detected** (JSON operator)
2. Build tab opens in **Custom SQL Mode**
3. Chart type: **Table** (with dynamic columns)

---

### Scenario 15: CASE/WHEN Query

**Starting state:**
- Query: `SELECT CASE WHEN status >= 500 THEN 'error' ELSE 'ok' END as status_type, count(*) FROM "logs" GROUP BY status_type`
- SQL Mode is ON

**What happens when you click Build:**
1. Query is parsed successfully (CASE/WHEN is supported)
2. Build tab opens in **Builder Mode**
3. Chart type: **Bar** (default)
4. CASE/WHEN shown as "raw" field type

---

### Scenario 16: Multiple JOINs (Flat)

**Starting state:**
- Query: `SELECT a.field as "field1", b.field as "field2" FROM "a" INNER JOIN "b" AS stream_0 ON a.x = b.x INNER JOIN "c" AS stream_1 ON b.y = c.y GROUP BY field1, field2 ORDER BY field1 ASC`
- SQL Mode is ON

**What happens when you click Build:**
1. Query is parsed successfully (flat JOINs are supported)
2. Build tab opens in **Builder Mode**
3. Chart type: **Bar** (default)

---

### Scenario 17: Opening Shared Link (First Time)

**Starting state:**
- URL contains `build_data` parameter with chart type "bar"
- Query in URL: `SELECT status, count(*) FROM "logs" GROUP BY status`

**What happens:**
1. Build tab opens
2. Query is parsed successfully
3. Chart type: **Bar** (restored from URL - first toggle)
4. Build tab opens in **Builder Mode**

---

### Scenario 18: Switching Back to Build Tab (After First Time)

**Starting state:**
- Previously visited Build tab
- URL still has `build_data` with chart type "bar"
- Query: `SELECT count(*) FROM "logs"` (metric query)

**What happens:**
1. Build tab opens
2. Query is parsed successfully
3. Chart type: **Metric** (auto-selected, URL ignored on subsequent toggles)

---

### Scenario 19: Invalid SQL Syntax

**Starting state:**
- Query: `SELEC * FORM "logs"` (typos)
- SQL Mode is ON

**What happens when you click Build:**
1. **Parse error** (invalid SQL)
2. Build tab opens in **Custom SQL Mode**
3. Chart type: **Table** (with dynamic columns)
4. Query editor is **editable** (so user can fix the query)

---

### Scenario 20: Query with WHERE Filters

**Starting state:**
- Query: `SELECT histogram(_timestamp), count(*) FROM "logs" WHERE status = 500 AND method = 'GET' GROUP BY 1`
- SQL Mode is ON

**What happens when you click Build:**
1. Query is parsed successfully
2. Build tab opens in **Builder Mode**
3. Chart type: **Bar** (default)
4. Filters populated in filter section

---

## Summary Table

| Query Type | Mode | Chart Type |
|------------|------|------------|
| SELECT * | **Custom** | **Table** |
| Histogram + count | Builder | Bar |
| Count only (no GROUP BY) | Builder | Metric |
| 1-2 GROUP BY fields | Builder | Bar |
| 3+ GROUP BY fields | Builder | Table |
| Simple JOIN | Builder | Bar |
| CASE/WHEN | Builder | Bar |
| Multiple flat JOINs | Builder | Bar |
| CTE (WITH clause) | **Custom** | **Table** |
| Subquery | **Custom** | **Table** |
| Nested JOIN | **Custom** | **Table** |
| UNION/INTERSECT/EXCEPT | **Custom** | **Table** |
| Window functions | **Custom** | **Table** |
| Nested functions | **Custom** | **Table** |
| JSON operations | **Custom** | **Table** |
| Invalid SQL | **Custom** | **Table** |

---

## Quick Mode Auto-Enable

Quick Mode is automatically enabled when switching to Build tab if:

| Condition | Quick Mode |
|-----------|------------|
| SQL Mode was OFF | ✅ Enabled |
| Query is `SELECT * FROM ...` | ✅ Enabled |
| Complex aggregation query | ❌ Not changed |

**Requires:** `quick_mode_enabled = true` in config

---

## SQL Mode Auto-Enable

| Starting State | After Clicking Build |
|----------------|---------------------|
| SQL Mode OFF | SQL Mode **ON** |
| SQL Mode ON | SQL Mode ON (no change) |

**Build tab always requires SQL Mode to be ON.**

---

## Chart Type Priority

When auto-selecting chart type:

1. **Custom Mode?** → Table
2. **3+ GROUP BY fields?** → Table
3. **Only Y-axis (no X, no breakdown)?** → Metric
4. **Everything else** → Bar (default)

**Exception:** First visit with shared link uses chart type from URL.

---

## Builder Mode vs Custom Mode

| Aspect | Builder Mode | Custom Mode |
|--------|--------------|-------------|
| Query Editor | Read-only | Editable |
| Field Selectors | Visible | Hidden |
| When Used | Parseable queries | Complex/unparseable queries |
| Default Chart | Bar/Metric | Table |
