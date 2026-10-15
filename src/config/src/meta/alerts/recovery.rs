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

//! Recovery is a transition, not a level — "is it Ok now?" answers yes forever, which is how
//! on-call wrote 11,616 entries for one firing. The episode anchors it: opened by the first
//! DELIVERED notification, cleared by the write that emits the recovery, so exactly-once is
//! structural and a suppressed firing needs no check in any consumer.

use serde::{Deserialize, Serialize};

use super::state::AlertState;
use crate::meta::alerts::level::AlertLevel;

/// Microseconds in a second, for `keep_firing_for`.
const MICROS_PER_SECOND: i64 = 1_000_000;

/// Carries what consumers need after the state row has forgotten it: the correlation key, and who
/// owned firing delivery.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "RecoveryEventWire", into = "RecoveryEventWire")]
pub struct RecoveryEvent {
    pub org_id: String,
    pub alert_id: String,
    /// `""` is the per-alert rollup row; non-empty identifies one grouped series.
    pub group_key: String,
    pub episode_id: String,
    /// Empty = the alert path owned firing delivery.
    pub incident_ids: EpisodeIncidents,
    pub opened_at: i64,
    /// When the condition cleared — not when `keep_firing_for` expired. The
    /// hold delays the message, it does not move the recovery.
    pub recovered_at: i64,
    pub emitted_at: i64,
    pub last_notified_level: Option<AlertLevel>,
    pub group_labels: Option<String>,
}

impl RecoveryEvent {
    /// How long the episode ran, in microseconds.
    pub fn duration_micros(&self) -> i64 {
        self.recovered_at.saturating_sub(self.opened_at).max(0)
    }
}

/// [`RecoveryEvent`] on the wire: `incident_id` keeps the first id an older node reads.
#[derive(Serialize, Deserialize)]
struct RecoveryEventWire {
    org_id: String,
    alert_id: String,
    group_key: String,
    episode_id: String,
    #[serde(default)]
    incident_id: Option<String>,
    /// Only written when there is more than one id; `incident_id` alone carries a single one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    incident_ids: Vec<String>,
    opened_at: i64,
    recovered_at: i64,
    emitted_at: i64,
    last_notified_level: Option<AlertLevel>,
    group_labels: Option<String>,
}

impl From<RecoveryEvent> for RecoveryEventWire {
    fn from(event: RecoveryEvent) -> Self {
        let ids = event.incident_ids.ids();
        Self {
            incident_id: ids.first().cloned(),
            incident_ids: if ids.len() > 1 {
                ids.to_vec()
            } else {
                Vec::new()
            },
            org_id: event.org_id,
            alert_id: event.alert_id,
            group_key: event.group_key,
            episode_id: event.episode_id,
            opened_at: event.opened_at,
            recovered_at: event.recovered_at,
            emitted_at: event.emitted_at,
            last_notified_level: event.last_notified_level,
            group_labels: event.group_labels,
        }
    }
}

impl From<RecoveryEventWire> for RecoveryEvent {
    fn from(wire: RecoveryEventWire) -> Self {
        Self {
            incident_ids: EpisodeIncidents::new(
                wire.incident_id.into_iter().chain(wire.incident_ids),
            ),
            org_id: wire.org_id,
            alert_id: wire.alert_id,
            group_key: wire.group_key,
            episode_id: wire.episode_id,
            opened_at: wire.opened_at,
            recovered_at: wire.recovered_at,
            emitted_at: wire.emitted_at,
            last_notified_level: wire.last_notified_level,
            group_labels: wire.group_labels,
        }
    }
}

/// The incidents that owned an episode's firing delivery, in correlation order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EpisodeIncidents(Vec<String>);

