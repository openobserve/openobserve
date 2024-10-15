use std::{fs::File, io::Read};

use config::meta::puffin_dir::puffin_dir_reader::PuffinDirReader;
use futures::io::Cursor;
use tantivy::query::QueryParser;

#[tokio::main]
async fn main() {
    // let mut data = Vec::<u8>::new();
    // let mut file = File::open("./data/7250413177689604885.ttv").unwrap();
    // let _ = file.read_to_end(&mut data);

    // let puffin_dir = PuffinDirReader::from_bytes(Cursor::new(data))
    //     .await
    //     .unwrap();

    // // Replace this with the actual operation you want to profile
    // let index = tantivy::Index::open(puffin_dir).unwrap();

    // Use the index variable or perform additional operations if necessary
    // For example:
    // let searcher = index.reader().unwrap().searcher();

    let mut data = Vec::<u8>::new();
    let mut file = File::open("./data/7250413177689604885.ttv").unwrap();
    let _ = file.read_to_end(&mut data);
    tokio::task::block_in_place(|| async {
        let puffin_dir = PuffinDirReader::from_bytes(Cursor::new(data))
            .await
            .unwrap();
        let index = tantivy::Index::open(puffin_dir).unwrap();
        // search for a term
        let searcher = index.reader().unwrap().searcher();
        let schema = index.schema();
        let query_parser = QueryParser::for_index(&index, vec![schema.get_field("_all").unwrap()]);
        let query = query_parser.parse_query("test").unwrap();
        let _docs = searcher
            .search(&query, &tantivy::collector::DocSetCollector)
            .unwrap();
    })
    .await;
}
