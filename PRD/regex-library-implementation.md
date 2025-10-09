# Regex Pattern Library - Implementation Guide

**Version:** 4.0 (Final)
**Date:** 2025-10-08
**Status:** Ready for Implementation

---

## Overview

Enable org users to upload JSON files containing regex patterns for data redaction/field dropping. Users browse uploaded libraries and import selected patterns into their custom patterns.

**Flow:** Upload JSON → Store in DB → Browse Patterns → Import Selected → Use Existing Pattern System

---

## Core Workflow

```
┌─────────────────────────────────┐
│  1. User Uploads JSON File      │
│     (via Settings UI)            │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│  2. Validate & Store             │
│     - Validate JSON schema       │
│     - Test all regex patterns    │
│     - Store in regex_library     │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│  3. Browse Library UI            │
│     - List all patterns          │
│     - Filter by category         │
│     - Multi-select               │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│  4. Import Selected              │
│     - Validate (existing logic)  │
│     - Create PatternEntry        │
│     - Persist (existing logic)   │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│  5. Use in Existing Flow         │
│     - Associate with streams     │
│     - Apply redaction/drop       │
└─────────────────────────────────┘
```

---

## Database Schema

### 1. New Table: `regex_library`

```sql
CREATE TABLE IF NOT EXISTS regex_library (
    -- Primary Key
    id VARCHAR(100) PRIMARY KEY,

    -- Ownership
    org VARCHAR(100) NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at BIGINT NOT NULL,

    -- Library Info
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    description TEXT,

    -- Content
    json_content JSONB NOT NULL,

    -- Metadata (extracted from JSON)
    total_patterns INT NOT NULL DEFAULT 0,
    total_categories INT NOT NULL DEFAULT 0,

    -- Constraints
    CONSTRAINT unique_library_per_org UNIQUE(org, name, version)
);

CREATE INDEX idx_regex_library_org ON regex_library(org);
```

### 2. Enhance Table: `re_patterns`

```sql
-- Add optional columns for source tracking
ALTER TABLE re_patterns ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'custom';
-- Values: 'custom' | 'builtin'

ALTER TABLE re_patterns ADD COLUMN IF NOT EXISTS builtin_id VARCHAR(100);
-- Original pattern ID from JSON (e.g., 'aws_access_key')

ALTER TABLE re_patterns ADD COLUMN IF NOT EXISTS library_id VARCHAR(100);
-- FK to regex_library.id

ALTER TABLE re_patterns ADD COLUMN IF NOT EXISTS builtin_version VARCHAR(20);
-- Library version when imported

ALTER TABLE re_patterns ADD COLUMN IF NOT EXISTS category VARCHAR(50);
-- Pattern category (e.g., 'credentials', 'pii')

ALTER TABLE re_patterns ADD COLUMN IF NOT EXISTS tags TEXT;
-- JSON array: ["cloud", "aws", "authentication"]
```

**Note:** All new columns are NULL-able for backward compatibility.

---

## JSON Structure

### Library JSON Format

