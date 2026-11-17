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

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::KV_MARK_PREFIX;

pub const MARK_PROTECTED: &str = "protected";
pub const ENTITY_TYPE_ALERT: &str = "alert";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkSource {
    Manual,
    SuggestionAccepted,
}

/// The stored value; `v` lets a later shape be told apart from this one.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EntityMark {
    pub v: u8,
    pub org_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub group_key: String,
    pub mark: String,
    pub value: bool,
    pub source: MarkSource,
    pub suggestion_id: Option<String>,
    pub reason: Option<String>,
    pub decided_by: String,
    pub decided_at: i64,
    pub review_after: Option<i64>,
}

/// Scope is per (entity, group); the group key is hashed so any group fits the 256-char column.
pub fn mark_key(mark: &str, entity_type: &str, entity_id: &str, group_key: &str) -> String {
    let digest = Sha256::digest(group_key.as_bytes());
    format!(
        "{KV_MARK_PREFIX}{mark}/{entity_type}/{entity_id}/g-{}",
        hex::encode(&digest[..8])
    )
}

pub fn protected_key(alert_id: &str, group_key: &str) -> String {
    mark_key(MARK_PROTECTED, ENTITY_TYPE_ALERT, alert_id, group_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_match_what_the_engine_writes() {
        let alert = "2abcdefghijklmnopqrstuvwxyz";
        assert_eq!(
            protected_key(alert, "host=a"),
            "_o2_ao/mark/protected/alert/2abcdefghijklmnopqrstuvwxyz/g-0aa80affb7686dc5"
        );
        assert_eq!(protected_key(alert, "host=a").len(), 74);
        assert_eq!(
            protected_key("a1", ""),
            "_o2_ao/mark/protected/alert/a1/g-e3b0c44298fc1c14"
        );
        assert_eq!(
            mark_key("m", "slo", "s1", "host=a"),
            "_o2_ao/mark/m/slo/s1/g-0aa80affb7686dc5"
        );
    }

    #[test]
    fn entity_mark_round_trips_in_the_engine_json_shape() {
        let mark = EntityMark {
            v: 1,
            org_id: "o".into(),
            entity_type: ENTITY_TYPE_ALERT.into(),
            entity_id: "a1".into(),
            group_key: "host=a".into(),
            mark: MARK_PROTECTED.into(),
            value: true,
            source: MarkSource::SuggestionAccepted,
            suggestion_id: Some("s1".into()),
            reason: None,
            decided_by: "u@x.io".into(),
            decided_at: 1,
            review_after: None,
        };
        let json = serde_json::to_string(&mark).unwrap();
        assert_eq!(
            json,
            r#"{"v":1,"org_id":"o","entity_type":"alert","entity_id":"a1","group_key":"host=a","mark":"protected","value":true,"source":"suggestion_accepted","suggestion_id":"s1","reason":null,"decided_by":"u@x.io","decided_at":1,"review_after":null}"#
        );
        assert_eq!(serde_json::from_str::<EntityMark>(&json).unwrap(), mark);
    }
}
