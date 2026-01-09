# MCP Multi-Level Tools Testing Guide

This guide will help you test the new MCP multi-level tools implementation before committing.

## Prerequisites

1. Build OpenObserve with enterprise features (build is running in background)
2. Ensure you have `curl` and `jq` installed for testing

## Testing Options

### Option 1: Automated Test Suite (Recommended)

Run the comprehensive test script:

```bash
# Start OpenObserve first (in another terminal)
./target/debug/openobserve

# Wait for server to start, then run tests
./test_mcp_multi_level.sh
```

This will test:
- ✅ MCP initialization
- ✅ tools/categories endpoint
- ✅ tools/list with lightweight summaries
- ✅ tools/list with category filtering
- ✅ tools/describe for on-demand schemas
- ✅ Token usage comparison (before vs after)

### Option 2: Quick Manual Test

```bash
# Start OpenObserve first
./target/debug/openobserve

# Run quick test
./test_mcp_quick.sh
```

### Option 3: Manual Testing with curl

If you prefer manual testing, here are the commands:

#### 1. Test tools/categories

```bash
curl -X POST http://localhost:5080/api/default/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'root@example.com:Complexpass#123' | base64)" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/categories",
    "params": null
  }' | jq '.'
```

**Expected**: List of categories with tool counts

#### 2. Test tools/list (lightweight)

```bash
curl -X POST http://localhost:5080/api/default/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'root@example.com:Complexpass#123' | base64)" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": null
  }' | jq '.'
```

**Expected**: Array of tool summaries (name, description, category only - NO inputSchema)

#### 3. Test tools/list with category filter

```bash
curl -X POST http://localhost:5080/api/default/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'root@example.com:Complexpass#123' | base64)" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/list",
    "params": {"category": "dashboards"}
  }' | jq '.'
```

**Expected**: Only tools with category="dashboards"

#### 4. Test tools/describe

```bash
curl -X POST http://localhost:5080/api/default/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'root@example.com:Complexpass#123' | base64)" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/describe",
    "params": {
      "names": ["CreateDashboard", "ListDashboards"]
    }
  }' | jq '.'
```

**Expected**: Full tool definitions WITH inputSchema

## What to Verify

### ✅ Checklist

- [ ] **tools/categories** returns a list of categories with counts
- [ ] **tools/list** returns tool summaries WITHOUT inputSchema (lightweight)
- [ ] **tools/list** with category filter only returns tools in that category
- [ ] **tools/describe** returns full tool definitions WITH inputSchema
- [ ] Response size of tools/list is much smaller than before (~10x reduction)
- [ ] All tools have a "category" field
- [ ] Categories include: dashboards, alerts, streams, functions, etc.

### 🔍 Token Usage Verification

Compare the response sizes:

```bash
# Old approach (would return all full schemas)
# Estimated: ~209 tools × 450 tokens = ~94,000 tokens

# New approach (lightweight summaries)
# tools/list response should be: ~10,000 tokens (90% reduction!)

# Measure actual size:
curl -s -X POST http://localhost:5080/api/default/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'root@example.com:Complexpass#123' | base64)" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":null}' | \
  wc -c | awk '{print "Response size: " int($1/4) " tokens (approx)"}'
```

### 📊 Expected Results

**Before this change:**
- tools/list returned ~209 full tool definitions
- Each with complete JSON Schema (inputSchema)
- Total size: ~80,000-100,000 tokens

**After this change:**
- tools/list returns ~209 lightweight summaries
- Only name, description, category (no schema)
- Total size: ~10,000 tokens
- **90% reduction!**

On-demand schema loading:
- tools/describe returns full schemas only when requested
- Typical use: load 5-10 tools at a time = ~2,000-4,000 tokens

## Troubleshooting

### Server won't start

Check if the port is already in use:
```bash
lsof -i :5080
```

### Authentication fails

The default credentials are:
- Username: `root@example.com`
- Password: `Complexpass#123`

Or set environment variable:
```bash
export MCP_AUTH_TOKEN="your-jwt-token"
./test_mcp_multi_level.sh
```

### No tools found

Make sure OpenObserve has initialized properly:
```bash
# Check logs
tail -f /tmp/openobserve/logs/openobserve.log
```

### Response shows error

Check the JSON-RPC error:
```bash
curl -s ... | jq '.error'
```

Common errors:
- `-32601`: Method not found (check MCP is enabled in enterprise build)
- `-32600`: Invalid request (check JSON syntax)
- `401`: Authentication failed

## Environment Variables

Customize the test with environment variables:

```bash
# Change base URL
export MCP_BASE_URL="http://localhost:8080"

# Change organization
export MCP_ORG_ID="my-org"

# Use JWT token instead of basic auth
export MCP_AUTH_TOKEN="eyJhbGc..."

# Run tests
./test_mcp_multi_level.sh
```

## Success Criteria

Your implementation is working correctly if:

1. ✅ All test scripts pass without errors
2. ✅ tools/list response is significantly smaller (~90% reduction)
3. ✅ Tools are properly categorized
4. ✅ Category filtering works
5. ✅ On-demand schema loading works via tools/describe
6. ✅ No compilation errors or warnings
7. ✅ All unit tests pass (36/36)

## Next Steps After Testing

Once all tests pass:

1. Commit the changes
2. Create pull requests
3. Update documentation
4. Monitor production metrics after deployment
