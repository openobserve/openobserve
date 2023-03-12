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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Transform {
    #[serde(default)]
    #[serde(skip_serializing_if = "is_zero")]
    pub order: u32,
    pub function: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "String::is_empty")]
    pub stream_name: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub num_args: u8,
    #[serde(default)]
    pub trans_type: u8,
}

fn is_zero(b: impl std::borrow::Borrow<u32>) -> bool {
    b.borrow() <= &0
}

impl PartialEq for Transform {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name && self.stream_name == other.stream_name
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_functions() {
        let trans = Transform {
            order: 0,
            function: "function jsconcat(a,b){return a+b}".to_string(),
            stream_name: "olympics".to_string(),
            name: "jsconcat".to_string(),
            num_args: 2,
            trans_type: 1,
        };

        let mod_trans = Transform {
            order: 0,
            function: "function jsconcat(a,b){return a..b}".to_string(),
            stream_name: "olympics".to_string(),
            name: "jsconcat".to_string(),
            num_args: 2,
            trans_type: 1,
        };
        assert_eq!(trans, mod_trans);

        let trans_str = serde_json::to_string(&trans).unwrap();
        let trans2: Transform = serde_json::from_str(&trans_str).unwrap();
        assert_eq!(format!("{:?}", trans), format!("{:?}", trans2));

        let trans_list = FunctionList {
            list: vec![trans, trans2],
        };
        assert!(!trans_list.list.is_empty());
        let trans_list_str = serde_json::to_string(&trans_list.clone()).unwrap();
        let trans_list2: FunctionList = serde_json::from_str(&trans_list_str).unwrap();
        assert_eq!(trans_list.list.len(), trans_list2.list.len());
    }

    #[test]
    fn test_zo_function() {
        let f1 = ZoFunction {
            name: "test",
            text: "test",
        };
        let f1_str = serde_json::to_string(&f1).unwrap();
        let f2: ZoFunction = serde_json::from_str(&f1_str).unwrap();
        assert_eq!(f1.name, f2.name);
        assert_eq!(format!("{:?}", f1), format!("{:?}", f2));
    }
}
