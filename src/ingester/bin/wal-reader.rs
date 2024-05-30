// Copyright 2024 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use ingester::{errors::Result, Entry};
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
        let entry = match reader.read_entry() {
            Ok(entry) => entry,
            Err(wal::Error::UnableToReadData { source }) => {
                println!("Unable to read entry from: {}, skip the entry", source);
                continue;
            }
            Err(e) => {
                println!("Error: {}", e);
                break;
            }
        };
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
