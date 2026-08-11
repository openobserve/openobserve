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

//! Ownership rules — which team owns which slice of the identity space — and
//! the queue of signals that fell through them.
//!
//! The two live together because they are the same question answered twice:
//! a rule says who owns a path, and an unrouted row says a path nobody owns
//! just woke nobody.

use std::collections::HashMap;

use config::{
    ider,
    meta::oncall::{OwnershipRule, SubjectType, UnroutedSignal, canonical_path},
    utils::time::now_micros,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
};

use super::entity::{oncall_ownership_rules, oncall_unrouted_signals};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// A rule whose dimensions column will not parse is dropped, not defaulted to
/// empty. An empty rule matches EVERY alert in the org, so a parse failure
/// must never produce one.
fn to_rule(m: oncall_ownership_rules::Model) -> Option<OwnershipRule> {
    let dimensions: HashMap<String, String> = match serde_json::from_str(&m.dimensions) {
        Ok(d) => d,
        Err(e) => {
            log::error!(
                "[ONCALL] ownership rule {} has unparseable dimensions, ignoring it: {e}",
                m.id
            );
            return None;
        }
    };
    Some(OwnershipRule {
        id: m.id,
        org_id: m.org_id,
        team_id: m.team_id,
        dimensions,
        created_at: m.created_at,
        updated_at: m.updated_at,
    })
}

pub async fn create(
    org_id: &str,
    team_id: &str,
    dimensions: HashMap<String, String>,
) -> Result<OwnershipRule, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = now_micros();
    let rule = OwnershipRule {
        id: ider::uuid(),
        org_id: org_id.to_string(),
        team_id: team_id.to_string(),
        dimensions,
        created_at: now,
        updated_at: now,
    };
    let model = oncall_ownership_rules::ActiveModel {
        id: Set(rule.id.clone()),
        org_id: Set(rule.org_id.clone()),
        team_id: Set(rule.team_id.clone()),
        path: Set(rule.path()),
        dimensions: Set(serde_json::to_string(&rule.dimensions)?),
        created_at: Set(now),
        updated_at: Set(now),
    };
    model.insert(client).await?;
    Ok(rule)
}

/// Every rule for an org. The routing path loads the whole set and resolves in
/// memory: the match is longest-prefix over a map, which SQL cannot express,
/// and an org has tens of rules, not thousands.
pub async fn list(org_id: &str) -> Result<Vec<OwnershipRule>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_ownership_rules::Entity::find()
        .filter(oncall_ownership_rules::Column::OrgId.eq(org_id))
        .order_by_asc(oncall_ownership_rules::Column::Path)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_rule)
        .collect())
}

pub async fn list_by_team(
    org_id: &str,
    team_id: &str,
) -> Result<Vec<OwnershipRule>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_ownership_rules::Entity::find()
        .filter(oncall_ownership_rules::Column::OrgId.eq(org_id))
        .filter(oncall_ownership_rules::Column::TeamId.eq(team_id))
        .order_by_asc(oncall_ownership_rules::Column::Path)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_rule)
        .collect())
}

pub async fn delete(org_id: &str, id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let deleted = oncall_ownership_rules::Entity::delete_many()
        .filter(oncall_ownership_rules::Column::OrgId.eq(org_id))
        .filter(oncall_ownership_rules::Column::Id.eq(id))
        .exec(client)
        .await?
        .rows_affected;
    Ok(deleted > 0)
}

/// Drops every rule a team owns. Called when the team is deleted, so its
/// claims do not keep routing alerts at a team that no longer exists.
pub async fn delete_by_team(org_id: &str, team_id: &str) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_ownership_rules::Entity::delete_many()
        .filter(oncall_ownership_rules::Column::OrgId.eq(org_id))
        .filter(oncall_ownership_rules::Column::TeamId.eq(team_id))
        .exec(client)
        .await?
        .rows_affected)
}

// ── The unrouted queue ──────────────────────────────────────────────────────

/// The most a stored path may be, in characters.
///
/// The column is a `varchar`, because the queue is keyed on it and a unique
/// index over unbounded text is not portable. Records carry far more
/// dimensions than any rule names, so a very wide record's path is truncated
/// rather than refused: losing the tail of a display string is a much smaller
/// failure than dropping the only evidence that a page went nowhere. The
/// dimensions themselves are stored in full alongside it.
const MAX_PATH_CHARS: usize = 255;

fn truncate_path(path: &str) -> String {
    match path.char_indices().nth(MAX_PATH_CHARS) {
        Some((byte, _)) => path[..byte].to_string(),
        None => path.to_string(),
    }
}

