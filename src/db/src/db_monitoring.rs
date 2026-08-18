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

use infra::errors::{DbError, Error};

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
///
/// A missing key is a legitimately fresh stream → `Ok((0, ""))`. Any OTHER
/// meta-DB error propagates: swallowing it to `(0, "")` would make a transient
/// read failure look like a fresh stream — restarting the rollup one window
/// back AND stealing the coordination lock from whichever node holds it.
pub async fn get_offset(org_id: &str, stream_name: &str) -> Result<(i64, String), anyhow::Error> {
    let key = mk_key(org_id, stream_name);
    match db::get(&key).await {
        Ok(ret) => Ok(parse_offset_value(&String::from_utf8_lossy(&ret))),
        Err(Error::DbError(DbError::KeyNotExists(_))) => Ok((0, String::new())),
        Err(e) => Err(e.into()),
    }
}

/// Get every stream's rollup offset for one org in ONE prefix read:
/// `stream name → (offset_micros, node_uuid)`.
///
/// The read API resolves tails for several streams per request, and one
/// meta-DB round trip per stream (twice — freshness and tail computation) is
/// what this batches away. A stream absent from the map is a legitimately
/// fresh stream — the same `(0, "")` that [`get_offset`] answers for a missing
/// key. Any read error propagates, exactly as [`get_offset`]'s does: the
/// caller must not mistake a meta-DB blip for a fleet of fresh streams.
pub async fn list_offsets(
    org_id: &str,
) -> Result<std::collections::HashMap<String, (i64, String)>, anyhow::Error> {
    let prefix = format!("/db_monitoring/offsets/{org_id}/");
    let items = db::list(&prefix).await?;
    Ok(items
        .into_iter()
        .filter_map(|(key, value)| {
            let stream = key.strip_prefix(&prefix)?.to_string();
            Some((stream, parse_offset_value(&String::from_utf8_lossy(&value))))
        })
        .collect())
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

/// Set the offset ONLY IF the stored value is still `expected` — the
/// compare-and-swap the plain [`set_offset`] is not.
///
/// Returns `Ok(true)` when this node won and the value was written, `Ok(false)`
/// when the stored value had moved (another node wrote in between; the caller
/// has lost the stream and must stop).
///
/// **Why the rollup needs this.** The window records are appended to a log
/// stream and the read path SUMS the constituent rows of a window, so a window
/// written twice is not overwritten — it is double-counted, permanently, by
/// every later read. The offset is the only thing standing between a window
/// and a second write of itself, which makes an unguarded read-then-write a
/// duplicate generator: two nodes that both read offset N both process window
/// N, and the second `put` merely overwrites the first's identical offset while
/// both sets of records are already in the stream.
///
/// This is NOT atomic against the meta store — there is no CAS primitive
/// underneath, so this re-reads and then writes. It closes the wide window
/// (a whole window's three searches, seconds to minutes, between the read and
/// the write) rather than the instruction-level one, which is the difference
/// between "duplicates whenever two nodes tick together" and "duplicates only
/// if two writes interleave inside the same few milliseconds".
pub async fn compare_and_set_offset(
    org_id: &str,
    stream_name: &str,
    expected: (i64, &str),
    offset: i64,
    node: Option<&str>,
) -> Result<bool, anyhow::Error> {
    let (current_offset, current_node) = get_offset(org_id, stream_name).await?;
    if current_offset != expected.0 || current_node != expected.1 {
        return Ok(false);
    }
    set_offset(org_id, stream_name, offset, node).await?;
    Ok(true)
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
