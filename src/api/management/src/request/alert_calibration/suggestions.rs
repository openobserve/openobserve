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

//! A folder destination is found at read time and offered only to a reader who passes P8a-D4.

use std::collections::{BTreeSet, HashMap};

use o2_enterprise::enterprise::alert_calibration_rules::{
    context::DestinationCandidate,
    no_destination::{ADVICE_ADD_DESTINATION, destination_suggestion},
};
use openobserve_core::alerts::alert_calibration::{
    live_destination_candidates, usable_destination_names,
};
use serde_json::{Map, Value};

use crate::request::alert_grants::{AlertAuthority, AlertVisibility, LiveAuthority};

/// Served only beside an offered suggestion, so a withheld one reads as having no candidate.
pub(super) const CANDIDATE_COLUMNS: [&str; 2] = [
    "evidence_nodestination_candidate",
    "evidence_nodestination_candidate_alerts",
];
/// The writer's mark that a candidate existed; this read answers it and never serves it.
pub(super) const HAS_CANDIDATE_COLUMN: &str = "evidence_nodestination_has_candidate";
const ACTIONS_COLUMN: &str = "insight_actions";

/// Answers every marked record for this reader; a read with none looks nothing up.
pub(super) async fn offer_destination_suggestions(
    org_id: &str,
    user_id: &str,
    visibility: &AlertVisibility,
    rows: &mut [Value],
) {
    let marked = marked_alerts(rows);
    let offers = if marked.is_empty() {
        HashMap::new()
    } else {
        live_offers(org_id, user_id, visibility, &marked).await
    };
    answer_marks(rows, &offers);
}

/// Keeps each candidate the reader can pick and whose supporting alerts its grants all cover.
pub(super) async fn reader_offers<A: AlertAuthority>(
    auth: &A,
    visibility: &AlertVisibility,
    candidates: HashMap<String, DestinationCandidate>,
    usable: Option<&BTreeSet<String>>,
) -> HashMap<String, DestinationCandidate> {
    let Some(usable) = usable else {
        return HashMap::new();
    };
    let mut offers: HashMap<String, DestinationCandidate> = candidates
        .into_iter()
        .filter(|(_, candidate)| usable.contains(&candidate.name))
        .collect();
    if offers.is_empty() || !matches!(visibility, AlertVisibility::Only(_)) {
        return offers;
    }
    // A supporting alert seldom has a record in the run, so the probe's ids cannot decide it.
    let support: BTreeSet<String> = offers
        .values()
        .flat_map(|candidate| candidate.supporting_alert_ids.iter().cloned())
        .collect();
    let (grants, folders) = tokio::join!(
        auth.grants(),
        auth.folders_of(support.into_iter().collect())
    );
    offers.retain(|_, candidate| {
        candidate.supporting_alert_ids.iter().all(|id| {
            folders
                .get(id)
                .is_some_and(|folder| grants.allows(id, folder))
        })
    });
    offers
}

/// Offered: Apply goes first and the candidate columns are served; otherwise the plain advice.
pub(super) fn answer_marks(rows: &mut [Value], offers: &HashMap<String, DestinationCandidate>) {
    for row in rows.iter_mut().filter_map(Value::as_object_mut) {
        let Some(mark) = row.remove(HAS_CANDIDATE_COLUMN) else {
            continue;
        };
        let offer = alert_id(row).and_then(|id| Some((id.clone(), offers.get(&id)?)));
        let offered = mark.as_bool() == Some(true)
            && offer.is_some_and(|(id, candidate)| offer_on(row, &id, candidate));
        if !offered {
            row.insert("advice".to_string(), ADVICE_ADD_DESTINATION.into());
        }
    }
}

/// The candidates for every alert the reader may be offered one for; a failed read offers nothing.
async fn live_offers(
    org_id: &str,
    user_id: &str,
    visibility: &AlertVisibility,
    marked: &BTreeSet<String>,
) -> HashMap<String, DestinationCandidate> {
    let candidates = match live_destination_candidates(org_id, marked).await {
        Ok(candidates) if candidates.is_empty() => return candidates,
        Ok(candidates) => candidates,
        Err(e) => {
            log::warn!(
                "[alert_calibration] could not read folder destinations for org={org_id}, so \
                 none is suggested: {e}"
            );
            return HashMap::new();
        }
    };
    let usable = usable_destination_names(org_id, user_id)
        .await
        .inspect_err(|e| {
            log::warn!(
                "[alert_calibration] could not list the reader's destinations for org={org_id}, \
                 so no destination is suggested: {e}"
            )
        })
        .ok();
    let auth = LiveAuthority { org_id, user_id };
    reader_offers(&auth, visibility, candidates, usable.as_ref()).await
}

fn marked_alerts(rows: &[Value]) -> BTreeSet<String> {
    rows.iter()
        .filter_map(Value::as_object)
        .filter(|row| row.get(HAS_CANDIDATE_COLUMN).and_then(Value::as_bool) == Some(true))
        .filter_map(alert_id)
        .collect()
}