```json
{
  "name": "Security Patterns",
  "version": "1.0.0",
  "description": "Common security patterns for sensitive data",
  "author": "Security Team",

  "categories": [
    {
      "id": "credentials",
      "name": "Credentials & Secrets",
      "description": "API keys, tokens, passwords",
      "patterns": [
        {
          "id": "aws_access_key",
          "name": "AWS Access Key ID",
          "description": "Matches AWS IAM access keys (AKIA...)",
          "pattern": "(?i)AKIA[0-9A-Z]{16}",
          "examples": [
            "AKIAIOSFODNN7EXAMPLE",
            "AKIAI44QH8DHBEXAMPLE"
          ],
          "tags": ["cloud", "aws", "authentication"]
        },
        {
          "id": "github_pat",
          "name": "GitHub Personal Access Token",
          "description": "GitHub tokens starting with ghp_",
          "pattern": "ghp_[0-9a-zA-Z]{36}",
          "examples": ["ghp_1Abcdefghijklmnopqrstuvwxyz123456"],
          "tags": ["github", "token"]
        },
        {
          "id": "generic_api_key",
          "name": "Generic API Key",
          "description": "Common API key patterns",
          "pattern": "(?i)(api[_-]?key|apikey)[\\s]*[:=][\\s]*['\"]?([0-9a-zA-Z\\-_]{20,})['\"]?",
          "examples": [
            "api_key: abcd1234efgh5678ijkl",
            "apiKey=\"xyz123abc456\""
          ],
          "tags": ["api", "authentication"]
        }
      ]
    },
    {
      "id": "pii",
      "name": "Personal Identifiable Information",
      "description": "Email, phone, SSN",
      "patterns": [
        {
          "id": "email_address",
          "name": "Email Address",
          "description": "Standard email format",
          "pattern": "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
          "examples": [
            "user@example.com",
            "john.doe+tag@company.co.uk"
          ],
          "tags": ["email", "contact", "pii"]
        },
        {
          "id": "phone_us",
          "name": "US Phone Number",
          "description": "US phone numbers in various formats",
          "pattern": "(?:\\+?1[-.]?)?\\(?([0-9]{3})\\)?[-.]?([0-9]{3})[-.]?([0-9]{4})",
          "examples": [
            "+1-555-123-4567",
            "(555) 123-4567",
            "555.123.4567"
          ],
          "tags": ["phone", "contact", "pii", "us"]
        },
        {
          "id": "ssn_us",
          "name": "US Social Security Number",
          "description": "9-digit US SSN",
          "pattern": "\\b(?!000|666|9\\d{2})([0-8]\\d{2}|7([0-6]\\d))[-]?(?!00)\\d{2}[-]?(?!0000)\\d{4}\\b",
          "examples": ["123-45-6789", "123456789"],
          "tags": ["ssn", "identity", "pii", "us"]
        }
      ]
    }
  ],

  "presets": [
    {
      "id": "security_essentials",
      "name": "Security Essentials",
      "description": "Critical security patterns",
      "pattern_ids": [
        "aws_access_key",
        "github_pat",
        "generic_api_key"
      ]
    },
    {
      "id": "pii_basic",
      "name": "Basic PII Protection",
      "description": "Common personal data patterns",
      "pattern_ids": [
        "email_address",
        "phone_us",
        "ssn_us"
      ]
    }
  ]
}
```

### Required Fields

**Library Level:**
- `name` (string)
- `version` (string)
- `categories` (array)

**Category Level:**
- `id` (string)
- `name` (string)
- `patterns` (array)

**Pattern Level:**
- `id` (string)
- `name` (string)
- `pattern` (string)

**Optional Fields:**
- `description` (string)
- `examples` (array of strings)
- `tags` (array of strings)

### Validation Rules

1. **Schema Validation**
   - All required fields present
   - Pattern IDs unique within library
   - Category IDs unique within library

2. **Pattern Validation**
   - All `pattern` fields must be valid regex
   - Test with `PatternManager::test_pattern(pattern, "", PatternPolicy::Redact)`
   - No ReDoS vulnerabilities

3. **Size Limits**
   - Max JSON file size: 5MB
   - Max patterns per library: 500
   - Max pattern length: 1000 characters

---

## Backend Implementation

### File Structure

```
src/
├── infra/src/table/
│   ├── regex_library.rs              # NEW: DB operations for regex_library table
│   └── re_pattern.rs                 # MODIFY: Add new optional fields
│
├── service/
│   ├── db/regex_library.rs           # NEW: Service layer for library ops
│   └── regex_library/
│       ├── mod.rs                    # NEW: Main module
│       ├── models.rs                 # NEW: Data structures (LibraryJson, etc.)
│       ├── validation.rs             # NEW: JSON schema & pattern validation
│       └── import.rs                 # NEW: Import logic
│
└── handler/http/request/
    └── regex_library/
        └── mod.rs                    # NEW: HTTP endpoints
```

---

### API Endpoints

#### 1. Upload Library

```rust
POST /api/{org_id}/regex_library/upload
Content-Type: multipart/form-data

Form Fields:
  - file: JSON file (required)
  - name: Override library name (optional)

Response 200:
{
  "id": "lib_uuid_1234",
  "name": "Security Patterns",
  "version": "1.0.0",
  "total_patterns": 6,
  "total_categories": 2,
  "created_at": 1710504000
}

Response 400: Invalid JSON/Pattern validation failed
Response 413: File too large
```

