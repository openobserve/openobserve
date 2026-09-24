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

//! Whether an item is inside an active downtime now, and which windows correct an SLO.

use std::collections::HashMap;

use config::meta::{
    downtimes::{ActiveDowntime, CorrectionRef, CorrectionWindow},
    slo::Slo,
};

/// Whether the org has an uncancelled downtime targeting `module`; else skip identity work.
#[cfg(feature = "enterprise")]
pub fn any_for(org: &str, module: config::meta::downtimes::TargetModule) -> bool {
    o2_enterprise::enterprise::common::config::get_config()
        .downtimes
        .enabled
        && enterprise::any_live_target(&db::downtimes::list_cached(org), module)
}

#[cfg(not(feature = "enterprise"))]
pub fn any_for(_org: &str, _module: config::meta::downtimes::TargetModule) -> bool {
    false
}

#[cfg(feature = "enterprise")]
pub fn active_for_alert(
    org: &str,
    alert_id: &str,
    folder_id: &str,
    dims: &HashMap<String, String>,
    now: i64,
) -> Option<ActiveDowntime> {
    let item = enterprise::item(alert_id, folder_id, dims, &[]);
    enterprise::active_in(
        &db::downtimes::list_cached(org),
        config::meta::downtimes::TargetModule::Alerts,
        &item,
        now,
    )
}

#[cfg(not(feature = "enterprise"))]
pub fn active_for_alert(
    _org: &str,
    _alert_id: &str,
    _folder_id: &str,
    _dims: &HashMap<String, String>,
    _now: i64,
) -> Option<ActiveDowntime> {
    None
}

#[cfg(feature = "enterprise")]
pub fn active_for_synthetic(
    org: &str,
    check_id: &str,
    folder_id: &str,
    tags: &[String],
    now: i64,
) -> Option<ActiveDowntime> {
    let no_identity = HashMap::new();
    let item = enterprise::item(check_id, folder_id, &no_identity, tags);
    enterprise::active_in(
        &db::downtimes::list_cached(org),
        config::meta::downtimes::TargetModule::Synthetics,
        &item,
        now,
    )
}

#[cfg(not(feature = "enterprise"))]
pub fn active_for_synthetic(
    _org: &str,
    _check_id: &str,
    _folder_id: &str,
    _tags: &[String],
    _now: i64,
) -> Option<ActiveDowntime> {
    None
}

#[cfg(feature = "enterprise")]
pub fn active_for_anomaly(
    org: &str,
    anomaly_id: &str,
    folder_id: &str,
    dims: &HashMap<String, String>,
    now: i64,
) -> Option<ActiveDowntime> {
    let item = enterprise::item(anomaly_id, folder_id, dims, &[]);
    enterprise::active_in(
        &db::downtimes::list_cached(org),
        config::meta::downtimes::TargetModule::AnomalyDetections,
        &item,
        now,
    )
}

#[cfg(not(feature = "enterprise"))]
pub fn active_for_anomaly(
    _org: &str,
    _anomaly_id: &str,
    _folder_id: &str,
    _dims: &HashMap<String, String>,
    _now: i64,
) -> Option<ActiveDowntime> {
    None
}

/// The only async part: semantic groups and the source alert both come from in-memory caches.
#[cfg(feature = "enterprise")]
pub async fn dimensions_for_slo(slo: &Slo) -> HashMap<String, String> {
    let groups = db::system_settings::get_semantic_field_groups(&slo.org).await;
    let source = match &slo.definition.sli_config {
        config::meta::slo::SliConfig::Alert { alert_id } => {
            db::alerts::alert::get_alert_from_cache(&slo.org, alert_id).await
        }
        _ => None,
    };
    o2_enterprise::enterprise::downtimes::scope::slo_dimensions(
        slo,
        &groups,
        source.as_ref().map(|(_, alert)| &alert.query_condition),
    )
}

