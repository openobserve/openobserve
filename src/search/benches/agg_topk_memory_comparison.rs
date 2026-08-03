use std::sync::Arc;

use arrow::{
    array::{ArrayRef, Int64Array, RecordBatch, StringArray},
    datatypes::{DataType, Field, Schema, SchemaRef},
};
use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use datafusion::execution::{RecordBatchStream, SendableRecordBatchStream};
use futures::StreamExt;
use peak_alloc::PeakAlloc;
use search::datafusion::distributed_plan::aggregate_topk_exec::{
    heap::TopKHeapStream, sort::TopKSortStream,
};
use serde_json::Value;
use tokio::runtime::Runtime;

#[global_allocator]
static PEAK_ALLOC: PeakAlloc = PeakAlloc;

// Memory measurement result
#[derive(Debug, Clone)]
struct MemoryUsage {
    peak_memory_bytes: usize,
    final_memory_bytes: usize,
}

// Combined benchmark result
#[derive(Debug, Clone)]
struct BenchmarkResult {
    memory: MemoryUsage,
    result_count: usize,
}

// Test data configuration
struct BenchmarkScenario {
    name: &'static str,
    filename: &'static str,
    description: &'static str,
}

const SCENARIOS: &[BenchmarkScenario] = &[
    BenchmarkScenario {
        name: "medium_low_cardinality",
        filename: "benches/data/medium_low_cardinality.json",
        description: "500K records, 100 unique sort values",
    },
    BenchmarkScenario {
        name: "large_low_cardinality",
        filename: "benches/data/large_low_cardinality.json",
        description: "1M records, 200 unique sort values",
    },
    BenchmarkScenario {
        name: "large_medium_cardinality",
        filename: "benches/data/large_medium_cardinality.json",
        description: "2M records, 1M unique sort values",
    },
    BenchmarkScenario {
        name: "xlarge_high_cardinality",
        filename: "benches/data/xlarge_high_cardinality.json",
        description: "10M records, 5M unique sort values",
    },
    BenchmarkScenario {
        name: "xlarge_huge_cardinality",
        filename: "benches/data/xlarge_huge_cardinality.json",
        description: "10M records, 8M unique sort values (pre-sorted)",
    },
];

// K values to test - including values around the 200 threshold
const K_VALUES: &[usize] = &[10, 50, 100, 200, 500, 1000, 5000];

// struct to create test streams
struct TestRecordBatchStream {
    schema: SchemaRef,
    batches: Vec<RecordBatch>,
    index: usize,
}

impl TestRecordBatchStream {
    fn new(schema: SchemaRef, batches: Vec<RecordBatch>) -> Self {
        Self {
            schema,
            batches,
            index: 0,
        }
    }
}

impl futures::Stream for TestRecordBatchStream {
    type Item = datafusion::common::Result<RecordBatch>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        if self.index < self.batches.len() {
            let batch = self.batches[self.index].clone();
            self.index += 1;
            std::task::Poll::Ready(Some(Ok(batch)))
        } else {
            std::task::Poll::Ready(None)
        }
    }
}

impl RecordBatchStream for TestRecordBatchStream {
    fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }
}