**Implementation:**
```rust
#[post("/{org_id}/regex_library/upload")]
pub async fn upload(
    org_id: web::Path<String>,
    mut payload: Multipart,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let user_id = extract_user_id(&req)?;

    // 1. Extract file from multipart
    let file_bytes = extract_file_from_multipart(&mut payload).await?;

    // 2. Parse JSON
    let library_json: LibraryJson = serde_json::from_slice(&file_bytes)?;

    // 3. Validate schema
    validation::validate_library_schema(&library_json)?;

    // 4. Test all patterns
    validation::validate_all_patterns(&library_json).await?;

    // 5. Create library entry
    let entry = RegexLibrary {
        id: ider::generate(),
        org: org_id.to_string(),
        created_by: user_id,
        created_at: now(),
        name: library_json.name.clone(),
        version: library_json.version.clone(),
        description: library_json.description.clone(),
        json_content: serde_json::to_value(library_json)?,
        total_patterns: count_patterns(&library_json),
        total_categories: library_json.categories.len() as i32,
    };

    // 6. Store in database
    db::regex_library::add(entry).await?;

    Ok(HttpResponse::Ok().json(/* response */))
}
```

---

#### 2. List Libraries

```rust
GET /api/{org_id}/regex_library

Response 200:
{
  "libraries": [
    {
      "id": "lib_uuid_1234",
      "name": "Security Patterns",
      "version": "1.0.0",
      "description": "Common security patterns",
      "total_patterns": 6,
      "total_categories": 2,
      "created_by": "user@example.com",
      "created_at": 1710504000
    }
  ]
}
```

---

#### 3. Get Library Patterns

```rust
GET /api/{org_id}/regex_library/{library_id}/patterns?category=credentials

Response 200:
{
  "library": {
    "id": "lib_uuid_1234",
    "name": "Security Patterns",
    "version": "1.0.0"
  },
  "patterns": [
    {
      "id": "aws_access_key",
      "name": "AWS Access Key ID",
      "description": "Matches AWS IAM access keys",
      "pattern": "(?i)AKIA[0-9A-Z]{16}",
      "category": "credentials",
      "examples": ["AKIAIOSFODNN7EXAMPLE"],
      "tags": ["cloud", "aws"],
      "is_imported": false
    }
  ],
  "categories": [
    {
      "id": "credentials",
      "name": "Credentials & Secrets",
      "pattern_count": 3
    },
    {
      "id": "pii",
      "name": "Personal Identifiable Information",
      "pattern_count": 3
    }
  ],
  "presets": [
    {
      "id": "security_essentials",
      "name": "Security Essentials",
      "pattern_count": 3
    }
  ]
}
```

**Implementation:**
```rust
#[get("/{org_id}/regex_library/{library_id}/patterns")]
pub async fn get_patterns(
    path: web::Path<(String, String)>,
    query: web::Query<PatternQuery>,
) -> Result<HttpResponse, Error> {
    let (org_id, library_id) = path.into_inner();

    // 1. Load library from database
    let library = db::regex_library::get(&library_id).await?;
    if library.org != org_id {
        return Err(Error::Forbidden);
    }

    // 2. Parse JSON
    let json: LibraryJson = serde_json::from_value(library.json_content)?;

    // 3. Get existing imported patterns
    let existing = db::re_pattern::list_by_org(&org_id).await?;
    let imported_ids: HashSet<_> = existing
        .iter()
        .filter_map(|p| p.builtin_id.as_ref())
        .collect();

    // 4. Build pattern list with is_imported flag
    let mut patterns = vec![];
    for category in &json.categories {
        if let Some(cat_filter) = &query.category {
            if &category.id != cat_filter {
                continue;
            }
        }

        for pattern in &category.patterns {
            patterns.push(PatternResponse {
                id: pattern.id.clone(),
                name: pattern.name.clone(),
                description: pattern.description.clone(),
                pattern: pattern.pattern.clone(),
                category: category.id.clone(),
                examples: pattern.examples.clone(),
                tags: pattern.tags.clone(),
                is_imported: imported_ids.contains(&pattern.id),
            });
        }
    }

    Ok(HttpResponse::Ok().json(/* response */))
}
```

---

#### 4. Import Patterns

```rust
POST /api/{org_id}/regex_library/{library_id}/import

Request:
{
  "pattern_ids": ["aws_access_key", "email_address"],
  "preset_id": "security_essentials",  // Optional
  "duplicate_strategy": "skip"  // "skip" | "create_new"
}

Response 200:
{
  "imported": [
    {
      "builtin_id": "aws_access_key",
      "custom_id": "pattern_uuid_1",
      "name": "AWS Access Key ID"
    }
  ],
  "failed": [
    {
      "builtin_id": "invalid_pattern",
      "error": "Pattern not found in library"
    }
  ],
  "skipped": [
    {
      "builtin_id": "email_address",
      "reason": "Already imported"
    }
  ],
  "summary": {
    "total": 2,
    "successful": 1,
    "failed": 0,
    "skipped": 1
  }
}
```