impl EpisodeIncidents {
    /// Drops blanks and repeats, keeping the first occurrence's position.
    pub fn new(ids: impl IntoIterator<Item = String>) -> Self {
        let mut kept: Vec<String> = Vec::new();
        for id in ids {
            if !id.is_empty() && !kept.contains(&id) {
                kept.push(id);
            }
        }
        Self(kept)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn ids(&self) -> &[String] {
        &self.0
    }

    /// These ids then `other`'s new ones, in order.
    pub fn union(&self, other: &Self) -> Self {
        Self::new(self.0.iter().chain(&other.0).cloned())
    }

    /// The column value: one id stays a bare string so a row older than the list still reads.
    pub fn to_stored(&self) -> Option<String> {
        match self.0.as_slice() {
            [] => None,
            [one] => Some(one.clone()),
            many => serde_json::to_string(many).ok(),
        }
    }

    /// Reads [`Self::to_stored`]; ksuid incident ids never start with `[`.
    pub fn from_stored(raw: Option<&str>) -> Self {
        let Some(raw) = raw.map(str::trim).filter(|r| !r.is_empty()) else {
            return Self::default();
        };
        if raw.starts_with('[') {
            return Self::new(serde_json::from_str::<Vec<String>>(raw).unwrap_or_default());
        }
        Self::new([raw.to_string()])
    }
}

impl From<Option<String>> for EpisodeIncidents {
    fn from(id: Option<String>) -> Self {
        Self::new(id)
    }
}

impl Serialize for EpisodeIncidents {
    // The column form, a string or null, which an older node's `Option<String>` decodes.
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_stored().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for EpisodeIncidents {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Stored {
            One(String),
            Many(Vec<String>),
        }
        Ok(match Option::<Stored>::deserialize(deserializer)? {
            None => Self::default(),
            Some(Stored::One(raw)) => Self::from_stored(Some(&raw)),
            Some(Stored::Many(ids)) => Self::new(ids),
        })
    }
}

/// The keys [`AlertState`] carries its episode incidents under on the wire.
#[derive(Default, Serialize, Deserialize)]
struct EpisodeIncidentKeys {
    /// The first id as a plain string, the shape an older node reads.
    #[serde(default)]
    episode_incident_id: Option<String>,
    /// Every id, written only when there is more than one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    episode_incident_ids: Vec<String>,
}

/// What one evaluation knows about delivery, for the episode axis.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EpisodeInput {
    /// A notification for this evaluation actually landed somewhere.
    pub delivered: bool,
    /// Set when the incident path owned that delivery, one id per correlated group.
    pub incident_ids: EpisodeIncidents,
    /// `keep_firing_for` in seconds; 0 recovers on the first clear evaluation.
    pub keep_firing_for_secs: i64,
    /// The key the trigger carried, so the episode stores what PagerDuty saw
    /// rather than a second id it has never been told about.
    pub episode_id: Option<String>,
}

impl EpisodeInput {
    /// This evaluation delivered nothing — every path that is not a successful
    /// send, including a suppressed or failed one.
    pub fn undelivered(keep_firing_for_secs: i64) -> Self {
        Self {
            delivered: false,
            incident_ids: EpisodeIncidents::default(),
            keep_firing_for_secs,
            episode_id: None,
        }
    }
}

/// Separate from [`RecoveryEvent`] because the state row does not know its own `org_id`.
#[derive(Clone, Debug, PartialEq)]
pub struct ClosedEpisode {
    pub episode_id: String,
    pub incident_ids: EpisodeIncidents,
    pub opened_at: i64,
    pub recovered_at: i64,
}

/// `firing` is the RECORDED level's verdict, not the raw match, so a frozen evaluation stays firing
/// and a search outage cannot read as a recovery.
pub fn apply_episode(
    state: &mut AlertState,
    firing: bool,
    input: &EpisodeInput,
    at: i64,
    new_episode_id: impl FnOnce() -> String,
) -> Option<ClosedEpisode> {
    if firing {
        // Same episode, so the resolve still pairs with the trigger that opened it.
        state.recovering_since = None;
        if input.delivered {
            if state.episode_id.is_none() {
                state.episode_id = Some(new_episode_id());
                state.episode_opened_at = Some(at);
            }
            // Every incident a delivery touched keeps its link; an alert-path send hands back.
            state.episode_incident_id = if input.incident_ids.is_empty() {
                EpisodeIncidents::default()
            } else {
                state.episode_incident_id.union(&input.incident_ids)
            };
        }
        return None;
    }

    let Some(episode_id) = state.episode_id.clone() else {
        // Nothing was ever delivered, so there is nothing to recover from.
        state.recovering_since = None;
        return None;
    };

    let recovered_at = *state.recovering_since.get_or_insert(at);
    let hold_micros = input
        .keep_firing_for_secs
        .max(0)
        .saturating_mul(MICROS_PER_SECOND);
    if at < recovered_at.saturating_add(hold_micros) {
        return None;
    }

    let closed = ClosedEpisode {
        episode_id,
        incident_ids: std::mem::take(&mut state.episode_incident_id),
        opened_at: state.episode_opened_at.unwrap_or(recovered_at),
        recovered_at,
    };
    state.episode_id = None;
    state.episode_opened_at = None;
    state.recovering_since = None;
    Some(closed)
}