// Load consistent dataset from JSON file using standard JSON parsing
fn load_dataset(scenario: &BenchmarkScenario) -> (SchemaRef, Vec<RecordBatch>) {
    let json_content = std::fs::read_to_string(scenario.filename)
        .unwrap_or_else(|_| panic!("Failed to read dataset file: {}. Run 'cargo run --example generate_benchmark_data' first.", scenario.filename));

    let json_data: Vec<Value> =
        serde_json::from_str(&json_content).expect("Failed to parse JSON data");

    if json_data.is_empty() {
        panic!("No data found in file: {}", scenario.filename);
    }

    // Create schema
    let schema = Arc::new(Schema::new(vec![
        Field::new("item_name", DataType::Utf8, false),
        Field::new("count", DataType::Int64, false),
        Field::new("status", DataType::Utf8, false),
        Field::new("timestamp", DataType::Int64, false),
    ]));
    let mut batches = Vec::new();

    for batch in json_data.chunks(10000) {
        // Extract arrays from JSON data
        let mut item_names = Vec::new();
        let mut counts = Vec::new();
        let mut statuses = Vec::new();
        let mut timestamps = Vec::new();

        for record in batch {
            let obj = record.as_object().expect("Expected JSON object");

            item_names.push(
                obj.get("item_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
            );
            counts.push(obj.get("count").and_then(|v| v.as_i64()).unwrap_or(0));
            statuses.push(
                obj.get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
            );
            timestamps.push(obj.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0));
        }

        // Create Arrow arrays
        let item_name_array = StringArray::from(item_names);
        let count_array = Int64Array::from(counts);
        let status_array = StringArray::from(statuses);
        let timestamp_array = Int64Array::from(timestamps);

        // Create RecordBatch
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(item_name_array) as ArrayRef,
                Arc::new(count_array) as ArrayRef,
                Arc::new(status_array) as ArrayRef,
                Arc::new(timestamp_array) as ArrayRef,
            ],
        )
        .expect("Failed to create RecordBatch");
        batches.push(batch);
    }
    (schema, batches)
}

// Benchmark heap implementation with memory tracking
async fn benchmark_heap_topk_with_memory(
    schema: SchemaRef,
    batches: Vec<RecordBatch>,
    k: usize,
) -> BenchmarkResult {
    // Reset peak memory counter
    PEAK_ALLOC.reset_peak_usage();

    let initial_memory = PEAK_ALLOC.current_usage();

    let stream = TestRecordBatchStream::new(schema.clone(), batches);
    let stream: SendableRecordBatchStream = Box::pin(stream);

    let mut heap_stream = TopKHeapStream::new(
        schema,
        stream,
        "count".to_string(),
        true, // descending
        (k * 4).max(1000),
    );

    let mut result_count = 0;
    while let Some(result) = heap_stream.next().await {
        match result {
            Ok(batch) => {
                result_count += batch.num_rows();
            }
            Err(_) => break,
        }
    }

    let peak_memory = PEAK_ALLOC.peak_usage();
    let final_memory = PEAK_ALLOC.current_usage();

    BenchmarkResult {
        memory: MemoryUsage {
            peak_memory_bytes: peak_memory.saturating_sub(initial_memory),
            final_memory_bytes: final_memory.saturating_sub(initial_memory),
        },
        result_count,
    }
}

// Benchmark sort implementation with memory tracking
async fn benchmark_sort_topk_with_memory(
    schema: SchemaRef,
    batches: Vec<RecordBatch>,
    k: usize,
) -> BenchmarkResult {
    // Reset peak memory counter
    PEAK_ALLOC.reset_peak_usage();

    let initial_memory = PEAK_ALLOC.current_usage();

    let stream = TestRecordBatchStream::new(schema.clone(), batches);
    let stream: SendableRecordBatchStream = Box::pin(stream);

    let mut sort_stream = TopKSortStream::new(
        schema,
        stream,
        "count".to_string(),
        true, // descending
        k as u64,
    );

    let mut result_count = 0;
    while let Some(result) = sort_stream.next().await {
        match result {
            Ok(batch) => {
                result_count += batch.num_rows();
            }
            Err(_) => break,
        }
    }

    let peak_memory = PEAK_ALLOC.peak_usage();
    let final_memory = PEAK_ALLOC.current_usage();

    BenchmarkResult {
        memory: MemoryUsage {
            peak_memory_bytes: peak_memory.saturating_sub(initial_memory),
            final_memory_bytes: final_memory.saturating_sub(initial_memory),
        },
        result_count,
    }
}

// Function to format bytes in human readable format
fn format_bytes(bytes: usize) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB"];
    const THRESHOLD: f64 = 1024.0;

    if bytes == 0 {
        return "0 B".to_string();
    }

    let size = bytes as f64;
    let digitgroups = (size.ln() / THRESHOLD.ln()).floor() as usize;
    let unit_index = std::cmp::min(digitgroups, UNITS.len() - 1);

    let value = size / THRESHOLD.powi(unit_index as i32);

    format!("{:.2} {}", value, UNITS[unit_index])
}