**Implementation:**
```rust
#[post("/{org_id}/regex_library/{library_id}/import")]
pub async fn import_patterns(
    path: web::Path<(String, String)>,
    body: web::Json<ImportRequest>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, library_id) = path.into_inner();
    let user_id = extract_user_id(&req)?;

    // 1. Load library
    let library = db::regex_library::get(&library_id).await?;
    let json: LibraryJson = serde_json::from_value(library.json_content)?;

    // 2. Resolve pattern IDs (handle presets)
    let mut pattern_ids = body.pattern_ids.clone();
    if let Some(preset_id) = &body.preset_id {
        if let Some(preset) = json.presets.iter().find(|p| p.id == *preset_id) {
            pattern_ids.extend(preset.pattern_ids.iter().cloned());
        }
    }

    // Remove duplicates
    pattern_ids.sort();
    pattern_ids.dedup();

    // 3. Get existing patterns for duplicate check
    let existing = db::re_pattern::list_by_org(&org_id).await?;
    let existing_builtin_ids: HashSet<_> = existing
        .iter()
        .filter_map(|p| p.builtin_id.as_ref())
        .collect();

    let mut imported = vec![];
    let mut failed = vec![];
    let mut skipped = vec![];

    // 4. Process each pattern
    for pattern_id in pattern_ids {
        // 4.1 Find pattern in JSON
        let Some(builtin) = json.find_pattern(&pattern_id) else {
            failed.push(FailedPattern {
                builtin_id: pattern_id,
                error: "Pattern not found in library".into(),
            });
            continue;
        };

        // 4.2 Check duplicate
        if existing_builtin_ids.contains(&pattern_id) {
            if body.duplicate_strategy == DuplicateStrategy::Skip {
                skipped.push(SkippedPattern {
                    builtin_id: pattern_id,
                    reason: "Already imported".into(),
                });
                continue;
            }
        }

        // 4.3 Validate pattern (REUSE EXISTING!)
        #[cfg(feature = "enterprise")]
        {
            use o2_enterprise::enterprise::re_patterns::PatternManager;
            use infra::table::re_pattern_stream_map::PatternPolicy;

            if let Err(e) = PatternManager::test_pattern(
                builtin.pattern.clone(),
                "".to_string(),
                PatternPolicy::Redact,
            ) {
                failed.push(FailedPattern {
                    builtin_id: pattern_id,
                    error: format!("Validation failed: {}", e),
                });
                continue;
            }
        }

        // 4.4 Create PatternEntry
        let entry = PatternEntry {
            // Standard fields
            id: ider::generate(),
            org: org_id.clone(),
            name: builtin.name.clone(),
            description: builtin.description.unwrap_or_default(),
            pattern: builtin.pattern.clone(),
            created_by: user_id.clone(),
            created_at: now(),
            updated_at: now(),

            // New metadata fields
            source_type: Some("builtin".to_string()),
            builtin_id: Some(builtin.id.clone()),
            library_id: Some(library_id.clone()),
            builtin_version: Some(library.version.clone()),
            category: Some(builtin.category.clone()),
            tags: builtin.tags.as_ref().map(|t| serde_json::to_string(t).ok()).flatten(),
        };

        // 4.5 Persist (REUSE EXISTING!)
        match crate::service::db::re_pattern::add(entry.clone()).await {
            Ok(created) => {
                #[cfg(feature = "enterprise")]
                {
                    use crate::common::utils::auth::set_ownership;
                    use crate::common::meta::authz::Authz;
                    set_ownership(&org_id, "re_patterns", Authz::new(&created.id)).await;
                }

                imported.push(ImportedPattern {
                    builtin_id: pattern_id,
                    custom_id: created.id,
                    name: created.name,
                });
            }
            Err(e) => {
                failed.push(FailedPattern {
                    builtin_id: pattern_id,
                    error: e.to_string(),
                });
            }
        }
    }

    let response = ImportResponse {
        imported,
        failed,
        skipped,
        summary: ImportSummary {
            total: pattern_ids.len(),
            successful: imported.len(),
            failed: failed.len(),
            skipped: skipped.len(),
        },
    };

    Ok(HttpResponse::Ok().json(response))
}
```

