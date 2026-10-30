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

use std::sync::LazyLock as Lazy;

use regex::Regex;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use vrl::{
    compiler::{CompileConfig, Program, TimeZone, VrlRuntime},
    prelude::Function,
};

use crate::{meta::stream::StreamType, stats::MemorySize, utils::json};

// Checks for #ResultArray#
pub static RESULT_ARRAY: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^#[ \s]*Result[ \s]*Array[ \s]*#").unwrap());

// Checks for #ResultArray#SkipVRL#
pub static RESULT_ARRAY_SKIP_VRL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^#[ \s]*Result[ \s]*Array[ \s]*#[ \s]*Skip[ \s]*VRL[ \s]*#").unwrap()
});

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub function: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub params: String,
    #[serde(default)]
    pub num_args: u8,
    #[serde(default = "default_trans_type")]
    pub trans_type: Option<u8>, // 0=vrl 1=js
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streams: Option<Vec<StreamOrder>>,
}

impl MemorySize for Transform {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<Transform>()
            + self.function.mem_size()
            + self.name.mem_size()
            + self.params.mem_size()
            + self.streams.mem_size()
    }
}

impl Transform {
    pub fn is_vrl(&self) -> bool {
        self.trans_type == Some(0)
    }

    pub fn is_js(&self) -> bool {
        self.trans_type == Some(1)
    }

    pub fn is_result_array_vrl(&self) -> bool {
        self.is_vrl()
            && RESULT_ARRAY.is_match(&self.function)
            && !RESULT_ARRAY_SKIP_VRL.is_match(&self.function)
    }
    pub fn is_result_array_js(&self) -> bool {
        self.is_js() && RESULT_ARRAY.is_match(&self.function)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct TestVRLRequest {
    pub function: String,         // Transform function as a string (VRL or JS)
    pub events: Vec<json::Value>, // List of events (JSON objects)
    #[serde(default)]
    pub trans_type: Option<u8>, // Optional: 0=vrl, 1=js. Auto-detected if not provided
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct TestVRLResponse {
    pub results: Vec<VRLResult>, // Transformed events
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct VRLResult {
    pub message: String,
    pub event: json::Value,
}

impl VRLResult {
    pub fn new(message: &str, event: json::Value) -> Self {
        Self {
            message: message.to_string(),
            event,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StreamOrder {
    #[serde(default)]
    pub stream: String,
    #[serde(default)]
    pub order: u8,
    #[serde(default)]
    pub stream_type: StreamType,
    #[serde(default)]
    pub is_removed: bool,
    #[serde(default)]
    pub apply_before_flattening: bool,
}

impl MemorySize for StreamOrder {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<StreamOrder>() + self.stream.mem_size()
    }
}

impl PartialEq for Transform {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name && self.function == other.function && self.params == other.params
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ZoFunction<'a> {
    pub name: &'a str,
    pub text: &'a str,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct FunctionList {
    pub list: Vec<Transform>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VRLConfig {
    pub runtime: VrlRuntime,
    pub timezone: TimeZone,
}

fn default_trans_type() -> Option<u8> {
    Some(0)
}

pub struct VRLCompilerConfig {
    pub config: CompileConfig,
    pub functions: Vec<Box<dyn Function>>,
}

pub struct VRLRuntimeConfig {
    pub config: CompileConfig,
    pub program: Program,
    pub fields: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct VRLResultResolver {
    pub program: Program,
    pub fields: Vec<String>,
}

impl MemorySize for VRLResultResolver {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<VRLResultResolver>() + self.fields.mem_size()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transform(function: &str, trans_type: Option<u8>) -> Transform {
        Transform {
            function: function.to_string(),
            name: "fn_a".to_string(),
            params: "row".to_string(),
            num_args: 1,
            trans_type,
            streams: None,
        }
    }

    #[test]
    fn test_transform_kind() {
        // (function, trans_type, is_vrl, is_js, is_result_array_vrl, is_result_array_js)
        let cases = [
            (". = {}", Some(0), true, false, false, false),
            ("#ResultArray#\n. = {}", Some(0), true, false, true, false),
            (
                "# Result Array #\n. = {}",
                Some(0),
                true,
                false,
                true,
                false,
            ),
            (
                "#ResultArray#SkipVRL#\n. = {}",
                Some(0),
                true,
                false,
                false,
                false,
            ),
            ("#ResultArray#\n. = {}", None, false, false, false, false),
            (
                "function(row) { return row; }",
                Some(1),
                false,
                true,
                false,
                false,
            ),
            (
                "#Result Array#\nfunction(row) { return [row]; }",
                Some(1),
                false,
                true,
                false,
                true,
            ),
        ];
        for (function, trans_type, vrl, js, array_vrl, array_js) in cases {
            let t = transform(function, trans_type);
            let got = (
                t.is_vrl(),
                t.is_js(),
                t.is_result_array_vrl(),
                t.is_result_array_js(),
            );
            assert_eq!(
                got,
                (vrl, js, array_vrl, array_js),
                "{function:?} {trans_type:?}"
            );
        }
    }

    #[test]
    fn test_transform_partial_eq() {
        let a = transform(". = {}", Some(0));
        let ignored = Transform {
            num_args: 2,
            streams: Some(vec![StreamOrder {
                stream: "my_stream".to_string(),
                order: 1,
                stream_type: StreamType::Logs,
                is_removed: false,
                apply_before_flattening: false,
            }]),
            ..a.clone()
        };
        assert_eq!(a, ignored);

        let c = Transform {
            function: ". = {\"x\": 1}".to_string(),
            ..a.clone()
        };
        assert_ne!(a, c);
        let d = Transform {
            name: "fn_d".to_string(),
            ..a.clone()
        };
        assert_ne!(a, d);
        let e = Transform {
            params: "event".to_string(),
            ..a.clone()
        };
        assert_ne!(a, e);
    }
}
