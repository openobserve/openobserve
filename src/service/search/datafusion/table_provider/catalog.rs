// Copyright 2026 OpenObserve Inc.
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

use std::{
    any::Any,
    collections::HashMap,
    sync::{Arc, RwLock},
};

use async_trait::async_trait;
use datafusion::{catalog::SchemaProvider, datasource::TableProvider, error::Result};

#[derive(Debug)]
pub struct StreamTypeProvider {
    #[allow(dead_code)]
    name: String,
    tables: RwLock<HashMap<String, Arc<dyn TableProvider>>>,
}

impl StreamTypeProvider {
    pub async fn create(name: &str) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            name: name.to_string(),
            tables: RwLock::new(HashMap::new()),
        }))
    }
}

#[async_trait]
impl SchemaProvider for StreamTypeProvider {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn table_names(&self) -> Vec<String> {
        let tables = self.tables.read().unwrap();
        tables.keys().cloned().collect::<Vec<_>>()
    }

    async fn table(&self, name: &str) -> Result<Option<Arc<dyn TableProvider>>> {
        let tables = self.tables.read().unwrap();
        Ok(tables.get(name).cloned())
    }

    fn table_exist(&self, name: &str) -> bool {
        let tables = self.tables.read().unwrap();
        tables.contains_key(name)
    }

    fn register_table(
        &self,
        name: String,
        table: Arc<dyn TableProvider>,
    ) -> Result<Option<Arc<dyn TableProvider>>> {
        let mut tables = self.tables.write().unwrap();
        tables.insert(name, table.clone());
        Ok(Some(table))
    }

    fn deregister_table(&self, _name: &str) -> Result<Option<Arc<dyn TableProvider>>> {
        unreachable!("deregister_table is not implemented")
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema, SchemaRef};
    use async_trait::async_trait;
    use datafusion::{
        catalog::SchemaProvider,
        datasource::{TableProvider, TableType},
        logical_expr::TableProviderFilterPushDown,
        prelude::Expr,
    };

    use super::*;

    #[derive(Debug)]
    struct DummyTable(SchemaRef);

    impl DummyTable {
        fn new() -> Arc<Self> {
            Arc::new(Self(Arc::new(Schema::new(vec![Field::new(
                "id",
                DataType::Int64,
                false,
            )]))))
        }
    }

    #[async_trait]
    impl TableProvider for DummyTable {
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
        fn schema(&self) -> SchemaRef {
            self.0.clone()
        }
        fn table_type(&self) -> TableType {
            TableType::Base
        }
        async fn scan(
            &self,
            _: &dyn datafusion::catalog::Session,
            _: Option<&Vec<usize>>,
            _: &[Expr],
            _: Option<usize>,
        ) -> datafusion::common::Result<Arc<dyn datafusion::physical_plan::ExecutionPlan>> {
            unimplemented!()
        }
        fn supports_filters_pushdown(
            &self,
            filters: &[&Expr],
        ) -> datafusion::common::Result<Vec<TableProviderFilterPushDown>> {
            Ok(vec![TableProviderFilterPushDown::Inexact; filters.len()])
        }
    }

    #[tokio::test]
    async fn test_table_names_empty() {
        let provider = StreamTypeProvider::create("logs").await.unwrap();
        assert!(provider.table_names().is_empty());
    }

    #[tokio::test]
    async fn test_table_exist_false_when_not_registered() {
        let provider = StreamTypeProvider::create("logs").await.unwrap();
        assert!(!provider.table_exist("default"));
    }

    #[tokio::test]
    async fn test_register_then_exist() {
        let provider = StreamTypeProvider::create("logs").await.unwrap();
        provider
            .register_table("default".to_string(), DummyTable::new())
            .unwrap();
        assert!(provider.table_exist("default"));
    }

    #[tokio::test]
    async fn test_table_names_after_register() {
        let provider = StreamTypeProvider::create("logs").await.unwrap();
        provider
            .register_table("stream_a".to_string(), DummyTable::new())
            .unwrap();
        let names = provider.table_names();
        assert_eq!(names, vec!["stream_a"]);
    }
}