// Memory-focused benchmark function
fn benchmark_topk_memory_comparison(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    for scenario in SCENARIOS {
        let (schema, batches) = load_dataset(scenario);
        let total_records = batches.iter().map(|b| b.num_rows()).sum::<usize>();

        println!(
            "Scenario: {} - {} - {} records",
            scenario.name, scenario.description, total_records
        );

        let mut group = c.benchmark_group(format!("memory_{}", scenario.name));

        for &k in K_VALUES {
            // Skip if K is larger than dataset or larger than cardinality
            if k > total_records {
                continue;
            }

            // Benchmark heap implementation with memory tracking
            group.bench_with_input(BenchmarkId::new("heap", k), &k, |b, &k| {
                b.to_async(&rt).iter_batched(
                    || (schema.clone(), batches.clone()),
                    |(schema, batches)| async move {
                        benchmark_heap_topk_with_memory(schema, batches, k).await
                    },
                    criterion::BatchSize::LargeInput,
                );
            });

            // Benchmark sort implementation with memory tracking
            group.bench_with_input(BenchmarkId::new("sort", k), &k, |b, &k| {
                b.to_async(&rt).iter_batched(
                    || (schema.clone(), batches.clone()),
                    |(schema, batches)| async move {
                        benchmark_sort_topk_with_memory(schema, batches, k).await
                    },
                    criterion::BatchSize::LargeInput,
                );
            });
        }

        group.finish();
    }
}

// Standalone memory comparison (not using Criterion for detailed output)
fn standalone_memory_comparison() {
    let rt = Runtime::new().unwrap();

    println!("\n=== MEMORY USAGE COMPARISON ===\n");

    for scenario in SCENARIOS {
        let (schema, batches) = load_dataset(scenario);
        let total_records = batches.iter().map(|b| b.num_rows()).sum::<usize>();

        println!("Scenario: {} ({} records)", scenario.name, total_records);
        println!("Description: {}", scenario.description);
        println!();

        for &k in K_VALUES {
            if k > total_records {
                continue;
            }

            // Test heap implementation
            let heap_result = rt.block_on(benchmark_heap_topk_with_memory(
                schema.clone(),
                batches.clone(),
                k,
            ));

            // Test sort implementation
            let sort_result = rt.block_on(benchmark_sort_topk_with_memory(
                schema.clone(),
                batches.clone(),
                k,
            ));

            println!("K = {k}");
            println!("  Heap Implementation:");
            println!(
                "    Peak Memory: {}",
                format_bytes(heap_result.memory.peak_memory_bytes)
            );
            println!(
                "    Final Memory: {}",
                format_bytes(heap_result.memory.final_memory_bytes)
            );
            println!("    Results: {}", heap_result.result_count);

            println!("  Sort Implementation:");
            println!(
                "    Peak Memory: {}",
                format_bytes(sort_result.memory.peak_memory_bytes)
            );
            println!(
                "    Final Memory: {}",
                format_bytes(sort_result.memory.final_memory_bytes)
            );
            println!("    Results: {}", sort_result.result_count);

            // Calculate memory savings
            let peak_diff = heap_result.memory.peak_memory_bytes as i64
                - sort_result.memory.peak_memory_bytes as i64;
            let peak_ratio = if sort_result.memory.peak_memory_bytes > 0 {
                heap_result.memory.peak_memory_bytes as f64
                    / sort_result.memory.peak_memory_bytes as f64
            } else {
                1.0
            };

            println!("  Comparison:");
            if peak_diff < 0 {
                println!(
                    "    Heap uses {} LESS peak memory ({:.2}x less)",
                    format_bytes((-peak_diff) as usize),
                    1.0 / peak_ratio
                );
            } else {
                println!(
                    "    Heap uses {} MORE peak memory ({:.2}x more)",
                    format_bytes(peak_diff as usize),
                    peak_ratio
                );
            }
            println!();
        }
        println!("{}", "=".repeat(60));
        println!();
    }
}

fn print_memory_comparison_summary(_c: &mut Criterion) {
    standalone_memory_comparison();
}

criterion_group!(
    benches,
    benchmark_topk_memory_comparison,
    print_memory_comparison_summary
);
criterion_main!(benches);
