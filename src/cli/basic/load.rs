// Copyright 2025 OpenObserve Inc.
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

use config::utils::parquet::parse_file_key_columns;

/// Read parquet file from object storage and generate file_list information
pub async fn load_file_list_from_s3(
    account: &str,
    prefix: &str,
    insert: bool,
) -> Result<(), anyhow::Error> {
    if prefix.is_empty() {
        return Err(anyhow::anyhow!(
            "prefix is required, eg: files/default/logs/default/2025/"
        ));
    }
    println!("account: {}", account);
    println!("prefix: {}", prefix);

    println!("Listing files...");
    let files = infra::storage::list(account, prefix).await?;
    println!("get files: {}", files.len());

    println!("Processing files...");
    for (i, file) in files.iter().enumerate() {
        println!("{} {}", i, file);
        let (stream_key, date, file_name) = parse_file_key_columns(file)?;
        let (org, stream) = stream_key.split_once('/').unwrap();
        let file_meta = infra::storage::get_file_meta(account, file).await?;
        if insert {
            if let Err(e) = infra::file_list::add(account, file, &file_meta).await {
                println!("insert to db with file {} error: {}", file, e);
            }
        } else {
            println!(
                "INSERT INTO file_list (account, org, stream, date, file, deleted, flattened, min_ts, max_ts, records, original_size, compressed_size, index_size) VALUES ('{}', '{}', '{}/{}', '{}', '{}', FALSE, FALSE, {}, {}, {}, {}, {}, 0);",
                account,
                org,
                org,
                stream,
                date,
                file_name,
                file_meta.min_ts,
                file_meta.max_ts,
                file_meta.records,
                file_meta.original_size,
                file_meta.compressed_size
            );
        }
    }

    println!("Done, processed {} files", files.len());
    Ok(())
}
