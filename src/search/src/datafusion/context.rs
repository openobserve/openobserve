// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{collections::HashSet, sync::Arc};

use config::{datafusion::request::Request, meta::sql::TableReferenceExt};
use datafusion::prelude::SessionContext;
use infra::errors::Result;

use super::{
    exec::{DataFusionContextBuilder, register_udf},
    optimizer::{
        context::PhysicalOptimizerContext, generate_analyzer_rules, generate_optimizer_rules,
        generate_physical_optimizer_rules,
    },
    table_provider::{catalog::StreamTypeProvider, empty_table::NewEmptyTable},
};
use crate::sql::Sql;

pub struct SearchContextBuilder {
    pub target_partitions: usize,
    pub contexts: Vec<PhysicalOptimizerContext>,
}

impl Default for SearchContextBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl SearchContextBuilder {
    pub fn new() -> Self {
        Self {
            target_partitions: 0,
            contexts: vec![],
        }
    }

    pub fn target_partitions(mut self, target_partitions: usize) -> Self {
        self.target_partitions = target_partitions;
        self
    }

    pub fn add_context(mut self, context: PhysicalOptimizerContext) -> Self {
        self.contexts.push(context);
        self
    }

    pub async fn build(self, req: &Request, sql: &Arc<Sql>) -> Result<SessionContext> {
        let analyzer_rules = generate_analyzer_rules(sql);
        let optimizer_rules = generate_optimizer_rules(sql);
        let physical_optimizer_rules = generate_physical_optimizer_rules(req, sql, self.contexts);
        let mut ctx = DataFusionContextBuilder::new()
            .trace_id(&req.trace_id)
            .work_group(req.work_group.clone())
            .analyzer_rules(analyzer_rules)
            .optimizer_rules(optimizer_rules)
            .physical_optimizer_rules(physical_optimizer_rules)
            .sorted_by_time(sql.sorted_by_time)
            .build(self.target_partitions)
            .await?;

        register_udf(&ctx, &sql.org_id)?;
        datafusion_functions_json::register_all(&mut ctx)?;

        Ok(ctx)
    }
}

pub async fn register_table(ctx: &SessionContext, sql: &Sql) -> Result<()> {
    let mut registered_schemas = HashSet::new();
    for (stream, _) in &sql.schemas {
        let stream_type = stream.stream_type();
        if !stream.has_stream_type() || registered_schemas.contains(&stream_type) {
            continue;
        }
        registered_schemas.insert(stream_type.clone());
        let schema_provider = StreamTypeProvider::create(&stream_type).await?;
        let _ = ctx
            .catalog("datafusion")
            .unwrap()
            .as_ref()
            .register_schema(&stream_type, schema_provider);
    }

    for (stream, schema) in &sql.schemas {
        let schema = schema
            .schema()
            .as_ref()
            .clone()
            .with_metadata(Default::default());
        let stream_name = stream.to_quoted_string();
        let table = Arc::new(
            NewEmptyTable::new(&stream_name, Arc::new(schema))
                .with_partitions(ctx.state().config().target_partitions())
                .with_sorted_by_time(sql.sorted_by_time),
        );
        ctx.register_table(&stream_name, table)?;
    }

    Ok(())
}
