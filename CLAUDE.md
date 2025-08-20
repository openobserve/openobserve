# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenObserve is a cloud-native observability platform built in Rust with a Vue.js frontend. It handles logs, metrics, traces, and analytics at petabyte scale, serving as an alternative to Elasticsearch/Splunk/Datadog with significantly lower storage costs and high performance.

## Architecture

### Backend (Rust)
- **Main application**: Rust-based server with embedded web UI
- **Workspace structure**: Multi-crate workspace with specialized components:
  - `src/config/`: Configuration management and data structures
  - `src/infra/`: Infrastructure layer (database, storage, caching)
  - `src/ingester/`: Data ingestion engine with write-ahead log
  - `src/wal/`: Write-ahead log implementation
  - `src/proto/`: Protocol buffer definitions
  - `src/flight/`: Apache Arrow Flight integration
  - `src/report_server/`: Report generation service

- **Core modules**:
  - `src/service/`: Business logic (search, ingestion, alerts, etc.)
  - `src/handler/`: HTTP and gRPC request handlers
  - `src/router/`: Request routing and middleware
  - `src/job/`: Background jobs (compaction, alerts, metrics)
  - `src/common/`: Shared utilities and metadata structures

### Frontend (Vue.js)
- **Location**: `web/` directory
- **Framework**: Vue 3 with Quasar UI framework
- **Build system**: Vite for development and production builds
- **Key directories**:
  - `web/src/views/`: Main application pages
  - `web/src/components/`: Reusable UI components
  - `web/src/services/`: API communication layer
  - `web/src/composables/`: Vue composition functions

## Common Development Commands

### Rust Backend
```bash
# Build for development
cargo build

# Build for production
cargo build --release

# Run with default admin user
ZO_ROOT_USER_EMAIL="root@example.com" ZO_ROOT_USER_PASSWORD="Complexpass#123" cargo run

# Run tests
cargo test

# Run tests with coverage
./coverage.sh

# Generate coverage report in HTML
cargo llvm-cov --html

# Check code formatting
cargo fmt --check

# Run clippy linter
cargo clippy

# Check specific workspace member
cargo check -p config
cargo test -p ingester
```

### Frontend (Web UI)
```bash
cd web

# Install dependencies
npm install

# Development server (port 8081)
npm run dev

# Build for production
npm run build

# Run tests
npm run test:unit

# Run tests with coverage
npm run test:unit:coverage

# Lint and fix code
npm run lint

# Type checking
npm run type-check

# End-to-end tests
npm run test:e2e
```

### Full Application Development
```bash
# 1. Build web UI first (required for embedding in Rust binary)
cd web && npm install && npm run build && cd ..

# 2. Build and run Rust application
ZO_ROOT_USER_EMAIL="root@example.com" ZO_ROOT_USER_PASSWORD="Complexpass#123" cargo run
```

## Testing

### Backend Testing
- Test coverage must be ≥57% functions, ≥54% lines, ≥52% regions
- Use `./coverage.sh` to run coverage tests
- Specific test commands:
  ```bash
  cargo test                    # All tests
  cargo test --bin openobserve  # Main binary tests
  cargo test -p config          # Config crate tests
  ```

### Frontend Testing
- Unit tests: `npm run test:unit`
- E2E tests with Cypress: `npm run test:e2e`
- Coverage check: `npm run test:coverage:check`

### API Testing
- Python-based API tests in `tests/api-testing/`
- Run with: `cd tests/api-testing && make test`
- UI testing with Playwright in `tests/ui-testing/`

## Database and Storage

### Supported Databases
- **Development**: SQLite (default, embedded)
- **Production**: PostgreSQL, MySQL, or external databases
- **Metadata**: Stored in configured database
- **Object Storage**: Local disk, S3, MinIO, GCS, Azure Blob Storage

### Key Database Tables
- Organizations, users, and permissions
- Streams and schema definitions
- Alerts, dashboards, and pipelines
- File lists and ingestion metadata

## Key Features and Components

### Data Ingestion
- **OTLP support**: OpenTelemetry Protocol for logs, metrics, traces
- **Multiple formats**: JSON, syslog, Loki, Prometheus remote write
- **Pipelines**: VRL-based data transformation and enrichment
- **Real-time processing**: Streaming ingestion with indexing

### Query and Search
- **SQL interface**: Full SQL support with custom functions
- **PromQL**: Prometheus-compatible query language
- **Apache DataFusion**: Query engine for analytics
- **Apache Arrow**: Columnar data format for performance
- **Tantivy**: Full-text search indexing

### Observability Stack
- **Logs**: High-performance log storage and search
- **Metrics**: Time-series data with Prometheus compatibility
- **Traces**: Distributed tracing with OpenTelemetry
- **RUM**: Real User Monitoring with session replay
- **Dashboards**: Interactive visualization and reporting

## Environment Variables

Key environment variables for development:
- `ZO_ROOT_USER_EMAIL`: Default admin email
- `ZO_ROOT_USER_PASSWORD`: Default admin password
- `VITE_OPENOBSERVE_ENDPOINT`: API endpoint for web UI (dev: http://localhost:5080)

## Development Workflow

1. **Backend changes**: Modify Rust code, run `cargo build`, test with `cargo test`
2. **Frontend changes**: Modify Vue.js code in `web/`, run `npm run dev` for live reload
3. **Full rebuild**: Always run `cd web && npm run build && cd ..` before final Rust build
4. **Testing**: Run both backend (`cargo test`, `./coverage.sh`) and frontend (`npm run test:unit`) tests
5. **Linting**: Use `cargo clippy` for Rust and `npm run lint` for JavaScript

## Performance Considerations

- The web UI is embedded in the Rust binary during build
- Use `cargo build --release` for production builds
- Object storage is preferred for large deployments
- Consider using external databases (PostgreSQL/MySQL) for production
- WAL (Write-Ahead Log) ensures data durability during ingestion

## Common Patterns

### Adding New API Endpoints
1. Define request/response models in `src/handler/http/models/`
2. Implement handler in `src/handler/http/request/`
3. Add route in `src/handler/http/router/`
4. Add service logic in `src/service/`
5. Update OpenAPI documentation with `utoipa` attributes

### Database Schema Changes
1. Create migration in `src/infra/table/migration/`
2. Update entity definitions in `src/infra/table/entity/`
3. Implement database operations in relevant `src/infra/` modules
4. Update service layer in `src/service/db/`

### Adding New UI Components
1. Create component in `web/src/components/`
2. Add to relevant page in `web/src/views/`
3. Update API services in `web/src/services/`
4. Add composables if needed in `web/src/composables/`

## CI/CD Requirements

- Rust code coverage must meet minimum thresholds
- All ESLint issues must be resolved
- Both backend and frontend tests must pass
- Use conventional commit messages (feat:, fix:, docs:, etc.)
- okay one important thing you need to remember is we have enterprise version as well which can be build using `cre` on this machine and you can use `cchk` to run cargo check. so whenever working on an enterprise feature use `cre` to build. enterprise version actually links a o2-enterprise crate which is at `../o2-enterprise`. Usually the workflow is to create branches with same name on both repos when working with enterprise features. Now when making any changes to Cargo.toml you have to make changes in the `Cargo.toml.openobserve` as well, because when building enterprise we copy this toml from enterprise repo to opensource repo and then build.
- /add-dir ../o2-enterprise
- always prefer `cchk` over `cargo build`