/// A row whose dimensions will not parse still lists — unlike an ownership
/// rule, an unparseable one here is harmless (it matches nothing and decides
/// nothing) and the row's whole purpose is to be seen.
fn to_unrouted(m: oncall_unrouted_signals::Model) -> UnroutedSignal {
    let dimensions: HashMap<String, String> =
        serde_json::from_str(&m.dimensions).unwrap_or_else(|e| {
            log::error!(
                "[ONCALL] unrouted signal {} has unparseable dimensions: {e}",
                m.id
            );
            HashMap::new()
        });
    UnroutedSignal {
        id: m.id,
        org_id: m.org_id,
        path: m.path,
        dimensions,
        occurrences: m.occurrences,
        first_seen_at: m.first_seen_at,
        last_seen_at: m.last_seen_at,
        last_subject_type: m.last_subject_type.and_then(SubjectType::from_i32),
        last_source_id: m.last_source_id,
        last_title: m.last_title,
        last_priority: m.last_priority,
        dismissed_at: m.dismissed_at,
    }
}

/// Records that a signal on `dimensions` matched no team.
///
/// Upserts on `(org_id, path)`: the second firing into the same gap bumps the
/// count and the sample rather than adding a line. `subject` is what fired,
/// when the caller knows it — routing itself decides before the subject is
/// built, so it is optional and only ever a sample.
///
/// A previously dismissed row is reopened. Somebody said "handled" and it
/// happened again, so it plainly was not.
pub async fn record_unrouted(
    org_id: &str,
    dimensions: &HashMap<String, String>,
    subject: Option<(SubjectType, &str, Option<&str>, i32)>,
    now: i64,
) -> Result<UnroutedSignal, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let path = truncate_path(&canonical_path(dimensions));
    let (subject_type, source_id, title, priority) = match subject {
        Some((t, s, title, p)) => (
            Some(t.to_i32()),
            Some(s.to_string()),
            title.map(|t| t.to_string()),
            Some(p),
        ),
        None => (None, None, None, None),
    };

    if let Some(existing) = oncall_unrouted_signals::Entity::find()
        .filter(oncall_unrouted_signals::Column::OrgId.eq(org_id))
        .filter(oncall_unrouted_signals::Column::Path.eq(&path))
        .one(client)
        .await?
    {
        let occurrences = existing.occurrences.saturating_add(1);
        let mut model: oncall_unrouted_signals::ActiveModel = existing.into();
        model.occurrences = Set(occurrences);
        model.last_seen_at = Set(now);
        model.dismissed_at = Set(None);
        // Only overwrite the sample when this caller actually has one; a bare
        // routing decision must not blank out what the last full page knew.
        if subject_type.is_some() {
            model.last_subject_type = Set(subject_type);
            model.last_source_id = Set(source_id);
            model.last_title = Set(title);
            model.last_priority = Set(priority);
        }
        return Ok(to_unrouted(model.update(client).await?));
    }

    let model = oncall_unrouted_signals::ActiveModel {
        id: Set(ider::uuid()),
        org_id: Set(org_id.to_string()),
        path: Set(path.clone()),
        dimensions: Set(serde_json::to_string(dimensions)?),
        occurrences: Set(1),
        first_seen_at: Set(now),
        last_seen_at: Set(now),
        last_subject_type: Set(subject_type),
        last_source_id: Set(source_id),
        last_title: Set(title),
        last_priority: Set(priority),
        dismissed_at: Set(None),
    };
    match model.insert(client).await {
        Ok(inserted) => Ok(to_unrouted(inserted)),
        // Two nodes hit the same gap at the same instant. The unique index
        // refuses the loser, whose signal is already recorded by the winner.
        Err(e) => match oncall_unrouted_signals::Entity::find()
            .filter(oncall_unrouted_signals::Column::OrgId.eq(org_id))
            .filter(oncall_unrouted_signals::Column::Path.eq(&path))
            .one(client)
            .await?
        {
            Some(found) => Ok(to_unrouted(found)),
            None => Err(e.into()),
        },
    }
}

/// The queue, most recent first.
pub async fn list_unrouted(
    org_id: &str,
    include_dismissed: bool,
    limit: u64,
) -> Result<Vec<UnroutedSignal>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut q = oncall_unrouted_signals::Entity::find()
        .filter(oncall_unrouted_signals::Column::OrgId.eq(org_id));
    if !include_dismissed {
        q = q.filter(oncall_unrouted_signals::Column::DismissedAt.is_null());
    }
    Ok(q.order_by_desc(oncall_unrouted_signals::Column::LastSeenAt)
        .limit(limit)
        .all(client)
        .await?
        .into_iter()
        .map(to_unrouted)
        .collect())
}

/// How many gaps are outstanding — the number a badge shows.
pub async fn count_unrouted(org_id: &str) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_unrouted_signals::Entity::find()
        .filter(oncall_unrouted_signals::Column::OrgId.eq(org_id))
        .filter(oncall_unrouted_signals::Column::DismissedAt.is_null())
        .count(client)
        .await?)
}