---

#### 5. Delete Library

```rust
DELETE /api/{org_id}/regex_library/{library_id}

Response 200:
{
  "message": "Library deleted successfully"
}
```

**Note:** Imported patterns remain in `re_patterns` table with `library_id` set to NULL.

---

## Frontend Implementation

### File Structure

```
web/src/
├── services/
│   └── regex_library.ts              # NEW: API service
│
└── components/
    └── regex_library/
        ├── LibraryUpload.vue         # NEW: Upload page
        ├── LibraryList.vue           # NEW: Library list
        ├── PatternBrowser.vue        # NEW: Browse & import patterns
        └── ImportResults.vue         # NEW: Import results dialog
```

---

### UI Pages

#### 1. Library Upload Page

**Route:** `/settings/regex-patterns/libraries/upload`

**Layout:**
```
┌────────────────────────────────────────────┐
│ ← Back to Libraries                        │
├────────────────────────────────────────────┤
│ Upload Pattern Library                     │
│                                            │
│ [📁 Choose File] No file chosen           │
│                                            │
│ [Upload]                                   │
│                                            │
│ ⏳ Validating patterns... 80% (4/5)       │
│                                            │
│ ✓ JSON schema valid                       │
│ ✓ 5 patterns validated                    │
│ ✓ No duplicate pattern IDs                │
└────────────────────────────────────────────┘
```

**Component:** `LibraryUpload.vue`

---

#### 2. Library List Page

**Route:** `/settings/regex-patterns/libraries`

**Layout:**
```
┌───────────────────────────────────────────────────────┐
│ Pattern Libraries              [+ Upload Library]      │
├───────────────────────────────────────────────────────┤
│ Name              Ver   Patterns  Created By   Actions│
│ Security Patterns 1.0.0    6     john@ex.com  [View] │
│ PII Protection    1.0.0    8     jane@ex.com  [View] │
└───────────────────────────────────────────────────────┘
```

**Component:** `LibraryList.vue`

---

#### 3. Pattern Browser Page

**Route:** `/settings/regex-patterns/libraries/{id}/patterns`

**Layout:**
```
┌───────────────────────────────────────────────────────┐
│ ← Back to Libraries                                    │
│                                                        │
│ Security Patterns v1.0.0                              │
│ Common security patterns for sensitive data           │
├───────────────────────────────────────────────────────┤
│ [All Categories ▼] Search: [____________] [🔍]       │
│                                                        │
│ Presets: [Security Essentials] [PII Basic]           │
├───────────────────────────────────────────────────────┤
│ ☑ Pattern Name      Category  Status      Actions    │
│ ☐ AWS Access Key    Creds     Ready       [Preview]  │
│ ☑ Email Address     PII       Ready       [Preview]  │
│ ☐ GitHub Token      Creds     Imported    -          │
├───────────────────────────────────────────────────────┤
│                    [Import Selected (2)]               │
└───────────────────────────────────────────────────────┘
```

**Component:** `PatternBrowser.vue`

**Status Values:**
- **Ready**: Can be imported
- **Imported**: Already in custom patterns (checkbox disabled)

---

#### 4. Import Results Dialog

**Component:** `ImportResults.vue`

```
┌──────────────────────────────────────┐
│ Import Results                       │
├──────────────────────────────────────┤
│ ✓ Imported: 2                       │
│ ⚠ Skipped: 0                        │
│ ✗ Failed: 0                         │
│                                      │
│ Successfully imported:               │
│ • AWS Access Key                    │
│ • Email Address                     │
│                                      │
│ [View My Patterns] [Close]          │
└──────────────────────────────────────┘
```

---

### API Service

**File:** `web/src/services/regex_library.ts`

