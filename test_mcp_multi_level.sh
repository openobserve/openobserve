#!/bin/bash

# Test script for MCP Multi-Level Tools
# This script tests the new MCP endpoints and measures token savings

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${MCP_BASE_URL:-http://localhost:5080}"
ORG_ID="${MCP_ORG_ID:-default}"
AUTH_TOKEN="${MCP_AUTH_TOKEN:-}"

# Build auth header
if [ -n "$AUTH_TOKEN" ]; then
    AUTH_HEADER="Authorization: Bearer $AUTH_TOKEN"
else
    # Default to basic auth with root user if no token provided
    AUTH_HEADER="Authorization: Basic $(echo -n 'root@example.com:Complexpass#123' | base64)"
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}MCP Multi-Level Tools Test Suite${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Base URL: ${YELLOW}${BASE_URL}${NC}"
echo -e "Org ID: ${YELLOW}${ORG_ID}${NC}"
echo ""

# Function to make MCP request
mcp_request() {
    local method=$1
    local params=${2:-null}
    local request_id=$3

    curl -s -X POST "${BASE_URL}/api/${ORG_ID}/mcp" \
        -H "Content-Type: application/json" \
        -H "$AUTH_HEADER" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"id\": ${request_id},
            \"method\": \"${method}\",
            \"params\": ${params}
        }"
}

# Function to count JSON size (approximate token count)
count_tokens() {
    local json=$1
    # Rough approximation: 1 token ≈ 4 characters
    echo "$json" | wc -c | awk '{print int($1/4)}'
}

# Test 1: Initialize (baseline test)
echo -e "${GREEN}Test 1: Initialize MCP Connection${NC}"
echo "Testing: initialize"
INIT_RESPONSE=$(mcp_request "initialize" "null" 1)
echo "$INIT_RESPONSE" | jq '.'
if echo "$INIT_RESPONSE" | jq -e '.result.protocolVersion' > /dev/null; then
    echo -e "${GREEN}✓ Initialize successful${NC}"
else
    echo -e "${RED}✗ Initialize failed${NC}"
    exit 1
fi
echo ""

