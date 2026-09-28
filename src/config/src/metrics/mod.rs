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

mod base;
pub mod oncall;
pub mod promql;

use std::collections::HashMap;

pub use base::*;
use prometheus::{Encoder, TextEncoder};

pub const NAMESPACE: &str = "zo";
const HELP_SUFFIX: &str =
    "Please include 'organization, 'stream type', and 'stream' labels for this metric.";

pub fn init() {
    let registry = prometheus::default_registry();
    base::register(registry);
    promql::register(registry);
    oncall::register(registry);
}

pub fn create_const_labels() -> HashMap<String, String> {
    let cfg = crate::config::get_config();
    let mut labels = HashMap::new();
    labels.insert("cluster".to_string(), cfg.common.cluster_name.clone());
    labels.insert("instance".to_string(), cfg.common.instance_name.clone());
    labels.insert("role".to_string(), cfg.common.node_role.clone());
    labels
}

pub fn gather() -> String {
    let registry = prometheus::default_registry();
    let mut buffer = vec![];
    TextEncoder::new()
        .encode(&registry.gather(), &mut buffer)
        .unwrap();
    String::from_utf8(buffer).unwrap()
}

#[cfg(test)]
mod tests {

    use super::*;

    #[test]
    fn test_create_const_labels() {
        let labels = create_const_labels();
        assert_eq!(
            labels.get("cluster").unwrap(),
            &crate::config::get_config().common.cluster_name
        );
    }

    #[test]
    fn test_create_const_labels_returns_three_keys() {
        let labels = create_const_labels();
        assert!(labels.contains_key("cluster"), "should have 'cluster' key");
        assert!(
            labels.contains_key("instance"),
            "should have 'instance' key"
        );
        assert!(labels.contains_key("role"), "should have 'role' key");
        assert_eq!(labels.len(), 3);
    }

    #[test]
    fn test_create_const_labels_values_are_strings() {
        let labels = create_const_labels();
        for (k, v) in &labels {
            let _ = format!("{k}={v}");
        }
    }
}
