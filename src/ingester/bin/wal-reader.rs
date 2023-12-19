use ingester::{
    errors::{Result, WalSnafu},
    Entry,
};
use snafu::ResultExt;
use wal::Reader;

fn main() -> Result<()> {
    let path = match std::env::args().nth(1) {
        Some(path) => path,
        None => {
            println!("Usage: wal-reader <path>");
            std::process::exit(1);
        }
    };
    let mut reader = Reader::from_path(path).unwrap();
    let mut total = 0;
    let mut i = 0;
    loop {
        let entry = reader.read_entry().context(WalSnafu)?;
        let Some(entry) = entry else {
            break;
        };
        let entry = Entry::from_bytes(&entry)?;
        i += 1;
        println!(
            "{:05}\t{}/{}/{}\t{:?}",
            i,
            entry.stream,
            entry.schema_key,
            entry.partition_key,
            entry.data.len()
        );
        total += entry.data.len();
    }
    println!("total: {}", total);
    Ok(())
}