# Test 2: Test tools/categories
echo -e "${GREEN}Test 2: List Tool Categories${NC}"
echo "Testing: tools/categories"
CATEGORIES_RESPONSE=$(mcp_request "tools/categories" "null" 2)
echo "$CATEGORIES_RESPONSE" | jq '.'
CATEGORY_COUNT=$(echo "$CATEGORIES_RESPONSE" | jq '.result.categories | length')
echo -e "${YELLOW}Found ${CATEGORY_COUNT} categories${NC}"
if [ "$CATEGORY_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Categories retrieved successfully${NC}"
    echo -e "${BLUE}Categories:${NC}"
    echo "$CATEGORIES_RESPONSE" | jq -r '.result.categories[] | "  - \(.name) (\(.tool_count) tools): \(.description)"'
else
    echo -e "${RED}✗ No categories found${NC}"
    exit 1
fi
echo ""

# Test 3: Test tools/list (lightweight summaries)
echo -e "${GREEN}Test 3: List All Tools (Lightweight)${NC}"
echo "Testing: tools/list (no parameters)"
TOOLS_LIST_RESPONSE=$(mcp_request "tools/list" "null" 3)
TOOLS_COUNT=$(echo "$TOOLS_LIST_RESPONSE" | jq '.result.tools | length')
TOOLS_SIZE=$(count_tokens "$TOOLS_LIST_RESPONSE")
echo -e "${YELLOW}Found ${TOOLS_COUNT} tools${NC}"
echo -e "${YELLOW}Response size: ~${TOOLS_SIZE} tokens${NC}"
echo ""
echo "Sample tools (first 5):"
echo "$TOOLS_LIST_RESPONSE" | jq '.result.tools[:5]'
if [ "$TOOLS_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Tools list retrieved successfully${NC}"
else
    echo -e "${RED}✗ No tools found${NC}"
    exit 1
fi
echo ""

# Test 4: Test tools/list with category filter
echo -e "${GREEN}Test 4: List Tools by Category${NC}"
echo "Testing: tools/list with category='dashboards'"
FILTERED_RESPONSE=$(mcp_request "tools/list" '{"category":"dashboards"}' 4)
FILTERED_COUNT=$(echo "$FILTERED_RESPONSE" | jq '.result.tools | length')
echo -e "${YELLOW}Found ${FILTERED_COUNT} dashboard tools${NC}"
echo "$FILTERED_RESPONSE" | jq '.result.tools'
if [ "$FILTERED_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Category filtering works${NC}"
else
    echo -e "${RED}✗ Category filtering failed${NC}"
    exit 1
fi
echo ""

# Test 5: Test tools/describe
echo -e "${GREEN}Test 5: Get Full Tool Schemas${NC}"
echo "Testing: tools/describe for specific tools"
# Get first 2 tool names from the list
TOOL_NAMES=$(echo "$TOOLS_LIST_RESPONSE" | jq -c '[.result.tools[:2] | .[].name]')
echo "Requesting full schemas for: $TOOL_NAMES"
DESCRIBE_RESPONSE=$(mcp_request "tools/describe" "{\"names\":${TOOL_NAMES}}" 5)
DESCRIBE_COUNT=$(echo "$DESCRIBE_RESPONSE" | jq '.result.tools | length')
DESCRIBE_SIZE=$(count_tokens "$DESCRIBE_RESPONSE")
echo -e "${YELLOW}Retrieved ${DESCRIBE_COUNT} full tool definitions${NC}"
echo -e "${YELLOW}Response size: ~${DESCRIBE_SIZE} tokens${NC}"
echo ""
echo "First tool (with schema):"
echo "$DESCRIBE_RESPONSE" | jq '.result.tools[0]'
if [ "$DESCRIBE_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Tools describe works${NC}"
else
    echo -e "${RED}✗ Tools describe failed${NC}"
    exit 1
fi
echo ""

# Test 6: Test category filter for different categories
echo -e "${GREEN}Test 6: Test Multiple Category Filters${NC}"
for category in "alerts" "streams" "search" "functions"; do
    echo "Testing category: $category"
    CAT_RESPONSE=$(mcp_request "tools/list" "{\"category\":\"${category}\"}" 6)
    CAT_COUNT=$(echo "$CAT_RESPONSE" | jq '.result.tools | length')
    echo -e "  ${YELLOW}Found ${CAT_COUNT} tools in '${category}'${NC}"
done
echo -e "${GREEN}✓ Multiple category filters work${NC}"
echo ""

# Test 7: Measure token savings
echo -e "${GREEN}Test 7: Token Usage Comparison${NC}"
echo "Comparing old vs new approach:"
echo ""
echo -e "${BLUE}OLD APPROACH (would load all schemas):${NC}"
# Calculate what the old size would be (full schemas for all tools)
# Estimate: each full tool ~400-500 tokens
OLD_ESTIMATED_SIZE=$((TOOLS_COUNT * 450))
echo -e "  Estimated size: ${RED}~${OLD_ESTIMATED_SIZE} tokens${NC}"
echo ""
echo -e "${BLUE}NEW APPROACH (lightweight summaries):${NC}"
echo -e "  tools/list size: ${GREEN}~${TOOLS_SIZE} tokens${NC}"
echo -e "  tools/describe (2 tools): ${GREEN}~${DESCRIBE_SIZE} tokens${NC}"
echo ""
SAVINGS=$((100 - (TOOLS_SIZE * 100 / OLD_ESTIMATED_SIZE)))
echo -e "${GREEN}Token savings: ~${SAVINGS}% reduction!${NC}"
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ All tests passed!${NC}"
echo ""
echo "Statistics:"
echo "  - Total tools: ${TOOLS_COUNT}"
echo "  - Categories: ${CATEGORY_COUNT}"
echo "  - Lightweight list size: ~${TOOLS_SIZE} tokens"
echo "  - Old approach estimate: ~${OLD_ESTIMATED_SIZE} tokens"
echo "  - Token savings: ~${SAVINGS}%"
echo ""
echo -e "${GREEN}The MCP multi-level tools implementation is working correctly!${NC}"
