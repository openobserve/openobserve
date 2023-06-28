use criterion::{criterion_group, criterion_main, Criterion};
use flatten_serde_json::flatten as flatten_from_lib;
use openobserve::common::flatten::flatten;
use serde_json::json;

pub fn flatten_benchmark(c: &mut Criterion) {
    let mut obj = json!({
        "simple_key": "simple_value",
        "key": [
            "value1",
            {"key": "value2"},
            {"nested_array": [
                "nested1",
                "nested2",
                ["nested3", "nested4"]
            ]}
        ]
    });

    c.bench_function("custom_flatten", |b| b.iter(|| flatten(&obj).unwrap()));
    c.bench_function("flatten_serde_json_flatten", |b| {
        b.iter(|| flatten_from_lib(&obj.as_object_mut().unwrap()))
    });
}

criterion_group!(benches, flatten_benchmark);
criterion_main!(benches);
