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

//! What a downtime covers today, forecast from definitions; pure over preloaded items.

use std::collections::{HashMap, HashSet};

use config::meta::downtimes::{
    DimensionCondition, DowntimeTarget, PreviewMatch, PreviewResponse, TargetFolders, TargetModule,
};
use o2_enterprise::enterprise::downtimes::scope::{self, TargetItem};

/// Preview lists are capped at this many names per module; totals count them all.
pub const PREVIEW_CAP: usize = 50;

/// One alert, anomaly detection, check or SLO, as the forecast sees it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Item {
    pub id: String,
    pub name: String,
    /// Public folder id.
    pub folder_id: String,
    pub dims: HashMap<String, String>,
    pub tags: Vec<String>,
    /// SLOs only: the dimensions of what the SLO measures, without its tags (D9).
    pub measured: HashMap<String, String>,
    /// SLOs only: `"query"` or `"source_alert"`.
    pub measured_by: &'static str,
}

impl Item {
    fn view(&self) -> TargetItem<'_> {
        TargetItem {
            id: &self.id,
            folder_id: &self.folder_id,
            dimensions: &self.dims,
            tags: &self.tags,
        }
    }

    fn preview(&self) -> PreviewMatch {
        PreviewMatch {
            id: self.id.clone(),
            name: self.name.clone(),
            folder_id: self.folder_id.clone(),
            matched_by: None,
            missing: None,
        }
    }
}

/// Every item of an org that a downtime can cover, per module.
#[derive(Clone, Debug, Default)]
pub struct Inventory {
    pub alerts: Vec<Item>,
    pub anomalies: Vec<Item>,
    pub synthetics: Vec<Item>,
    pub slos: Vec<Item>,
}

impl Inventory {
    pub fn items(&self, module: TargetModule) -> &[Item] {
        match module {
            TargetModule::Alerts => &self.alerts,
            TargetModule::AnomalyDetections => &self.anomalies,
            TargetModule::Synthetics => &self.synthetics,
            TargetModule::Slos => &self.slos,
        }
    }

    pub fn find(&self, module: TargetModule, id: &str) -> Option<&Item> {
        self.items(module).iter().find(|item| item.id == id)
    }
}

/// What one target matches in its module.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ModuleMatch {
    pub matched: Vec<PreviewMatch>,
    /// Alerts whose definition names no dimension: decided when they fire (section 7.6).
    pub at_fire_time: Vec<PreviewMatch>,
    /// Items whose identity lacks a key the condition tests inside an `Or` group (D16).
    pub undecidable: Vec<PreviewMatch>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Matches {
    pub alerts: ModuleMatch,
    pub anomalies: ModuleMatch,
    pub synthetics: ModuleMatch,
    pub slos: ModuleMatch,
}

impl Matches {
    pub fn module(&self, module: TargetModule) -> &ModuleMatch {
        match module {
            TargetModule::Alerts => &self.alerts,
            TargetModule::AnomalyDetections => &self.anomalies,
            TargetModule::Synthetics => &self.synthetics,
            TargetModule::Slos => &self.slos,
        }
    }
}

/// The folders a user may list, per folder type; `None` means every folder.
#[derive(Clone, Debug, Default)]
pub struct Visibility {
    pub alert_folders: Option<HashSet<String>>,
    pub synthetics_folders: Option<HashSet<String>>,
}

impl Visibility {
    pub fn sees(&self, module: TargetModule, folder_id: &str) -> bool {
        let folders = match module {
            TargetModule::Synthetics => &self.synthetics_folders,
            _ => &self.alert_folders,
        };
        folders.as_ref().is_none_or(|f| f.contains(folder_id))
    }
}

pub fn match_all(
    inventory: &Inventory,
    condition: Option<&DimensionCondition>,
    targets: &[DowntimeTarget],
) -> Matches {
    let run = |module| {
        scope::target_for(targets, module)
            .map(|target| match_module(target, condition, inventory.items(module)))
            .unwrap_or_default()
    };
    Matches {
        alerts: run(TargetModule::Alerts),
        anomalies: run(TargetModule::AnomalyDetections),
        synthetics: run(TargetModule::Synthetics),
        slos: run(TargetModule::Slos),
    }
}