/// Writes [`AlertState::episode_incident_id`] as the first id plus, for several, the full list.
pub fn serialize_episode_incident_keys<S: serde::Serializer>(
    incidents: &EpisodeIncidents,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let ids = incidents.ids();
    EpisodeIncidentKeys {
        episode_incident_id: ids.first().cloned(),
        episode_incident_ids: if ids.len() > 1 {
            ids.to_vec()
        } else {
            Vec::new()
        },
    }
    .serialize(serializer)
}

/// Reads the list when present, else the single id (an intermediate build's array string too).
pub fn deserialize_episode_incident_keys<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<EpisodeIncidents, D::Error> {
    let keys = EpisodeIncidentKeys::deserialize(deserializer)?;
    if keys.episode_incident_ids.is_empty() {
        return Ok(EpisodeIncidents::from_stored(
            keys.episode_incident_id.as_deref(),
        ));
    }
    Ok(EpisodeIncidents::new(keys.episode_incident_ids))
}

/// Build the outbound event for an episode this evaluation closed.
pub fn recovery_event(
    org_id: &str,
    state: &AlertState,
    closed: ClosedEpisode,
    emitted_at: i64,
) -> RecoveryEvent {
    RecoveryEvent {
        org_id: org_id.to_string(),
        alert_id: state.alert_id.clone(),
        group_key: state.group_key.clone(),
        episode_id: closed.episode_id,
        incident_ids: closed.incident_ids,
        opened_at: closed.opened_at,
        recovered_at: closed.recovered_at,
        emitted_at,
        last_notified_level: state.last_notified_level,
        group_labels: state.group_labels.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> AlertState {
        AlertState::empty("alert_1", "")
    }

    fn delivered() -> EpisodeInput {
        EpisodeInput {
            delivered: true,
            incident_ids: EpisodeIncidents::default(),
            keep_firing_for_secs: 0,
            episode_id: None,
        }
    }

    #[test]
    fn a_suppressed_firing_neither_opens_an_episode_nor_disturbs_one() {
        let mut s = state();
        apply_episode(&mut s, true, &EpisodeInput::undelivered(0), 10, || {
            "ep_1".into()
        });
        assert!(
            s.episode_id.is_none(),
            "nothing was delivered, so nothing paged"
        );
        assert!(
            apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 20, || "x"
                .into())
            .is_none(),
            "there is nothing to recover from"
        );

        // The other half: a suppressed firing must not disturb the episode a
        // delivered one already opened, or the resolve loses its dedup key.
        apply_episode(&mut s, true, &delivered(), 30, || "ep_2".into());
        apply_episode(&mut s, true, &EpisodeInput::undelivered(0), 40, || {
            "ep_3".into()
        });
        assert_eq!(
            s.episode_id.as_deref(),
            Some("ep_2"),
            "a suppressed firing must not mint a second id"
        );
        let closed = apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 50, || {
            "x".into()
        })
        .expect("the delivered episode still recovers");
        assert_eq!(closed.episode_id, "ep_2");
    }

    #[test]
    fn an_episode_recovers_exactly_once_however_often_it_is_evaluated() {
        let mut s = state();
        apply_episode(&mut s, true, &delivered(), 10, || "ep_1".into());
        assert_eq!(s.episode_id.as_deref(), Some("ep_1"));

        let closed = apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 20, || {
            "ep_2".into()
        })
        .expect("the first clear evaluation recovers");
        assert_eq!(closed.episode_id, "ep_1");
        assert_eq!(closed.opened_at, 10);
        assert_eq!(closed.recovered_at, 20);

        // The id is gone, so the question the scheduler asks every tick has
        // nothing left to answer with.
        for at in [30, 40, 50] {
            assert!(
                apply_episode(&mut s, false, &EpisodeInput::undelivered(0), at, || "ep_3"
                    .into())
                .is_none(),
                "a second emit must be impossible, not merely guarded"
            );
        }
    }

    #[test]
    fn keep_firing_for_holds_the_episode_open_and_keeps_the_clear_time() {
        let hold = EpisodeInput {
            delivered: false,
            incident_ids: EpisodeIncidents::default(),
            keep_firing_for_secs: 60,
            episode_id: None,
        };
        let mut s = state();
        apply_episode(&mut s, true, &delivered(), 0, || "ep_1".into());

        assert!(apply_episode(&mut s, false, &hold, 1_000_000, || "x".into()).is_none());
        assert_eq!(s.recovering_since, Some(1_000_000));
        assert!(apply_episode(&mut s, false, &hold, 30_000_000, || "x".into()).is_none());

        let closed = apply_episode(&mut s, false, &hold, 61_000_000, || "x".into())
            .expect("the hold has expired");
        assert_eq!(
            closed.recovered_at, 1_000_000,
            "the hold delays the message, it does not move the recovery"
        );
    }

    #[test]
    fn a_re_fire_during_the_hold_keeps_the_same_episode() {
        let hold = EpisodeInput {
            delivered: false,
            incident_ids: EpisodeIncidents::default(),
            keep_firing_for_secs: 60,
            episode_id: None,
        };
        let mut s = state();
        apply_episode(&mut s, true, &delivered(), 0, || "ep_1".into());
        apply_episode(&mut s, false, &hold, 1_000_000, || "x".into());
        assert_eq!(s.recovering_since, Some(1_000_000));

        apply_episode(
            &mut s,
            true,
            &EpisodeInput::undelivered(60),
            2_000_000,
            || "ep_2".into(),
        );
        assert_eq!(
            s.episode_id.as_deref(),
            Some("ep_1"),
            "same firing, same dedup key"
        );
        assert!(s.recovering_since.is_none(), "it is firing again");
    }

    #[test]
    fn the_incident_that_owned_the_firing_owns_the_recovery() {
        let mut s = state();
        apply_episode(&mut s, true, &EpisodeInput::undelivered(0), 0, || {
            "x".into()
        });
        apply_episode(
            &mut s,
            true,
            &EpisodeInput {
                delivered: true,
                incident_ids: Some("inc_1".to_string()).into(),
                keep_firing_for_secs: 0,
                episode_id: None,
            },
            10,
            || "ep_1".into(),
        );

        let closed = apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 20, || {
            "x".into()
        })
        .expect("recovered");
        assert_eq!(closed.incident_ids.ids(), ["inc_1".to_string()]);
    }

    #[test]
    fn a_new_firing_after_a_recovery_is_a_new_episode() {
        let mut s = state();
        apply_episode(&mut s, true, &delivered(), 0, || "ep_1".into());
        apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 10, || {
            "x".into()
        });
        apply_episode(&mut s, true, &delivered(), 20, || "ep_2".into());
        assert_eq!(s.episode_id.as_deref(), Some("ep_2"));
        assert_eq!(s.episode_opened_at, Some(20));
    }

    #[test]
    fn episode_incidents_read_the_legacy_single_id_and_the_list() {
        let legacy: EpisodeIncidents = serde_json::from_str("\"inc_1\"").unwrap();
        assert_eq!(legacy.ids(), ["inc_1".to_string()]);
        let none: EpisodeIncidents = serde_json::from_str("null").unwrap();
        assert!(none.is_empty());
        let many: EpisodeIncidents = serde_json::from_str("[\"a\",\"b\",\"a\"]").unwrap();
        assert_eq!(many.ids(), ["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn one_episode_incident_serialises_as_the_old_option_string() {
        let one = EpisodeIncidents::new(["inc_1".to_string()]);
        assert_eq!(serde_json::to_string(&one).unwrap(), "\"inc_1\"");
        let old: Option<String> =
            serde_json::from_str(&serde_json::to_string(&one).unwrap()).unwrap();
        assert_eq!(old.as_deref(), Some("inc_1"));
        assert_eq!(
            serde_json::to_string(&EpisodeIncidents::default()).unwrap(),
            "null"
        );
        let many = EpisodeIncidents::new(["a".to_string(), "b".to_string()]);
        let json = serde_json::to_string(&many).unwrap();
        let old: Option<String> = serde_json::from_str(&json).expect("an older node reads a list");
        assert_eq!(old.as_deref(), Some("[\"a\",\"b\"]"));
        assert_eq!(
            serde_json::from_str::<EpisodeIncidents>(&json).unwrap(),
            many
        );
    }

    #[test]
    fn episode_incidents_round_trip_through_the_column() {
        assert_eq!(EpisodeIncidents::default().to_stored(), None);
        let one = EpisodeIncidents::new(["inc_1".to_string()]);
        assert_eq!(one.to_stored().as_deref(), Some("inc_1"));
        assert_eq!(EpisodeIncidents::from_stored(Some("inc_1")), one);
        let many = EpisodeIncidents::new(["a".to_string(), "b".to_string()]);
        assert_eq!(
            EpisodeIncidents::from_stored(many.to_stored().as_deref()),
            many
        );
        assert!(EpisodeIncidents::from_stored(None).is_empty());
        assert!(EpisodeIncidents::from_stored(Some("")).is_empty());
    }

    #[test]
    fn a_recovery_event_keeps_the_incident_id_wire_name() {
        let event = RecoveryEvent {
            org_id: "o".into(),
            alert_id: "a".into(),
            group_key: String::new(),
            episode_id: "ep".into(),
            incident_ids: EpisodeIncidents::new(["inc_1".to_string()]),
            opened_at: 1,
            recovered_at: 2,
            emitted_at: 3,
            last_notified_level: None,
            group_labels: None,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["incident_id"], "inc_1", "an older node reads this key");
        assert!(json.get("incident_ids").is_none());
        let back: RecoveryEvent = serde_json::from_value(json).unwrap();
        assert_eq!(back, event);
    }

    #[test]
    fn an_older_node_reads_a_recovery_event_with_several_incidents() {
        #[derive(Deserialize)]
        struct OldRecoveryEvent {
            episode_id: String,
            incident_id: Option<String>,
        }
        let event = RecoveryEvent {
            org_id: "o".into(),
            alert_id: "a".into(),
            group_key: String::new(),
            episode_id: "ep".into(),
            incident_ids: EpisodeIncidents::new(["inc_1".to_string(), "inc_2".to_string()]),
            opened_at: 1,
            recovered_at: 2,
            emitted_at: 3,
            last_notified_level: None,
            group_labels: None,
        };
        let json = serde_json::to_string(&event).unwrap();
        let old: OldRecoveryEvent = serde_json::from_str(&json).expect("an older node reads it");
        assert_eq!(old.episode_id, "ep");
        assert_eq!(
            old.incident_id.as_deref(),
            Some("inc_1"),
            "it still resolves the first"
        );
        let back: RecoveryEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(back, event, "a new node keeps every id");
    }

    #[test]
    fn an_older_node_reads_the_first_incident_of_an_alert_state() {
        #[derive(Deserialize)]
        struct OldAlertState {
            alert_id: String,
            episode_incident_id: Option<String>,
        }
        let mut s = state();
        s.episode_incident_id = EpisodeIncidents::new(["inc_1".to_string(), "inc_2".to_string()]);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["episode_incident_id"], "inc_1");
        assert_eq!(
            json["episode_incident_ids"],
            serde_json::json!(["inc_1", "inc_2"])
        );
        let old: OldAlertState =
            serde_json::from_value(json.clone()).expect("an older node reads it");
        assert_eq!(old.alert_id, "alert_1");
        assert_eq!(
            old.episode_incident_id.as_deref(),
            Some("inc_1"),
            "it resolves the first"
        );
        let new: AlertState = serde_json::from_value(json).unwrap();
        assert_eq!(new, s, "a new node keeps every id");
    }

    #[test]
    fn alert_state_incident_keys_for_none_one_and_older_shapes() {
        let mut s = state();
        let json = serde_json::to_value(&s).unwrap();
        assert!(json["episode_incident_id"].is_null());
        assert!(json.get("episode_incident_ids").is_none());
        assert_eq!(serde_json::from_value::<AlertState>(json).unwrap(), s);

        s.episode_incident_id = EpisodeIncidents::new(["inc_1".to_string()]);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["episode_incident_id"], "inc_1");
        assert!(
            json.get("episode_incident_ids").is_none(),
            "one id needs no list"
        );
        assert_eq!(serde_json::from_value::<AlertState>(json).unwrap(), s);

        // A row from before the field existed, and the array string an intermediate build wrote.
        let mut legacy = serde_json::to_value(state()).unwrap();
        legacy
            .as_object_mut()
            .unwrap()
            .remove("episode_incident_id");
        assert!(
            serde_json::from_value::<AlertState>(legacy)
                .unwrap()
                .episode_incident_id
                .is_empty()
        );
        let mut intermediate = serde_json::to_value(state()).unwrap();
        intermediate["episode_incident_id"] = serde_json::json!("[\"a\",\"b\"]");
        assert_eq!(
            serde_json::from_value::<AlertState>(intermediate)
                .unwrap()
                .episode_incident_id,
            EpisodeIncidents::new(["a".to_string(), "b".to_string()])
        );
    }

    #[test]
    fn deliveries_with_different_incidents_accumulate_over_the_episode() {
        let with = |ids: &[&str]| EpisodeInput {
            delivered: true,
            incident_ids: EpisodeIncidents::new(ids.iter().map(|id| id.to_string())),
            keep_firing_for_secs: 0,
            episode_id: None,
        };
        let mut s = state();
        apply_episode(&mut s, true, &with(&["inc_A", "inc_B"]), 10, || {
            "ep_1".into()
        });
        apply_episode(&mut s, true, &with(&["inc_B"]), 20, || "x".into());
        apply_episode(&mut s, true, &with(&["inc_C", "inc_A"]), 30, || "x".into());
        let closed = apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 40, || {
            "x".into()
        })
        .expect("recovered");
        assert_eq!(
            closed.incident_ids.ids(),
            [
                "inc_A".to_string(),
                "inc_B".to_string(),
                "inc_C".to_string()
            ]
        );
        assert!(
            s.episode_incident_id.is_empty(),
            "cleared when the episode closes"
        );
    }

    #[test]
    fn an_alert_path_delivery_hands_the_episode_back() {
        let mut s = state();
        apply_episode(
            &mut s,
            true,
            &EpisodeInput {
                delivered: true,
                incident_ids: EpisodeIncidents::new(["inc_A".to_string()]),
                keep_firing_for_secs: 0,
                episode_id: None,
            },
            10,
            || "ep_1".into(),
        );
        apply_episode(&mut s, true, &delivered(), 20, || "x".into());
        assert!(s.episode_incident_id.is_empty());
    }

    #[test]
    fn a_recovery_event_written_before_the_list_still_decodes() {
        let json = r#"{"org_id":"o","alert_id":"a","group_key":"","episode_id":"ep","incident_id":"inc_1","opened_at":1,"recovered_at":2,"emitted_at":3,"last_notified_level":null,"group_labels":null}"#;
        let event: RecoveryEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.incident_ids.ids(), ["inc_1".to_string()]);
    }

    #[test]
    fn every_incident_that_owned_the_firing_owns_the_recovery() {
        let mut s = state();
        apply_episode(
            &mut s,
            true,
            &EpisodeInput {
                delivered: true,
                incident_ids: EpisodeIncidents::new(["inc_1".to_string(), "inc_2".to_string()]),
                keep_firing_for_secs: 0,
                episode_id: None,
            },
            10,
            || "ep_1".into(),
        );
        let closed = apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 20, || {
            "x".into()
        })
        .expect("recovered");
        assert_eq!(
            closed.incident_ids.ids(),
            ["inc_1".to_string(), "inc_2".to_string()]
        );
        assert!(s.episode_incident_id.is_empty());
    }
}