#[cfg(not(feature = "enterprise"))]
pub async fn dimensions_for_slo(_slo: &Slo) -> HashMap<String, String> {
    HashMap::new()
}

/// Windows correcting this SLO in `[from, to)`; a cancelled row counts up to its cancel.
#[cfg(feature = "enterprise")]
pub fn corrections_for_slo(
    slo: &Slo,
    dims: &HashMap<String, String>,
    from: i64,
    to: i64,
) -> Vec<CorrectionWindow> {
    enterprise::corrections_in(&db::downtimes::list_cached(&slo.org), slo, dims, from, to)
}

#[cfg(not(feature = "enterprise"))]
pub fn corrections_for_slo(
    _slo: &Slo,
    _dims: &HashMap<String, String>,
    _from: i64,
    _to: i64,
) -> Vec<CorrectionWindow> {
    Vec::new()
}

/// The active and scheduled downtimes that correct this SLO, for its detail page.
#[cfg(feature = "enterprise")]
pub fn corrections_refs_for_slo(
    slo: &Slo,
    dims: &HashMap<String, String>,
    now: i64,
) -> Vec<CorrectionRef> {
    enterprise::refs_in(&db::downtimes::list_cached(&slo.org), slo, dims, now)
}

#[cfg(not(feature = "enterprise"))]
pub fn corrections_refs_for_slo(
    _slo: &Slo,
    _dims: &HashMap<String, String>,
    _now: i64,
) -> Vec<CorrectionRef> {
    Vec::new()
}

/// Pure over a slice of rows, so the rules are tested without the cache.
#[cfg(feature = "enterprise")]
pub(crate) mod enterprise {
    use std::collections::HashMap;

    use config::meta::{
        downtimes::{
            ActiveDowntime, CorrectionRef, CorrectionWindow, Downtime, DowntimeStatus,
            SloCorrectionMode, TargetModule,
        },
        slo::Slo,
    };
    use o2_enterprise::enterprise::downtimes::{
        schedule,
        scope::{self, TargetItem},
    };

