use std::{fs::File, io::Read};

use config::meta::tantivy_inverted_index::PuffinDirectory;
use futures::io::Cursor;

#[tokio::main]
async fn main() {
    let mut data = Vec::<u8>::new();
    let mut file = File::open("./data/7250413177689604885.ttv").unwrap();
    let _ = file.read_to_end(&mut data);

    let puffin_dir = PuffinDirectory::from_bytes(Cursor::new(data))
        .await
        .unwrap();

    // Replace this with the actual operation you want to profile
    let index = tantivy::Index::open(puffin_dir).unwrap();

    // Use the index variable or perform additional operations if necessary
    // For example:
    // let searcher = index.reader().unwrap().searcher();
}
