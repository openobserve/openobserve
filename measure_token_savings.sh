#!/bin/bash

# Measure actual token savings

BASE_URL="${MCP_BASE_URL:-http://localhost:5080}"
ORG_ID="${MCP_ORG_ID:-default}"
AUTH="Authorization: Basic $(echo -n 'root@example.com:Complexpass#123' | base64)"

echo "📊 Measuring Token Savings"
echo "=========================="
echo ""

# Get lightweight list
LIGHTWEIGHT=$(curl -s -X POST "${BASE_URL}/api/${ORG_ID}/mcp" \
    -H "Content-Type: application/json" \
    -H "$AUTH" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":null}')

TOOL_COUNT=$(echo "$LIGHTWEIGHT" | jq '.result.tools | length')
LIGHTWEIGHT_SIZE=$(echo "$LIGHTWEIGHT" | wc -c)
LIGHTWEIGHT_TOKENS=$((LIGHTWEIGHT_SIZE / 4))

echo "NEW APPROACH (Lightweight summaries):"
echo "  Tools: $TOOL_COUNT"
echo "  Response size: $LIGHTWEIGHT_SIZE bytes"
echo "  Estimated tokens: ~$LIGHTWEIGHT_TOKENS"
echo ""

# Get first tool name for comparison
FIRST_TOOL=$(echo "$LIGHTWEIGHT" | jq -r '.result.tools[0].name')

# Get full schema for comparison
FULL_SCHEMA=$(curl -s -X POST "${BASE_URL}/api/${ORG_ID}/mcp" \
    -H "Content-Type: application/json" \
    -H "$AUTH" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/describe\",\"params\":{\"names\":[\"$FIRST_TOOL\"]}}")

FULL_SIZE=$(echo "$FULL_SCHEMA" | jq '.result.tools[0]' | wc -c)
AVG_FULL_TOKENS=$((FULL_SIZE / 4))

echo "FULL SCHEMA (Single tool with inputSchema):"
echo "  Tool: $FIRST_TOOL"
echo "  Response size: $FULL_SIZE bytes"
echo "  Estimated tokens: ~$AVG_FULL_TOKENS per tool"
echo ""

# Calculate old approach
OLD_ESTIMATED=$((TOOL_COUNT * AVG_FULL_TOKENS))
SAVINGS=$((100 - (LIGHTWEIGHT_TOKENS * 100 / OLD_ESTIMATED)))

echo "COMPARISON:"
echo "  OLD approach (all full schemas): ~$OLD_ESTIMATED tokens"
echo "  NEW approach (lightweight list): ~$LIGHTWEIGHT_TOKENS tokens"
echo ""
echo "🎉 Token savings: ~$SAVINGS% reduction!"
echo ""
echo "Typical usage pattern:"
echo "  1. Load lightweight list: ~$LIGHTWEIGHT_TOKENS tokens"
echo "  2. Describe 5 tools on-demand: ~$((AVG_FULL_TOKENS * 5)) tokens"
echo "  Total: ~$((LIGHTWEIGHT_TOKENS + (AVG_FULL_TOKENS * 5))) tokens"
echo "  vs OLD: ~$OLD_ESTIMATED tokens"
PRACTICAL_SAVINGS=$((100 - ((LIGHTWEIGHT_TOKENS + (AVG_FULL_TOKENS * 5)) * 100 / OLD_ESTIMATED)))
echo "  Practical savings: ~$PRACTICAL_SAVINGS%"
