// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use async_once::AsyncOnce;
use async_trait::async_trait;
use chrono::Utc;
use std::fs;

use duckdb::{params, DuckdbConnectionManager};
use r2d2::PooledConnection;

use crate::common::{
    infra::{
        config::CONFIG,
        errors::{Error, Result},
    },
    meta::{
        common::{FileKey, FileMeta},
        stream::PartitionTimeLevel,
        StreamType,
    },
};

lazy_static! {
    pub static ref DUCK_DB_CLIENT: AsyncOnce<DuckDB> =
        AsyncOnce::new(async { DuckDB::connect().await });
}

pub struct DuckDB {
    pub client: r2d2::Pool<DuckdbConnectionManager>,
}

impl DuckDB {
    pub async fn connect() -> DuckDB {
        let db_path = format!("{}duckdb", CONFIG.common.data_cache_dir);
        // create duckdb dir
        fs::create_dir_all(&db_path).unwrap();
        let manager = DuckdbConnectionManager::file(format!("{db_path}/file.db")).unwrap();
        let pool = r2d2::Pool::builder()
            .build(manager)
            .expect("duckdb pool builder failed");
        let conn = pool.get().expect("duckdb pool creation failed");

        match conn.execute_batch(&get_config()) {
            Ok(_) => log::info!("set env success "),
            Err(err) => panic!("set env err {err} "),
        }
        create_file_list_table(&CONFIG.common.file_list_dynamo_table_name)
            .await
            .unwrap();
        DuckDB { client: pool }
    }

    pub fn connection(&self) -> PooledConnection<DuckdbConnectionManager> {
        self.client.get().unwrap()
    }
}

fn get_config() -> String {
    let url = CONFIG.s3.server_url.strip_prefix("https://").unwrap();
    format!(
        "set s3_endpoint = \"{url}\";set s3_access_key_id = \"{}\";
        set s3_secret_access_key = \"{}\";set s3_region = \"{}\";",
        CONFIG.s3.access_key, CONFIG.s3.secret_key, CONFIG.s3.region_name
    )
}

async fn create_file_list_table(table_name: &str) -> Result<()> {
    let conn = DUCK_DB_CLIENT.get().await.connection();
    let sql = format!(
        "CREATE TABLE IF NOT EXISTS {table_name}(stream VARCHAR, date VARCHAR, file VARCHAR,
                         min_ts bigint, max_ts bigint, records bigint, original_size bigint, compressed_size bigint,
                         deleted BOOLEAN);",    
    );
    conn.execute_batch(&sql).unwrap();
    Ok(())
}

pub struct DuckDBFileList {
    table: String,
}

impl DuckDBFileList {
    pub fn new() -> Self {
        //create_file_list_table(&CONFIG.common.file_list_dynamo_table_name).await.unwrap();
        Self {
            table: CONFIG.common.file_list_dynamo_table_name.clone(),
        }
    }
}

impl Default for DuckDBFileList {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::FileList for DuckDBFileList {
    async fn add(&self, file: &str, meta: &FileMeta) -> Result<()> {
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;

        let sql = format!("INSERT INTO {}(stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",self.table);
        match DUCK_DB_CLIENT.get().await.connection().execute(
            &sql,
            params![
                stream_key,
                date_key,
                file_name,
                false,
                meta.min_ts,
                meta.max_ts,
                meta.records as i64,
                meta.original_size as i64,
                meta.compressed_size as i64
            ],
        ) {
            Err(e) => Err(Error::Message(e.to_string())),
            Ok(_) => Ok(()),
        }
    }

    async fn remove(&self, file: &str) -> Result<()> {
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        let sql = format!(
            "DELETE FROM {} WHERE stream = ? AND date = ? AND file = ?; ;",
            self.table,
        );
        match DUCK_DB_CLIENT
            .get()
            .await
            .connection()
            .execute(&sql, params![stream_key, date_key, file_name])
        {
            Err(e) => Err(Error::Message(e.to_string())),
            Ok(_) => Ok(()),
        }
    }

    async fn batch_add(&self, files: &[FileKey]) -> Result<()> {
        let chunks = files.chunks(100);
        for files in chunks {
            let mut sqls = Vec::with_capacity(files.len() + 2);
            sqls.push(format!("INSERT INTO {} (stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size)", self.table));
            sqls.push(" VALUES ".to_string());
            let files_num = files.len();
            let mut i = 0;
            for file in files {
                i += 1;
                let dim = if i == files_num { "; " } else { ", " };
                let (stream_key, date_key, file_name) = super::parse_file_key_columns(&file.key)?;
                sqls.push(format!(
                " ('{stream_key}', '{date_key}', '{file_name}', false, {}, {}, {}, {}, {}){dim} ",
                file.meta.min_ts,
                file.meta.max_ts,
                file.meta.records,
                file.meta.original_size,
                file.meta.compressed_size
            ));
            }
            if let Err(e) = DUCK_DB_CLIENT
                .get()
                .await
                .connection()
                .execute(&sqls.join("\n"), params![])
            {
                return Err(Error::Message(e.to_string()));
            }
        }
        Ok(())
    }

    async fn batch_remove(&self, files: &[String]) -> Result<()> {
        for file in files {
            self.remove(file).await?;
        }
        Ok(())
    }

