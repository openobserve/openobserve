use std::{fs::File, io::Read};

use config::meta::puffin_directory::reader::RamDirectoryReader;
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use futures::io::Cursor;
use tantivy::query::QueryParser;

fn benchmark_puffin(c: &mut Criterion) {
    let mut group = c.benchmark_group("puffin");
    // group.sample_size(10);
    // group.measurement_time(Duration::new(60, 0));
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(8)
        .enable_all()
        .build()
        .unwrap();

    group.bench_function("test_mem_dir_reader", |b| {
        b.to_async(&runtime).iter(|| async {
            let mut data = Vec::<u8>::new();
            let path = std::env::var("BENCH_INDEX_PATH")
                .expect("BENCH_INDEX_PATH environment variable must be set");
            let mut file = File::open(&path).unwrap();
            let _ = file.read_to_end(&mut data);
            tokio::task::block_in_place(|| async {
                let puffin_dir = RamDirectoryReader::from_bytes(Cursor::new(black_box(data)))
                    .await
                    .unwrap();
                let index = tantivy::Index::open(puffin_dir).unwrap();
                // search for a term
                let searcher = index.reader().unwrap().searcher();
                let schema = index.schema();
                let query_parser =
                    QueryParser::for_index(&index, vec![schema.get_field("_all").unwrap()]);
                let query = query_parser.parse_query("test").unwrap();
                let _docs = searcher
                    .search(&query, &tantivy::collector::DocSetCollector)
                    .unwrap();
            })
            .await;
        });
    });

    // group.bench_function("test_file_dir_reader", |b| {
    //     b.to_async(&runtime).iter(|| async {
    //         let path =
    // PathBuf::from("/Users/uddhav/Projects/openobserve/data/openobserve/stream/files/default/
    // index/default22_logs/2024/10/23/07/7254744283947730080.ttv");
    //         tokio::task::block_in_place(|| async {
    //             let puffin_dir = StdFsReader::from_dir(&path).await.unwrap();
    //             let index = tantivy::Index::open(puffin_dir).unwrap();
    //             // search for a term
    //             let searcher = index.reader().unwrap().searcher();
    //             let schema = index.schema();
    //             let query_parser =
    //                 QueryParser::for_index(&index, vec![schema.get_field("_all").unwrap()]);
    //             let query = query_parser.parse_query("test").unwrap();
    //             let _docs = searcher
    //                 .search(&query, &tantivy::collector::DocSetCollector)
    //                 .unwrap();
    //         })
    //         .await;
    //     });
    // });

    // group.bench_function("test_mmap_dir", |b| {
    //     b.to_async(&runtime).iter(|| async {
    //         let index =
    //             tantivy::Index::open_in_dir("./data/7250413177689604885.ttv.folder").unwrap();

    //         let searcher = index.reader().unwrap().searcher();
    //         let schema = index.schema();
    //         let query_parser =
    //             QueryParser::for_index(&index, vec![schema.get_field("_all").unwrap()]);
    //         let query = query_parser.parse_query("test").unwrap();
    //         let _docs = searcher
    //             .search(&query, &tantivy::collector::DocSetCollector)
    //             .unwrap();
    //     });
    // });

    group.bench_function("test_split", |b| {
        b.to_async(&runtime).iter(|| async { todo!() });
    });

    group.finish();
}

criterion_group!(benches, benchmark_puffin);
criterion_main!(benches);
