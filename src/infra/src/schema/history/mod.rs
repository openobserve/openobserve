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

use async_trait::async_trait;
use config::meta::{meta_store::MetaStore, stream::StreamType};
use datafusion::arrow::datatypes::Schema;
use once_cell::sync::Lazy;

use crate::errors::Result;

pub mod mysql;
pub mod postgres;
pub mod sqlite;

static CLIENT: Lazy<Box<dyn SchemaHistory>> = Lazy::new(connect);

pub fn connect() -> Box<dyn SchemaHistory> {
    match config::get_config().common.meta_store.as_str().into() {
        MetaStore::Sqlite => Box::<sqlite::SqliteSchemaHistory>::default(),
        MetaStore::Etcd => Box::<sqlite::SqliteSchemaHistory>::default(),
        MetaStore::Nats => Box::<sqlite::SqliteSchemaHistory>::default(),
        MetaStore::MySQL => Box::<mysql::MysqlSchemaHistory>::default(),
        MetaStore::PostgreSQL => Box::<postgres::PostgresSchemaHistory>::default(),
    }
}

#[async_trait]
pub trait SchemaHistory: Sync + Send + 'static {
    async fn create_table(&self) -> Result<()>;
    async fn create_table_index(&self) -> Result<()>;
    async fn create(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        start_dt: i64,
        schema: Schema,
    ) -> Result<()>;
}

pub async fn init() -> Result<()> {
    CLIENT.create_table().await?;
    CLIENT.create_table_index().await?;
    Ok(())
}

#[inline]
pub async fn create(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    start_dt: i64,
    schema: Schema,
) -> Result<()> {
    CLIENT
        .create(org_id, stream_type, stream_name, start_dt, schema)
        .await
}
