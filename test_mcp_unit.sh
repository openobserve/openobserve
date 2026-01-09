#!/bin/bash

# Unit test for MCP multi-level tools (no server needed)
# This runs the Rust unit tests

echo "🧪 Running MCP Unit Tests"
echo "========================="
echo ""

echo "Testing o2-enterprise MCP module..."
cd ../o2-enterprise
cargo test --package o2_enterprise --lib mcp::

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ All unit tests passed!"
    echo ""
    echo "Tests verified:"
    echo "  ✓ MCPMethod enum parsing"
    echo "  ✓ tools/list handler"
    echo "  ✓ tools/categories handler"
    echo "  ✓ tools/describe handler"
    echo "  ✓ Request/response serialization"
    echo "  ✓ Schema simplification"
else
    echo ""
    echo "❌ Some tests failed"
    exit 1
fi
