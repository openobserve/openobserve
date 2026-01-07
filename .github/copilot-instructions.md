# GitHub Copilot Instructions for OpenObserve

## Project Overview

OpenObserve is a cloud-native observability platform built for logs, metrics, traces, analytics, and frontend monitoring. The project is written in Rust (backend) and Vue.js/TypeScript (frontend), designed to be 140x more cost-efficient than Elasticsearch while providing better performance.

**Key Architecture:**
- Backend: Rust with embedded SQLite
- Frontend: Vue.js 3 with TypeScript
- Storage: Parquet columnar format with S3-native design
- License: AGPL-3.0

## Development Environment Setup

### Prerequisites
- Git
- Rust & Cargo 1.70+
- Node.js v14+ and npm v6+
- Protocol Buffers compiler (protoc) >= 3.15

### Building from Source

**Backend:**
```bash
cargo build --release
```

**Frontend:**
```bash
cd web
npm install
npm run build
cd ..
```

### Running Development Servers

**Backend API Server:**
```bash
ZO_ROOT_USER_EMAIL="root@example.com" ZO_ROOT_USER_PASSWORD="Complexpass#123" cargo run
```
Server runs on port 5080.

**Frontend Dev Server:**
```bash
cd web
# Create .env file with: VITE_OPENOBSERVE_ENDPOINT=http://localhost:5080
npm install
npm run dev
```
UI runs on port 8081.

## Code Style and Conventions

### Rust Code Style

**Formatting:** Use rustfmt with the project's configuration:
- Style edition: 2024
- Comment width: 120 characters
- Unix newline style
- Use field init shorthand and try shorthand
- Imports granularity: Crate level
- Group imports: StdExternalCrate

**Linting:** Follow clippy rules:
- Large error threshold: 200 bytes

**File Headers:** All Rust files must include the AGPL-3.0 copyright header:
```rust
// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.
```

### JavaScript/TypeScript Code Style

**Linting:** ESLint is configured with:
- Vue.js essential rules
- TypeScript ESLint plugin
- Prettier integration
- ECMAScript latest

**Testing:** Use Vitest for unit tests:
```bash
npm run test:unit
npm run test:unit:coverage
```

## Testing Requirements

### Rust Tests

**Code Coverage Requirements (Backend):**
- Functions: ≥66%
- Lines: ≥66%
- Regions: ≥65%

These thresholds are enforced by the CI pipeline and can be overridden using environment variables `COVERAGE_FUNCTIONS`, `COVERAGE_LINES`, and `COVERAGE_REGIONS`.

**Running Tests:**
```bash
# Run tests with coverage
./coverage.sh

# Generate HTML coverage report
./coverage.sh html

# Check if coverage meets thresholds
./coverage.sh check
```

**Test Configuration:**
- Use `cargo nextest` for test execution
- Tests run with `--test-threads=1`
- Ignore coverage for `job` and `generated` files
- Retry failed tests once

### JavaScript/TypeScript Tests

**Code Coverage Requirements (Frontend):**
- Lines: ≥55%
- Functions: ≥44%
- Branches: ≥45%
- Statements: ≥54%

**Running Tests:**
```bash
cd web
# Run tests with coverage
./coverage.sh check

# Run ESLint checks
./eslint.sh
```

## Build and CI/CD

### Docker Builds

**Simple build:**
```bash
docker build -t openobserve:latest-amd64 -f deploy/build/Dockerfile .
```

**Multi-arch build:**
```bash
docker build -t openobserve:latest-amd64 -f deploy/build/Dockerfile.tag.amd64 .
```

### CI Pipeline Checks

Pull requests must pass:
1. **Rust unit tests** with coverage thresholds (66%/66%/65% for functions/lines/regions)
   - Tests run against both PostgreSQL and SQLite
2. **Frontend unit tests** with coverage thresholds (55%/44%/45%/54% for lines/functions/branches/statements)
3. **ESLint checks** for JavaScript/TypeScript
4. **Cargo deny** for license and security checks
5. **PR title validation** (see below)

### Security and License Checks

**Cargo Deny:**
- Yanked crates are denied
- License exceptions are defined in `deny.toml`
- Security advisories are checked (with specific ignores)

## Pull Request Conventions

### PR Title Format

PRs must follow conventional commits format:
```
<type>(<optional-scope>): <description>
```

**Valid types:**
- `feat`: A new feature
- `fix`: A bug fix
- `test`: Adding or correcting tests
- `refactor`: Code changes that neither fix bugs nor add features
- `chore`: Changes to build process or auxiliary tools
- `style`: Code style changes (formatting, whitespace, etc.)
- `docs`: Documentation only changes
- `perf`: Performance improvements
- `build`: Build system or external dependency changes
- `ci`: CI configuration changes
- `revert`: Revert a previous commit

**Examples:**
- `feat(logs): add support for custom log parsing`
- `fix(metrics): correct prometheus metric aggregation`
- `docs: update installation instructions`
- `test(ingestion): add unit tests for data pipeline`

### PR Process

1. Fork the repository
2. Clone from your fork
3. Create a new branch
4. Make changes
5. Ensure tests pass locally
6. Push to your fork
7. Create a PR
8. Ensure CI checks pass

## Key Project Directories

- `src/`: Rust source code
  - `service/`: Business logic services
  - `handler/`: HTTP request handlers
  - `router/`: API routing
  - `common/`: Shared utilities
  - `infra/`: Infrastructure layer
  - `proto/`: Protocol buffer definitions
- `web/`: Vue.js frontend application
- `tests/`: Integration and end-to-end tests
- `deploy/`: Deployment configurations and Dockerfiles
- `scripts/`: Build and utility scripts

## API Documentation

The project uses Swagger/OpenAPI for API documentation:
- Access at: `/swagger/index.html`
- Uses [utoipa](https://github.com/juhaku/utoipa) for annotation-based generation
- Mark API endpoints with comment annotations in Rust code

## Additional Notes

### Protobuf
- Protocol buffer files are in `src/proto/proto/`
- Generated code is ignored by rustfmt
- Changes to proto files require regeneration

### Multi-tenancy
- Organizations and streams are first-class concepts
- Complete data isolation between tenants
- Consider multi-tenancy in all data access patterns

### Performance Considerations
- The project prioritizes performance and low resource usage
- Use efficient data structures and algorithms
- Leverage Rust's zero-cost abstractions
- Be mindful of memory allocations in hot paths

### Storage
- Data is stored in Parquet columnar format
- Support for multiple storage backends: S3, MinIO, GCS, Azure Blob, local disk
- Intelligent caching and partitioning for query performance

## Getting Help

- Documentation: https://openobserve.ai/docs/
- Contributing Guide: See CONTRIBUTING.md
- Security: See SECURITY.md
