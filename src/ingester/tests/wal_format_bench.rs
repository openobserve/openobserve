// Micro-benchmark comparing WAL entry serialization formats:
// legacy JSON (serde_json::to_vec) vs Arrow IPC (reusing the RecordBatch).
// Run with:
//   WAL_BENCH_DATA=/path/to/logs.json cargo test --release -p ingester \
//     --test wal_format_bench -- --ignored --nocapture
// where the data file contains a JSON array of log records.

use std::{sync::Arc, time::Instant};

use config::utils::{
    record_batch_ext::convert_json_to_record_batch, schema::infer_json_schema_from_values,
};
use ingester::Entry;

#[test]
#[ignore]
fn bench_wal_entry_serialization() {
    let Ok(path) = std::env::var("WAL_BENCH_DATA") else {
        println!("WAL_BENCH_DATA not set, skip");
        return;
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        println!("data file not found: {path}, skip");
        return;
    };
    let data: Vec<serde_json::Value> = serde_json::from_str(&content).unwrap();
    let data: Vec<Arc<serde_json::Value>> = data.into_iter().map(Arc::new).collect();
    println!("records: {}", data.len());

    let schema = infer_json_schema_from_values("k8slog", "logs", data.iter().cloned()).unwrap();
    let schema = Arc::new(schema);

    let mut entry = Entry {
        org_id: Arc::from("default"),
        stream: Arc::from("k8slog"),
        schema: None,
        schema_key: Arc::from("abcd1234abcd1234"),
        partition_key: Arc::from("2026/07/14/00/default"),
        data,
        data_size: 8_400_000,
        batch: None,
    };

    const N: usize = 20;

    // json -> record batch conversion (needed by both paths for the memtable)
    let start = Instant::now();
    let mut batch = None;
    for _ in 0..N {
        batch = Some(convert_json_to_record_batch(&schema, &entry.data).unwrap());
    }
    let batch = batch.unwrap();
    println!(
        "json->record_batch:   {:>8.2} ms/iter",
        start.elapsed().as_secs_f64() * 1000.0 / N as f64
    );

    // legacy WAL path: serialize data back to JSON
    let start = Instant::now();
    let mut json_len = 0;
    for _ in 0..N {
        json_len = entry.into_bytes().unwrap().len();
    }
    println!(
        "wal json serialize:   {:>8.2} ms/iter, {:>9} bytes",
        start.elapsed().as_secs_f64() * 1000.0 / N as f64,
        json_len
    );

    // new WAL path: serialize the RecordBatch as Arrow IPC
    let start = Instant::now();
    let mut arrow_len = 0;
    for _ in 0..N {
        arrow_len = entry.into_bytes_arrow(&batch).unwrap().len();
    }
    println!(
        "wal arrow serialize:  {:>8.2} ms/iter, {:>9} bytes",
        start.elapsed().as_secs_f64() * 1000.0 / N as f64,
        arrow_len
    );

    // decode side (WAL replay)
    let json_bytes = entry.into_bytes().unwrap();
    let arrow_bytes = entry.into_bytes_arrow(&batch).unwrap();
    let start = Instant::now();
    for _ in 0..N {
        let decoded = Entry::from_bytes(&json_bytes).unwrap();
        assert!(decoded.batch.is_none());
    }
    println!(
        "wal json decode:      {:>8.2} ms/iter",
        start.elapsed().as_secs_f64() * 1000.0 / N as f64
    );
    let start = Instant::now();
    for _ in 0..N {
        let decoded = Entry::from_bytes(&arrow_bytes).unwrap();
        assert!(decoded.batch.is_some());
    }
    println!(
        "wal arrow decode:     {:>8.2} ms/iter",
        start.elapsed().as_secs_f64() * 1000.0 / N as f64
    );
}
