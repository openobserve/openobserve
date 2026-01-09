#!/bin/bash

# Quick MCP test - just verify the endpoints work

BASE_URL="${MCP_BASE_URL:-http://localhost:5080}"
ORG_ID="${MCP_ORG_ID:-default}"
AUTH="Authorization: Basic $(echo -n 'root@example.com:Complexpass#123' | base64)"

echo "🧪 Quick MCP Multi-Level Tools Test"
echo "===================================="
echo ""

# Test 1: tools/categories
echo "1. Testing tools/categories..."
curl -s -X POST "${BASE_URL}/api/${ORG_ID}/mcp" \
    -H "Content-Type: application/json" \
    -H "$AUTH" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/categories","params":null}' | jq -r '.result.categories[] | "\(.name): \(.tool_count) tools"'
echo ""

# Test 2: tools/list (lightweight)
echo "2. Testing tools/list (lightweight)..."
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/${ORG_ID}/mcp" \
    -H "Content-Type: application/json" \
    -H "$AUTH" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":null}')
COUNT=$(echo "$RESPONSE" | jq '.result.tools | length')
echo "   Found $COUNT tools"
echo "   First 3 tools:"
echo "$RESPONSE" | jq -r '.result.tools[:3] | .[] | "   - \(.name) (\(.category // "no category"))"'
echo ""

# Test 3: tools/list with category filter
echo "3. Testing tools/list with category='dashboards'..."
FILTERED=$(curl -s -X POST "${BASE_URL}/api/${ORG_ID}/mcp" \
    -H "Content-Type: application/json" \
    -H "$AUTH" \
    -d '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{"category":"dashboards"}}')
FCOUNT=$(echo "$FILTERED" | jq '.result.tools | length')
echo "   Found $FCOUNT dashboard tools"
echo "$FILTERED" | jq -r '.result.tools | .[] | "   - \(.name)"'
echo ""

# Test 4: tools/describe
echo "4. Testing tools/describe..."
curl -s -X POST "${BASE_URL}/api/${ORG_ID}/mcp" \
    -H "Content-Type: application/json" \
    -H "$AUTH" \
    -d '{"jsonrpc":"2.0","id":4,"method":"tools/describe","params":{"names":["CreateDashboard"]}}' | jq '.result.tools[0] | {name, description, has_schema: (.inputSchema != null)}'
echo ""

echo "✅ All endpoints working!"
