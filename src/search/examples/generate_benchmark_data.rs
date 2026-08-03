use std::fs;
/// Generate consistent benchmark datasets for TopK performance testing
///
/// This example generates test datasets with different cardinalities and saves them to files
/// so that all benchmarks use the same data for consistent comparisons.
///
/// Run with: cargo run -p search --example generate_benchmark_data
use std::sync::Arc;

use arrow::{
    array::{ArrayRef, Int64Array, RecordBatch, StringArray},
    datatypes::{DataType, Field, Schema, SchemaRef},
    json::ArrayWriter,
};

// Test data scenarios - these match the benchmark configurations
struct DatasetConfig {
    name: &'static str,
    filename: &'static str,
    num_records: usize,
    sort_field_cardinality: usize,
    description: &'static str,
}

const DATASET_CONFIGS: &[DatasetConfig] = &[
    DatasetConfig {
        name: "medium_low_cardinality",
        filename: "medium_low_cardinality.json",
        num_records: 500_000,
        sort_field_cardinality: 100,
        description: "500K records, 100 unique sort values",
    },
    DatasetConfig {
        name: "large_low_cardinality",
        filename: "large_low_cardinality.json",
        num_records: 1_000_000,
        sort_field_cardinality: 200,
        description: "1M records, 200 unique sort values",
    },
    DatasetConfig {
        name: "large_medium_cardinality",
        filename: "large_medium_cardinality.json",
        num_records: 2_000_000,
        sort_field_cardinality: 1_000_000,
        description: "2M records, 1M unique sort values",
    },
    DatasetConfig {
        name: "xlarge_high_cardinality",
        filename: "xlarge_high_cardinality.json",
        num_records: 10_000_000,
        sort_field_cardinality: 5_000_000,
        description: "10M records, 5M unique sort values",
    },
    DatasetConfig {
        name: "xlarge_huge_cardinality",
        filename: "xlarge_huge_cardinality.json",
        num_records: 10_000_000,
        sort_field_cardinality: 8_000_000,
        description: "10M records, 8M unique sort values",
    },
];

// Simple deterministic pseudo-random number generator
struct SimpleRng {
    state: u64,
}

impl SimpleRng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next(&mut self) -> u64 {
        self.state = self.state.wrapping_mul(1103515245).wrapping_add(12345);
        self.state
    }

    fn next_u32(&mut self) -> u32 {
        (self.next() >> 32) as u32
    }

    fn next_f64(&mut self) -> f64 {
        (self.next() % 1000000) as f64 / 1000000.0
    }

    fn next_range(&mut self, range: u64) -> u64 {
        self.next() % range
    }
}

