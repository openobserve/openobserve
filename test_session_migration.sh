#!/bin/bash

# Session Migration Test Script
# This script automates the testing of session migration from meta table to sessions table
#
# IMPORTANT: Run as regular user, NOT with sudo!
# If you need sudo for docker, add your user to docker group:
#   sudo usermod -aG docker $USER
#   newgrp docker

set -e  # Exit on error

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "ERROR: Do not run this script with sudo!"
    echo ""
    echo "If docker requires sudo, fix it by adding your user to docker group:"
    echo "  sudo usermod -aG docker \$USER"
    echo "  newgrp docker"
    echo ""
    echo "Then run: ./test_session_migration.sh (without sudo)"
    exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="openobserve-postgres-test"
DB_USER="openobserve"
DB_PASSWORD="openobserve123"
DB_NAME="openobserve"
DB_PORT="5433"  # Using non-standard port to avoid conflicts
POSTGRES_VERSION="15"

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

run_sql() {
    docker exec $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -t -c "$1" 2>/dev/null | xargs
}

run_sql_verbose() {
    echo -e "${YELLOW}SQL: $1${NC}"
    docker exec $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -c "$1"
}

# Cleanup function
cleanup() {
    print_header "Cleaning Up"

    # Kill any remaining OpenObserve process
    if [ -n "$OPENOBSERVE_PID" ] && kill -0 $OPENOBSERVE_PID 2>/dev/null; then
        print_info "Stopping OpenObserve (PID: $OPENOBSERVE_PID)..."
        kill $OPENOBSERVE_PID 2>/dev/null || true
        sleep 2
    fi

    if docker ps -a | grep -q $CONTAINER_NAME; then
        print_info "Stopping and removing PostgreSQL container..."
        docker stop $CONTAINER_NAME >/dev/null 2>&1 || true
        docker rm $CONTAINER_NAME >/dev/null 2>&1 || true
        print_success "Container removed"
    fi

    # Remove test files if they exist
    for file in .env.test build_errors.log init.log migration_test.log openobserve_test.log entity_gen.log; do
        if [ -f "$file" ]; then
            rm "$file"
            print_success "Removed $file"
        fi
    done

    # Remove test data directory
    if [ -d "./data_test" ]; then
        rm -rf ./data_test
        print_success "Removed data_test directory"
    fi
}

# Trap to cleanup on exit
trap cleanup EXIT

# Step 1: Start PostgreSQL
print_header "Step 1: Starting PostgreSQL Container"
if docker ps | grep -q $CONTAINER_NAME; then
    print_info "Container already running, stopping it first..."
    docker stop $CONTAINER_NAME >/dev/null
    docker rm $CONTAINER_NAME >/dev/null
fi

docker run -d \
  --name $CONTAINER_NAME \
  -e POSTGRES_USER=$DB_USER \
  -e POSTGRES_PASSWORD=$DB_PASSWORD \
  -e POSTGRES_DB=$DB_NAME \
  -p $DB_PORT:5432 \
  postgres:$POSTGRES_VERSION >/dev/null

print_info "Waiting for PostgreSQL to be ready..."
sleep 5

# Test connection
if docker exec $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -c "SELECT 1;" >/dev/null 2>&1; then
    print_success "PostgreSQL is running and accessible"
else
    print_error "PostgreSQL failed to start"
    exit 1
fi

# Step 2: Create .env file
print_header "Step 2: Creating Test Configuration"
cat > .env.test << EOF
ZO_ROOT_USER_EMAIL=root@example.com
ZO_ROOT_USER_PASSWORD=Complexpass#123
ZO_META_STORE=postgres
ZO_META_POSTGRES_DSN=postgres://$DB_USER:$DB_PASSWORD@localhost:$DB_PORT/$DB_NAME
ZO_DATA_DIR=./data_test
ZO_LOCAL_MODE=true
RUST_LOG=info,openobserve=debug,sea_orm=debug
ZO_S3_PROVIDER=local
EOF
print_success "Configuration file created"

# Step 3: Build OpenObserve
print_header "Step 3: Building OpenObserve"
print_info "Building in debug mode (this may take a few minutes)..."

# Build and capture errors to a file
BUILD_LOG="build_errors.log"
if cargo build 2>&1 | tee "$BUILD_LOG" | grep -E "(Compiling|Finished|error:)" | tail -20; then
    if grep -q "error:" "$BUILD_LOG"; then
        print_error "Build completed with errors"
        echo ""
        echo "Errors found:"
        grep -A 3 "error:" "$BUILD_LOG"
        exit 1
    else
        print_success "Build completed successfully"
    fi
else
    print_error "Build process failed"
    exit 1
fi

# Step 4: Initialize database (run migrations without sessions)
print_header "Step 4: Initializing Database"
print_info "Starting OpenObserve to run migrations..."

# Check if binary exists
if [ ! -f "./target/debug/openobserve" ]; then
    print_error "OpenObserve binary not found at ./target/debug/openobserve"
    exit 1
fi

# Start OpenObserve in background
export $(cat .env.test | grep -v '^#' | xargs)
./target/debug/openobserve > init.log 2>&1 &
OPENOBSERVE_PID=$!

print_info "OpenObserve PID: $OPENOBSERVE_PID"
print_info "Waiting for server to start (up to 60 seconds)..."

# Wait for server to be ready (look for "Starting HTTP server" message)
SERVER_STARTED=false
for i in {1..60}; do
    if grep -q "Starting HTTP server" init.log 2>/dev/null; then
        print_success "OpenObserve server started"
        SERVER_STARTED=true
        break
    fi
    sleep 1
done

if [ "$SERVER_STARTED" = false ]; then
    print_error "OpenObserve failed to start within 60 seconds"
    echo ""
    echo "Full initialization log:"
    cat init.log
    kill $OPENOBSERVE_PID 2>/dev/null || true
    exit 1
fi

# Give migrations a moment to complete after server starts
sleep 3

# Stop OpenObserve
print_info "Stopping OpenObserve..."
kill $OPENOBSERVE_PID 2>/dev/null || true
wait $OPENOBSERVE_PID 2>/dev/null || true
sleep 2

# Check migration logs
print_info "Checking for migration activity in logs..."
if grep -i "migration" init.log | head -10; then
    echo ""
fi

# Check if meta table exists
if run_sql "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'meta');" | grep -q "t"; then
    print_success "Meta table created"
else
    print_error "Meta table not found"
    echo ""
    echo "Full initialization log:"
    cat init.log
    exit 1
fi

print_info "Tables created:"
run_sql_verbose "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('meta', 'sessions') ORDER BY table_name;"

# Clean up init log
rm -f init.log