    pub(crate) fn item<'a>(
        id: &'a str,
        folder_id: &'a str,
        dimensions: &'a HashMap<String, String>,
        tags: &'a [String],
    ) -> TargetItem<'a> {
        TargetItem {
            id,
            folder_id,
            dimensions,
            tags,
        }
    }

    pub(crate) fn any_live_target(rows: &[Downtime], module: TargetModule) -> bool {
        rows.iter().any(|row| {
            row.cancelled_at.is_none() && scope::target_for(&row.targets, module).is_some()
        })
    }

    /// The first live row whose window holds `now` and whose target of `module` matches.
    pub(crate) fn active_in(
        rows: &[Downtime],
        module: TargetModule,
        item: &TargetItem<'_>,
        now: i64,
    ) -> Option<ActiveDowntime> {
        rows.iter()
            .filter(|row| row.cancelled_at.is_none())
            .find_map(|row| {
                let window = schedule::window_at(&row.schedule, now)?;
                covers(row, module, item).then(|| ActiveDowntime {
                    id: row.id.clone(),
                    name: row.name.clone(),
                    ends_at: window.end,
                })
            })
    }

    /// `Exclude` windows sort first, so the honest mode wins where two overlap.
    pub(crate) fn corrections_in(
        rows: &[Downtime],
        slo: &Slo,
        dims: &HashMap<String, String>,
        from: i64,
        to: i64,
    ) -> Vec<CorrectionWindow> {
        let item = slo_item(slo, dims);
        let mut windows: Vec<CorrectionWindow> = rows
            .iter()
            .filter_map(|row| {
                let target = scope::target_for(&row.targets, TargetModule::Slos)?;
                scope::matches(target, row.condition.as_ref(), &item).then_some((row, target))
            })
            .flat_map(|(row, target)| {
                let mode = target.slo_mode.unwrap_or_default();
                schedule::windows_between(&row.schedule, row.cancelled_at, from, to)
                    .into_iter()
                    .map(move |w| CorrectionWindow {
                        downtime_id: row.id.clone(),
                        start: w.start,
                        end: w.end,
                        mode,
                    })
            })
            .collect();
        windows.sort_by_key(|w| (w.mode != SloCorrectionMode::Exclude, w.start));
        windows
    }

    pub(crate) fn refs_in(
        rows: &[Downtime],
        slo: &Slo,
        dims: &HashMap<String, String>,
        now: i64,
    ) -> Vec<CorrectionRef> {
        let item = slo_item(slo, dims);
        rows.iter()
            .filter(|row| covers(row, TargetModule::Slos, &item))
            .filter_map(|row| {
                let status = schedule::status(&row.schedule, row.cancelled_at, now);
                matches!(status, DowntimeStatus::Active | DowntimeStatus::Scheduled).then(|| {
                    CorrectionRef {
                        downtime_id: row.id.clone(),
                        name: row.name.clone(),
                        status,
                    }
                })
            })
            .collect()
    }

    fn covers(row: &Downtime, module: TargetModule, item: &TargetItem<'_>) -> bool {
        scope::target_for(&row.targets, module)
            .is_some_and(|target| scope::matches(target, row.condition.as_ref(), item))
    }

    fn slo_item<'a>(slo: &'a Slo, dims: &'a HashMap<String, String>) -> TargetItem<'a> {
        item(&slo.id, &slo.folder_id, dims, &slo.tags)
    }
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use config::meta::{
        downtimes::{
            DimensionCondition, Downtime, DowntimeSchedule, DowntimeTarget, PairOperator, Repeat,
            SloCorrectionMode, TargetFolders, TargetModule,
        },
        slo::{CountSource, SliConfig, SloDefinition},
    };

    use super::{enterprise::*, *};

    const HOUR: i64 = 3_600_000_000;

    fn target(module: TargetModule) -> DowntimeTarget {
        DowntimeTarget {
            module,
            folders: TargetFolders::All,
            tags: vec![],
            ids: vec![],
            slo_mode: None,
        }
    }

    fn row(id: &str, targets: Vec<DowntimeTarget>, start: i64, end: i64) -> Downtime {
        Downtime {
            id: id.to_string(),
            org: "acme".to_string(),
            folder_id: "default".to_string(),
            name: id.to_string(),
            reason: None,
            condition: Some(DimensionCondition::Pair {
                key: "service".to_string(),
                operator: PairOperator::Eq,
                value: "payments".to_string(),
            }),
            targets,
            schedule: DowntimeSchedule {
                repeat: Repeat::None,
                starts_at: start,
                ends_at: Some(end),
                timezone: "UTC".to_string(),
                start_time_local: None,
                duration_secs: (end - start) / 1_000_000,
                weekdays: vec![],
            },
            cancelled_at: None,
            cancelled_by: None,
            show_banner: true,
            created_by: "lin".to_string(),
            created_at: 0,
            updated_by: "lin".to_string(),
            updated_at: 0,
        }
    }

    fn payments() -> HashMap<String, String> {
        HashMap::from([("service".to_string(), "payments".to_string())])
    }

    fn slo() -> Slo {
        Slo {
            id: "slo1".to_string(),
            org: "acme".to_string(),
            folder_id: "default".to_string(),
            name: "checkout".to_string(),
            description: String::new(),
            definition: SloDefinition {
                sli_config: SliConfig::Count {
                    source: CountSource::SingleQuery {
                        stream: "requests".to_string(),
                        stream_type: "logs".to_string(),
                        scope: None,
                        good_expr: "status < 500".to_string(),
                    },
                },
                group_by: None,
                window_secs: 30 * 86_400,
                slice_interval_secs: 300,
            },
            target: 99.9,
            tags: vec![],
            enabled: true,
            owner: None,
            definition_generation: 1,
            groups_estimate: None,
            groups_reserved: 1,
        }
    }

    #[test]
    fn active_in_matches_the_module_target_inside_the_window_only() {
        let rows = vec![row(
            "d1",
            vec![target(TargetModule::Alerts)],
            10 * HOUR,
            12 * HOUR,
        )];
        let dims = payments();
        let alert = item("a1", "default", &dims, &[]);
        let hit = active_in(&rows, TargetModule::Alerts, &alert, 11 * HOUR).unwrap();
        assert_eq!(hit.id, "d1");
        assert_eq!(hit.ends_at, 12 * HOUR);
        assert!(active_in(&rows, TargetModule::Alerts, &alert, 13 * HOUR).is_none());
        assert!(
            active_in(&rows, TargetModule::AnomalyDetections, &alert, 11 * HOUR).is_none(),
            "a row without a target for the module is skipped"
        );
        let other = HashMap::from([("service".to_string(), "checkout".to_string())]);
        assert!(
            active_in(
                &rows,
                TargetModule::Alerts,
                &item("a1", "default", &other, &[]),
                11 * HOUR
            )
            .is_none()
        );
    }

    #[test]
    fn only_an_uncancelled_row_with_a_target_of_the_module_asks_for_the_identity() {
        let alerts = row("d1", vec![target(TargetModule::Alerts)], 0, HOUR);
        let mut cancelled = row("d2", vec![target(TargetModule::Slos)], 0, HOUR);
        cancelled.cancelled_at = Some(1);
        let rows = [alerts, cancelled];
        assert!(any_live_target(&rows, TargetModule::Alerts));
        assert!(!any_live_target(&rows, TargetModule::Slos));
        assert!(!any_live_target(&rows, TargetModule::Synthetics));
        assert!(!any_live_target(&[], TargetModule::Alerts));
    }

    #[test]
    fn active_in_skips_a_cancelled_row() {
        let mut cancelled = row(
            "d1",
            vec![target(TargetModule::Alerts)],
            10 * HOUR,
            12 * HOUR,
        );
        cancelled.cancelled_at = Some(10 * HOUR + 1);
        let dims = payments();
        let alert = item("a1", "default", &dims, &[]);
        assert!(active_in(&[cancelled], TargetModule::Alerts, &alert, 11 * HOUR).is_none());
    }

    #[test]
    fn corrections_ignore_rows_without_an_slos_target_and_rows_that_miss_the_slo() {
        let mut other_service = row("d2", vec![target(TargetModule::Slos)], 0, 2 * HOUR);
        other_service.condition = Some(DimensionCondition::Pair {
            key: "service".to_string(),
            operator: PairOperator::Eq,
            value: "checkout".to_string(),
        });
        let rows = vec![
            row("d1", vec![target(TargetModule::Alerts)], 0, 2 * HOUR),
            other_service,
        ];
        assert!(corrections_in(&rows, &slo(), &payments(), 0, 4 * HOUR).is_empty());
    }

    #[test]
    fn corrections_clip_a_cancelled_row_and_put_exclude_first() {
        let mut cancelled = row("d1", vec![target(TargetModule::Slos)], HOUR, 5 * HOUR);
        cancelled.cancelled_at = Some(3 * HOUR);
        let mut as_good = target(TargetModule::Slos);
        as_good.slo_mode = Some(SloCorrectionMode::CountAsGood);
        let rows = vec![row("d0", vec![as_good], 0, 2 * HOUR), cancelled];

        let got = corrections_in(&rows, &slo(), &payments(), 2 * HOUR - 1, 10 * HOUR);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].downtime_id, "d1");
        assert_eq!(got[0].mode, SloCorrectionMode::Exclude);
        assert_eq!((got[0].start, got[0].end), (2 * HOUR - 1, 3 * HOUR));
        assert_eq!(got[1].downtime_id, "d0");
        assert_eq!(got[1].mode, SloCorrectionMode::CountAsGood);
    }

    #[test]
    fn refs_list_active_and_scheduled_rows_only() {
        let mut cancelled = row("gone", vec![target(TargetModule::Slos)], 0, HOUR);
        cancelled.cancelled_at = Some(1);
        let rows = vec![
            row("active", vec![target(TargetModule::Slos)], 0, 2 * HOUR),
            row(
                "later",
                vec![target(TargetModule::Slos)],
                5 * HOUR,
                6 * HOUR,
            ),
            row("past", vec![target(TargetModule::Slos)], 0, HOUR / 2),
            cancelled,
        ];
        let got: Vec<String> = refs_in(&rows, &slo(), &payments(), HOUR)
            .into_iter()
            .map(|r| r.downtime_id)
            .collect();
        assert_eq!(got, ["active", "later"]);
    }

    #[test]
    fn a_composite_tagged_with_the_service_is_suppressed_by_its_downtime() {
        let rows = vec![row(
            "d1",
            vec![target(TargetModule::Alerts)],
            10 * HOUR,
            12 * HOUR,
        )];
        let tags = ["service:payments".to_string(), "team:core".to_string()];
        let dims = o2_enterprise::enterprise::downtimes::scope::composite_dimensions(&tags);
        let composite = item("c1", "default", &dims, &[]);
        let hit = active_in(&rows, TargetModule::Alerts, &composite, 11 * HOUR);
        assert_eq!(hit.map(|d| d.id).as_deref(), Some("d1"));

        let other = o2_enterprise::enterprise::downtimes::scope::composite_dimensions(&[
            "service:checkout".to_string(),
        ]);
        let unrelated = item("c2", "default", &other, &[]);
        assert!(active_in(&rows, TargetModule::Alerts, &unrelated, 11 * HOUR).is_none());
    }

    #[test]
    fn an_slo_alert_takes_the_identity_of_its_slo_query() {
        let groups = [config::meta::correlation::FieldAlias {
            id: "service".to_string(),
            display: "Service".to_string(),
            group: None,
            fields: vec!["service".to_string(), "service_name".to_string()],
            is_workload_type: false,
        }];
        let mut measured = slo();
        measured.definition.sli_config = SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "requests".to_string(),
                stream_type: "logs".to_string(),
                scope: Some("service_name = 'payments'".to_string()),
                good_expr: "status < 500".to_string(),
            },
        };
        let dims =
            o2_enterprise::enterprise::downtimes::scope::slo_dimensions(&measured, &groups, None);
        assert_eq!(dims.get("service").map(String::as_str), Some("payments"));

        let rows = vec![row(
            "d1",
            vec![target(TargetModule::Alerts)],
            10 * HOUR,
            12 * HOUR,
        )];
        let slo_alert = item("burn-alert", "default", &dims, &[]);
        let hit = active_in(&rows, TargetModule::Alerts, &slo_alert, 11 * HOUR);
        assert_eq!(hit.map(|d| d.id).as_deref(), Some("d1"));
    }

    /// A cancel re-measures the pre-cancel windows, so later slices lose their correction.
    #[test]
    fn a_cancel_re_measures_the_windows_of_the_row_before_the_cancel() {
        let before = row("d1", vec![target(TargetModule::Slos)], HOUR, 5 * HOUR);
        let mut after = before.clone();
        after.cancelled_at = Some(3 * HOUR);

        let after_only = corrections_in(
            std::slice::from_ref(&after),
            &slo(),
            &payments(),
            0,
            10 * HOUR,
        );
        let span_after = crate::slo::corrections::remeasure_span(&after_only, 0, 36_000, 300);
        assert_eq!(span_after, Some((3_600, 10_800)));

        let both = corrections_in(&[before, after], &slo(), &payments(), 0, 10 * HOUR);
        let span = crate::slo::corrections::remeasure_span(&both, 0, 36_000, 300);
        assert_eq!(
            span,
            Some((3_600, 18_000)),
            "the cancelled tail is measured again"
        );
    }
}