```typescript
import http from './http';

export interface Library {
  id: string;
  name: string;
  version: string;
  description?: string;
  total_patterns: number;
  total_categories: number;
  created_by: string;
  created_at: number;
}

export interface Pattern {
  id: string;
  name: string;
  description?: string;
  pattern: string;
  category: string;
  examples?: string[];
  tags?: string[];
  is_imported: boolean;
}

export interface ImportRequest {
  pattern_ids: string[];
  preset_id?: string;
  duplicate_strategy: 'skip' | 'create_new';
}

export interface ImportResponse {
  imported: Array<{
    builtin_id: string;
    custom_id: string;
    name: string;
  }>;
  failed: Array<{
    builtin_id: string;
    error: string;
  }>;
  skipped: Array<{
    builtin_id: string;
    reason: string;
  }>;
  summary: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
  };
}

const regexLibrary = {
  // Upload library
  upload(orgId: string, file: File): Promise<Library> {
    const formData = new FormData();
    formData.append('file', file);

    return http().post(`/api/${orgId}/regex_library/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // List libraries
  list(orgId: string): Promise<{ libraries: Library[] }> {
    return http().get(`/api/${orgId}/regex_library`);
  },

  // Get patterns from library
  getPatterns(
    orgId: string,
    libraryId: string,
    category?: string
  ): Promise<{
    library: Library;
    patterns: Pattern[];
    categories: Array<{ id: string; name: string; pattern_count: number }>;
    presets: Array<{ id: string; name: string; pattern_count: number }>;
  }> {
    return http().get(`/api/${orgId}/regex_library/${libraryId}/patterns`, {
      params: { category },
    });
  },

  // Import patterns
  import(
    orgId: string,
    libraryId: string,
    request: ImportRequest
  ): Promise<ImportResponse> {
    return http().post(
      `/api/${orgId}/regex_library/${libraryId}/import`,
      request
    );
  },

  // Delete library
  delete(orgId: string, libraryId: string): Promise<{ message: string }> {
    return http().delete(`/api/${orgId}/regex_library/${libraryId}`);
  },
};

export default regexLibrary;
```

---

## Implementation Checklist

### Phase 1: Backend (Week 1-2)

**Database:**
- [ ] Create migration for `regex_library` table
- [ ] Create migration to add columns to `re_patterns`
- [ ] Test migrations (up/down)

**Infra Layer:**
- [ ] `src/infra/src/table/regex_library.rs`
  - [ ] `add()` - Insert library
  - [ ] `get()` - Get by ID
  - [ ] `list_by_org()` - List org libraries
  - [ ] `remove()` - Delete library

**Service Layer:**
- [ ] `src/service/regex_library/models.rs`
  - [ ] `LibraryJson` struct
  - [ ] `Pattern` struct
  - [ ] `Category` struct
  - [ ] `Preset` struct
  - [ ] Helper methods (`find_pattern`, etc.)

- [ ] `src/service/regex_library/validation.rs`
  - [ ] `validate_library_schema()`
  - [ ] `validate_all_patterns()`
  - [ ] Size limit checks

- [ ] `src/service/regex_library/import.rs`
  - [ ] `import_patterns()` logic
  - [ ] Duplicate detection
  - [ ] Pattern-to-entry mapping

**Handler Layer:**
- [ ] `src/handler/http/request/regex_library/mod.rs`
  - [ ] `upload()` endpoint
  - [ ] `list()` endpoint
  - [ ] `get_patterns()` endpoint
  - [ ] `import_patterns()` endpoint
  - [ ] `delete()` endpoint

- [ ] Register routes in router

**Tests:**
- [ ] Unit tests for validation
- [ ] Unit tests for import logic
- [ ] Integration tests for endpoints

---

### Phase 2: Frontend (Week 3-4)

**Services:**
- [ ] `web/src/services/regex_library.ts`
  - [ ] All API methods
  - [ ] Type definitions

**Components:**
- [ ] `web/src/components/regex_library/LibraryUpload.vue`
  - [ ] File picker
  - [ ] Upload progress
  - [ ] Validation feedback

- [ ] `web/src/components/regex_library/LibraryList.vue`
  - [ ] Table with libraries
  - [ ] View/Delete actions
  - [ ] Empty state

- [ ] `web/src/components/regex_library/PatternBrowser.vue`
  - [ ] Pattern list with checkboxes
  - [ ] Category filter
  - [ ] Preset selector
  - [ ] Import button
  - [ ] Check imported status

- [ ] `web/src/components/regex_library/ImportResults.vue`
  - [ ] Success/failure display
  - [ ] Navigation to patterns list

**Routes:**
- [ ] Add routes to router
- [ ] Add navigation links

**Integration:**
- [ ] Update existing pattern list to show source badge
- [ ] Update pattern detail to show library info

**Tests:**
- [ ] Component unit tests
- [ ] E2E tests for full flow

---

### Phase 3: Polish & Documentation (Week 5)

- [ ] Error handling & messages
- [ ] Loading states
- [ ] Create sample JSON libraries (3-5 examples)
- [ ] User documentation
- [ ] API documentation
- [ ] Migration guide
- [ ] Beta testing

---

## Sample Pattern Library

**File:** `samples/security-patterns-v1.json`

```json
{
  "name": "Security Patterns",
  "version": "1.0.0",
  "description": "Essential security patterns for credentials and secrets",
  "author": "OpenObserve Team",
  "categories": [
    {
      "id": "credentials",
      "name": "Credentials & Secrets",
      "description": "API keys, tokens, passwords",
      "patterns": [
        {
          "id": "aws_access_key",
          "name": "AWS Access Key ID",
          "description": "Matches AWS IAM access keys",
          "pattern": "(?i)AKIA[0-9A-Z]{16}",
          "examples": ["AKIAIOSFODNN7EXAMPLE"],
          "tags": ["cloud", "aws"]
        },
        {
          "id": "github_pat",
          "name": "GitHub Personal Access Token",
          "description": "GitHub tokens",
          "pattern": "ghp_[0-9a-zA-Z]{36}",
          "tags": ["github", "token"]
        }
      ]
    }
  ],
  "presets": [
    {
      "id": "all",
      "name": "All Patterns",
      "pattern_ids": ["aws_access_key", "github_pat"]
    }
  ]
}
```

---

## Configuration

```yaml
# config/config.yaml
regex_library:
  enabled: true
  max_upload_size_mb: 5
  max_patterns_per_library: 500
  max_pattern_length: 1000
  validation_timeout_seconds: 10
