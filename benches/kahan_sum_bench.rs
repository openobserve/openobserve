use kahan::*;
use rand::{distributions::Uniform, Rng}; // 0.6.5
fn generate_data() -> Vec<f64> {
    let mut rng = rand::thread_rng();
    let range = Uniform::new(0, 50);
    (0..10000).map(|_| rng.sample(&range).into()).collect()
}

use criterion::{criterion_group, criterion_main, Criterion};

pub fn kahan_sum_bench(c: &mut Criterion) {
    let generated_data = generate_data();

    let mut group = c.benchmark_group("f64_accurate_sums");

    group.bench_function("sum_iter", |b| {
        b.iter(|| {
            let _val = generated_data.iter().sum::<f64>();
        })
    });
    group.bench_function("sum_kahan", |b| {
        b.iter(|| {
            let _val: f64 = generated_data.iter().kahan_sum().sum();
        })
    });
    group.finish();
}

criterion_group!(benches, kahan_sum_bench);
criterion_main!(benches);
