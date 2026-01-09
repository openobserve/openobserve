#!/bin/bash

# Start OpenObserve test server with minimal configuration

echo "🚀 Starting OpenObserve test server..."
echo ""

# Set test environment
export ZO_ROOT_USER_EMAIL="root@example.com"
export ZO_ROOT_USER_PASSWORD="Complexpass#123"
export ZO_DATA_DIR="/tmp/openobserve-test"
export ZO_HTTP_PORT="5080"
export ZO_NODE_ROLE="all"

# Clean up old data if exists
if [ -d "$ZO_DATA_DIR" ]; then
    echo "Cleaning up old test data..."
    rm -rf "$ZO_DATA_DIR"
fi

echo "Configuration:"
echo "  Root user: $ZO_ROOT_USER_EMAIL"
echo "  Data dir: $ZO_DATA_DIR"
echo "  Port: $ZO_HTTP_PORT"
echo ""
echo "Starting server (press Ctrl+C to stop)..."
echo ""

./target/debug/openobserve