```

---

## Error Handling

### Upload Errors

| Scenario | HTTP Code | Message |
|----------|-----------|---------|
| Invalid JSON syntax | 400 | "Invalid JSON format: {error}" |
| Missing required field | 400 | "Missing required field: {field}" |
| Invalid regex pattern | 400 | "Pattern '{id}' has invalid regex: {error}" |
| File too large | 413 | "File size exceeds 5MB limit" |
| Too many patterns | 400 | "Library exceeds 500 pattern limit" |
| Duplicate library | 409 | "Library with this name and version already exists" |

### Import Errors

| Scenario | Handling |
|----------|----------|
| Pattern not found | Add to `failed`, continue |
| Pattern validation fails | Add to `failed`, continue |
| Already imported (skip mode) | Add to `skipped`, continue |
| Database error | Add to `failed`, continue |

**Philosophy:** Partial success is acceptable. Return detailed per-pattern results.

---

## Testing Strategy

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_validate_library_schema() {
        let json = r#"{"name": "Test", "version": "1.0.0", "categories": []}"#;
        let library: LibraryJson = serde_json::from_str(json).unwrap();
        assert!(validate_library_schema(&library).is_ok());
    }

    #[test]
    fn test_pattern_validation() {
        let pattern = r"\d{3}-\d{2}-\d{4}";
        assert!(validate_pattern(pattern).is_ok());
    }

    #[tokio::test]
    async fn test_import_flow() {
        // Setup
        let library = create_test_library().await;

        // Import
        let request = ImportRequest {
            pattern_ids: vec!["test_pattern".into()],
            preset_id: None,
            duplicate_strategy: DuplicateStrategy::Skip,
        };

        let result = import_patterns("org1", library.id, request, "user1").await;

        // Assert
        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.failed.len(), 0);
    }
}
```

### Integration Tests

- Upload library → List → Get patterns → Import → Verify in custom patterns
- Upload duplicate library → Expect 409
- Upload invalid JSON → Expect 400
- Import already imported → Verify skipped
- Delete library → Verify patterns remain

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Libraries uploaded | 5+ per org in first 3 months |
| Pattern import rate | 50%+ of orgs use import |
| Time to first pattern | < 2 minutes (vs 30 min manual) |
| Import success rate | > 95% |
| User satisfaction | > 4/5 rating |

---

## Next Steps

1. ✅ Design approved
2. ⏳ Create database migrations
3. ⏳ Implement backend (Week 1-2)
4. ⏳ Implement frontend (Week 3-4)
5. ⏳ Testing & documentation (Week 5)
6. ⏳ Beta release

---

**Status:** Ready for Implementation
**Start Date:** TBD
**Target Completion:** 5 weeks from start
