// Copyright 2023 Zinc Labs Inc.
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

pub mod entry;
pub mod errors;
pub mod immutable;
pub mod memtable;
pub mod partition;
pub mod rwmap;
pub mod stream;
pub mod writer;
pub mod parquet;

pub use entry::Entry;
pub use immutable::read_from_immutable;
use tokio::time;
pub use writer::{get_reader, get_writer};

// TODO: make this configurable
const WAL_DIR: &str = "./data/wal";
const ARROW_DIR: &str = "./data/openobserve/wal/files";
const WAL_FILE_MAX_SIZE: usize = 1024 * 1024 * 32; // 128MB
const WAL_FILE_ROTATION_INTERVAL: i64 = 600; // 10 minutes

pub async fn init() -> errors::Result<()> {
    // load from disk

    // replay wal

    // start a job to dump immutable data to disk
    tokio::task::spawn(async move {
        // immutable persist every 10 seconds
        let mut interval = time::interval(time::Duration::from_secs(10));
        interval.tick().await; // the first tick is immediate
        loop {
            if let Err(e) = immutable::persist().await {
                println!("persist error: {}", e);
            }
            interval.tick().await;
        }
    });

    Ok(())
}
