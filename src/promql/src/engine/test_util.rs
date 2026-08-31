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

//! Shared fixtures for the engine module's tests.

use std::sync::Arc;

use config::meta::promql::value::*;
use hashbrown::HashSet;
use promql_parser::{
    label::Matchers,
    parser::{token, value::ValueType},
};

// Test extension struct for testing
#[derive(Debug)]
pub(crate) struct TestExtension;

impl promql_parser::parser::ast::ExtensionExpr for TestExtension {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn name(&self) -> &str {
        "test_extension"
    }

    fn value_type(&self) -> ValueType {
        ValueType::String
    }

    fn children(&self) -> &[promql_parser::parser::Expr] {
        &[]
    }
}

pub(crate) fn range_value(timestamp: i64, value: f64) -> RangeValue {
    RangeValue {
        labels: vec![],
        samples: vec![Sample::new(timestamp, value)],
        exemplars: None,
        time_window: None,
    }
}

// Helper function to create test token types
pub(crate) fn create_test_token() -> token::TokenType {
    token::TokenType::new(token::T_ADD)
}

// Helper function to create test QueryContext
pub(crate) fn create_test_query_ctx(
    trace_id: &str,
    org_id: &str,
    timeout: u64,
) -> Arc<QueryContext> {
    Arc::new(QueryContext {
        trace_id: trace_id.to_string(),
        org_id: org_id.to_string(),
        query_exemplars: false,
        query_data: false,
        need_wal: false,
        use_cache: false,
        timeout,
        search_event_type: None,
        regions: vec![],
        clusters: vec![],
        is_super_cluster: false,
    })
}

// Helper function to create test EvalContext
pub(crate) fn create_test_eval_ctx() -> EvalContext {
    EvalContext::new(
        1640995200000000i64,
        1640995200000000i64,
        0,
        "test_trace".to_string(),
    )
}

// Simple mock provider that implements the required trait
pub(crate) struct SimpleMockProvider;

#[async_trait::async_trait]
impl crate::TableProvider for SimpleMockProvider {
    async fn create_context(
        &self,
        _org_id: &str,
        _stream_name: &str,
        _time_range: (i64, i64),
        _machers: promql_parser::label::Matchers,
        _label_selector: HashSet<String>,
        _filters: &mut [(String, Vec<String>)],
    ) -> datafusion::error::Result<
        Vec<(
            datafusion::prelude::SessionContext,
            std::sync::Arc<datafusion::arrow::datatypes::Schema>,
            config::meta::search::ScanStats,
            bool,
        )>,
    > {
        Ok(vec![])
    }
}

/// Mock provider that records the matchers the engine hands to storage.
pub(crate) struct MatcherCapturingProvider {
    pub(crate) captured: Arc<std::sync::Mutex<Option<Matchers>>>,
}

#[async_trait::async_trait]
impl crate::TableProvider for MatcherCapturingProvider {
    async fn create_context(
        &self,
        _org_id: &str,
        _stream_name: &str,
        _time_range: (i64, i64),
        matchers: promql_parser::label::Matchers,
        _label_selector: HashSet<String>,
        _filters: &mut [(String, Vec<String>)],
    ) -> datafusion::error::Result<
        Vec<(
            datafusion::prelude::SessionContext,
            std::sync::Arc<datafusion::arrow::datatypes::Schema>,
            config::meta::search::ScanStats,
            bool,
        )>,
    > {
        *self.captured.lock().unwrap() = Some(matchers);
        Ok(vec![])
    }
}
