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

mod entry;
pub mod errors;
mod immutable;
mod memtable;
mod parquet;
mod partition;
mod rwmap;
mod stream;
mod wal;
mod writer;

pub use entry::Entry;
pub use immutable::read_from_immutable;
use tokio::time;
pub use writer::{get_reader, get_writer};

pub async fn init() -> errors::Result<()> {
    // check uncompleted parquet files, need delete those files
    wal::check_uncompleted_parquet_files().await?;

    // replay wal files to create immutable
    wal::replay_wal_files().await?;

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