pub fn match_module(
    target: &DowntimeTarget,
    condition: Option<&DimensionCondition>,
    items: &[Item],
) -> ModuleMatch {
    let condition = condition.filter(|_| target.module.has_identity());
    let mut out = ModuleMatch::default();
    for item in items {
        if !scope::matches(target, None, &item.view()) {
            continue;
        }
        let Some(cond) = condition else {
            out.matched.push(matched(target, None, item));
            continue;
        };
        if target.module == TargetModule::Alerts && item.dims.is_empty() {
            out.at_fire_time.push(item.preview());
        } else if scope::eval_condition(cond, &item.dims) {
            out.matched.push(matched(target, Some(cond), item));
        } else if let Some(key) = scope::undecidable_key(cond, &item.dims) {
            out.undecidable.push(PreviewMatch {
                missing: Some(key),
                ..item.preview()
            });
        }
    }
    out
}

/// The preview a user sees: names filtered to what the user may list, capped, totals complete.
pub fn to_preview(matches: &Matches, visibility: &Visibility) -> PreviewResponse {
    let visible = |module: TargetModule, list: &[PreviewMatch], cap: usize| -> Vec<PreviewMatch> {
        list.iter()
            .filter(|m| visibility.sees(module, &m.folder_id))
            .take(cap)
            .cloned()
            .collect()
    };
    let mut undecidable = HashMap::new();
    for (key, module) in [
        ("alerts", TargetModule::Alerts),
        ("anomalies", TargetModule::AnomalyDetections),
        ("slos", TargetModule::Slos),
    ] {
        let list = visible(module, &matches.module(module).undecidable, PREVIEW_CAP);
        if !list.is_empty() {
            undecidable.insert(key.to_string(), list);
        }
    }
    PreviewResponse {
        alerts: visible(TargetModule::Alerts, &matches.alerts.matched, PREVIEW_CAP),
        resolved_at_fire_time: visible(
            TargetModule::Alerts,
            &matches.alerts.at_fire_time,
            PREVIEW_CAP,
        ),
        anomalies: visible(
            TargetModule::AnomalyDetections,
            &matches.anomalies.matched,
            PREVIEW_CAP,
        ),
        synthetics: visible(
            TargetModule::Synthetics,
            &matches.synthetics.matched,
            PREVIEW_CAP,
        ),
        slos: visible(TargetModule::Slos, &matches.slos.matched, PREVIEW_CAP),
        alerts_total: matches.alerts.matched.len(),
        anomalies_total: matches.anomalies.matched.len(),
        synthetics_total: matches.synthetics.matched.len(),
        slos_total: matches.slos.matched.len(),
        undecidable,
    }
}

fn matched(
    target: &DowntimeTarget,
    condition: Option<&DimensionCondition>,
    item: &Item,
) -> PreviewMatch {
    PreviewMatch {
        matched_by: (target.module == TargetModule::Slos)
            .then(|| slo_matched_by(target, condition, item).to_string()),
        ..item.preview()
    }
}

/// Why an SLO is in the list, so the form can say it.
fn slo_matched_by(
    target: &DowntimeTarget,
    condition: Option<&DimensionCondition>,
    item: &Item,
) -> &'static str {
    if !target.ids.is_empty() {
        return "id";
    }
    match (condition, &target.folders) {
        (Some(cond), _) if scope::eval_condition(cond, &item.measured) => item.measured_by,
        (Some(_), _) => "tag",
        (None, TargetFolders::Some { .. }) => "folder",
        (None, TargetFolders::All) => "org",
    }
}

#[cfg(test)]
mod tests {
    use config::meta::downtimes::{LogicalOp, PairOperator};

    use super::*;