fn generate_dataset(config: &DatasetConfig) -> (SchemaRef, RecordBatch) {
    println!("Generating {} - {}", config.name, config.description);

    // Use a different seed for each dataset to ensure variety, but still reproducible
    let seed = match config.name {
        "medium_low_cardinality" => 42u64,
        "large_low_cardinality" => 123u64,
        "large_medium_cardinality" => 456u64,
        "xlarge_high_cardinality" => 789u64,
        "xlarge_huge_cardinality" => 999u64,
        _ => 42u64,
    };

    let mut rng = SimpleRng::new(seed);

    // Create item names (high cardinality, doesn't affect TopK performance)
    let name_values: Vec<String> = (0..config.num_records)
        .map(|_| format!("item_{}", rng.next_u32() % (config.num_records as u32 / 10)))
        .collect();
    let name_array = StringArray::from(name_values);

    // Create count values with controlled cardinality - this is what affects TopK performance
    // Generate values that follow a realistic distribution (some values appear more frequently)
    let mut count_values = Vec::with_capacity(config.num_records);

    // Generate values that respect the exact cardinality constraint
    for i in 0..config.num_records {
        if config.sort_field_cardinality >= config.num_records {
            // High cardinality case: aim for near-unique values
            let base_value = i as i64 + 1; // Start from 1
            let variation = (rng.next_range(3) as i64) - 1; // Small variation -1 to +1
            count_values.push((base_value + variation).max(1));
        } else {
            // Lower cardinality: ensure we hit all target unique values by cycling through them
            // Use power-law distribution but guarantee coverage
            let target_value = if i < config.sort_field_cardinality {
                // First pass: ensure each unique value appears at least once
                i as i64 + 1
            } else {
                // Subsequent passes: use power-law distribution
                let uniform_val = rng.next_f64();
                let power_law_val = uniform_val.powf(0.5);
                (power_law_val * config.sort_field_cardinality as f64) as i64 + 1
            };
            count_values.push(
                target_value
                    .min(config.sort_field_cardinality as i64)
                    .max(1),
            );
        }
    }

    // Handle sorting based on dataset type
    if config.name == "large_sorted_data" {
        // Keep data sorted in descending order for worst-case heap scenario
        count_values.sort_by(|a, b| b.cmp(a));
        println!("  Data sorted in descending order (worst case for heap)");
    } else {
        // Simple shuffle using Fisher-Yates algorithm for random distribution
        for i in (1..count_values.len()).rev() {
            let j = rng.next_range(i as u64 + 1) as usize;
            count_values.swap(i, j);
        }
    }
    let count_array = Int64Array::from(count_values);

    // Create additional fields to simulate realistic record structure
    let status_values: Vec<String> = (0..config.num_records)
        .map(|_| {
            match rng.next_range(4) {
                0 => "success",
                1 => "warning",
                2 => "error",
                _ => "info",
            }
            .to_string()
        })
        .collect();
    let status_array = StringArray::from(status_values);

    // Timestamp values spread over a day
    let base_timestamp = 1640000000i64; // Jan 1, 2022
    let timestamp_values: Vec<i64> = (0..config.num_records)
        .map(|_| base_timestamp + (rng.next_range(86400) as i64)) // Random seconds in a day
        .collect();
    let timestamp_array = Int64Array::from(timestamp_values);

    // Create schema that simulates observability data
    let schema = Arc::new(Schema::new(vec![
        Field::new("item_name", DataType::Utf8, false),
        Field::new("count", DataType::Int64, false), // This is our sort field
        Field::new("status", DataType::Utf8, false),
        Field::new("timestamp", DataType::Int64, false),
    ]));

    // Create batch
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(name_array) as ArrayRef,
            Arc::new(count_array) as ArrayRef,
            Arc::new(status_array) as ArrayRef,
            Arc::new(timestamp_array) as ArrayRef,
        ],
    )
    .expect("Failed to create RecordBatch");

    println!(
        "  Generated {} records with {} unique count values",
        batch.num_rows(),
        // Calculate actual unique values for verification
        {
            use std::collections::HashSet;
            let counts = batch
                .column(1)
                .as_any()
                .downcast_ref::<Int64Array>()
                .unwrap();
            let unique_counts: HashSet<i64> = (0..counts.len()).map(|i| counts.value(i)).collect();
            unique_counts.len()
        }
    );

    (schema, batch)
}

fn save_dataset_to_json(
    _schema: &SchemaRef,
    batch: &RecordBatch,
    filepath: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let file = std::fs::File::create(filepath)?;
    let mut writer = ArrayWriter::new(file);
    writer.write_batches(&[&batch.clone()])?;
    writer.finish()?;

    println!("  Saved to {filepath}");
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("TopK Benchmark Data Generator");
    println!("=============================\n");

    // Create benchmark data directory
    let data_dir = "benches/data";
    fs::create_dir_all(data_dir)?;

    println!("Generating datasets in {data_dir} directory...\n");

    for config in DATASET_CONFIGS {
        let (schema, batch) = generate_dataset(config);
        let filepath = format!("{}/{}", data_dir, config.filename);
        save_dataset_to_json(&schema, &batch, &filepath)?;
        println!();
    }

    println!("✅ All benchmark datasets generated successfully!");
    println!("\nGenerated files:");
    for config in DATASET_CONFIGS {
        println!(
            "  - {}/{} ({})",
            data_dir, config.filename, config.description
        );
    }

    println!("\n🔧 Usage in benchmarks:");
    println!("  cargo bench --bench agg_topk_comparison");
    println!("  cargo bench --bench agg_topk_memory_comparison");
    println!("  cargo run --example memory_profiler");

    Ok(())
}