/// Marks one entry handled. Returns `None` if it is gone.
pub async fn dismiss_unrouted(
    org_id: &str,
    id: &str,
    now: i64,
) -> Result<Option<UnroutedSignal>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_unrouted_signals::Entity::find_by_id(id)
        .filter(oncall_unrouted_signals::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    let mut model: oncall_unrouted_signals::ActiveModel = existing.into();
    model.dismissed_at = Set(Some(now));
    Ok(Some(to_unrouted(model.update(client).await?)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(dimensions: &str) -> oncall_ownership_rules::Model {
        oncall_ownership_rules::Model {
            id: "rule_1".into(),
            org_id: "default".into(),
            team_id: "team_1".into(),
            path: "k8s-cluster=prod".into(),
            dimensions: dimensions.into(),
            created_at: 10,
            updated_at: 20,
        }
    }

    #[test]
    fn test_dimensions_round_trip_through_the_json_column() {
        let dims = HashMap::from([
            ("k8s-cluster".to_string(), "prod".to_string()),
            ("k8s-namespace".to_string(), "payments".to_string()),
        ]);
        let rule = to_rule(model(&serde_json::to_string(&dims).unwrap())).unwrap();
        assert_eq!(rule.dimensions, dims);
        assert_eq!(rule.team_id, "team_1");
    }

    /// An empty rule owns EVERY alert in the org. A parse failure must drop
    /// the row, never fall back to one.
    #[test]
    fn test_unparseable_dimensions_drop_the_rule() {
        for bad in ["not json", "[]", "null", r#"{"k":1}"#] {
            assert!(to_rule(model(bad)).is_none(), "`{bad}` must be dropped");
        }
    }

    /// `{}` parses cleanly as a map, so the drop above cannot catch it — the
    /// resolver's own validate() is the backstop.
    #[test]
    fn test_an_empty_map_parses_but_never_matches() {
        let rule = to_rule(model("{}")).unwrap();
        assert!(rule.validate().is_err());
        assert!(
            config::meta::oncall::resolve_owner(
                &[rule],
                &HashMap::from([("k8s-cluster".to_string(), "prod".to_string())])
            )
            .is_none()
        );
    }

    fn unrouted_model(dimensions: &str) -> oncall_unrouted_signals::Model {
        oncall_unrouted_signals::Model {
            id: "unr_1".into(),
            org_id: "default".into(),
            path: "k8s-cluster=prod/k8s-namespace=search".into(),
            dimensions: dimensions.into(),
            occurrences: 12,
            first_seen_at: 10,
            last_seen_at: 20,
            last_subject_type: Some(SubjectType::Alert.to_i32()),
            last_source_id: Some("al_ckt".into()),
            last_title: Some("payment_gateway_error_rate".into()),
            last_priority: Some(2),
            dismissed_at: None,
        }
    }

    /// The row exists to be read by a person, so everything they need to write
    /// the missing rule has to survive the round trip.
    #[test]
    fn test_an_unrouted_row_maps_onto_the_meta_type() {
        let dims = HashMap::from([
            ("k8s-cluster".to_string(), "prod".to_string()),
            ("k8s-namespace".to_string(), "search".to_string()),
        ]);
        let s = to_unrouted(unrouted_model(&serde_json::to_string(&dims).unwrap()));
        assert_eq!(s.dimensions, dims);
        assert_eq!(s.occurrences, 12);
        assert_eq!(s.last_subject_type, Some(SubjectType::Alert));
        assert!(s.is_open());
        assert!(s.describe().contains("payment_gateway_error_rate"));
    }

    /// Unlike an ownership rule, a queue row with unreadable dimensions is
    /// harmless — it matches nothing and decides nothing — and dropping it
    /// would hide the one fact it exists to report.
    #[test]
    fn test_an_unrouted_row_survives_unparseable_dimensions() {
        let s = to_unrouted(unrouted_model("not json"));
        assert!(s.dimensions.is_empty());
        assert_eq!(s.occurrences, 12, "the rest of the row still loads");
    }

    /// The path is the queue's key and lives in a `varchar`. A record carrying
    /// dozens of dimensions must not fail to be recorded because its display
    /// string is long — losing the tail beats losing the evidence.
    #[test]
    fn test_a_very_wide_path_is_truncated_rather_than_refused() {
        let wide: HashMap<String, String> = (0..40)
            .map(|i| (format!("dimension-{i:02}"), format!("value-{i:02}")))
            .collect();
        let path = truncate_path(&config::meta::oncall::canonical_path(&wide));
        assert_eq!(path.chars().count(), MAX_PATH_CHARS);
        assert!(path.starts_with("dimension-00=value-00"));

        // Multi-byte values must not be cut mid-character.
        let unicode: HashMap<String, String> =
            HashMap::from([("k8s-namespace".to_string(), "प".repeat(400))]);
        let path = truncate_path(&config::meta::oncall::canonical_path(&unicode));
        assert_eq!(path.chars().count(), MAX_PATH_CHARS);
    }

    /// The stored path is what the unique index refuses duplicates on, so it
    /// has to be the canonical sorted form, not HashMap order.
    #[test]
    fn test_stored_path_is_canonical() {
        let dims = HashMap::from([
            ("k8s-namespace".to_string(), "payments".to_string()),
            ("k8s-cluster".to_string(), "prod".to_string()),
        ]);
        let rule = to_rule(model(&serde_json::to_string(&dims).unwrap())).unwrap();
        assert_eq!(rule.path(), "k8s-cluster=prod/k8s-namespace=payments");
    }
}