fn alert_id(row: &Map<String, Value>) -> Option<String> {
    row.get("alert_id")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// False, and the row unchanged, when its stored actions are not a list.
fn offer_on(
    row: &mut Map<String, Value>,
    alert_id: &str,
    candidate: &DestinationCandidate,
) -> bool {
    let apply = destination_suggestion(alert_id, candidate);
    let actions = match row.get(ACTIONS_COLUMN) {
        // Spliced as text, so the stored actions and P6's pinned bytes keep their key order.
        Some(Value::String(text)) => {
            let (Ok(apply), Ok(stored)) = (
                serde_json::to_string(&apply),
                serde_json::from_str::<Vec<Value>>(text),
            ) else {
                return false;
            };
            let rest = text.trim_start().strip_prefix('[').unwrap_or_default();
            Value::String(if stored.is_empty() {
                format!("[{apply}]")
            } else {
                format!("[{apply},{rest}")
            })
        }
        Some(Value::Array(stored)) => {
            let Ok(apply) = serde_json::to_value(&apply) else {
                return false;
            };
            Value::Array(
                std::iter::once(apply)
                    .chain(stored.iter().cloned())
                    .collect(),
            )
        }
        _ => return false,
    };
    row.insert(ACTIONS_COLUMN.to_string(), actions);
    row.insert(
        CANDIDATE_COLUMNS[0].to_string(),
        candidate.name.clone().into(),
    );
    row.insert(
        CANDIDATE_COLUMNS[1].to_string(),
        candidate.supporting_alerts.into(),
    );
    true
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;

    use serde_json::json;

    use super::*;
    use crate::request::alert_grants::tests::CountingAuthority;

    const APPLY: &str = r#"{"type":"apply_suggestion","alert_id":"a1","patch":[{"field":"destinations","from":[],"to":["ops-pager"]}]}"#;
    const REVIEW: &str = r#"{"type":"review_alert","alert_id":"a1","focus":"settings"}"#;

    /// A candidate record as ENT's digest writer stores it (digest.rs, test 6).
    fn marked_row() -> Value {
        json!({
            "kind": "finding",
            "rule_id": "no_destination",
            "alert_id": "a1",
            "tier": "A",
            "advice": "attach_folder_destination",
            "insight_actions": format!("[{REVIEW}]"),
            "evidence_nodestination_firings": 5,
            "evidence_nodestination_creates_incident": false,
            "evidence_nodestination_has_candidate": true,
        })
    }

    fn pager(support: &[&str]) -> HashMap<String, DestinationCandidate> {
        HashMap::from([(
            "a1".to_string(),
            DestinationCandidate {
                name: "ops-pager".to_string(),
                supporting_alerts: support.len() as u64,
                supporting_alert_ids: support.iter().map(|id| id.to_string()).collect(),
            },
        )])
    }

    fn set(list: &[&str]) -> BTreeSet<String> {
        list.iter().map(|name| name.to_string()).collect()
    }

    /// Grants on folder `ops` only; `pay` holds `c1`, and `gone` has no alert row.
    fn folder_scoped(grants: &[&str]) -> CountingAuthority {
        CountingAuthority {
            grants: grants.iter().map(|g| g.to_string()).collect(),
            folders: [("a1", "ops"), ("b1", "ops"), ("b2", "ops"), ("c1", "pay")]
                .into_iter()
                .map(|(id, folder)| (id.to_string(), folder.to_string()))
                .collect(),
            ..Default::default()
        }
    }

    fn answered(row: Value, offers: &HashMap<String, DestinationCandidate>) -> Value {
        let mut rows = [row];
        answer_marks(&mut rows, offers);
        let [row] = rows;
        row
    }

    fn assert_plain(row: &Value) {
        assert_eq!(row["insight_actions"], format!("[{REVIEW}]"), "{row}");
        assert_eq!(row["advice"], "add_destination", "{row}");
        for column in CANDIDATE_COLUMNS.iter().chain([&HAS_CANDIDATE_COLUMN]) {
            assert!(row.get(*column).is_none(), "{column} in {row}");
        }
        assert_eq!(row["evidence_nodestination_firings"], 5);
        assert_eq!(row["tier"], "A");
    }

    fn assert_offered(row: &Value, count: u64) {
        assert_eq!(
            row["insight_actions"],
            format!("[{APPLY},{REVIEW}]"),
            "{row}"
        );
        assert_eq!(row["advice"], "attach_folder_destination", "{row}");
        assert_eq!(row["evidence_nodestination_candidate"], "ops-pager");
        assert_eq!(row["evidence_nodestination_candidate_alerts"], count);
        assert!(row.get(HAS_CANDIDATE_COLUMN).is_none(), "{row}");
    }

    /// Home's Review change finds the apply this reader was offered.
    #[test]
    fn the_offered_change_reaches_the_autoobserve_item_before_its_review() {
        use o2_enterprise::enterprise::autoobserve::{
            alert_findings::{DigestRun, item_of},
            insight::{FieldPatch, InsightAction},
        };
        let mut row = marked_row();
        row["finding_id"] = "f".repeat(64).into();
        row["alert_folder"] = "ops".into();
        let run = DigestRun::default();
        let item = |row: &Value| item_of("o", &run, row).expect("a listed finding");
        let offered = item(&answered(row.clone(), &pager(&["b1"])));
        assert_eq!(offered.kind, "alert_no_destination");
        assert_eq!(
            offered.actions[0],
            InsightAction::ApplySuggestion {
                alert_id: "a1".into(),
                patch: vec![FieldPatch::Destinations {
                    from: vec![],
                    to: vec!["ops-pager".into()],
                }],
            }
        );
        assert!(matches!(
            offered.actions[1],
            InsightAction::ReviewAlert { .. }
        ));
        assert_eq!(offered.evidence["folder"], "ops");
        let plain = item(&answered(row, &HashMap::new()));
        assert!(matches!(
            plain.actions[..],
            [InsightAction::ReviewAlert { .. }]
        ));
    }

    #[tokio::test]
    async fn a_reader_who_cannot_list_the_destination_gets_the_plain_finding() {
        let auth = folder_scoped(&[]);
        for usable in [Some(set(&[])), Some(set(&["ops-mail"])), None] {
            let offers = reader_offers(
                &auth,
                &AlertVisibility::Org,
                pager(&["b1", "b2"]),
                usable.as_ref(),
            )
            .await;
            assert!(offers.is_empty(), "{usable:?}");
            assert_plain(&answered(marked_row(), &offers));
        }
        assert_eq!(auth.grant_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn an_alert_scoped_reader_is_offered_the_suggestion_only_when_its_grants_cover_every_supporting_alert()
     {
        let pick = set(&["ops-pager"]);
        let probed = AlertVisibility::Only(set(&["a1"]));
        let offered = |auth: CountingAuthority, support: &'static [&'static str]| {
            let (probed, pick) = (probed.clone(), pick.clone());
            async move { reader_offers(&auth, &probed, pager(support), Some(&pick)).await }
        };
        // b1 and b2 wrote no record this run, so only their folder grant can admit them.
        let auth = folder_scoped(&["afolder:ops"]);
        let kept = reader_offers(&auth, &probed, pager(&["b1", "b2"]), Some(&pick)).await;
        assert_offered(&answered(marked_row(), &kept), 2);
        assert_eq!(auth.grant_calls.load(Ordering::SeqCst), 1);
        assert_eq!(auth.folder_reads.load(Ordering::SeqCst), 1);
        assert_eq!(auth.alerts_read.load(Ordering::SeqCst), 2);

        let denied = offered(folder_scoped(&["afolder:ops"]), &["b1", "c1"]).await;
        assert_plain(&answered(marked_row(), &denied));
        let unread = offered(folder_scoped(&["afolder:ops"]), &["b1", "gone"]).await;
        assert_plain(&answered(marked_row(), &unread));
        let single = offered(folder_scoped(&["afolder:ops", "alert:c1"]), &["b1", "c1"]).await;
        assert_offered(&answered(marked_row(), &single), 2);

        for visibility in [AlertVisibility::AnyAlert, AlertVisibility::Org] {
            let auth = folder_scoped(&[]);
            let offers =
                reader_offers(&auth, &visibility, pager(&["c1", "gone"]), Some(&pick)).await;
            assert_offered(&answered(marked_row(), &offers), 2);
            assert_eq!(auth.grant_calls.load(Ordering::SeqCst), 0);
        }
    }

    #[test]
    fn the_mark_never_leaves_the_server_and_other_rows_are_untouched() {
        let failure = json!({
            "kind": "finding",
            "rule_id": "failure",
            "alert_id": "a2",
            "advice": "check_missing_stream",
            "insight_actions": r#"[{"type":"review_alert","alert_id":"a2","focus":"query"}]"#,
        });
        let unmarked = json!({
            "kind": "finding",
            "rule_id": "no_destination",
            "alert_id": "a3",
            "advice": "add_destination",
            "insight_actions": r#"[{"type":"review_alert","alert_id":"a3","focus":"settings"}]"#,
        });
        let run = json!({"kind": "run", "finding_count": 3, "window_start": 0, "window_end": 1});
        let mut rows = [marked_row(), failure.clone(), unmarked.clone(), run.clone()];
        assert_eq!(marked_alerts(&rows), set(&["a1"]));
        answer_marks(&mut rows, &HashMap::new());
        assert_plain(&rows[0]);
        assert_eq!(rows[1..], [failure.clone(), unmarked.clone(), run.clone()]);
        assert!(marked_alerts(&[failure, unmarked, run]).is_empty());

        let mut stored_as_list = marked_row();
        stored_as_list[ACTIONS_COLUMN] = json!([serde_json::from_str::<Value>(REVIEW).unwrap()]);
        let row = answered(stored_as_list, &pager(&["b1"]));
        assert_eq!(
            row[ACTIONS_COLUMN],
            json!([
                serde_json::from_str::<Value>(APPLY).unwrap(),
                serde_json::from_str::<Value>(REVIEW).unwrap()
            ])
        );
        assert!(row.get(HAS_CANDIDATE_COLUMN).is_none(), "{row}");
    }
}
