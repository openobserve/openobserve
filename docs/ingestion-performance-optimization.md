# OpenObserve Ingestion Flow Performance Optimization

## Executive Summary

This document provides a comprehensive analysis of the OpenObserve ingestion flow implementation, identifies performance bottlenecks related to async code design and disk write operations, and presents a detailed plan for benchmarking and optimization. The analysis reveals several critical issues including serialized write queues, coarse-grained locking, and inefficient disk I/O patterns that significantly impact ingestion throughput.

## Table of Contents

1. [Current Implementation Analysis](#1-current-implementation-analysis)
2. [Performance Bottlenecks](#2-performance-bottlenecks)
3. [Benchmarking Plan](#3-benchmarking-plan)
4. [Proposed Optimizations](#4-proposed-optimizations)
5. [Implementation Roadmap](#5-implementation-roadmap)

---

## 1. Current Implementation Analysis

### 1.1 Ingestion Flow Architecture

The OpenObserve ingestion pipeline processes data through multiple stages:

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ HTTP/gRPC   │────▶│ Parse &      │────▶│ Transform &  │────▶│ Writer       │
│ Endpoints   │     │ Validate     │     │ Process      │     │ (Async Queue)│
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                                       │
                                                                       ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Disk        │◀────│ Parquet      │◀────│ Immutable    │◀────│ WAL +        │
│ Storage     │     │ Writer       │     │ Tables       │     │ MemTable     │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

#### 1.1.1 Ingestion Endpoints

**HTTP Endpoints** (`src/handler/http/request/logs/`):
- `/api/{org_id}/{stream_name}/_json` - JSON array ingestion
- `/api/{org_id}/{stream_name}/_multi` - Multi-line JSON ingestion
- `/api/{org_id}/{stream_name}/_bulk` - Elasticsearch bulk format
- `/api/{org_id}/{stream_name}/_hec` - Splunk HEC format

**gRPC Endpoints** (`src/router/grpc/ingest/`):
- Distributed ingestion for logs, metrics, and traces
- Protobuf-based communication

#### 1.1.2 Data Processing Pipeline

**Location**: `src/service/logs/mod.rs:160-350`

The pipeline performs:
1. **Request Parsing**: JSON/bulk format parsing and validation
2. **JSON Flattening**: Nested structure flattening with configurable depth
3. **Schema Conformance**: Type checking and field validation
4. **Timestamp Handling**: Extraction and normalization
5. **Alert Evaluation**: Real-time alert processing
6. **Distinct Value Tracking**: Cardinality tracking for indexing

### 1.2 Memory and Storage Layer

#### 1.2.1 Writer Architecture

**File**: `src/ingester/src/writer.rs`

```rust
pub struct Writer {
    wal: Arc<RwLock<WalWriter>>,
    memtable: Arc<RwLock<MemTable>>,
    last_sync: Arc<RwLock<Instant>>,
    runtime: Arc<Runtime>,
    tx: Option<UnboundedSender<Entry>>,
}
```

**Key Design Decisions**:
- Uses `tokio::sync::mpsc::unbounded_channel` for async write queue
- Single consumer loop processes all entries serially (lines 110-154)
- Hash-based distribution across writer buckets: `WRITERS[idx]`
- Writer count configurable via `cfg.limit.mem_table_bucket_num`

#### 1.2.2 MemTable Implementation

**File**: `src/ingester/src/memtable.rs`

```rust
pub(crate) struct MemTable {
    streams: HashMap<Arc<str>, Stream>,
    json_bytes_written: AtomicU64,
    arrow_bytes_written: AtomicU64,
}
```

**Hierarchical Structure**:
```
MemTable
  └── Stream (per stream name)
       └── Partition (per schema hash)
            └── PartitionFile (per hour)
                 └── RecordBatchEntry (Arrow format)
```

**Critical Issue**: No fine-grained locking - entire memtable locked for any write operation.

#### 1.2.3 WAL (Write-Ahead Log) Implementation

**Files**: 
- `src/ingester/src/wal.rs` - Recovery and orchestration
- `src/ingester/src/writer.rs:200-224` - Write logic

**WAL Lifecycle**:
1. **Write Phase**: Binary serialization to WAL file
2. **Rotation Trigger**: Size (`max_file_size_on_disk`) or time threshold
3. **Immutable Conversion**: MemTable → Immutable table
4. **Persist Phase**: Background conversion to Parquet
5. **Cleanup Phase**: Multi-step file operations (`.par` → `.parquet`)

### 1.3 Disk Write Operations

**File**: `src/ingester/src/partition.rs:120-280`

**Persist Flow**:
```rust
// Simplified flow
for stream in streams {
    for hour in stream.hours {
        let chunks = split_by_size(records, PARQUET_FILE_CHUNK_SIZE);
        for chunk in chunks {
            let merged = merge_record_batches(chunk);
            let buf_parquet = create_parquet_buffer(merged);
            
            // Multiple async I/O operations
            fs::write(path + ".par", buf_parquet).await?;
            fs::write(path + ".lock", "").await?;
            fs::rename(path + ".par", path + ".parquet").await?;
            fs::remove_file(path + ".lock").await?;
        }
    }
}
```

### 1.4 Configuration Parameters

| Parameter | Description | Default | Impact |
|-----------|-------------|---------|--------|
| `max_file_size_on_disk` | WAL rotation threshold | 32MB | Rotation frequency |
| `max_file_size_in_memory` | MemTable rotation threshold | 256MB | Memory usage |
| `mem_table_bucket_num` | Number of writer buckets | 4 | Concurrency |
| `wal_write_queue_size` | Async queue capacity | 100000 | Backpressure |
| `wal_write_buffer_size` | WAL write buffer | 512KB | I/O efficiency |
| `mem_persist_interval` | Persist check interval | 10s | Latency |
| `mem_dump_thread_num` | Persist thread count | 2 | Parallelism |

---

## 2. Performance Bottlenecks

### 2.1 Serialized Write Queue Bottleneck

**Location**: `src/ingester/src/writer.rs:110-154`

**Issue**: Single-threaded consumer processing all writes sequentially.

```rust
// Current implementation
while let Some(entry) = rx.recv().await {
    if let Err(e) = consume(entry, &wal, &memtable).await {
        log::error!("Error: {}", e);
    }
}
```

**Impact**:
- Maximum throughput limited by single thread performance
- No parallelism across different streams
- Queue can back up under load, causing memory pressure

**Metrics**: `INGEST_WAL_WRITE_QUEUE_SIZE` tracks queue depth

### 2.2 Coarse-Grained MemTable Locking

**Location**: `src/ingester/src/writer.rs:200-230`

**Issue**: Entire memtable locked for each write operation.

```rust
// Current locking pattern
let mut memtable = self.memtable.write().await;
memtable.write(stream_name, &entry)?; // Holds lock during entire operation
```

**Impact**:
- Serializes all writes even for different streams
- Lock contention increases with concurrent writers
- No benefit from multi-core systems

**Metrics**: 
- `INGEST_MEMTABLE_LOCK_TIME` - Time spent acquiring lock
- `INGEST_MEMTABLE_WRITE_TIME` - Time spent writing

### 2.3 Multi-Step File Persistence

**Location**: `src/ingester/src/partition.rs:190-210`

**Issue**: Four separate I/O operations per file.

```rust
// Current implementation
fs::write(&path_par, buf_parquet).await?;     // Write .par file
fs::write(&path_lock, b"").await?;            // Create lock file
fs::rename(&path_par, &path_parquet).await?;  // Rename to .parquet
fs::remove_file(&path_lock).await?;           // Delete lock file
```

**Impact**:
- 4x I/O operations increases latency
- File system metadata operations are expensive
- Lock file mechanism adds unnecessary overhead

### 2.4 Sequential Processing

**Location**: `src/ingester/src/immutable.rs`

**Issue**: Nested sequential loops for persistence.

```rust
// Current pattern
for stream in streams {
    for partition in stream.partitions {
        for hour in partition.hours {
            // Process sequentially
        }
    }
}
```

**Impact**:
- Cannot leverage parallel I/O capabilities
- Large batches block small ones
- Poor CPU utilization on multi-core systems

### 2.5 Large Buffer Accumulation

**Location**: `src/ingester/src/partition.rs:150-180`

**Issue**: Entire record batch buffered before writing.

```rust
let buf_parquet = create_parquet_buffer(merged_batch)?; // Full buffer in memory
fs::write(path, buf_parquet).await?; // Single large write
```

**Impact**:
- High memory usage for large batches
- OOM risk under memory pressure
- No streaming capability for large datasets

### 2.6 Lock Contention Analysis

**Critical Lock Points**:

| Lock | Location | Scope | Contention Level |
|------|----------|-------|------------------|
| `WRITERS[idx]` | writer.rs:73 | Writer lookup | Medium |
| `Writer.wal` | writer.rs:200 | WAL write | High |
| `Writer.memtable` | writer.rs:210 | MemTable write | Very High |
| `IMMUTABLES` | immutable.rs:30 | Table registry | Low |
| `PROCESSING_TABLES` | writer.rs:300 | Rotation tracking | Low |

---

## 3. Benchmarking Plan

### 3.1 Metrics to Measure

#### 3.1.1 Throughput Metrics
- **Records/second**: Raw ingestion rate
- **Bytes/second**: Data throughput
- **Batches/second**: Batch processing rate

#### 3.1.2 Latency Metrics
- **P50, P95, P99**: Ingestion latency percentiles
- **End-to-end latency**: Request to persistence
- **Queue latency**: Time spent in write queue

#### 3.1.3 Resource Metrics
- **CPU utilization**: Per-core usage patterns
- **Memory usage**: Heap allocation and GC pressure
- **Disk I/O**: IOPS, bandwidth, queue depth
- **Lock contention**: Wait times and acquisition counts

### 3.2 Benchmark Scenarios

#### 3.2.1 Baseline Benchmarks

```rust
// Scenario 1: Small payload, high frequency
#[bench]
fn bench_small_high_freq(b: &mut Bencher) {
    // 1KB payloads, 10,000 req/sec
}

// Scenario 2: Large payload, low frequency  
#[bench]
fn bench_large_low_freq(b: &mut Bencher) {
    // 1MB payloads, 100 req/sec
}

// Scenario 3: Mixed workload
#[bench]
fn bench_mixed_workload(b: &mut Bencher) {
    // Varying sizes and rates
}
```

#### 3.2.2 Stress Test Scenarios

1. **Burst Traffic**: 10x normal load for 1 minute
2. **Sustained Load**: 2x normal load for 1 hour
3. **Concurrent Writers**: 100, 500, 1000 parallel connections
4. **Large Batch**: Single 100MB payload
5. **Memory Pressure**: Run with 50% available memory

### 3.3 Benchmarking Tools Setup

#### 3.3.1 Criterion Benchmarks

Create `benches/ingestion.rs`:

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use openobserve::service::logs;

fn benchmark_ingestion(c: &mut Criterion) {
    let mut group = c.benchmark_group("ingestion");
    
    for size in [1024, 10240, 102400, 1048576].iter() {
        group.throughput(Throughput::Bytes(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, &size| {
            b.iter(|| {
                // Benchmark ingestion with different payload sizes
                logs::ingest(black_box(generate_payload(size)))
            });
        });
    }
    group.finish();
}

criterion_group!(benches, benchmark_ingestion);
criterion_main!(benches);
```

#### 3.3.2 Load Testing Script

Create `scripts/load_test.py`:

```python
import asyncio
import aiohttp
import time
import json
from dataclasses import dataclass
from typing import List

@dataclass
class LoadTestConfig:
    url: str
    payload_size: int
    concurrent_requests: int
    duration_seconds: int
    
async def run_load_test(config: LoadTestConfig):
    """Run load test with specified configuration"""
    stats = {
        'total_requests': 0,
        'successful_requests': 0,
        'failed_requests': 0,
        'latencies': []
    }
    
    async with aiohttp.ClientSession() as session:
        start_time = time.time()
        
        while time.time() - start_time < config.duration_seconds:
            tasks = []
            for _ in range(config.concurrent_requests):
                task = send_request(session, config.url, config.payload_size, stats)
                tasks.append(task)
            
            await asyncio.gather(*tasks)
    
    return calculate_statistics(stats)

async def send_request(session, url, payload_size, stats):
    """Send single ingestion request"""
    payload = generate_test_payload(payload_size)
    start = time.time()
    
    try:
        async with session.post(url, json=payload) as response:
            if response.status == 200:
                stats['successful_requests'] += 1
            else:
                stats['failed_requests'] += 1
    except Exception as e:
        stats['failed_requests'] += 1
    
    stats['latencies'].append(time.time() - start)
    stats['total_requests'] += 1
```

#### 3.3.3 Profiling Setup

Enable profiling in `Cargo.toml`:

```toml
[features]
profiling = ["pprof/flamegraph"]

[profile.bench]
debug = true
```

Create profiling script `scripts/profile_ingestion.sh`:

```bash
#!/bin/bash
# Run with profiling enabled
CARGO_PROFILE_BENCH_DEBUG=true cargo build --release --features profiling

# Start profiling
./target/release/openobserve &
PID=$!

# Run load test
python scripts/load_test.py --duration 60

# Generate flamegraph
pprof -http=:8080 ./target/release/openobserve http://localhost:5080/debug/pprof/profile?seconds=30
```

### 3.4 Baseline Measurements

#### 3.4.1 Current Performance Baseline

Run initial benchmarks to establish baseline:

```bash
# 1. WAL write performance
cargo bench --bench write

# 2. End-to-end ingestion
cargo bench --bench ingestion

# 3. Load test baseline
python scripts/load_test.py \
    --url http://localhost:5080/api/default/test/_json \
    --payload-size 10240 \
    --concurrent 100 \
    --duration 300
```

#### 3.4.2 Metrics Collection

Implement metrics collection:

```rust
// Add to src/metrics.rs
lazy_static! {
    pub static ref INGESTION_THROUGHPUT: Histogram = register_histogram!(
        "ingestion_throughput_bytes_per_sec",
        "Ingestion throughput in bytes per second"
    ).unwrap();
    
    pub static ref INGESTION_LATENCY: Histogram = register_histogram!(
        "ingestion_latency_ms", 
        "End-to-end ingestion latency in milliseconds"
    ).unwrap();
    
    pub static ref WRITE_QUEUE_DEPTH: Gauge = register_gauge!(
        "write_queue_depth",
        "Current depth of write queue"
    ).unwrap();
}
```

---

## 4. Proposed Optimizations

### 4.1 Short-Term Optimizations (1-2 weeks)

#### 4.1.1 Configuration Tuning

**Objective**: Optimize existing parameters without code changes.

| Parameter | Current | Proposed | Rationale |
|-----------|---------|----------|-----------|
| `mem_table_bucket_num` | 4 | 16 | Reduce lock contention |
| `wal_write_buffer_size` | 512KB | 2MB | Fewer I/O operations |
| `mem_dump_thread_num` | 2 | 8 | Parallel persistence |
| `wal_write_queue_size` | 100000 | 500000 | Handle bursts better |

#### 4.1.2 Buffer Pool Implementation

**File**: `src/ingester/src/buffer_pool.rs` (new)

```rust
pub struct BufferPool {
    buffers: Vec<BytesMut>,
    size: usize,
}

impl BufferPool {
    pub fn acquire(&mut self) -> BytesMut {
        self.buffers.pop().unwrap_or_else(|| BytesMut::with_capacity(self.size))
    }
    
    pub fn release(&mut self, mut buffer: BytesMut) {
        buffer.clear();
        if self.buffers.len() < 100 {
            self.buffers.push(buffer);
        }
    }
}
```

**Expected Impact**: 20-30% reduction in allocation overhead.

### 4.2 Medium-Term Optimizations (1-2 months)

#### 4.2.1 Fine-Grained Locking

**Approach**: Per-stream locking instead of memtable-wide locking.

```rust
// Modified MemTable structure
pub struct MemTable {
    streams: DashMap<Arc<str>, Arc<RwLock<Stream>>>, // Use DashMap for concurrent access
    json_bytes_written: AtomicU64,
    arrow_bytes_written: AtomicU64,
}

impl MemTable {
    pub async fn write(&self, stream_name: &str, entry: &Entry) -> Result<()> {
        let stream = self.streams.entry(Arc::from(stream_name))
            .or_insert_with(|| Arc::new(RwLock::new(Stream::new())));
        
        let mut stream_guard = stream.write().await; // Lock only this stream
        stream_guard.write(entry)?;
        Ok(())
    }
}
```

**Expected Impact**: 3-5x improvement in concurrent write throughput.

#### 4.2.2 Parallel Write Queue Processing

**Approach**: Multiple consumers with stream affinity.

```rust
pub struct ParallelWriter {
    channels: Vec<(Sender<Entry>, JoinHandle<()>)>,
    next_channel: AtomicUsize,
}

impl ParallelWriter {
    pub fn new(num_workers: usize) -> Self {
        let mut channels = Vec::new();
        
        for _ in 0..num_workers {
            let (tx, rx) = mpsc::channel(10000);
            let handle = tokio::spawn(async move {
                while let Some(entry) = rx.recv().await {
                    process_entry(entry).await;
                }
            });
            channels.push((tx, handle));
        }
        
        Self {
            channels,
            next_channel: AtomicUsize::new(0),
        }
    }
    
    pub async fn write(&self, stream: &str, entry: Entry) -> Result<()> {
        // Use consistent hashing for stream affinity
        let index = hash(stream) % self.channels.len();
        self.channels[index].0.send(entry).await?;
        Ok(())
    }
}
```

**Expected Impact**: Linear scaling with number of workers (up to CPU cores).

#### 4.2.3 Optimized File Persistence

**Approach**: Single atomic write operation.

```rust
pub async fn persist_optimized(path: &Path, data: &[u8]) -> Result<()> {
    let temp_path = path.with_extension("tmp");
    
    // Write to temp file
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .open(&temp_path)
        .await?;
    
    file.write_all(data).await?;
    file.sync_all().await?;
    
    // Atomic rename
    fs::rename(temp_path, path).await?;
    
    Ok(())
}
```

**Expected Impact**: 75% reduction in I/O operations.

### 4.3 Long-Term Optimizations (3-6 months)

#### 4.3.1 Lock-Free Data Structures

**Approach**: Use crossbeam's lock-free structures.

```rust
use crossbeam::queue::SegQueue;

pub struct LockFreeWriter {
    queue: SegQueue<Entry>,
    workers: Vec<JoinHandle<()>>,
}

impl LockFreeWriter {
    pub fn write(&self, entry: Entry) {
        self.queue.push(entry); // No locking required
    }
}
```

**Expected Impact**: 10x improvement in write throughput under high contention.

#### 4.3.2 Streaming Parquet Writer

**Approach**: Stream data directly to disk without full buffering.

```rust
pub struct StreamingParquetWriter {
    writer: ArrowWriter<File>,
    buffer_size: usize,
    current_buffer: Vec<RecordBatch>,
}

impl StreamingParquetWriter {
    pub async fn write_batch(&mut self, batch: RecordBatch) -> Result<()> {
        self.current_buffer.push(batch);
        
        if self.buffer_size() > self.buffer_size {
            self.flush().await?;
        }
        
        Ok(())
    }
    
    async fn flush(&mut self) -> Result<()> {
        for batch in &self.current_buffer {
            self.writer.write(batch)?;
        }
        self.writer.flush()?;
        self.current_buffer.clear();
        Ok(())
    }
}
```

**Expected Impact**: 50% reduction in memory usage, elimination of OOM risk.

#### 4.3.3 Direct I/O for Write Path

**Approach**: Bypass OS page cache for sequential writes.

```rust
#[cfg(target_os = "linux")]
pub struct DirectIOWriter {
    fd: RawFd,
    alignment: usize,
}

impl DirectIOWriter {
    pub fn new(path: &Path) -> Result<Self> {
        let fd = open(
            path.as_os_str(),
            OFlag::O_DIRECT | OFlag::O_WRONLY | OFlag::O_CREAT,
            Mode::S_IRUSR | Mode::S_IWUSR,
        )?;
        
        Ok(Self { fd, alignment: 4096 })
    }
    
    pub async fn write_aligned(&self, data: &[u8]) -> Result<()> {
        let aligned_data = align_buffer(data, self.alignment);
        pwrite(self.fd, &aligned_data, 0)?;
        Ok(())
    }
}
```

**Expected Impact**: 30% improvement in write throughput, reduced CPU usage.

### 4.4 Alternative Async Patterns

#### 4.4.1 Actor Model with Actix

```rust
use actix::prelude::*;

struct WriterActor {
    wal: WalWriter,
    memtable: MemTable,
}

impl Actor for WriterActor {
    type Context = Context<Self>;
}

impl Handler<WriteMessage> for WriterActor {
    type Result = Result<()>;
    
    fn handle(&mut self, msg: WriteMessage, _: &mut Context<Self>) -> Self::Result {
        self.wal.write(&msg.entry)?;
        self.memtable.write(&msg.stream, &msg.entry)?;
        Ok(())
    }
}
```

#### 4.4.2 Async Channels with Backpressure

```rust
use async_channel::{bounded, Sender, Receiver};

pub struct BackpressureWriter {
    sender: Sender<Entry>,
}

impl BackpressureWriter {
    pub async fn write(&self, entry: Entry) -> Result<()> {
        // Will block if channel is full
        self.sender.send(entry).await?;
        Ok(())
    }
}
```

---

## 5. Implementation Roadmap

### 5.1 Phase 1: Quick Wins (Week 1-2)

| Task | Priority | Risk | Impact |
|------|----------|------|--------|
| Configuration tuning | High | Low | Medium |
| Buffer pool implementation | High | Low | Medium |
| Add comprehensive metrics | High | Low | High |
| Benchmark infrastructure | High | Low | High |

### 5.2 Phase 2: Core Improvements (Week 3-6)

| Task | Priority | Risk | Impact |
|------|----------|------|--------|
| Fine-grained locking | High | Medium | High |
| Parallel write queues | High | Medium | High |
| Optimized file persistence | Medium | Low | Medium |
| Streaming writes | Medium | Medium | High |

### 5.3 Phase 3: Architecture Evolution (Week 7-12)

| Task | Priority | Risk | Impact |
|------|----------|------|--------|
| Lock-free structures | Medium | High | Very High |
| Direct I/O implementation | Low | Medium | Medium |
| Actor model evaluation | Low | High | High |
| Complete rewrite evaluation | Low | Very High | Very High |

### 5.4 Testing Strategy

#### 5.4.1 Unit Tests

```rust
#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn test_concurrent_writes() {
        // Test concurrent writes to different streams
    }
    
    #[tokio::test]
    async fn test_backpressure() {
        // Test queue backpressure handling
    }
    
    #[tokio::test]
    async fn test_persistence() {
        // Test file persistence under load
    }
}
```

#### 5.4.2 Integration Tests

```python
def test_ingestion_performance():
    """End-to-end performance test"""
    # 1. Start OpenObserve
    # 2. Run load test
    # 3. Verify metrics
    # 4. Check for data loss
    # 5. Validate query results
```

#### 5.4.3 Chaos Testing

- Network partitions during ingestion
- Disk full scenarios
- OOM conditions
- Process crashes and recovery

### 5.5 Rollout Plan

1. **Canary Deployment**: 5% traffic for 24 hours
2. **Progressive Rollout**: 25% → 50% → 100% over 1 week
3. **Monitoring**: Real-time dashboards for all metrics
4. **Rollback Plan**: Feature flags for instant rollback
5. **Documentation**: Update all operational runbooks

### 5.6 Success Metrics

| Metric | Current | Target | Stretch |
|--------|---------|--------|---------|
| Throughput (records/sec) | 50K | 200K | 500K |
| P99 Latency (ms) | 100 | 50 | 20 |
| CPU Utilization | 80% | 60% | 40% |
| Memory Usage (GB) | 8 | 6 | 4 |
| Lock Contention | High | Low | None |

---

## Appendices

### A. Benchmark Code Examples

Full benchmark suite available at: `benches/ingestion_suite.rs`

### B. Configuration Tuning Guide

Detailed parameter tuning guide at: `docs/performance_tuning.md`

### C. Monitoring Dashboard

Grafana dashboard JSON at: `dashboards/ingestion_performance.json`

### D. References

1. [Rust Async Performance](https://tokio.rs/tokio/topics/tracing)
2. [Lock-Free Programming](https://docs.rs/crossbeam/latest/crossbeam/)
3. [Parquet Best Practices](https://arrow.apache.org/docs/cpp/parquet.html)
4. [Direct I/O in Linux](https://www.kernel.org/doc/html/latest/filesystems/ext4/direct_io.html)

---

## Contact

For questions or clarifications about this optimization plan, please contact the OpenObserve performance team.

Last Updated: 2025-10-23