    fn dims(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn item(id: &str, folder: &str, pairs: &[(&str, &str)]) -> Item {
        Item {
            id: id.to_string(),
            name: format!("{id}-name"),
            folder_id: folder.to_string(),
            dims: dims(pairs),
            ..Default::default()
        }
    }

    fn eq(key: &str, value: &str) -> DimensionCondition {
        DimensionCondition::Pair {
            key: key.to_string(),
            operator: PairOperator::Eq,
            value: value.to_string(),
        }
    }

    fn target(module: TargetModule) -> DowntimeTarget {
        DowntimeTarget {
            module,
            folders: TargetFolders::All,
            tags: vec![],
            ids: vec![],
            slo_mode: None,
        }
    }

    fn ids(list: &[PreviewMatch]) -> Vec<&str> {
        list.iter().map(|m| m.id.as_str()).collect()
    }

    #[test]
    fn alerts_without_dimensions_resolve_at_fire_time() {
        let items = vec![
            item("a1", "default", &[("service", "payments")]),
            item("a2", "default", &[]),
            item("a3", "default", &[("service", "checkout")]),
        ];
        let got = match_module(
            &target(TargetModule::Alerts),
            Some(&eq("service", "payments")),
            &items,
        );
        assert_eq!(ids(&got.matched), ["a1"]);
        assert_eq!(ids(&got.at_fire_time), ["a2"]);
        assert!(got.undecidable.is_empty());
    }

    #[test]
    fn undecidable_names_the_key_an_alert_cannot_answer() {
        let cond = DimensionCondition::Group {
            op: LogicalOp::And,
            items: vec![
                eq("service", "payments"),
                DimensionCondition::Group {
                    op: LogicalOp::Or,
                    items: vec![eq("host", "db-1"), eq("host", "db-2")],
                },
            ],
        };
        let items = vec![
            item(
                "a1",
                "default",
                &[("service", "payments"), ("host", "db-1")],
            ),
            item("a2", "default", &[("service", "payments")]),
        ];
        let got = match_module(&target(TargetModule::Alerts), Some(&cond), &items);
        assert_eq!(ids(&got.matched), ["a1"]);
        assert_eq!(ids(&got.undecidable), ["a2"]);
        assert_eq!(got.undecidable[0].missing.as_deref(), Some("host"));
    }

    #[test]
    fn a_module_without_a_target_matches_nothing() {
        let inventory = Inventory {
            alerts: vec![item("a1", "default", &[("service", "payments")])],
            ..Default::default()
        };
        let got = match_all(&inventory, None, &[target(TargetModule::Slos)]);
        assert!(got.alerts.matched.is_empty());
    }

    #[test]
    fn synthetics_ignore_the_condition_and_use_tags() {
        let mut check = item("c1", "syn", &[]);
        check.tags = vec!["service:payments".to_string()];
        let mut t = target(TargetModule::Synthetics);
        t.tags = vec!["service:payments".to_string()];
        let got = match_module(&t, Some(&eq("service", "checkout")), &[check]);
        assert_eq!(ids(&got.matched), ["c1"]);
    }

    #[test]
    fn slo_matches_say_why() {
        let mut by_query = item("s1", "default", &[("service", "payments")]);
        by_query.measured = dims(&[("service", "payments")]);
        by_query.measured_by = "query";
        let mut by_tag = item("s2", "default", &[("service", "payments")]);
        by_tag.measured_by = "query";
        let items = vec![by_query, by_tag];

        let got = match_module(
            &target(TargetModule::Slos),
            Some(&eq("service", "payments")),
            &items,
        );
        let why: Vec<_> = got
            .matched
            .iter()
            .map(|m| m.matched_by.as_deref())
            .collect();
        assert_eq!(why, [Some("query"), Some("tag")]);

        let mut by_id = target(TargetModule::Slos);
        by_id.ids = vec!["s1".to_string()];
        assert_eq!(
            match_module(&by_id, None, &items).matched[0]
                .matched_by
                .as_deref(),
            Some("id")
        );
        assert_eq!(
            match_module(&target(TargetModule::Slos), None, &items).matched[0]
                .matched_by
                .as_deref(),
            Some("org")
        );
    }

    #[test]
    fn the_preview_hides_names_the_user_cannot_list_and_keeps_the_totals() {
        let inventory = Inventory {
            alerts: (0..60)
                .map(|i| {
                    let folder = if i % 2 == 0 { "mine" } else { "theirs" };
                    item(&format!("a{i}"), folder, &[])
                })
                .collect(),
            ..Default::default()
        };
        let matches = match_all(&inventory, None, &[target(TargetModule::Alerts)]);
        let visibility = Visibility {
            alert_folders: Some(HashSet::from(["mine".to_string()])),
            synthetics_folders: None,
        };
        let preview = to_preview(&matches, &visibility);
        assert_eq!(preview.alerts_total, 60);
        assert_eq!(preview.alerts.len(), 30);
        assert!(preview.alerts.iter().all(|m| m.folder_id == "mine"));

        let everyone = to_preview(&matches, &Visibility::default());
        assert_eq!(everyone.alerts.len(), PREVIEW_CAP);
        assert_eq!(everyone.slos_total, 0);
    }
}