    async fn get(&self, file: &str) -> Result<FileMeta> {
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        let sql=format!("SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size
        FROM {} WHERE stream = '{stream_key}' AND date = '{date_key}' AND file = '{file_name}'; ",self.table);
        match DUCK_DB_CLIENT
            .get()
            .await
            .connection()
            .query_row(&sql, [], |row| {
                Ok(FileMeta {
                    min_ts: row.get(4)?,
                    max_ts: row.get(5)?,
                    records: row.get(6)?,
                    original_size: row.get(7)?,
                    compressed_size: row.get(8)?,
                })
            }) {
            Err(e) => Err(Error::Message(e.to_string())),
            Ok(meta) => Ok(meta),
        }
    }

    async fn list(&self) -> Result<Vec<(String, FileMeta)>> {
        let conn = DUCK_DB_CLIENT.get().await.connection();
        let sql = r#"SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size FROM file_list;"#;

        let mut stmt = conn.prepare(sql)?;
        let ret = stmt.query_and_then([], |row| {
            let stream: String = row.get(0)?;
            let date: String = row.get(1)?;
            let file: String = row.get(2)?;
            if stream.is_empty() || date.is_empty() || file.is_empty() {
                Err(Error::Message("invalid file key".to_string()))
            } else {
                Ok((
                    format!("files/{stream}/{date}/{file}"),
                    FileMeta {
                        min_ts: row.get(4)?,
                        max_ts: row.get(5)?,
                        records: row.get(6)?,
                        original_size: row.get(7)?,
                        compressed_size: row.get(8)?,
                    },
                ))
            }
        })?;
        let mut res_final = vec![];
        for item in ret {
            res_final.push(item?);
        }
        Ok(res_final)
    }

    async fn query(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        _time_level: PartitionTimeLevel,
        time_range: (i64, i64),
    ) -> Result<Vec<(String, FileMeta)>> {
        let (time_start, mut time_end) = time_range;
        if time_start == 0 {
            return Err(Error::Message(
                "Disallow empty time range query".to_string(),
            ));
        }
        if time_end == 0 {
            time_end = Utc::now().timestamp_micros();
        }

        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
        let conn = DUCK_DB_CLIENT.get().await.connection();
        let sql = format!("SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size
                    FROM {}  WHERE stream = '{}' AND min_ts >= {} AND max_ts <= {};",self.table,stream_key,time_start,time_end);
        let mut stmt = conn.prepare(&sql)?;
        let ret = stmt.query_and_then([], |row| {
            let stream: String = row.get(0)?;
            let date: String = row.get(1)?;
            let file: String = row.get(2)?;
            if stream.is_empty() || date.is_empty() || file.is_empty() {
                Err(Error::Message("invalid file key".to_string()))
            } else {
                Ok((
                    format!("files/{stream}/{date}/{file}"),
                    FileMeta {
                        min_ts: row.get(4)?,
                        max_ts: row.get(5)?,
                        records: row.get(6)?,
                        original_size: row.get(7)?,
                        compressed_size: row.get(8)?,
                    },
                ))
            }
        })?;
        let mut res_final = vec![];
        for item in ret {
            res_final.push(item?);
        }
        Ok(res_final)
    }

    async fn contains(&self, file: &str) -> Result<bool> {
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        let sql = format!(
            "SELECT count(*) FROM {} WHERE stream = '{}' AND date = '{}' AND file = '{}';",
            self.table, stream_key, date_key, file_name
        );
        let conn = DUCK_DB_CLIENT.get().await.connection();
        let mut stmt = conn.prepare(&sql)?;
        match stmt.query_row::<usize, _, _>([], |r| r.get(0)) {
            Err(_) => return Ok(false),
            Ok(count) => return Ok(count > 0),
        }
    }

    async fn len(&self) -> usize {
        let sql = format!("SELECT COUNT(*)  FROM {};", self.table);
        match DUCK_DB_CLIENT.get().await.connection().prepare(&sql) {
            Ok(mut stmt) => stmt.query_row::<usize, _, _>([], |r| r.get(0)).unwrap_or(0),
            Err(_) => 0,
        }
    }

    async fn is_empty(&self) -> bool {
        self.len().await == 0
    }

    async fn clear(&self) -> Result<()> {
        let sql = format!("DELETE FROM {};", self.table,);
        match DUCK_DB_CLIENT
            .get()
            .await
            .connection()
            .execute(&sql, params![])
        {
            Err(e) => Err(Error::Message(e.to_string())),
            Ok(_) => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::common::infra::file_list::FileList;

    use super::*;

    #[tokio::test]
    async fn test_duckdb() {
        let _ = create_file_list_table(&CONFIG.common.file_list_dynamo_table_name)
            .await
            .unwrap();
        let table = DuckDBFileList::new();
        table.clear().await.unwrap();
        assert_eq!(0, table.len().await);
        table
            .add(
                "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
                &FileMeta {
                    min_ts: 1,
                    max_ts: 10,
                    records: 2,
                    original_size: 20,
                    compressed_size: 3,
                },
            )
            .await
            .unwrap();
        table
            .batch_add(&[FileKey {
                key: "files/default/logs/olympics/2022/10/03/10/6982652937234804993_1.parquet"
                    .to_string(),
                meta: FileMeta {
                    min_ts: 1,
                    max_ts: 10,
                    records: 2,
                    original_size: 20,
                    compressed_size: 3,
                },
                deleted: false,
            }])
            .await
            .unwrap();

        assert!(table
            .contains("files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet")
            .await
            .unwrap(),);

        assert!(table
            .get("files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet")
            .await
            .is_ok());

        assert_eq!(2, table.list().await.unwrap().len());
        table
            .remove("files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet")
            .await
            .unwrap();

        assert_eq!(false, table.is_empty().await);
    }
}
