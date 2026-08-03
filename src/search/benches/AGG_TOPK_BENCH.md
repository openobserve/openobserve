# TopK Aggregation Benchmark

This benchmark compares the performance of heap-based vs sort-based TopK implementations in the `AggregateTopkExec` execution plan.

**Important**: You must generate the test data first before running benchmarks.

## Running the Benchmark

### Step 1: Generate Test Data (Required)
```bash
# Generate consistent benchmark datasets
cargo run --example generate_benchmark_data
```

This creates JSON files in `benches/data/` that all benchmarks will use for consistent results.

### Step 2: Run Benchmarks

#### Performance Benchmarks
```bash
cargo bench --bench agg_topk_memory_comparison

cargo bench --bench agg_topk_memory_comparison -- "topk_small_low_cardinality"

cargo bench --bench agg_topk_memory_comparison -- --test
```
```
```

To create new test datasets with different characteristics, modify the `DATASET_CONFIGS` in `examples/generate_benchmark_data.rs` and run:

```
```
```bash
cargo run --example generate_benchmark_data
```

This will generate new consistent datasets in `benches/data/` with your desired configurations.
