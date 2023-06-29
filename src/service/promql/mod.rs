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

use async_trait::async_trait;
use datafusion::{arrow::datatypes::Schema, error::Result, prelude::SessionContext};
use serde::{Deserialize, Serialize};
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use utoipa::ToSchema;

mod aggregations;
mod binaries;
mod engine;
mod exec;
mod functions;
pub mod search;
pub mod value;

pub use engine::Engine;
pub use exec::Query;

use crate::meta::stream::ScanStats;

pub(crate) const DEFAULT_LOOKBACK: Duration = Duration::from_secs(300); // 5m
pub(crate) const MINIMAL_INTERVAL: Duration = Duration::from_secs(10); // 10s
pub(crate) const MAX_DATA_POINTS: i64 = 1000; // Width of panel

#[async_trait]
pub trait TableProvider: Sync + Send + 'static {
    async fn create_context(
        &self,
        org_id: &str,
        stream_name: &str,
        time_range: (i64, i64),
        filters: &[(&str, &str)],
    ) -> Result<Vec<(SessionContext, Arc<Schema>, ScanStats)>>;
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct MetricsQueryRequest {
    pub query: String,
    pub start: i64,
    pub end: i64,
    pub step: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Success,
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub result_type: String, // vector, matrix, scalar, string
    pub result: value::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResponse {
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<QueryResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub(crate) enum ApiFuncResponse<T: Serialize> {
    Success {
        data: T,
    },
    Error {
        #[serde(rename = "errorType")]
        error_type: ApiErrorType,
        error: String,
    },
}

impl<T: Serialize> ApiFuncResponse<T> {
    pub(crate) fn ok(data: T) -> Self {
        ApiFuncResponse::Success { data }
    }

    pub(crate) fn err_bad_data(error: impl ToString) -> Self {
        ApiFuncResponse::Error {
            error_type: ApiErrorType::BadData,
            error: error.to_string(),
        }
    }

    pub(crate) fn err_internal(error: impl ToString) -> Self {
        ApiFuncResponse::Error {
            error_type: ApiErrorType::Internal,
            error: error.to_string(),
        }
    }
}

// cf. https://github.com/prometheus/prometheus/blob/5c5fa5c319fca713506fa144ec6768fddf00d466/web/api/v1/api.go#L73-L82
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiErrorType {
    Timeout,
    Cancelled,
    Exec,
    BadData,
    Internal,
    Unavailable,
    NotFound,
}

/// Converts `t` to the number of microseconds elapsed since the beginning of the Unix epoch.
pub(crate) fn micros_since_epoch(t: SystemTime) -> i64 {
    micros(
        t.duration_since(UNIX_EPOCH)
            .expect("BUG: {t} is earlier than Unix epoch"),
    )
}

pub(crate) fn micros(t: Duration) -> i64 {
    t.as_micros()
        .try_into()
        .expect("BUG: time value is too large to fit in i64")
}

#[cfg(test)]
mod tests {
    use super::*;
    use expect_test::expect;

    #[test]
    fn test_api_func_response_serialize() {
        let ok = ApiFuncResponse::ok("hello".to_owned());
        assert_eq!(
            serde_json::to_string(&ok).unwrap(),
            r#"{"status":"success","data":"hello"}"#
        );

        let err = ApiFuncResponse::<()>::err_internal("something went wrong".to_owned());
        assert_eq!(
            serde_json::to_string(&err).unwrap(),
            r#"{"status":"error","errorType":"internal","error":"something went wrong"}"#
        );

        let err = ApiFuncResponse::<()>::err_bad_data(
            r#"invalid parameter \"start\": Invalid time value for 'start': cannot parse \"foobar\" to a valid timestamp"#,
        );
        expect![[r#"
            {
              "status": "error",
              "errorType": "bad_data",
              "error": "invalid parameter \\\"start\\\": Invalid time value for 'start': cannot parse \\\"foobar\\\" to a valid timestamp"
            }"#
        ]].assert_eq(&serde_json::to_string_pretty(&err).unwrap());
    }
}
