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

use std::{collections::BTreeMap, error::Error, fmt};

use config::{meta::function::VRLResultResolver, utils::json};
use vrl::compiler::{TargetValueRef, runtime::Runtime};

/// A failure produced while executing a transform.
///
/// The transform boundary deliberately does not update ingestion metrics. Callers that own
/// ingestion observability can classify this error without coupling query or pipeline execution
/// to the ingestion domain.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TransformError {
    ResultConversion {
        org_id: String,
        stream_name: Vec<String>,
        message: String,
    },
    Runtime {
        org_id: String,
        stream_name: Vec<String>,
        message: String,
    },
}

impl fmt::Display for TransformError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ResultConversion {
                org_id,
                stream_name,
                message,
            } => write!(formatter, "{org_id}/{stream_name:?} vrl failed: {message}"),
            Self::Runtime {
                org_id,
                stream_name,
                message,
            } => write!(
                formatter,
                "{org_id}/{stream_name:?} vrl runtime error: {message}"
            ),
        }
    }
}

impl Error for TransformError {}

/// Execute a compiled VRL program without recording caller-domain metrics.
pub fn apply_vrl(
    runtime: &mut Runtime,
    vrl_runtime: &VRLResultResolver,
    row: &json::Value,
    org_id: &str,
    stream_name: &[String],
) -> Result<json::Value, TransformError> {
    let primary_stream = stream_name.first().map_or("", String::as_str);
    let mut metadata = vrl::value::Value::from(BTreeMap::new());
    metadata.insert("org_id", vrl::value::Value::from(org_id.to_string()));
    metadata.insert(
        "stream_name",
        vrl::value::Value::from(primary_stream.to_string()),
    );
    let mut target = TargetValueRef {
        value: &mut vrl::value::Value::from(row),
        metadata: &mut metadata,
        secrets: &mut vrl::value::Secrets::new(),
    };

    target
        .secrets
        .insert(primary_stream.to_string(), primary_stream.to_string());

    let timezone = vrl::compiler::TimeZone::Local;
    let result = match vrl::compiler::VrlRuntime::default() {
        vrl::compiler::VrlRuntime::Ast => {
            runtime.resolve(&mut target, &vrl_runtime.program, &timezone)
        }
    };

    let resolved = result.map_err(|error| TransformError::Runtime {
        org_id: org_id.to_string(),
        stream_name: stream_name.to_vec(),
        message: format!("{error:?}"),
    })?;

    resolved
        .try_into()
        .map_err(|error| TransformError::ResultConversion {
            org_id: org_id.to_string(),
            stream_name: stream_name.to_vec(),
            message: format!("{error:?}"),
        })
}

/// Compatibility shape used by existing callers while they migrate to [`apply_vrl`].
pub fn apply_vrl_fn(
    runtime: &mut Runtime,
    vrl_runtime: &VRLResultResolver,
    row: json::Value,
    org_id: &str,
    stream_name: &[String],
) -> (json::Value, Option<String>) {
    match apply_vrl(runtime, vrl_runtime, &row, org_id, stream_name) {
        Ok(value) => (value, None),
        Err(error) => (row, Some(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use config::meta::function::VRLResultResolver;
    use serde_json::json;

    use super::*;
    use crate::{compile_vrl_function, init_vrl_runtime};

    #[test]
    fn applies_compiled_vrl() {
        let config = compile_vrl_function(".answer = 42\n.", "test_org").unwrap();
        let resolver = VRLResultResolver {
            program: config.program,
            fields: config.fields,
        };
        let mut runtime = init_vrl_runtime();

        let result = apply_vrl(
            &mut runtime,
            &resolver,
            &json!({"message": "hello"}),
            "test_org",
            &["logs".to_string()],
        )
        .unwrap();

        assert_eq!(result["message"], "hello");
        assert_eq!(result["answer"], 42);
    }

    #[test]
    fn returns_original_value_from_compatibility_api_on_error() {
        let config = compile_vrl_function("abort", "test_org").unwrap();
        let resolver = VRLResultResolver {
            program: config.program,
            fields: config.fields,
        };
        let mut runtime = init_vrl_runtime();
        let input = json!({"message": "hello"});

        let (result, error) = apply_vrl_fn(
            &mut runtime,
            &resolver,
            input.clone(),
            "test_org",
            &["logs".to_string()],
        );

        assert_eq!(result, input);
        assert!(error.is_some());
    }
}
