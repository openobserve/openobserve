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

//! Database Monitoring rollup offsets (design `docs/___databsepages/dbm-design-doc.md` §5, D3).
//!
//! PER-`(org, stream)` offsets — a deliberate deviation from the sibling
//! `service_graph` store's single global key: combined with the DBM job's
//! never-advance-on-failure rule, one persistently failing stream must block
//! only itself, never the whole fleet. Value format is shared with the sibling:
//! either `"<offset>"` or `"<offset>;<node_uuid>"` (node = job lock holder).

use crate as db;

fn mk_key(org_id: &str, stream_name: &str) -> String {
    format!("/db_monitoring/offsets/{org_id}/{stream_name}")
}

/// Parse a stored offset value into `(offset_micros, node_uuid)`.
/// Empty/missing/unparseable values yield `(0, "")` — a fresh stream.
fn parse_offset_value(value: &str) -> (i64, String) {
    let value = value.trim();
    if value.is_empty() {
        return (0, String::new());
    }
    if let Some((offset, node)) = value.split_once(';') {
        (offset.parse().unwrap_or(0), node.to_string())
    } else {
        (value.parse().unwrap_or(0), String::new())
    }
}

/// Get the rollup offset (µs) and lock-holder node for one `(org, stream)`.
pub async fn get_offset(org_id: &str, stream_name: &str) -> (i64, String) {
    let key = mk_key(org_id, stream_name);
    let value = match db::get(&key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from("0"),
    };
    parse_offset_value(&value)
}

/// Set the rollup offset (µs) for one `(org, stream)`, optionally stamping the
/// processing node's uuid as the job lock.
pub async fn set_offset(
    org_id: &str,
    stream_name: &str,
    offset: i64,
    node: Option<&str>,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_name);
    let val = if let Some(node) = node {
        format!("{offset};{node}")
    } else {
        offset.to_string()
    };
    Ok(db::put(&key, val.into(), db::NO_NEED_WATCH, None).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Per-(org, stream) key — NOT the sibling's single global key. A failing
    // stream's offset is isolated to its own meta entry (design D3).
    #[test]
    fn test_mk_key_is_per_org_and_stream() {
        assert_eq!(
            mk_key("default", "traces_a"),
            "/db_monitoring/offsets/default/traces_a"
        );
        assert_eq!(
            mk_key("org2", "traces_a"),
            "/db_monitoring/offsets/org2/traces_a"
        );
        // Two streams of one org never collide.
        assert_ne!(mk_key("default", "s1"), mk_key("default", "s2"));
    }

    #[test]
    fn test_parse_offset_value_plain() {
        assert_eq!(
            parse_offset_value("1700000000000000"),
            (1700000000000000, String::new())
        );
    }

    #[test]
    fn test_parse_offset_value_with_node() {
        assert_eq!(
            parse_offset_value("42;node-uuid-1"),
            (42, "node-uuid-1".to_string())
        );
    }

    #[test]
    fn test_parse_offset_value_empty_or_garbage_is_fresh() {
        assert_eq!(parse_offset_value(""), (0, String::new()));
        assert_eq!(parse_offset_value("not-a-number"), (0, String::new()));
        // Garbage offset with a node still surfaces the node (lock survives).
        assert_eq!(parse_offset_value("x;node"), (0, "node".to_string()));
    }
}
