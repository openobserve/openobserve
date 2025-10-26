# Log Patterns Feature Design for OpenObserve
## Enterprise Feature Implementation Plan

**Author**: Design Team
**Date**: October 26, 2025
**Last Updated**: October 26, 2025
**Status**: Draft - Updated for Scale
**Version**: 2.1 (Production-Ready Edition)

---

## 1. Executive Summary

This design proposes adding automated log pattern detection to OpenObserve as an enterprise feature, leveraging the [drain3-rs](https://github.com/openobserve/drain3-rs) algorithm. The feature will automatically cluster similar logs, detect anomalies, and provide pattern-based analytics to accelerate troubleshooting and reduce costs.

**Version 2.1 Updates (Production-Ready):**
- ✅ **Comprehensive scalability analysis** for 200GB to 1PB/day customers
- ✅ **Scale-adaptive sampling** (10k to 100M samples)
- ✅ **Hierarchical pattern merging** for distributed processing
- ✅ **Resource budgets and circuit breakers** to prevent cluster overload
- ✅ **Failure handling and partial results** for reliability at scale
- ✅ **Tiered extraction schedules** by stream priority
- ✅ **Realistic cost modeling** with compute & storage overhead
- ✅ **Separate pattern extraction API** (not query parameter)
- ✅ **Async-by-default** for large sample sizes (>100k)
- ✅ **Pattern retention tiers** (hot/warm/cold) for cost optimization
- ✅ **Detailed LSH parameters** for pattern deduplication
- ✅ **Concrete VRL integration** specifications
- ✅ **Pattern export/import API** for community sharing
- ✅ **Progressive loading** with real-time progress indicators
- ✅ **Integrated pattern annotation** in search results (patterns WITH logs)

**Key Differentiators vs Competitors:**
- **Scale-adaptive design**: Works from 200GB/day to 1PB/day
- **Hybrid approach**: Both on-demand and tiered periodic extraction
- **Integrated UX**: Patterns shown WITH logs in search results (not separate)
- **Distributed pattern extraction**: Hierarchical merging across 1000+ workers
- **Pattern evolution tracking**: Historical pattern changes for anomaly detection
- **Cost optimization**: Pattern-based log filtering with ROI calculator
- **Resilient by design**: Circuit breakers, degraded modes, partial results
- **Lightweight annotation**: <50ms overhead for cached patterns
- **Integration with existing enterprise features**: Works with pattern manager, VRL functions

---

## 2. Competitive Analysis

### 2.1 Datadog Log Patterns
- **Approach**: Real-time clustering on 10,000 log samples
- **Strengths**: Fast, user-friendly visualization, cost optimization features
- **Weaknesses**: Limited sample size, no historical pattern tracking, **patterns separate from logs**
- **Key Insight**: Focus on sample-based analysis for speed
- **UX Gap**: Users must switch between pattern view and log view - patterns disconnected from logs

### 2.2 New Relic Log Patterns
- **Approach**: ML-based automatic clustering stored as events
- **Strengths**: Patterns stored as queryable events, dashboard/alert integration
- **Weaknesses**: Limited technical details available, **cannot filter logs by pattern in log viewer**
- **Key Insight**: Storing patterns as first-class entities enables powerful analytics
- **UX Gap**: Pattern events stored separately - no way to see which logs match which pattern in real-time

### 2.3 Splunk Pattern Detection
- **Approach**: Multiple algorithms (K-means, DBSCAN, Birch, cluster command)
- **Strengths**: Flexible algorithm selection, ML toolkit integration
- **Weaknesses**: Complex setup, requires expertise
- **Key Insight**: Offering multiple clustering strategies for different use cases

### 2.4 Elasticsearch/Grok
- **Approach**: Manual pattern definition with 120+ built-in patterns
- **Strengths**: Precise control, extensive pattern library
- **Weaknesses**: Requires manual pattern creation, not automatic
- **Key Insight**: Pre-built pattern libraries reduce setup time

### 2.5 Drain3 Algorithm
- **Performance**: 90% accuracy average, fast streaming processing
- **Limitations**: Variables at log beginning parsed incorrectly
- **Improvements**: XDrain (96.9% accuracy), USTEP (93% accuracy)
- **Key Insight**: Drain3 is proven but has room for enhancement

---

## 3. Architecture Integration with OpenObserve

### 3.1 Current OpenObserve Query Flow

Based on exploration findings:

```
HTTP Request → Cache Check → SQL Processing → Distributed Search
  → DataFusion Execution → Result Merging → Response Assembly
```

**Key Integration Points:**
1. **Entry Point**: `src/handler/http/request/search/mod.rs` - `POST /{org_id}/_search`
2. **Query Execution**: `src/service/search/cluster/http.rs` - `search()` function
3. **Pattern Management**: `o2_enterprise::enterprise::re_patterns::PatternManager` (already exists)
4. **Storage**: ObjectStoreExt trait with S3/local disk backends

### 3.2 Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Search Request                            │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Pattern Extraction Mode?                        │
│  Query Param: pattern_extraction=on_demand|periodic          │
└───────────────────┬─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌──────────────┐      ┌──────────────────┐
│  On-Demand   │      │    Periodic       │
│  Extraction  │      │   Background Job  │
└──────┬───────┘      └────────┬──────────┘
       │                       │
       └───────────┬───────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│           Distributed Pattern Extraction                     │
│  - Leader querier coordinates                                │
│  - Workers process log chunks with drain3-rs                 │
│  - Patterns merged using similarity threshold                │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Pattern Storage Layer                           │
│  - Patterns stored as separate stream                        │
│  - Time-series pattern evolution tracking                    │
│  - Pattern metadata (frequency, examples, variables)         │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Pattern Analytics & Visualization               │
│  - Pattern frequency trends                                  │
│  - Anomaly detection (new/rare patterns)                     │
│  - Cost optimization recommendations                         │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Three-Tier Pattern Architecture

**Critical Design Decision**: Patterns must be integrated WITH logs, not separate.

```
┌────────────────────────────────────────────────────────────────┐
│         Tier 1: Periodic Pattern Extraction (Background)       │
├────────────────────────────────────────────────────────────────┤
│  - Runs hourly/daily for configured streams                    │
│  - Extracts patterns using drain3-rs                           │
│  - Stores patterns in _patterns_* streams                      │
│  - Updates pattern cache in queriers                           │
│  - Cost: Compute overhead (15-20% of cluster)                  │
└────────────────────────────────────────────────────────────────┘
                          │
                          ├─── Patterns Cached ───┐
                          ▼                        ▼
┌────────────────────────────────────────────────────────────────┐
│     Tier 2: Lightweight Pattern Annotation (Search Path)      │
├────────────────────────────────────────────────────────────────┤
│  POST /{org_id}/_search?pattern_annotation=true               │
│                                                                 │
│  1. Execute search → Get logs                                  │
│  2. Load cached patterns for stream (<10ms)                    │
│  3. Match each log against patterns (parallel)                 │
│  4. Add _pattern field to each log                             │
│  5. Return pattern summary with counts                         │
│                                                                 │
│  Overhead: +10-50ms per search                                 │
│  Benefit: Patterns integrated WITH logs (filterable, groupable)│
└────────────────────────────────────────────────────────────────┘
                          │
                          ├─── If no cached patterns ──┐
                          ▼                              ▼
┌────────────────────────────────────────────────────────────────┐
│   Tier 3: On-Demand Pattern Extraction (Dedicated API)        │
├────────────────────────────────────────────────────────────────┤
│  POST /{org_id}/streams/{stream}/patterns/extract             │
│                                                                 │
│  - User clicks "Extract Patterns" button                       │
│  - Runs drain3 on specific time range                          │
│  - Returns patterns + annotates logs                           │
│  - Caches patterns for future annotation                       │
│                                                                 │
│  Overhead: +2-60s depending on sample size                     │
│  Async for >100k samples                                       │
└────────────────────────────────────────────────────────────────┘
```

**User Flow Example:**

```
Day 1: New stream "application_logs"
1. User searches logs → No patterns yet
2. User clicks "Extract Patterns" → Tier 3 (on-demand extraction)
3. Patterns extracted + logs annotated → Results shown immediately
4. Patterns cached → Future searches use Tier 2 (lightweight)

Day 2+: Periodic jobs enabled
1. User searches logs → Tier 2 (lightweight annotation) ✅
2. Patterns already cached from periodic job
3. +30ms overhead → seamless UX
4. Logs shown with pattern info inline

Investigating rare error:
1. User filters: WHERE severity='error' AND _pattern.is_anomaly=true
2. Only shows logs matching rare patterns
3. User clicks pattern → Groups all similar errors
4. Root cause found in 2 minutes instead of 20
```

**Why This Architecture Wins:**

| Aspect | Competitor (Datadog) | OpenObserve (This Design) |
|--------|----------------------|---------------------------|
| **Pattern discovery** | Separate patterns view | Tier 3 (on-demand API) |
| **Daily use** | Must switch views | Tier 2 (integrated in logs) |
| **Performance** | N/A (separate view) | +10-50ms (barely noticeable) |
| **Filtering** | Cannot filter logs by pattern | Filter by pattern_id, is_anomaly, etc. |
| **Background compute** | Unknown | Tier 1 (periodic, configurable) |
| **First-time UX** | No patterns until analyzed | Tier 3 (extract on-demand) |

---

## 4. On-Demand vs Periodic Extraction: Design Decision

### 4.1 On-Demand Pattern Extraction

**When**: User triggers pattern extraction via query parameter or UI button

**Pros:**
1. ✅ **User-controlled**: Users decide when patterns are needed
2. ✅ **Precise scope**: Patterns extracted for specific time ranges/filters
3. ✅ **No background overhead**: Zero cost when not in use
4. ✅ **Fresh patterns**: Always reflects current query results
5. ✅ **Investigation-focused**: Perfect for troubleshooting sessions

**Cons:**
1. ❌ **Query latency**: Adds processing time to search requests
2. ❌ **No historical trends**: Can't track pattern evolution over time
3. ❌ **Redundant computation**: Same patterns recomputed on each request
4. ❌ **Limited to sample size**: May not represent full dataset

**Best Use Cases:**
- Active incident investigation
- Exploring unknown log sources
- One-time analysis of specific time windows
- Quick pattern discovery during troubleshooting

**Implementation Approach:**
```rust
// Query parameter: pattern_extraction=true&pattern_sample_size=10000
if req.pattern_extraction {
    let drain = Drain3::new(config);
    let sample_logs = select_sample_logs(results, req.pattern_sample_size);
    let patterns = drain.extract_patterns(sample_logs);
    response.patterns = patterns;
}
```

---

### 4.2 Periodic Pattern Extraction

**When**: Background jobs run at regular intervals (e.g., every hour, daily)

**Pros:**
1. ✅ **Zero query overhead**: Patterns pre-computed, instant retrieval
2. ✅ **Historical tracking**: Track pattern evolution, detect changes
3. ✅ **Comprehensive coverage**: Process full dataset, not just samples
4. ✅ **Anomaly detection**: Identify new/rare patterns automatically
5. ✅ **Cost optimization**: Pre-identify high-volume low-value logs
6. ✅ **Alerting capability**: Alert on pattern changes or anomalies

**Cons:**
1. ❌ **Background resource usage**: Continuous compute/storage overhead
2. ❌ **Staleness**: Patterns may lag behind real-time data
3. ❌ **Storage cost**: Must store pattern history
4. ❌ **Configuration complexity**: Scheduling, retention policies
5. ❌ **May extract patterns users don't need**: Wasted resources

**Best Use Cases:**
- Monitoring pattern trends over time
- Automated anomaly detection
- Cost optimization dashboards
- Proactive alerting on pattern changes
- Pattern-based log sampling/filtering

**Implementation Approach - Tiered Extraction Strategy:**
```rust
// Tiered extraction configuration for different stream priorities
// Critical for PB-scale customers to avoid resource exhaustion

#[derive(Debug, Clone)]
pub enum StreamPriority {
    Critical,   // Business-critical streams (errors, security)
    Important,  // Important monitoring streams
    Normal,     // Regular application logs
    LowPriority, // Debug logs, verbose logs
}

pub struct PatternExtractionJob {
    stream: String,
    priority: StreamPriority,
    schedule: ExtractionSchedule,
    retention_days: u32,
    window_size: Duration,
    sample_size: u64,
    min_pattern_frequency: u32,
}

pub enum ExtractionSchedule {
    Hourly,         // Critical streams only
    Every6Hours,    // Important streams
    Daily,          // Normal streams
    Weekly,         // Low-priority streams
    OnDemandOnly,   // No periodic extraction
}

// Example configurations by customer scale:

// Small customers (200GB/day):
PatternExtractionJob {
    stream: "service_logs",
    priority: StreamPriority::Critical,
    schedule: ExtractionSchedule::Hourly,
    retention_days: 90,
    window_size: Duration::from_secs(3600), // 1 hour
    sample_size: 100_000,
    min_pattern_frequency: 10,
}

// Large customers (10TB/day):
PatternExtractionJob {
    stream: "application_logs",
    priority: StreamPriority::Important,
    schedule: ExtractionSchedule::Every6Hours,
    retention_days: 30,
    window_size: Duration::from_secs(21600), // 6 hours
    sample_size: 1_000_000,
    min_pattern_frequency: 100,
}

// Petabyte customers (1PB/day):
PatternExtractionJob {
    stream: "debug_logs",
    priority: StreamPriority::LowPriority,
    schedule: ExtractionSchedule::Daily,
    retention_days: 7,
    window_size: Duration::from_secs(86400), // 1 day
    sample_size: 10_000_000,
    min_pattern_frequency: 1000,
}
```

**Resource Budget Management:**
```rust
// Prevent pattern extraction from overwhelming cluster
pub struct PatternExtractionBudget {
    // Maximum concurrent extraction jobs
    max_concurrent_jobs: usize,

    // Maximum CPU cores that can be used for pattern extraction
    max_cpu_cores: usize,

    // Maximum memory for pattern extraction (GB)
    max_memory_gb: usize,

    // Maximum samples processed per hour across all streams
    max_samples_per_hour: u64,

    // Auto-throttle if cluster CPU > threshold
    cpu_throttle_threshold: f64, // e.g., 0.7 = 70%

    // Auto-disable if cluster CPU > threshold
    cpu_disable_threshold: f64, // e.g., 0.9 = 90%
}

// Example budgets by customer scale:
// Medium (200GB/day): 10 jobs, 16 cores, 64GB RAM, 10M samples/hour
// Large (10TB/day): 50 jobs, 64 cores, 256GB RAM, 100M samples/hour
// Petabyte (1PB/day): 100 jobs, 256 cores, 1TB RAM, 1B samples/hour
```

---

### 4.3 Recommended Hybrid Approach

**Implement both approaches with different use cases:**

| Feature | On-Demand | Periodic | Scale Recommendation |
|---------|-----------|----------|----------------------|
| **Query latency** | +500ms-2s | 0ms (pre-computed) | PB: Use periodic for active streams |
| **Storage cost** | $0 | $$ (pattern history) | PB: Selective streams only |
| **Compute cost** | $ (per query) | $$ (continuous) | PB: Budget management critical |
| **Use case** | Investigation | Monitoring | Small: On-demand focus<br>PB: Periodic focus |
| **Pattern freshness** | Real-time | 1-hour lag | PB: Daily acceptable for most |
| **Historical trends** | No | Yes | Critical for all scales |
| **Alerting** | No | Yes | Critical for Large/PB scales |
| **Sample size** | 10k-1M | 100k-100M | Adaptive based on volume |

**Implementation Priority:**
1. **Phase 1**: On-demand (faster to implement, immediate value)
2. **Phase 2**: Periodic (adds monitoring, alerting, cost optimization)
3. **Phase 3**: Hybrid optimization (smart caching, incremental updates)

**Scale-Specific Recommendations:**

| Customer Scale | Daily Volume | Recommended Approach | Primary Method |
|----------------|--------------|----------------------|----------------|
| **Small** | <10GB | On-demand primary, periodic for critical streams | On-Demand 80% |
| **Medium** | 10GB-1TB | Balanced hybrid approach | 50/50 Split |
| **Large** | 1TB-100TB | Periodic primary, on-demand for investigation | Periodic 70% |
| **Petabyte** | >100TB | Selective periodic only, limited on-demand | Periodic 90% |

---

## 5. Pattern Storage Strategy

### 5.1 Storage Schema

Store patterns as a special stream: `_patterns_{org_id}_{stream_name}`

**Pattern Record Schema:**
```json
{
  "pattern_id": "hash_of_pattern_template",
  "pattern_template": "User <*> logged in from <*>",
  "pattern_tokens": ["User", "<*>", "logged", "in", "from", "<*>"],
  "extraction_time": "2025-10-26T10:00:00Z",
  "time_window_start": "2025-10-26T09:00:00Z",
  "time_window_end": "2025-10-26T10:00:00Z",
  "frequency": 15234,
  "example_logs": [
    "User john logged in from 192.168.1.1",
    "User alice logged in from 10.0.0.5"
  ],
  "variable_positions": [1, 5],
  "variable_types": ["string", "ip_address"],
  "source_stream": "application_logs",
  "cluster_id": "cluster_42",
  "first_seen": "2025-10-20T08:00:00Z",
  "last_seen": "2025-10-26T10:00:00Z",
  "is_anomaly": false,
  "anomaly_score": 0.12
}
```

### 5.2 Storage Benefits

1. **Queryable**: Use SQL to analyze patterns over time
2. **Time-series**: Track pattern evolution, detect trends
3. **Reusable**: Leverage existing ObjectStore infrastructure
4. **Consistent**: Same storage format as other data
5. **Scalable**: Distributed across same S3/storage backends

### 5.3 Pattern Retention Tiers

**Cost-Optimized Pattern Storage Strategy:**

To manage storage costs, patterns are stored in tiered retention periods with varying detail levels:

```rust
pub enum PatternRetentionTier {
    Hot {
        // Full detail for recent patterns
        retention_days: u32,        // 7 days default
        extraction_frequency: ExtractionSchedule, // Hourly/Daily
        max_examples: usize,        // 3 examples per pattern
        example_max_length: usize,  // 500 chars
        compression: bool,          // false (fast access)
    },
    Warm {
        // Aggregated patterns with reduced examples
        retention_days: u32,        // 23 days (7-30 days total)
        aggregation: AggregationLevel, // Hourly → Daily rollup
        max_examples: usize,        // 1 example per pattern
        example_max_length: usize,  // 200 chars
        compression: bool,          // true (zstd)
    },
    Cold {
        // Summary patterns only, no examples
        retention_days: u32,        // 60 days (30-90 days total)
        aggregation: AggregationLevel, // Daily → Weekly rollup
        max_examples: usize,        // 0 (no examples)
        compression: bool,          // true (zstd, high ratio)
        template_only: bool,        // true (remove metadata)
    },
}

// Example lifecycle: Patterns automatically tier down over time
// Day 0-7: Hot tier (full detail, 3 examples)
// Day 8-30: Warm tier (1 example, compressed, hourly→daily aggregation)
// Day 31-90: Cold tier (no examples, weekly aggregation)
// Day 90+: Deleted (configurable retention)
```

**Storage Impact with Retention Tiers:**

| Tier | Storage per Pattern | Compression | Effective Size |
|------|---------------------|-------------|----------------|
| **Hot** | 2.5KB | None | 2.5KB |
| **Warm** | 1.5KB | 60% | 0.6KB |
| **Cold** | 0.5KB | 70% | 0.15KB |

**Revised Storage Estimates with Tiering:**

```
Example: 1000 streams, 200 patterns, hourly extraction

Hot tier (7 days):
= 1000 streams × 200 patterns × 2.5KB × 24 hours/day × 7 days
= 84GB

Warm tier (23 days, aggregated daily):
= 1000 streams × 200 patterns × 0.6KB × 23 days
= 2.76GB

Cold tier (60 days, aggregated weekly):
= 1000 streams × 200 patterns × 0.15KB × (60/7) weeks
= 0.26GB

Total: 87GB (vs 1.3TB without tiering = 93% savings!)
```

**Updated Storage Scaling by Customer Size:**

| Customer Scale | Daily Volume | Streams | Total Storage (90-day) | Monthly Cost (S3) |
|----------------|--------------|---------|------------------------|-------------------|
| Small          | <10GB        | 10-50   | 4-20GB                 | $0.10-0.50        |
| Medium         | 10GB-1TB     | 50-500  | 40-400GB               | $1-10             |
| Large          | 1TB-100TB    | 500-5K  | 400GB-4TB              | $10-100           |
| Petabyte       | >100TB       | 5K-50K  | 4-40TB                 | $100-1,000        |

### 5.4 Pattern Caching Strategy

**Scale-Adaptive In-Memory Pattern Cache:**

| Customer Scale | Daily Volume | Streams | Cache Size/Querier | Cache Strategy |
|----------------|--------------|---------|---------------------|----------------|
| **Small** | <10GB | 10-50 | 50MB | Full pattern cache |
| **Medium** | 10GB-1TB | 50-500 | 200MB | Recent patterns (24h) |
| **Large** | 1TB-100TB | 500-5K | 1-2GB | Active stream patterns |
| **Petabyte** | >100TB | 5K-50K | 5GB | Priority-based LRU |

**Cache Implementation:**
```rust
pub struct PatternCache {
    // Per-stream pattern cache with LRU eviction
    cache: LruCache<StreamKey, Vec<Pattern>>,

    // Maximum memory in bytes
    max_memory: usize,

    // TTL for cached patterns
    ttl: Duration,

    // Stream priority affects eviction
    stream_priorities: HashMap<StreamKey, StreamPriority>,
}

// For PB-scale: Use distributed cache (Redis/similar)
pub struct DistributedPatternCache {
    redis_client: RedisClient,
    local_cache: PatternCache, // L1 cache
    // Redis serves as L2 cache
}

impl DistributedPatternCache {
    // Two-tier caching: Local (hot) + Redis (warm)
    pub async fn get_patterns(&self, stream: &str) -> Option<Vec<Pattern>> {
        // L1: Check local cache first (microseconds)
        if let Some(patterns) = self.local_cache.get(stream) {
            return Some(patterns);
        }

        // L2: Check Redis (milliseconds)
        if let Some(patterns) = self.redis_client.get(stream).await {
            // Promote to local cache
            self.local_cache.put(stream, patterns.clone());
            return Some(patterns);
        }

        // L3: Load from object storage (seconds)
        None
    }
}
```

**Pattern Deduplication with LSH:**

Locality-Sensitive Hashing (LSH) enables O(n) pattern deduplication vs O(n²) pairwise comparison:

```rust
// Use MinHash + LSH for efficient pattern deduplication at scale
use minhash::{MinHash, LSH};

pub struct PatternDeduplicator {
    lsh: LSH<PatternId>,
    similarity_threshold: f64,
    minhash_config: MinHashConfig,
}

pub struct MinHashConfig {
    // Number of permutation functions for MinHash
    // Higher = more accurate, slower
    num_perm: usize,              // 128 (good balance)

    // Number of bands for LSH
    // More bands = higher recall, more false positives
    num_bands: usize,             // 16

    // Rows per band
    // Derived: num_perm / num_bands
    rows_per_band: usize,         // 8

    // Token n-gram size for shingling
    ngram_size: usize,            // 3 (trigrams)
}

impl PatternDeduplicator {
    pub fn new(similarity_threshold: f64) -> Self {
        let config = MinHashConfig {
            num_perm: 128,
            num_bands: 16,
            rows_per_band: 8,
            ngram_size: 3,
        };

        let lsh = LSH::new(config.num_bands, config.rows_per_band);

        Self {
            lsh,
            similarity_threshold,
            minhash_config: config,
        }
    }

    pub fn deduplicate_patterns(&mut self, patterns: Vec<Pattern>) -> Vec<Pattern> {
        // For small scale (<1000 patterns): Simple pairwise comparison O(n²)
        if patterns.len() < 1000 {
            return self.simple_deduplicate(patterns);
        }

        // For large scale (>1000 patterns): Use LSH for O(n) expected
        self.lsh_deduplicate(patterns)
    }

    fn lsh_deduplicate(&mut self, patterns: Vec<Pattern>) -> Vec<Pattern> {
        let mut deduplicated = Vec::new();
        let mut pattern_index = HashMap::new();

        for (idx, pattern) in patterns.iter().enumerate() {
            // Step 1: Create MinHash signature from pattern tokens
            let signature = self.create_minhash_signature(&pattern.tokens);

            // Step 2: Query LSH for candidate similar patterns
            let candidates = self.lsh.query(&signature);

            // Step 3: Compute exact Jaccard similarity for candidates
            let mut merged = false;
            for candidate_id in candidates {
                if let Some(&existing_idx) = pattern_index.get(&candidate_id) {
                    let existing = &patterns[existing_idx];

                    let similarity = self.jaccard_similarity(
                        &pattern.tokens,
                        &existing.tokens
                    );

                    if similarity >= self.similarity_threshold {
                        // Merge: combine frequencies, keep shorter template
                        self.merge_patterns(
                            &mut deduplicated,
                            existing_idx,
                            pattern
                        );
                        merged = true;
                        break;
                    }
                }
            }

            // Step 4: If no similar pattern found, add as new
            if !merged {
                let pattern_id = PatternId::new();
                self.lsh.insert(&signature, pattern_id.clone());
                pattern_index.insert(pattern_id, deduplicated.len());
                deduplicated.push(pattern.clone());
            }
        }

        deduplicated
    }

    fn create_minhash_signature(&self, tokens: &[String]) -> MinHash {
        let mut minhash = MinHash::new(self.minhash_config.num_perm);

        // Create token n-grams (shingles) for better similarity
        for i in 0..tokens.len().saturating_sub(self.minhash_config.ngram_size - 1) {
            let ngram = tokens[i..i + self.minhash_config.ngram_size].join(" ");
            minhash.update(&ngram.as_bytes());
        }

        minhash
    }

    fn jaccard_similarity(&self, tokens1: &[String], tokens2: &[String]) -> f64 {
        let set1: HashSet<_> = tokens1.iter().collect();
        let set2: HashSet<_> = tokens2.iter().collect();

        let intersection = set1.intersection(&set2).count();
        let union = set1.union(&set2).count();

        if union == 0 {
            return 0.0;
        }

        intersection as f64 / union as f64
    }

    fn merge_patterns(
        &self,
        deduplicated: &mut Vec<Pattern>,
        existing_idx: usize,
        new_pattern: &Pattern
    ) {
        let existing = &mut deduplicated[existing_idx];

        // Combine frequency counts
        existing.frequency += new_pattern.frequency;

        // Update time range
        if new_pattern.first_seen < existing.first_seen {
            existing.first_seen = new_pattern.first_seen;
        }
        if new_pattern.last_seen > existing.last_seen {
            existing.last_seen = new_pattern.last_seen;
        }

        // Keep shorter template (usually more general)
        if new_pattern.template.len() < existing.template.len() {
            existing.template = new_pattern.template.clone();
            existing.tokens = new_pattern.tokens.clone();
        }

        // Merge examples (keep diverse examples)
        if existing.examples.len() < 3 {
            existing.examples.push(new_pattern.examples[0].clone());
        }
    }

    fn simple_deduplicate(&self, patterns: Vec<Pattern>) -> Vec<Pattern> {
        // O(n²) brute force for small pattern sets
        let mut deduplicated = Vec::new();

        for pattern in patterns {
            let mut found_similar = false;

            for existing in &mut deduplicated {
                let similarity = self.jaccard_similarity(
                    &pattern.tokens,
                    &existing.tokens
                );

                if similarity >= self.similarity_threshold {
                    self.merge_patterns(&mut deduplicated, 0, &pattern);
                    found_similar = true;
                    break;
                }
            }

            if !found_similar {
                deduplicated.push(pattern);
            }
        }

        deduplicated
    }
}

// Example: Merge patterns from distributed workers
pub fn merge_worker_patterns_with_lsh(
    worker_patterns: Vec<Vec<Pattern>>,
    similarity_threshold: f64
) -> Vec<Pattern> {
    let mut deduplicator = PatternDeduplicator::new(similarity_threshold);

    // Flatten all worker patterns
    let all_patterns: Vec<Pattern> = worker_patterns
        .into_iter()
        .flatten()
        .collect();

    // Deduplicate using LSH
    deduplicator.deduplicate_patterns(all_patterns)
}
```

**LSH Performance Characteristics:**

| Pattern Count | Method | Complexity | Time (approx) |
|---------------|--------|------------|---------------|
| <1,000 | Pairwise | O(n²) | <1s |
| 1,000-10,000 | LSH | O(n) expected | 1-5s |
| 10,000-100,000 | LSH | O(n) expected | 10-30s |
| >100,000 | LSH + Parallel | O(n/p) | 30-120s |

**LSH Parameter Tuning:**

```rust
// Relationship between parameters and similarity threshold
// Probability of collision for similar items:
// P_collision ≈ (similarity)^(rows_per_band)
//
// For 80% similarity threshold:
// - With 8 rows/band: P_collision ≈ 0.80^8 ≈ 0.168 per band
// - With 16 bands: P_at_least_one ≈ 1 - (1 - 0.168)^16 ≈ 0.95
//
// Tuning guide:
// - Higher threshold (0.9): Use more rows_per_band (16), fewer bands (8)
// - Lower threshold (0.7): Use fewer rows_per_band (4), more bands (32)
// - Recall vs Precision tradeoff

pub fn configure_lsh_for_threshold(similarity_threshold: f64) -> MinHashConfig {
    match similarity_threshold {
        t if t >= 0.9 => MinHashConfig {
            num_perm: 128,
            num_bands: 8,
            rows_per_band: 16,
            ngram_size: 3,
        },
        t if t >= 0.8 => MinHashConfig {
            num_perm: 128,
            num_bands: 16,
            rows_per_band: 8,
            ngram_size: 3,
        },
        _ => MinHashConfig {
            num_perm: 128,
            num_bands: 32,
            rows_per_band: 4,
            ngram_size: 3,
        },
    }
}
```

---

## 6. Making OpenObserve Log Patterns Better Than Competitors

### 6.1 Unique Advantages

#### A. Distributed Pattern Extraction
- **Competitor weakness**: Datadog uses 10k sample, others unclear
- **Our advantage**: Leverage OpenObserve's distributed querier architecture
- **Benefit**: Process millions of logs in parallel across cluster
- **Implementation**: Leader querier coordinates, workers extract patterns from chunks

#### B. Pattern Evolution Tracking
- **Competitor weakness**: Most focus on current patterns only
- **Our advantage**: Store pattern history as time-series data
- **Benefit**:
  - Track when new patterns emerge (potential incidents)
  - Detect pattern frequency anomalies
  - Historical pattern analysis
- **Implementation**: Store patterns with timestamps, query with SQL

#### C. Cost Optimization Intelligence
- **Competitor feature**: Datadog mentions this but limited details
- **Our advantage**: Deep integration with pattern analytics
- **Benefit**:
  - Auto-identify high-volume low-value patterns
  - Suggest sampling rates for specific patterns
  - Pattern-based drop filter recommendations
  - ROI calculator for pattern filtering
- **Implementation**: Pattern frequency analysis + cost modeling

#### D. Pattern-Based VRL Functions
- **Competitor weakness**: Limited custom transformation capabilities
- **Our advantage**: Integration with existing VRL engine
- **Benefit**:
  - Apply transformations based on pattern matching
  - Dynamic field extraction from pattern variables
  - Pattern-aware enrichment
  - Pattern-based routing and filtering
- **Implementation**: See Section 8.4 for detailed VRL function specifications

#### E. Smart Pattern Sampling
- **Competitor weakness**: Static sampling (e.g., Datadog's 10k)
- **Our advantage**: Adaptive sampling based on log volume
- **Benefit**:
  - Low-volume streams: 100% logs processed
  - High-volume streams: Intelligent sampling
  - Rare pattern preservation
- **Implementation**: Scale-adaptive sampling algorithm

```rust
// Adaptive sampling algorithm
fn calculate_sample_size(stream_volume: u64, time_window_size: Duration) -> u64 {
    let logs_in_window = estimate_logs_in_window(stream_volume, time_window_size);

    match logs_in_window {
        0..=1_000_000 => logs_in_window, // <1M: process all logs
        1_000_001..=10_000_000 => 100_000, // 1-10M: 100k sample (1-10%)
        10_000_001..=100_000_000 => 1_000_000, // 10-100M: 1M sample (1-10%)
        100_000_001..=1_000_000_000 => 10_000_000, // 100M-1B: 10M sample (1-10%)
        _ => 100_000_000, // >1B: 100M max sample (0.01-10%)
    }
}

// Stratified sampling by severity for better pattern coverage
fn stratified_sample(logs: &[Log], target_size: usize) -> Vec<Log> {
    let error_ratio = 0.5;   // 50% errors (oversample for critical patterns)
    let warn_ratio = 0.3;    // 30% warnings
    let info_ratio = 0.15;   // 15% info
    let debug_ratio = 0.05;  // 5% debug

    // Oversample errors and warnings to catch critical patterns
    reservoir_sample_by_severity(logs, target_size,
        [error_ratio, warn_ratio, info_ratio, debug_ratio])
}
```

#### F. Pattern-Based Alerting
- **Competitor feature**: New Relic has this, others unclear
- **Our advantage**: Native integration with OpenObserve alerting
- **Benefit**:
  - Alert on new pattern emergence
  - Alert on pattern frequency changes
  - Alert on pattern disappearance
- **Implementation**: Alert rules on `_patterns_*` streams

#### G. Multi-Field Pattern Detection
- **Competitor weakness**: Most focus on message field only
- **Our advantage**: Run Drain3 on any field or field combinations
- **Benefit**:
  - Detect patterns in error codes, URLs, user agents
  - Multi-dimensional pattern analysis
  - Field correlation discovery
- **Implementation**: Configurable field selection for pattern extraction

#### H. Open Source Pattern Templates
- **Competitor weakness**: Proprietary, closed systems
- **Our advantage**: Export/import pattern templates
- **Benefit**:
  - Share patterns across organizations
  - Community pattern library (like Grok patterns)
  - Faster onboarding for common log sources
- **Implementation**: Pattern template JSON export/import API

---

### 6.2 Feature Comparison Matrix

| Feature | Datadog | New Relic | Splunk | OpenObserve (Proposed) |
|---------|---------|-----------|--------|------------------------|
| **Automatic clustering** | ✅ | ✅ | ✅ | ✅ |
| **Real-time extraction** | ✅ | ❌ | ✅ | ✅ (on-demand) |
| **Periodic extraction** | ❌ | ✅ | ❌ | ✅ |
| **Pattern history** | ❌ | ✅ | ❌ | ✅ |
| **Anomaly detection** | ❌ | ✅ | Manual | ✅ (auto) |
| **Cost optimization** | ✅ | ❌ | ❌ | ✅ (advanced) |
| **Distributed processing** | ? | ? | ✅ | ✅ |
| **Multi-field patterns** | ❌ | ❌ | ��� | ✅ |
| **Pattern export/import** | ❌ | ❌ | ✅ (Grok) | ✅ |
| **VRL integration** | ❌ | ❌ | ❌ | ✅ |
| **SQL queryable patterns** | ❌ | ✅ | ✅ | ✅ |
| **Patterns IN log search results** | ❌ | ❌ | ❌ | ✅ ⭐ |
| **Pattern-based log filtering** | ❌ | ❌ | ❌ | ✅ ⭐ |
| **Lightweight annotation (<50ms)** | ❌ | ❌ | ❌ | ✅ ⭐ |
| **Open source** | ❌ | ❌ | ❌ | ✅ |

**⭐ = Unique to OpenObserve - Major competitive advantage**

---

## 7. Implementation Roadmap

### Phase 1: MVP - On-Demand Pattern Extraction (4-6 weeks)

**Goal**: Basic pattern extraction on user request with integrated log annotation

**Core Features:**
- ✅ Integrate drain3-rs library
- ✅ **Dedicated pattern extraction API** (`POST /{org_id}/streams/{stream}/patterns/extract`)
- ✅ **Lightweight pattern annotation in search results** (`_pattern` field on each log)
- ✅ Sample-based extraction (10k-100k logs)
- ✅ Pattern summary with log counts in search response
- ✅ Basic UI visualization in log explorer with pattern highlighting
- ✅ Pattern-based filtering/grouping in UI

**Why Annotation is Critical for MVP:**
- Without it, patterns are disconnected from logs (unusable in practice)
- +10-50ms overhead is acceptable for lightweight mode
- Enables pattern-based filtering, grouping, and highlighting
- Requires cached patterns from periodic jobs OR on-demand extraction

**Files to Create/Modify:**
- `src/service/search/pattern_extraction/mod.rs` (new)
- `src/service/search/pattern_extraction/drain3_wrapper.rs` (new)
- `src/service/search/pattern_extraction/annotation.rs` (new - lightweight matching)
- `src/handler/http/request/patterns/extract.rs` (new - dedicated API)
- `src/handler/http/request/search/mod.rs` (modify - add pattern_annotation param)
- `src/service/search/cluster/http.rs` (modify - integrate annotation)

### Phase 2: Pattern Storage & History (4-6 weeks)

**Goal**: Store patterns as time-series data

**Features:**
- ✅ Create `_patterns_*` streams
- ✅ Store pattern records with metadata
- ✅ Pattern deduplication
- ✅ Pattern caching in queriers
- ✅ SQL queries on patterns

**Files to Create/Modify:**
- `src/service/search/pattern_extraction/storage.rs` (new)
- `src/service/db/pattern_store.rs` (new)
- Leverage existing ObjectStore infrastructure

### Phase 3: Periodic Extraction & Monitoring (4-6 weeks)

**Goal**: Background pattern extraction jobs

**Features:**
- ✅ Pattern extraction scheduler
- ✅ Per-stream pattern extraction jobs
- ✅ Pattern evolution tracking
- ✅ Anomaly detection (new/rare patterns)
- ✅ Pattern analytics dashboard

**Files to Create/Modify:**
- `src/service/search/pattern_extraction/scheduler.rs` (new)
- `src/service/search/pattern_extraction/anomaly_detection.rs` (new)

### Phase 4: Cost Optimization & Advanced Features (4-6 weeks)

**Goal**: Enterprise value-add features

**Features:**
- ✅ Cost optimization recommendations
- ✅ Pattern-based sampling/filtering
- ✅ Pattern-based alerting
- ✅ Multi-field pattern detection
- ✅ Pattern export/import
- ✅ VRL pattern functions

**Files to Create/Modify:**
- `src/service/search/pattern_extraction/cost_optimizer.rs` (new)
- `o2_enterprise/src/patterns/` (new module)

---

## 8. Technical Specifications

### 8.1 Drain3-rs Configuration

```rust
use drain3_rs::{Drain, DrainConfig};

let config = DrainConfig {
    max_depth: 4,              // Tree depth
    sim_threshold: 0.4,        // Similarity threshold
    max_children: 100,         // Max children per node
    max_clusters: 1000,        // Max pattern clusters
    extra_delimiters: vec![    // Additional delimiters
        '=', ':', ',', '[', ']', '(', ')', '{', '}'
    ],
    persist_state: true,       // Save state for incremental
};

let mut drain = Drain::new(config);
```

### 8.2 Dedicated Pattern Extraction API

**Why Separate Endpoint?**
- Cleaner separation of concerns (search vs pattern extraction)
- Independent rate limiting and circuit breaking
- Different permission model (search vs pattern analysis)
- Better monitoring and cost tracking
- Async support built-in from day 1

#### **On-Demand Pattern Extraction API**

**Endpoint:** `POST /{org_id}/streams/{stream_name}/patterns/extract`

**Request (Sync):**
```json
{
  "time_range": {
    "start_time": 1698000000000000,
    "end_time": 1698086400000000
  },
  "filters": {
    "sql": "WHERE severity = 'error'",
    "match_all": [
      {"field": "service", "value": "auth"}
    ]
  },
  "extraction_config": {
    "sample_size": 10000,
    "fields": ["message"],          // Fields to extract patterns from
    "min_cluster_size": 10,         // Minimum logs per pattern
    "similarity_threshold": 0.4,    // Drain3 similarity
    "async": false,                 // Force sync (if sample_size allows)
    "stratified_sampling": true,    // Oversample errors/warnings
    "deduplicate": true             // Merge similar patterns
  }
}
```

**Response (Sync - sample_size ≤ 100k):**
```json
{
  "extraction_id": "ext_abc123xyz",
  "status": "completed",
  "extraction_time_ms": 1523,
  "statistics": {
    "total_logs_analyzed": 10000,
    "total_patterns_found": 45,
    "coverage_percentage": 98.5,
    "rare_patterns": 3,            // Patterns with <1% frequency
    "is_partial": false,
    "worker_success_rate": 100.0
  },
  "patterns": [
    {
      "pattern_id": "pat_abc123",
      "template": "User <*> logged in from <*>",
      "tokens": ["User", "<*>", "logged", "in", "from", "<*>"],
      "frequency": 1523,
      "percentage": 15.23,
      "examples": [
        {
          "log": "User john logged in from 192.168.1.1",
          "variables": {
            "var_0": "john",
            "var_1": "192.168.1.1"
          }
        }
      ],
      "variable_types": ["string", "ip_address"],
      "variable_positions": [1, 5],
      "first_seen": "2025-10-26T09:15:23Z",
      "last_seen": "2025-10-26T10:00:00Z",
      "is_anomaly": false,
      "anomaly_score": 0.12
    }
  ],
  "metadata": {
    "extraction_method": "drain3-rs",
    "drain3_config": {
      "max_depth": 4,
      "sim_threshold": 0.4,
      "max_clusters": 1000
    },
    "sample_strategy": "stratified",
    "cache_hit": false
  }
}
```

**Response (Async - sample_size > 100k):**
```json
{
  "extraction_id": "ext_xyz789abc",
  "status": "running",
  "message": "Pattern extraction started. Large sample size requires async processing.",
  "progress_url": "/api/v1/{org_id}/streams/{stream_name}/patterns/extract/ext_xyz789abc",
  "poll_interval_seconds": 5,
  "estimated_completion_seconds": 45,
  "started_at": "2025-10-26T10:00:00Z"
}
```

#### **Poll Async Extraction Progress**

**Endpoint:** `GET /{org_id}/streams/{stream_name}/patterns/extract/{extraction_id}`

**Response (In Progress):**
```json
{
  "extraction_id": "ext_xyz789abc",
  "status": "running",
  "progress": {
    "percentage": 65.5,
    "logs_processed": 6550000,
    "logs_total": 10000000,
    "patterns_found_so_far": 312,
    "elapsed_seconds": 29
  },
  "estimated_completion_seconds": 15
}
```

**Response (Completed):**
```json
{
  "extraction_id": "ext_xyz789abc",
  "status": "completed",
  // ... same as sync response above
}
```

**Response (Failed):**
```json
{
  "extraction_id": "ext_xyz789abc",
  "status": "failed",
  "error": {
    "code": "EXTRACTION_TIMEOUT",
    "message": "Pattern extraction timed out after 300 seconds",
    "details": {
      "logs_processed": 7500000,
      "logs_total": 10000000,
      "partial_results_available": true
    }
  },
  "partial_results_url": "/api/v1/{org_id}/streams/{stream_name}/patterns/extract/ext_xyz789abc/partial"
}
```

#### **Cancel Running Extraction**

**Endpoint:** `DELETE /{org_id}/streams/{stream_name}/patterns/extract/{extraction_id}`

**Response:**
```json
{
  "extraction_id": "ext_xyz789abc",
  "status": "cancelled",
  "message": "Pattern extraction cancelled by user",
  "logs_processed": 3250000,
  "partial_results_available": true
}
```

#### **Integrated Pattern Extraction with Search Results**

**CRITICAL UX FEATURE**: Users need patterns **with their logs**, not separate.

**Endpoint:** `POST /{org_id}/_search` (existing search endpoint)

**Request with Pattern Annotation:**
```json
{
  "query": {
    "sql": "SELECT * FROM service_logs WHERE severity='error'",
    "start_time": 1698000000000000,
    "end_time": 1698086400000000,
    "from": 0,
    "size": 1000
  },
  "pattern_annotation": {
    "enabled": true,
    "mode": "lightweight",  // "lightweight" | "full_extraction"
    "use_cached_patterns": true,
    "extract_if_missing": false  // Don't extract if no cached patterns
  }
}
```

**Response with Pattern-Annotated Logs:**
```json
{
  "took": 523,
  "hits": {
    "total": 5000,
    "hits": [
      {
        "_timestamp": "2025-10-26T10:15:23Z",
        "_source": {
          "message": "User john logged in from 192.168.1.1",
          "severity": "info",
          "service": "auth"
        },
        "_pattern": {
          "pattern_id": "pat_abc123",
          "pattern_template": "User <*> logged in from <*>",
          "variables": {
            "0": "john",
            "1": "192.168.1.1"
          },
          "variable_names": {
            "0": "username",
            "1": "ip_address"
          },
          "frequency_percentile": 85.3,
          "is_anomaly": false
        }
      },
      {
        "_timestamp": "2025-10-26T10:15:24Z",
        "_source": {
          "message": "Database connection failed: timeout after 30s",
          "severity": "error",
          "service": "api"
        },
        "_pattern": {
          "pattern_id": "pat_xyz789",
          "pattern_template": "Database connection failed: timeout after <*>",
          "variables": {
            "0": "30s"
          },
          "variable_names": {
            "0": "timeout_duration"
          },
          "frequency_percentile": 2.3,
          "is_anomaly": true,
          "anomaly_reason": "Rare pattern (<5% frequency)"
        }
      }
    ]
  },
  "pattern_summary": {
    "total_patterns": 45,
    "patterns_in_results": 12,
    "top_patterns": [
      {
        "pattern_id": "pat_abc123",
        "template": "User <*> logged in from <*>",
        "count": 523,
        "percentage": 52.3
      },
      {
        "pattern_id": "pat_xyz789",
        "template": "Database connection failed: timeout after <*>",
        "count": 15,
        "percentage": 1.5,
        "is_anomaly": true
      }
    ],
    "pattern_source": "cached",  // "cached" | "extracted" | "partial"
    "cache_age_seconds": 3600
  }
}
```

**Two Modes for Different Use Cases:**

### **Mode 1: Lightweight Pattern Annotation (RECOMMENDED)**
- Uses **pre-computed patterns** from periodic extraction or cache
- Fast: +10-50ms overhead per search
- Each log matched against known patterns
- No drain3 extraction on search path

**When to use:**
- Regular log viewing
- Troubleshooting sessions
- Pattern-based filtering in UI
- When patterns already extracted (periodic jobs running)

**Implementation:**
```rust
pub async fn annotate_logs_with_patterns(
    logs: Vec<Log>,
    stream: &str,
    pattern_cache: &PatternCache
) -> Vec<AnnotatedLog> {
    // Load cached patterns for this stream (fast: <10ms)
    let patterns = pattern_cache.get_patterns(stream).await?;

    // Build compiled pattern matcher (one-time per stream)
    let matcher = CompiledPatternMatcher::new(&patterns);

    // Match each log against patterns (parallel)
    logs.par_iter()
        .map(|log| {
            let pattern_match = matcher.match_message(&log.message);
            AnnotatedLog {
                log: log.clone(),
                pattern: pattern_match,
            }
        })
        .collect()
}
```

### **Mode 2: Full Extraction with Search (SLOWER)**
- Runs drain3 extraction on search results
- Slow: +2-60s depending on sample size
- Use when no cached patterns exist
- Or user explicitly requests fresh extraction

**When to use:**
- First-time pattern discovery for new streams
- Investigating specific time windows with no cached patterns
- User clicks "Extract Patterns" button explicitly

**Implementation:**
```rust
pub async fn search_with_pattern_extraction(
    query: SearchQuery,
    extract_patterns: bool
) -> SearchResponse {
    // Step 1: Execute search (existing logic)
    let search_results = execute_search(query).await?;

    // Step 2: If pattern extraction requested
    if extract_patterns {
        // Run drain3 on search results
        let patterns = extract_patterns_from_logs(
            &search_results.hits,
            sample_size: 10_000
        ).await?;

        // Step 3: Annotate logs with just-extracted patterns
        let annotated_logs = annotate_logs_with_patterns(
            search_results.hits,
            &patterns
        );

        return SearchResponse {
            hits: annotated_logs,
            pattern_summary: Some(patterns),
            ...
        };
    }

    // Step 3 (alternate): Try lightweight annotation with cache
    if let Some(cached_patterns) = pattern_cache.get(stream).await {
        let annotated_logs = annotate_logs_with_patterns(
            search_results.hits,
            &cached_patterns
        );

        return SearchResponse {
            hits: annotated_logs,
            pattern_summary: Some(cached_patterns),
            ...
        };
    }

    // No patterns available
    search_results
}
```

---

### **UI Integration Examples**

#### **Log Viewer with Pattern Highlighting:**
```
╔══════════════════════════════════════════════════════════════╗
║ Logs (1,000 results)              [Extract Patterns] Button ║
╠══════════════════════════════════════════════════════════════╣
║ 📊 Pattern Summary: 12 patterns found                       ║
║ ┌─ User <*> logged in from <*>          (523 logs, 52.3%)  ║
║ ├─ API request <*> completed in <*>ms   (312 logs, 31.2%)  ║
║ └─ Database timeout after <*>           (15 logs, 1.5%) ⚠️  ║
╠══════════════════════════════════════════════════════════════╣
║ 10:15:23 [INFO] User john logged in from 192.168.1.1       ║
║              ↳ Pattern: User <*> logged in from <*>         ║
║              ↳ Variables: username=john, ip=192.168.1.1     ║
║                                                               ║
║ 10:15:24 [ERROR] Database timeout after 30s             ⚠️  ║
║              ↳ Pattern: Database timeout after <*>          ║
║              ↳ ANOMALY: Rare pattern (1.5% frequency)       ║
║              ↳ Variable: timeout_duration=30s               ║
╚══════════════════════════════════════════════════════════════╝

[Filter by Pattern ▼] [Group by Pattern] [Anomalies Only]
```

#### **Pattern-Based Log Filtering:**
```javascript
// User clicks pattern in summary
onClick(pattern_id) {
  // Filter logs to show only this pattern
  filteredLogs = allLogs.filter(log =>
    log._pattern?.pattern_id === pattern_id
  );

  // Highlight pattern variables in logs
  highlightVariables(filteredLogs);
}
```

#### **Anomaly Detection Highlighting:**
```javascript
// Auto-highlight anomalous patterns
anomalousLogs = allLogs.filter(log =>
  log._pattern?.is_anomaly === true
);

// Show warning badge next to rare patterns
if (log._pattern?.frequency_percentile < 5.0) {
  showWarningBadge("Rare pattern detected!");
}
```

---

### **Performance Comparison**

| Approach | Latency | When to Use |
|----------|---------|-------------|
| **No patterns** | 0ms | Default (no pattern feature enabled) |
| **Lightweight annotation** | +10-50ms | Regular use (cached patterns available) |
| **Full extraction** | +2-60s | First discovery, explicit user action |
| **Separate extraction API** | +2-60s | Background jobs, pattern management |

---

### **Recommended Default Behavior**

```yaml
# Default configuration for log search
search:
  pattern_annotation:
    enabled: true
    mode: lightweight
    use_cached_patterns: true
    extract_if_missing: false

    # Auto-enable for error logs
    auto_enable_for:
      - severity: error
      - severity: critical

    # Disable for high-volume streams
    disabled_streams:
      - metrics
      - traces
      - debug_logs
```

**User Flow:**
1. User opens log viewer → Lightweight annotation enabled automatically
2. If cached patterns exist → Logs annotated instantly (+10-50ms)
3. If no cached patterns → Show "Extract Patterns" button
4. User clicks button → Full extraction runs, then annotates
5. Patterns cached → Next searches use lightweight mode

---

### **Benefits of This Approach**

✅ **Integrated UX**: Patterns shown WITH logs, not separate
✅ **Fast default**: <50ms overhead for cached patterns
✅ **Progressive enhancement**: Works with or without cached patterns
✅ **Flexible**: Both lightweight and full extraction modes
✅ **Actionable**: Click pattern → filter logs → see examples
✅ **Anomaly detection**: Auto-highlight rare/new patterns
✅ **Backward compatible**: Works with existing search API

---

### 8.3 Pattern Query API

```sql
-- Query patterns for a stream
SELECT * FROM _patterns_service_logs
WHERE extraction_time > '2025-10-20T00:00:00Z'
ORDER BY frequency DESC

-- Find new patterns in last hour
SELECT * FROM _patterns_service_logs
WHERE first_seen > now() - interval '1 hour'

-- Pattern frequency trends
SELECT
  pattern_id,
  date_trunc('hour', extraction_time) as hour,
  sum(frequency) as total_count
FROM _patterns_service_logs
WHERE extraction_time > now() - interval '24 hours'
GROUP BY pattern_id, hour
ORDER BY hour DESC
```

### 8.4 VRL Integration for Pattern-Based Transformations

**Concrete VRL Functions Specification:**

Pattern-based VRL functions enable dynamic field extraction, routing, and enrichment based on discovered patterns.

#### **Function 1: `extract_from_pattern`**

Extract variables from log messages using pattern templates:

```ruby
# VRL Function Signature
extract_from_pattern(
  message: string,
  pattern_id: string,
  variable_name: string
) -> string | null

# Usage Examples
.username = extract_from_pattern(.message, "login_pattern_001", "username")
.ip_address = extract_from_pattern(.message, "login_pattern_001", "ip_address")
.error_code = extract_from_pattern(.message, "error_pattern_042", "error_code")

# Example Log
message = "User john logged in from 192.168.1.1"
# Pattern: "User <*> logged in from <*>"
# Variables: {0: "username", 1: "ip_address"}

.user_name = extract_from_pattern(.message, "pat_abc123", "0")  # "john"
.source_ip = extract_from_pattern(.message, "pat_abc123", "1")  # "192.168.1.1"
```

**Implementation:**

```rust
use vrl::prelude::*;

#[derive(Clone, Copy, Debug)]
pub struct ExtractFromPattern;

impl Function for ExtractFromPattern {
    fn identifier(&self) -> &'static str {
        "extract_from_pattern"
    }

    fn parameters(&self) -> &'static [Parameter] {
        &[
            Parameter {
                keyword: "message",
                kind: kind::BYTES,
                required: true,
            },
            Parameter {
                keyword: "pattern_id",
                kind: kind::BYTES,
                required: true,
            },
            Parameter {
                keyword: "variable_name",
                kind: kind::BYTES,
                required: true,
            },
        ]
    }

    fn compile(
        &self,
        _state: &TypeState,
        _ctx: &mut FunctionCompileContext,
        arguments: ArgumentList,
    ) -> Compiled {
        let message = arguments.required("message");
        let pattern_id = arguments.required("pattern_id");
        let variable_name = arguments.required("variable_name");

        Ok(ExtractFromPatternFn {
            message,
            pattern_id,
            variable_name,
            pattern_cache: Arc::new(RwLock::new(PatternCache::new())),
        }
        .as_expr())
    }
}

#[derive(Debug, Clone)]
struct ExtractFromPatternFn {
    message: Box<dyn Expression>,
    pattern_id: Box<dyn Expression>,
    variable_name: Box<dyn Expression>,
    pattern_cache: Arc<RwLock<PatternCache>>,
}

impl FunctionExpression for ExtractFromPatternFn {
    fn resolve(&self, ctx: &mut Context) -> ExpressionResult<Value> {
        let message = self.message.resolve(ctx)?.try_bytes_utf8_lossy()?;
        let pattern_id = self.pattern_id.resolve(ctx)?.try_bytes_utf8_lossy()?;
        let variable_name = self.variable_name.resolve(ctx)?.try_bytes_utf8_lossy()?;

        // Load pattern from cache
        let pattern = self.pattern_cache
            .read()
            .unwrap()
            .get(&pattern_id)
            .ok_or_else(|| format!("Pattern not found: {}", pattern_id))?;

        // Match log message against pattern template
        let matches = pattern.match_log(&message)?;

        // Extract requested variable
        let value = matches
            .get_variable(&variable_name)
            .ok_or_else(|| format!("Variable not found: {}", variable_name))?;

        Ok(Value::Bytes(value.into()))
    }
}
```

#### **Function 2: `match_pattern`**

Check if a log message matches a specific pattern:

```ruby
# VRL Function Signature
match_pattern(message: string, pattern_id: string) -> bool

# Usage Examples
if match_pattern(.message, "error_pattern_042") {
  .alert_severity = "high"
}

if match_pattern(.message, "healthcheck_pattern") {
  .drop = true  # Drop health check logs
}

# Pattern-based routing
.destination_stream = if match_pattern(.message, "security_pattern") {
  "security_logs"
} else if match_pattern(.message, "error_pattern") {
  "error_logs"
} else {
  "general_logs"
}
```

#### **Function 3: `enrich_with_pattern`**

Enrich log with pattern metadata:

```ruby
# VRL Function Signature
enrich_with_pattern(message: string) -> object

# Usage Example
.pattern_info = enrich_with_pattern(.message)
# Returns:
# {
#   "pattern_id": "pat_abc123",
#   "pattern_template": "User <*> logged in from <*>",
#   "is_anomaly": false,
#   "frequency_percentile": 85.3
# }

# Extract all variables automatically
pattern_data = enrich_with_pattern(.message)
.pattern_id = pattern_data.pattern_id
.variables = pattern_data.variables
.is_rare_pattern = pattern_data.frequency_percentile < 1.0
```

#### **Function 4: `pattern_based_sample`**

Intelligent sampling based on pattern rarity:

```ruby
# VRL Function Signature
pattern_based_sample(
  message: string,
  common_pattern_rate: float,
  rare_pattern_rate: float
) -> bool

# Usage Example
# Sample 1% of common patterns, 100% of rare patterns
if !pattern_based_sample(.message, 0.01, 1.0) {
  .drop = true
}

# Implementation uses pattern frequency to determine sampling
# Rare patterns (frequency_percentile < 5%) always kept
# Common patterns sampled at specified rate
```

**VRL Function Implementation Architecture:**

```rust
pub struct PatternVRLFunctions {
    // Shared pattern cache across all VRL invocations
    pattern_cache: Arc<RwLock<PatternCache>>,

    // Pattern matcher using drain3-rs
    pattern_matcher: Arc<PatternMatcher>,
}

impl PatternVRLFunctions {
    pub fn register_all(ctx: &mut FunctionContext) {
        ctx.register(ExtractFromPattern);
        ctx.register(MatchPattern);
        ctx.register(EnrichWithPattern);
        ctx.register(PatternBasedSample);
    }

    pub async fn refresh_pattern_cache(&self, stream: &str) {
        // Periodically load latest patterns from storage
        let patterns = self.load_patterns_from_storage(stream).await;
        let mut cache = self.pattern_cache.write().unwrap();
        cache.update(stream, patterns);
    }
}

pub struct PatternCache {
    patterns: HashMap<String, HashMap<String, Pattern>>, // stream -> pattern_id -> Pattern
    matcher_cache: HashMap<String, CompiledPatternMatcher>,
    ttl: Duration,
}

impl PatternCache {
    pub fn get(&self, pattern_id: &str) -> Option<Pattern> {
        // TODO: Implement pattern lookup with LRU caching
    }

    pub fn match_message(&self, stream: &str, message: &str) -> Option<PatternMatch> {
        // Use compiled pattern matcher for fast matching
        self.matcher_cache
            .get(stream)?
            .match_message(message)
    }
}
```

### 8.5 Pattern Export/Import API

Enable community sharing of pattern templates for common log sources (Apache, Nginx, K8s, etc.).

#### **Export Patterns**

**Endpoint:** `GET /{org_id}/streams/{stream_name}/patterns/export`

**Query Parameters:**
- `format`: `json` | `yaml` | `grok` (default: `json`)
- `time_range`: Optional time range filter
- `min_frequency`: Minimum pattern frequency to export
- `include_examples`: Include example logs (default: `false`)

**Response (JSON format):**
```json
{
  "export_metadata": {
    "export_date": "2025-10-26T10:00:00Z",
    "source_org": "acme_corp",
    "source_stream": "nginx_access_logs",
    "pattern_count": 25,
    "time_range": {
      "start": "2025-10-20T00:00:00Z",
      "end": "2025-10-26T00:00:00Z"
    }
  },
  "patterns": [
    {
      "pattern_template": "GET <*> HTTP/<*> <*> <*>",
      "pattern_tokens": ["GET", "<*>", "HTTP/<*>", "<*>", "<*>"],
      "description": "HTTP GET request pattern",
      "variable_names": ["path", "http_version", "status_code", "response_size"],
      "variable_types": ["string", "string", "integer", "integer"],
      "examples": [
        "GET /api/users HTTP/1.1 200 1234"
      ],
      "drain3_config": {
        "max_depth": 4,
        "sim_threshold": 0.4
      },
      "tags": ["nginx", "access_log", "http"]
    }
  ]
}
```

**Response (Grok format):**
```
# Exported from OpenObserve on 2025-10-26
# Source: acme_corp/nginx_access_logs

# HTTP GET request pattern
GET_REQUEST %{DATA:path} HTTP/%{DATA:http_version} %{INT:status_code} %{INT:response_size}

# HTTP POST request pattern
POST_REQUEST %{DATA:path} HTTP/%{DATA:http_version} %{INT:status_code} %{INT:response_size}
```

#### **Import Patterns**

**Endpoint:** `POST /{org_id}/streams/{stream_name}/patterns/import`

**Request:**
```json
{
  "import_mode": "merge",  // "merge" | "replace"
  "patterns": [
    {
      "pattern_template": "User <*> logged in from <*>",
      "description": "User login pattern",
      "variable_names": ["username", "ip_address"],
      "variable_types": ["string", "ip_address"],
      "tags": ["authentication", "security"]
    }
  ],
  "validate": true,  // Test patterns before importing
  "auto_activate": false  // Auto-use for pattern extraction
}
```

**Response:**
```json
{
  "import_id": "imp_abc123",
  "status": "completed",
  "imported_patterns": 15,
  "skipped_patterns": 2,
  "failed_patterns": 1,
  "validation_results": [
    {
      "pattern_template": "Invalid pattern <*",
      "status": "failed",
      "error": "Unclosed variable placeholder"
    }
  ],
  "patterns": [
    {
      "pattern_id": "pat_imported_001",
      "pattern_template": "User <*> logged in from <*>",
      "status": "imported"
    }
  ]
}
```

#### **Community Pattern Library**

**Endpoint:** `GET /api/v1/patterns/community`

**Query Parameters:**
- `source`: `nginx` | `apache` | `k8s` | `docker` | `aws` | `gcp`
- `category`: `access_log` | `error_log` | `audit_log` | `metrics`
- `search`: Free-text search

**Response:**
```json
{
  "patterns": [
    {
      "pattern_id": "community_nginx_access_001",
      "name": "Nginx Combined Access Log",
      "description": "Standard nginx access log format (combined)",
      "pattern_template": "<*> - - [<*>] \"<*> <*> HTTP/<*>\" <*> <*> \"<*>\" \"<*>\"",
      "source": "nginx",
      "category": "access_log",
      "downloads": 1523,
      "rating": 4.8,
      "verified": true,
      "contributed_by": "openobserve",
      "tags": ["nginx", "access_log", "http"]
    }
  ]
}
```

#### **Pre-built Pattern Libraries**

```rust
// Ship with OpenObserve
pub mod pattern_libraries {
    pub const NGINX_PATTERNS: &str = include_str!("patterns/nginx.json");
    pub const APACHE_PATTERNS: &str = include_str!("patterns/apache.json");
    pub const K8S_PATTERNS: &str = include_str!("patterns/kubernetes.json");
    pub const DOCKER_PATTERNS: &str = include_str!("patterns/docker.json");
    pub const AWS_PATTERNS: &str = include_str!("patterns/aws.json");

    pub fn load_builtin_patterns(source: &str) -> Result<Vec<PatternTemplate>> {
        match source {
            "nginx" => serde_json::from_str(NGINX_PATTERNS),
            "apache" => serde_json::from_str(APACHE_PATTERNS),
            "k8s" | "kubernetes" => serde_json::from_str(K8S_PATTERNS),
            "docker" => serde_json::from_str(DOCKER_PATTERNS),
            "aws" => serde_json::from_str(AWS_PATTERNS),
            _ => Err(Error::UnsupportedPatternSource),
        }
    }
}
```

---

## 9. Performance Considerations

### 9.1 Drain3-rs Performance

**Single-threaded Performance:**
- **Throughput**: ~10,000-50,000 logs/sec (single thread)
- **Memory**: ~100-500MB for 1M logs
- **Latency**: O(log n) per log with tree depth

**Multi-threaded Performance:**
- **4 cores**: 40,000-200,000 logs/sec
- **16 cores**: 160,000-800,000 logs/sec
- **64 cores**: 640,000-3,200,000 logs/sec

**Memory Scaling:**
- 1M logs: ~500MB RAM
- 10M logs: ~5GB RAM
- 100M logs: ~50GB RAM (requires chunked processing)
- 1B logs: Requires distributed processing across workers

### 9.2 Distributed Processing

**Architecture:**
- Split logs across N worker queriers
- Each worker processes chunk independently with drain3-rs
- Leader coordinates and merges patterns using hierarchical reduction
- Patterns deduplicated using LSH (Locality-Sensitive Hashing)

**Hierarchical Pattern Merging:**
```rust
// Instead of O(n²) all-to-all merging:
// Use tree-based reduction: Workers merge in pairs up the tree
//
//          Leader (final merge)
//         /                    \
//    Merge(W1,W2)           Merge(W3,W4)
//      /      \               /      \
//    W1       W2            W3       W4
//
// Complexity: O(n log n) instead of O(n²)
// For 1000 workers: 1000 comparisons vs 500,000 comparisons

fn hierarchical_merge(worker_patterns: Vec<Vec<Pattern>>) -> Vec<Pattern> {
    if worker_patterns.len() == 1 {
        return worker_patterns[0].clone();
    }

    // Pair up workers and merge in parallel
    let merged_pairs: Vec<Vec<Pattern>> = worker_patterns
        .chunks(2)
        .map(|pair| merge_patterns_with_lsh(pair))
        .collect();

    // Recurse up the tree
    hierarchical_merge(merged_pairs)
}
```

**Throughput by Scale:**
- **10 workers**: 400k-2M logs/sec
- **50 workers**: 2M-10M logs/sec
- **100 workers**: 4M-20M logs/sec
- **1000 workers**: 40M-200M logs/sec (PB-scale)

**Real-world Scaling:**
- 200GB/day = 2.3M logs/sec peak → **10-50 workers**
- 10TB/day = 115M logs/sec peak → **50-100 workers**
- 1PB/day = 11.6B logs/sec peak → **100-1000 workers** (with heavy sampling)

### 9.3 Query Overhead

**On-Demand Extraction Latency:**
- 10k sample: +500ms-1s
- 100k sample: +2-5s
- 1M sample: +10-20s
- 10M sample: +60-120s (requires async with progress indicator)
- 100M sample: +5-10min (requires async background job)

**Mitigation for Large Samples:**
- Async extraction: Return immediately with job ID, poll for completion
- Progress indicators: Real-time progress updates to UI
- Result caching: Cache results for 1 hour for repeated queries

**Periodic Extraction:**
- Pre-computed patterns: +0ms (patterns cached in memory)
- Cache hit rate: >80% for active streams

### 9.4 Storage Overhead

**Per-Pattern Storage:**
- Pattern record size: ~1-5KB per pattern
- Patterns per stream: ~50-500 typical, max 1000

**Storage Scaling by Customer Size:**

| Customer Scale | Daily Volume | Streams | Patterns/Stream | Daily Storage | Annual Storage |
|----------------|--------------|---------|-----------------|---------------|----------------|
| Small          | <10GB        | 10-50   | 100             | 5-25KB        | 1.8-9MB        |
| Medium         | 10GB-1TB     | 50-500  | 200             | 50-500KB      | 18MB-180MB     |
| Large          | 1TB-100TB    | 500-5K  | 300             | 750KB-7.5MB   | 270MB-2.7GB    |
| Petabyte       | >100TB       | 5K-50K  | 500             | 12.5-125MB    | 4.5GB-45GB     |

**With Hourly Extraction (Worst Case):**
- Small: 43MB-216MB/year
- Medium: 432MB-4.3GB/year
- Large: 6.5GB-65GB/year
- Petabyte: 108GB-1TB/year

**Storage Optimization Strategies:**
1. **Pattern Aggregation**: Roll up hourly patterns to daily after 7 days
2. **Compression**: Compress pattern history (50-70% reduction)
3. **Retention Policies**: Default 90 days, configurable per stream
4. **Selective Extraction**: Not all streams need hourly extraction

---

## 10. Security & Enterprise Considerations

### 10.1 Access Control
- Pattern extraction requires `search` permission
- Pattern storage respects org-level isolation
- Enterprise license validation for periodic extraction

### 10.2 Data Privacy
- Pattern examples can be redacted (only show template)
- Sensitive field exclusion (passwords, tokens, etc.)
- Configurable PII masking in pattern extraction

### 10.3 Resource Limits & Rate Limiting

**Credit-Based Rate Limiting System:**

Instead of simple request-based rate limiting, use compute-aware credits to prevent resource exhaustion:

```rust
pub struct PatternExtractionCredits {
    // Credits regenerate hourly
    credits_per_hour: u64,

    // Current available credits
    available_credits: AtomicU64,

    // Credit costs by operation size
    cost_per_10k_sample: u64,   // 1 credit
    cost_per_100k_sample: u64,  // 10 credits
    cost_per_1m_sample: u64,    // 100 credits
    cost_per_10m_sample: u64,   // 1000 credits
}

// Scale credits by license tier and customer size
pub fn get_credit_budget(customer_scale: CustomerScale, license_tier: LicenseTier) -> u64 {
    match (customer_scale, license_tier) {
        // Small customers
        (CustomerScale::Small, LicenseTier::Basic) => 100,      // ~1M samples/hour
        (CustomerScale::Small, LicenseTier::Enterprise) => 500, // ~5M samples/hour

        // Medium customers
        (CustomerScale::Medium, LicenseTier::Basic) => 1_000,      // ~10M samples/hour
        (CustomerScale::Medium, LicenseTier::Enterprise) => 5_000, // ~50M samples/hour

        // Large customers
        (CustomerScale::Large, LicenseTier::Enterprise) => 50_000, // ~500M samples/hour

        // Petabyte customers
        (CustomerScale::Petabyte, LicenseTier::Enterprise) => 500_000, // ~5B samples/hour
    }
}

// Calculate cost before extraction
pub fn calculate_extraction_cost(sample_size: u64) -> u64 {
    match sample_size {
        0..=10_000 => 1,
        10_001..=100_000 => 10,
        100_001..=1_000_000 => 100,
        1_000_001..=10_000_000 => 1_000,
        _ => 10_000,
    }
}
```

**Resource Limits by Scale:**

| Customer Scale | Max Sample/Query | Max Patterns/Stream | Max Concurrent Jobs | Credits/Hour |
|----------------|------------------|---------------------|---------------------|--------------|
| **Small** | 100k | 500 | 5 | 100-500 |
| **Medium** | 1M | 1000 | 20 | 1k-5k |
| **Large** | 10M | 1000 | 50 | 10k-50k |
| **Petabyte** | 100M | 1000 | 100 | 100k-500k |

**Auto-Throttling & Circuit Breaker:**
```rust
pub struct PatternExtractionCircuitBreaker {
    // Monitor cluster health
    cpu_usage: f64,
    memory_usage: f64,
    active_jobs: usize,

    // Thresholds
    throttle_cpu_threshold: f64,  // 0.70 = 70% CPU
    disable_cpu_threshold: f64,   // 0.90 = 90% CPU
    throttle_memory_threshold: f64, // 0.80 = 80% memory
}

impl PatternExtractionCircuitBreaker {
    pub fn should_allow_extraction(&self) -> ExtractionDecision {
        // Critical: Disable if cluster overloaded
        if self.cpu_usage > self.disable_cpu_threshold {
            return ExtractionDecision::Deny("Cluster CPU overloaded");
        }

        if self.memory_usage > self.throttle_memory_threshold {
            return ExtractionDecision::Deny("Cluster memory overloaded");
        }

        // Throttle: Allow but reduce sample size
        if self.cpu_usage > self.throttle_cpu_threshold {
            return ExtractionDecision::Throttle(0.5); // Reduce sample by 50%
        }

        ExtractionDecision::Allow
    }
}
```

---

## 11. Failure Handling & Resilience

### 11.1 Partial Pattern Extraction

Critical for distributed systems at scale - some workers may fail:

```rust
pub struct PatternExtractionResult {
    patterns: Vec<Pattern>,

    // Metadata for partial results
    total_workers: usize,
    successful_workers: usize,
    failed_workers: usize,
    coverage_percentage: f64,

    // Quality indicators
    is_partial: bool,
    is_reliable: bool, // true if >80% workers succeeded

    errors: Vec<WorkerError>,
}

impl PatternExtractionResult {
    pub fn from_worker_results(results: Vec<WorkerResult>) -> Self {
        let total = results.len();
        let successful: Vec<_> = results.iter()
            .filter(|r| r.is_ok())
            .collect();
        let failed = total - successful.len();

        let coverage = (successful.len() as f64) / (total as f64);

        // Merge patterns from successful workers only
        let patterns = merge_worker_patterns(successful);

        PatternExtractionResult {
            patterns,
            total_workers: total,
            successful_workers: successful.len(),
            failed_workers: failed,
            coverage_percentage: coverage * 100.0,
            is_partial: failed > 0,
            is_reliable: coverage >= 0.8, // 80% threshold
            errors: collect_errors(&results),
        }
    }
}

// Return partial results to user with clear indicators
// Better than failing completely at PB-scale
```

### 11.2 Timeout Handling

Different timeout strategies by extraction type:

| Extraction Type | Timeout | Behavior on Timeout |
|----------------|---------|---------------------|
| **On-demand (10k)** | 30s | Return partial results + warning |
| **On-demand (100k)** | 60s | Return partial results + warning |
| **On-demand (1M+)** | 5min | Automatic async conversion, return job ID |
| **Periodic** | 30min | Retry with reduced sample size |

```rust
pub struct ExtractionTimeout {
    sample_size: u64,
    extraction_type: ExtractionType,
}

impl ExtractionTimeout {
    pub fn timeout_duration(&self) -> Duration {
        match (self.extraction_type, self.sample_size) {
            (ExtractionType::OnDemand, 0..=10_000) => Duration::from_secs(30),
            (ExtractionType::OnDemand, 10_001..=100_000) => Duration::from_secs(60),
            (ExtractionType::OnDemand, 100_001..=1_000_000) => Duration::from_secs(300),
            (ExtractionType::OnDemand, _) => Duration::from_secs(600), // Auto-async
            (ExtractionType::Periodic, _) => Duration::from_secs(1800),
        }
    }

    pub fn on_timeout(&self) -> TimeoutAction {
        match self.extraction_type {
            ExtractionType::OnDemand => {
                if self.sample_size > 1_000_000 {
                    TimeoutAction::ConvertToAsync
                } else {
                    TimeoutAction::ReturnPartial
                }
            },
            ExtractionType::Periodic => {
                // Retry with 50% sample size
                TimeoutAction::RetryReduced(0.5)
            },
        }
    }
}
```

### 11.3 Degraded Mode Operations

When cluster is under stress, gracefully degrade instead of failing:

```rust
pub enum DegradedMode {
    // Normal: All features available
    Normal,

    // Throttled: Reduce sample sizes by 50%
    Throttled { reduction_factor: f64 },

    // LimitedStreams: Only extract from critical streams
    LimitedStreams { allowed_streams: HashSet<String> },

    // OnDemandOnly: Disable periodic extraction
    OnDemandOnly,

    // Disabled: Temporarily disable all pattern extraction
    Disabled { reason: String, retry_after: Duration },
}

pub struct PatternExtractionService {
    mode: Arc<RwLock<DegradedMode>>,
    health_monitor: HealthMonitor,
}

impl PatternExtractionService {
    pub async fn auto_adjust_mode(&self) {
        let health = self.health_monitor.get_cluster_health().await;

        let new_mode = match health {
            ClusterHealth::Healthy => DegradedMode::Normal,

            ClusterHealth::Stressed { cpu_usage } if cpu_usage > 0.85 => {
                DegradedMode::Throttled { reduction_factor: 0.5 }
            },

            ClusterHealth::Stressed { cpu_usage } if cpu_usage > 0.80 => {
                DegradedMode::OnDemandOnly
            },

            ClusterHealth::Critical => {
                DegradedMode::Disabled {
                    reason: "Cluster overloaded".to_string(),
                    retry_after: Duration::from_secs(600), // 10 min
                }
            },

            _ => DegradedMode::Normal,
        };

        *self.mode.write().await = new_mode;
    }
}
```

### 11.4 Error Recovery Strategies

| Error Type | Recovery Strategy | Max Retries |
|------------|------------------|-------------|
| **Worker timeout** | Use partial results from other workers | N/A |
| **Worker OOM** | Reduce sample size by 50%, retry | 2 |
| **Storage failure** | Cache patterns in memory, retry storage | 3 |
| **Network partition** | Wait for partition to heal, return partial | 1 |
| **Drain3 crash** | Skip problematic logs, continue | 1 |

### 11.5 Health Monitoring & Alerting

```rust
pub struct PatternExtractionHealthMetrics {
    // Success rates
    extraction_success_rate: f64,        // Target: >95%
    worker_success_rate: f64,            // Target: >98%
    cache_hit_rate: f64,                 // Target: >80%

    // Performance metrics
    avg_extraction_latency_ms: f64,      // Target: <2000ms for 100k
    p99_extraction_latency_ms: f64,      // Target: <5000ms for 100k

    // Resource usage
    cpu_usage_percentage: f64,           // Alert if >70%
    memory_usage_percentage: f64,        // Alert if >80%

    // Quality metrics
    avg_coverage_percentage: f64,        // Target: >95%
    partial_result_rate: f64,            // Target: <5%
}

// Alert conditions
impl PatternExtractionHealthMetrics {
    pub fn health_alerts(&self) -> Vec<Alert> {
        let mut alerts = Vec::new();

        if self.extraction_success_rate < 0.90 {
            alerts.push(Alert::critical("Pattern extraction success rate below 90%"));
        }

        if self.partial_result_rate > 0.10 {
            alerts.push(Alert::warning("High partial result rate: >10%"));
        }

        if self.cpu_usage_percentage > 0.80 {
            alerts.push(Alert::warning("Pattern extraction CPU usage >80%"));
        }

        alerts
    }
}
```

---

## 12. Scalability Limits & Operational Guidelines

### 12.1 Resource Requirements by Customer Scale

| Customer Scale | Daily Volume | Querier Nodes | CPU Cores | RAM | Pattern Storage |
|----------------|--------------|---------------|-----------|-----|-----------------|
| **Small** | <10GB | 1-2 | 4-8 | 16GB | <1GB |
| **Medium** | 10GB-1TB | 5-10 | 32-64 | 128GB | 1-10GB |
| **Large** | 1TB-100TB | 20-50 | 128-256 | 512GB-1TB | 10-500GB |
| **Petabyte** | >100TB | 100-1000 | 512-4096 | 2TB-16TB | 500GB-10TB |

### 12.2 Recommended Configuration by Scale

**Small Customers (200GB/day):**
```yaml
pattern_extraction:
  enabled: true
  mode: hybrid

  on_demand:
    enabled: true
    default_sample_size: 100_000
    max_sample_size: 1_000_000
    timeout_seconds: 60

  periodic:
    enabled: true
    critical_streams:
      schedule: hourly
      sample_size: 100_000
    normal_streams:
      schedule: daily
      sample_size: 50_000

  cache:
    size_mb: 50
    ttl_seconds: 3600

  resources:
    max_concurrent_jobs: 5
    max_cpu_cores: 4
    credits_per_hour: 500
```

**Large Customers (10TB/day):**
```yaml
pattern_extraction:
  enabled: true
  mode: periodic_primary

  on_demand:
    enabled: true
    default_sample_size: 1_000_000
    max_sample_size: 10_000_000
    timeout_seconds: 300
    async_threshold: 1_000_000  # >1M samples = async

  periodic:
    enabled: true
    critical_streams:
      schedule: hourly
      sample_size: 10_000_000
    important_streams:
      schedule: every_6_hours
      sample_size: 5_000_000
    normal_streams:
      schedule: daily
      sample_size: 1_000_000

  cache:
    size_mb: 2048  # 2GB
    ttl_seconds: 7200
    distributed: true  # Use Redis

  resources:
    max_concurrent_jobs: 50
    max_cpu_cores: 64
    max_memory_gb: 256
    credits_per_hour: 50_000

  resilience:
    partial_result_threshold: 0.8  # Accept if >80% workers succeed
    auto_throttle_cpu: 0.70
    auto_disable_cpu: 0.90
```

**Petabyte Customers (1PB/day):**
```yaml
pattern_extraction:
  enabled: true
  mode: selective_periodic

  on_demand:
    enabled: false  # Too expensive for PB-scale
    # Only enable for specific critical investigations

  periodic:
    enabled: true
    stream_selection: priority_based  # Not all streams

    critical_streams:  # ~100 most critical streams
      schedule: every_6_hours
      sample_size: 100_000_000  # 100M
      retention_days: 30

    important_streams:  # ~1000 important streams
      schedule: daily
      sample_size: 10_000_000  # 10M
      retention_days: 14

    # Normal/debug streams: on-demand only

  cache:
    size_mb: 5120  # 5GB per querier
    ttl_seconds: 14400
    distributed: true
    redis_cluster: true  # Distributed Redis

  resources:
    max_concurrent_jobs: 100
    max_cpu_cores: 256
    max_memory_gb: 1024
    credits_per_hour: 500_000

    # Strict resource budgets to prevent overload
    budget_enforcement: strict

  resilience:
    partial_result_threshold: 0.7  # Accept if >70% workers succeed
    auto_throttle_cpu: 0.65
    auto_disable_cpu: 0.85
    degraded_mode_enabled: true
```

### 12.3 Capacity Planning Guidelines

**Formula for required querier nodes:**
```
Required Workers = (Daily Volume in GB × Sample Rate) / (Worker Throughput × Hours per Day)

Example for 10TB/day with 1% sampling:
- Sample volume: 10TB × 0.01 = 100GB
- Assuming 1KB avg log size: 100GB = 100M logs to process
- Worker throughput: 50k logs/sec = 180M logs/hour
- Hourly extraction: 100M / 180M = 0.56 workers per hour
- With headroom (2x): ~2-5 workers needed
```

**Storage capacity planning:**
```
Pattern Storage = Streams × Patterns/Stream × Pattern Size × Retention Days × Extraction Frequency

Example for 1000 streams, hourly extraction, 90-day retention:
- 1000 streams × 200 patterns × 3KB × 90 days × 24 hours/day
- = 1000 × 200 × 3KB × 2160
- = 1.3TB pattern storage
```

### 12.4 Operational Runbook

**When to scale up pattern extraction:**
1. Extraction success rate drops below 95%
2. P99 latency exceeds 2× target
3. Partial result rate exceeds 10%
4. Credit exhaustion rate exceeds 80%

**When to scale down or disable:**
1. Cluster CPU consistently above 85%
2. Pattern extraction blocking critical queries
3. Storage costs exceed budget
4. Low adoption (<10% of users using features)

**Troubleshooting checklist:**
- [ ] Check extraction success rates per stream
- [ ] Review worker failure logs
- [ ] Verify cache hit rates (should be >80%)
- [ ] Check for memory pressure on queriers
- [ ] Review sample sizes (may need reduction)
- [ ] Verify LSH deduplication is working
- [ ] Check for storage backend latency
- [ ] Review circuit breaker state

---

## 13. Success Metrics

### 13.1 User Value Metrics
- **Investigation time reduction**: 30-50% faster incident resolution
- **Cost savings**: 10-30% log volume reduction through pattern-based filtering
- **Pattern discovery rate**: Users find patterns in 80%+ of troubleshooting sessions

### 13.2 Technical Metrics
- **Pattern extraction latency**: <2s for 100k logs (on-demand)
- **Pattern accuracy**: >90% (similar to Drain3 benchmarks)
- **Storage efficiency**: <1% overhead vs raw logs (for medium customers)
- **Cache hit rate**: >80% for periodic patterns
- **Worker success rate**: >98% (distributed extraction)
- **Extraction success rate**: >95% overall

### 13.3 Adoption Metrics
- **Feature activation**: 40%+ of enterprise customers
- **Daily active users**: 60%+ of org users
- **Query adoption**: 20%+ of searches use pattern extraction

### 13.4 Scale-Specific Success Criteria

| Scale | Latency Target | Success Rate | Storage Overhead | Key Metric |
|-------|----------------|--------------|------------------|------------|
| **Small** | <2s (100k) | >98% | <0.5% | User satisfaction |
| **Medium** | <5s (1M) | >95% | <1% | Adoption rate |
| **Large** | <30s (10M) | >90% | <2% | Cost savings |
| **Petabyte** | Async only | >85% | <3% | Reliability |

---

## 14. Cost Modeling & ROI

### 14.1 Pattern Extraction Costs

**Compute Costs (AWS pricing example):**
```
Small (200GB/day):
- 2 queriers: c6i.2xlarge × 2 = $0.68/hr × 2 = $1.36/hr
- Pattern extraction overhead: ~10% = $0.14/hr
- Monthly cost: ~$100/month

Large (10TB/day):
- 20 queriers: c6i.8xlarge × 20 = $2.72/hr × 20 = $54.40/hr
- Pattern extraction overhead: ~15% = $8.16/hr
- Monthly cost: ~$5,880/month

Petabyte (1PB/day):
- 200 queriers: c6i.16xlarge × 200 = $5.44/hr × 200 = $1,088/hr
- Pattern extraction overhead: ~20% = $217.60/hr
- Monthly cost: ~$156,672/month
```

**Storage Costs:**
- Small: ~$1/month (S3 standard)
- Medium: ~$10-50/month
- Large: ~$100-500/month
- Petabyte: ~$1,000-10,000/month

### 14.2 Cost Savings Through Pattern-Based Optimization

**Potential Savings:**
```
Small (200GB/day):
- Identify 20% logs as low-value
- Apply 90% sampling to those logs
- Savings: 200GB × 0.2 × 0.9 = 36GB/day = 18% reduction
- At $0.50/GB: $1,080/month saved
- ROI: 10x

Medium (10TB/day):
- Identify 25% logs as low-value
- Apply 95% sampling
- Savings: 10TB × 0.25 × 0.95 = 2.375TB/day = 23.75% reduction
- At $0.30/GB: $21,375/month saved
- ROI: 4x

Large (1PB/day):
- Identify 30% logs as low-value (debug, verbose)
- Apply 98% sampling
- Savings: 1PB × 0.30 × 0.98 = 294TB/day = 29.4% reduction
- At $0.10/GB: $882,000/month saved
- ROI: 5.6x
```

**Break-even Analysis:**
- Small customers: Break-even within 1 month
- Medium customers: Break-even within 1-2 weeks
- Large/PB customers: Immediate positive ROI

---

## 15. Recommended Decision

### Phased Rollout Strategy by Customer Scale:

#### **Phase 1 (MVP) - Target: Small/Medium Customers (4-6 weeks)**

**Goal**: Prove value with manageable scale

**Scope:**
- ✅ On-demand extraction only
- ✅ Sample sizes: 10k-100k logs
- ✅ Basic UI visualization
- ✅ Simple caching (50-200MB per querier)
- ✅ Single-threaded drain3-rs

**Target Customers**: 200GB-1TB/day
- Low risk, fast implementation
- Validates user interest
- Establishes baseline metrics

**Success Criteria:**
- <2s latency for 100k samples
- >95% extraction success rate
- 30%+ feature adoption among beta customers

---

#### **Phase 2 - Pattern Storage & History (4-6 weeks)**

**Goal**: Enable pattern analytics and periodic extraction

**Scope:**
- ✅ Pattern storage in `_patterns_*` streams
- ✅ Periodic extraction (hourly/daily)
- ✅ Pattern deduplication with LSH
- ✅ SQL queries on patterns
- ✅ Pattern evolution tracking

**Target Customers**: 200GB-10TB/day
- Enables monitoring use cases
- Foundation for alerting
- Historical pattern analysis

**Success Criteria:**
- >80% cache hit rate
- <1% storage overhead
- Pattern-based alerting working

---

#### **Phase 3 - Large Scale Optimization (6-8 weeks)**

**Goal**: Support TB-scale customers reliably

**Scope:**
- ✅ Multi-threaded drain3-rs (16-64 cores)
- ✅ Hierarchical pattern merging
- ✅ Distributed cache (Redis)
- ✅ Adaptive sampling (1M-10M samples)
- ✅ Resource budgets and throttling
- ✅ Partial result handling

**Target Customers**: 10TB-100TB/day
- Distributed processing critical
- Advanced resilience needed
- Cost optimization features

**Success Criteria:**
- >90% success rate at 10M samples
- <30s latency for 10M samples
- <2% storage overhead
- 10-30% cost savings demonstrated

---

#### **Phase 4 - Petabyte Scale (6-8 weeks)**

**Goal**: Selective support for PB-scale customers

**Scope:**
- ✅ Selective periodic extraction (priority-based)
- ✅ 100M+ sample sizes
- ✅ Advanced degraded mode operations
- ✅ Circuit breakers and health monitoring
- ✅ Tiered extraction schedules
- ✅ On-demand disabled by default (too expensive)

**Target Customers**: >100TB/day
- Requires mature, battle-tested implementation
- Focus on reliability over features
- Heavy emphasis on resource management

**Success Criteria:**
- >85% success rate (partial results accepted)
- Extraction doesn't impact cluster health
- <3% storage overhead
- Positive ROI for PB customers

---

### Why This Phased Approach Wins:

✅ **Risk Management**: Start small, prove value, then scale
✅ **Faster Time to Market**: Phase 1 ships in 4-6 weeks
✅ **Learn & Iterate**: Each phase informs the next
✅ **Customer Alignment**: Match phases to customer scale needs
✅ **Resource Efficiency**: Don't over-engineer for PB-scale on day 1

### Updated Key Differentiators (After Review):

1. **Scale-adaptive design** (works from 10GB to 1PB/day)
2. **Hybrid extraction model** (on-demand + tiered periodic)
3. **Hierarchical pattern merging** (O(n log n) vs O(n²))
4. **Resilient by design** (partial results, circuit breakers, degraded modes)
5. **Cost-aware** (credit-based quotas, resource budgets, ROI tracking)
6. **Pattern evolution tracking** (time-series analytics)
7. **VRL integration** (custom transformations)
8. **Open source pattern templates** (community sharing)

### Competitive Positioning by Scale:

| Scale | vs Datadog | vs New Relic | vs Splunk | OpenObserve Advantage |
|-------|------------|--------------|-----------|----------------------|
| **Small** | ✅ Better | ✅ Better | ✅ Better | Lower cost, easier setup |
| **Medium** | ✅ Better | ≈ Similar | ✅ Better | Open source, VRL, better analytics |
| **Large** | ✅ Better | ✅ Better | ≈ Similar | Cost optimization, distributed processing |
| **Petabyte** | ⚠️ Unknown | ⚠️ Unknown | ≈ Similar | Selective extraction, resource-aware |

---

## 16. Next Steps

### Immediate Actions (Week 1-2):
1. ✅ **Review & Approve Design**: Stakeholder sign-off on scale-aware approach
2. ✅ **Prioritize Customer Scale**: Start with Small/Medium (200GB-1TB/day)
3. ✅ **Create Phase 1 Implementation Plan**: Detailed task breakdown
4. ✅ **Setup drain3-rs Integration**: Evaluate library, run benchmarks on sample data

### Phase 1 Execution (Week 3-8):
5. ✅ **Build MVP**: On-demand extraction only
6. ✅ **Performance Testing**: Validate latency targets (<2s for 100k)
7. ✅ **Beta Testing**: 3-5 medium-scale enterprise customers
8. ✅ **Collect Metrics**: Measure adoption, latency, accuracy

### Phase 2+ Planning (After Phase 1 Success):
9. ✅ **Iterate Based on Feedback**: Adjust before Phase 2
10. ✅ **Plan Scale Testing**: Test with Large customers (10TB/day)
11. ✅ **Capacity Planning**: Size infrastructure for Phase 3/4

---

## 17. Open Questions & Decisions Needed

### Licensing & Packaging:
**Q1**: Should pattern extraction be included in all enterprise licenses or separate tier?
- **Recommendation**: Include in Enterprise license
- **Rationale**: Key differentiator, ROI justifies cost, drives adoption

**Q2**: Should we offer limited pattern extraction in OSS/Community edition?
- **Recommendation**: Yes, limit to on-demand only, max 10k samples
- **Rationale**: Try-before-you-buy, community contribution, adoption driver

### Configuration & Defaults:
**Q3**: What default retention period for pattern history?
- **Recommendation**:
  - Small/Medium: 90 days (default)
  - Large: 30 days (cost management)
  - Petabyte: 7-14 days (configurable)

**Q4**: Should we pre-train patterns for common log sources?
- **Recommendation**: Phase 2+ feature
- **Rationale**: Requires pattern library curation, focus on MVP first
- **Suggested sources**: Apache, Nginx, K8s, Docker, AWS, GCP

### Architecture & Integration:
**Q5**: Integration with existing pattern manager or separate module?
- **Recommendation**: Separate module initially, integrate in Phase 2
- **Rationale**: Cleaner separation, faster development, easier testing

**Q6**: Should we support custom drain3 configurations per stream?
- **Recommendation**: Phase 3+ feature
- **Rationale**: Adds complexity, validate basic approach first

### Resource Management:
**Q7**: How to handle customers exceeding credit budgets?
- **Recommendation**: Soft limits with throttling, not hard denials
- **Options**:
  1. Throttle: Reduce sample sizes automatically
  2. Queue: Delay extraction during high load
  3. Notify: Alert customer to adjust configuration

**Q8**: Should PB-scale customers have pattern extraction enabled by default?
- **Recommendation**: No, opt-in only with guided onboarding
- **Rationale**: Resource intensive, requires configuration, risk mitigation

---

## 18. Risk Assessment & Mitigation

### Technical Risks:

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **drain3-rs performance worse than expected** | Medium | High | Run benchmarks early, have fallback algorithms |
| **Pattern merging too slow at scale** | Medium | High | Hierarchical merging + LSH (already planned) |
| **Storage costs exceed estimates** | Low | Medium | Aggressive retention policies, compression |
| **PB-scale customers overwhelm cluster** | High | Critical | Circuit breakers, resource budgets (already planned) |
| **Pattern accuracy below 90%** | Medium | Medium | Tune drain3 params, stratified sampling |
| **Worker failures cause cascading issues** | Low | High | Partial results, resilience (already planned) |

### Product Risks:

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Low user adoption** | Medium | High | Beta testing, iterate on UX, clear value prop |
| **Patterns not actionable** | Medium | High | Integrate with alerting, cost optimization early |
| **Competitors release similar features** | High | Medium | Fast execution, unique differentiators |
| **Feature too complex for users** | Low | Medium | Simplified defaults, guided onboarding |

### Operational Risks:

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Support burden increases** | Medium | Medium | Comprehensive docs, operational runbooks |
| **Resource contention with queries** | High | High | Resource budgets, auto-throttling (already planned) |
| **Pattern extraction causes incidents** | Low | Critical | Degraded mode, circuit breakers (already planned) |

---

## 19. References

- [drain3-rs Repository](https://github.com/openobserve/drain3-rs)
- [OpenObserve Architecture Documentation](https://openobserve.ai/docs/architecture/)
- Datadog Log Patterns: https://www.datadoghq.com/blog/log-patterns/
- New Relic Log Patterns: https://docs.newrelic.com/docs/logs/ui-data/find-unusual-logs-log-patterns/
- Splunk Pattern Detection: https://docs.splunk.com/Documentation/Splunk/latest/Search/Detectingpatterns
- Drain3 Algorithm Research: https://github.com/logpai/Drain3
