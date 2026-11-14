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

use config::{
    meta::{
        promql::DownsamplingRule,
        stream::{FileKey, PartitionTimeLevel, StreamParams, StreamType},
    },
    utils::time::day_micros,
};
use o2_enterprise::enterprise::common::downsampling::get_matching_downsampling_rules;
use search::merge::MergeMode;

use super::{MergeRule, RoundPlan};
use crate::merge::job::job_range_end;

pub(super) const READS_WHOLE_WINDOW: bool = true;

pub(super) fn select(
    stream: &StreamParams,
    offset: i64,
    partition_level: PartitionTimeLevel,
    is_incremental: bool,
    now: i64,
) -> Option<(PartitionTimeLevel, MergeRule)> {
    if is_incremental || stream.stream_type != StreamType::Metrics {
        return None;
    }
    let rules = get_matching_downsampling_rules(&stream.stream_name);
    select_from_rules(
        stream.stream_type,
        offset,
        partition_level,
        is_incremental,
        now,
        &rules,
    )
}

pub(super) fn plan(files: Vec<FileKey>, rule: &DownsamplingRule) -> RoundPlan {
    RoundPlan::new(vec![(files, MergeMode::Downsampling(rule.clone()))])
}

fn select_from_rules(
    stream_type: StreamType,
    offset: i64,
    partition_level: PartitionTimeLevel,
    is_incremental: bool,
    now: i64,
    rules: &[&DownsamplingRule],
) -> Option<(PartitionTimeLevel, MergeRule)> {
    if is_incremental || stream_type != StreamType::Metrics {
        return None;
    }
    if offset % day_micros(1) == 0 {
        if let Some(rule) = rule_at(rules, now, job_range_end(offset, PartitionTimeLevel::Daily)) {
            return Some((
                PartitionTimeLevel::Daily,
                MergeRule::Downsampling(rule.clone()),
            ));
        }
        if partition_level == PartitionTimeLevel::Daily {
            return None;
        }
    }
    rule_at(rules, now, job_range_end(offset, partition_level))
        .map(|rule| (partition_level, MergeRule::Downsampling(rule.clone())))
}

fn rule_at<'a>(
    rules: &[&'a DownsamplingRule],
    now: i64,
    range_end: i64,
) -> Option<&'a DownsamplingRule> {
    rules
        .iter()
        .copied()
        .find(|rule| now - rule.offset * 1_000_000 > range_end)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::{
        meta::{promql::Function, stream::MergeStrategy},
        utils::time::hour_micros,
    };

    use super::{
        super::{MergePolicy, MergeWindow, is_incremental, tests::*},
        *,
    };

    #[tokio::test]
    async fn test_resolve_downsampling_scope_and_priority() {
        let schema = indexed_schema();
        let older = DownsamplingRule {
            rule: None,
            function: Function::Avg,
            offset: 36 * 3600,
            step: 300,
        };
        let newer = DownsamplingRule {
            offset: 12 * 3600,
            step: 60,
            ..older.clone()
        };
        let zero_age = DownsamplingRule {
            offset: 0,
            ..newer.clone()
        };
        let hourly = PartitionTimeLevel::Hourly;
        let daily = PartitionTimeLevel::Daily;
        let now = day() + day_micros(2);
        for (label, offset, level, now, rules, end, step) in [
            (
                "midnight day",
                day(),
                hourly,
                now,
                vec![&older, &newer],
                "23",
                Some(60),
            ),
            (
                "midnight hour fallback",
                day(),
                hourly,
                now,
                vec![&older],
                "00",
                Some(300),
            ),
            (
                "other hour",
                day() + hour_micros(5),
                hourly,
                now,
                vec![&older, &newer],
                "05",
                Some(300),
            ),
            (
                "daily job",
                day() + hour_micros(5),
                daily,
                now,
                vec![&older, &newer],
                "23",
                Some(60),
            ),
            (
                "daily without rule",
                day(),
                daily,
                now,
                vec![&older],
                "23",
                None,
            ),
            (
                "open hour",
                day(),
                hourly,
                day() + hour_micros(1) + 10,
                vec![&zero_age],
                "00",
                None,
            ),
            ("no rule", day(), hourly, now, Vec::new(), "00", None),
        ] {
            let stream = StreamParams::new("default", "cpu", StreamType::Metrics);
            let incremental = is_incremental(job_range_end(offset, level), now, 10);
            let (read_level, rule) =
                select_from_rules(stream.stream_type, offset, level, incremental, now, &rules)
                    .unwrap_or_else(|| {
                        (level, MergeRule::for_stream(&stream, &schema, incremental))
                    });
            let policy = MergePolicy {
                window: MergeWindow::new(&stream, offset, level, read_level, incremental),
                rule,
            };
            assert_eq!(
                policy.window().date_end,
                format!("2026/08/18/{end}"),
                "{label}"
            );
            assert_eq!(
                policy.window().job_end,
                job_range_end(offset, level),
                "{label}"
            );
            assert_eq!(policy.window().merges_by_day, level == daily, "{label}");
            match (&policy.rule, step) {
                (MergeRule::Downsampling(rule), Some(step)) => {
                    assert_eq!(rule.step, step, "{label}")
                }
                (MergeRule::MetricsOpenHour | MergeRule::MetricsClosedHour, None) => {}
                (rule, expected) => panic!("{label}: {rule:?}, expected step {expected:?}"),
            }
            if step.is_some() {
                let files = vec![
                    metrics_file("legacy.parquet", 300),
                    hash_file("hash-sorted-v1-a.parquet", 100),
                ];
                let plan = policy
                    .plan(
                        files.clone(),
                        &limits(&MergeStrategy::FileTime, 0, false),
                        &Arc::new(schema.clone()),
                    )
                    .await;
                assert!(policy.reads_whole_window());
                assert!(!plan.needs_another_round);
                assert_eq!(plan.batches.len(), 1);
                assert_eq!(names(&plan.batches[0].0), names(&files));
                assert!(matches!(plan.batches[0].1, MergeMode::Downsampling(_)));
            }
        }
        let stream = StreamParams::new("default", "cpu", StreamType::Logs);
        assert!(
            select_from_rules(stream.stream_type, day(), hourly, false, now, &[&newer]).is_none()
        );
        let (read_level, rule) = MergeRule::select(&stream, &schema, day(), hourly, false, now);
        let policy = MergePolicy {
            window: MergeWindow::new(&stream, day(), hourly, read_level, false),
            rule,
        };
        assert_eq!(policy.window().date_end, "2026/08/18/00");
        assert!(matches!(
            policy.rule,
            MergeRule::SizeBounded(MergeMode::Classic)
        ));
    }

    #[test]
    fn test_resolve_downsampling_age_boundary_is_strict() {
        let schema = indexed_schema();
        let rule = DownsamplingRule {
            rule: None,
            function: Function::Avg,
            offset: 3600,
            step: 60,
        };
        let stream = StreamParams::new("default", "cpu", StreamType::Metrics);
        let hourly = PartitionTimeLevel::Hourly;
        let offset = day() + hour_micros(5);
        let end = job_range_end(offset, hourly);
        for delta in [-1, 0, 1] {
            let now = end + hour_micros(1) + delta;
            let incremental = is_incremental(end, now, 10);
            let (read_level, rule) = select_from_rules(
                stream.stream_type,
                offset,
                hourly,
                incremental,
                now,
                &[&rule],
            )
            .unwrap_or_else(|| (hourly, MergeRule::for_stream(&stream, &schema, incremental)));
            let policy = MergePolicy {
                window: MergeWindow::new(&stream, offset, hourly, read_level, incremental),
                rule,
            };
            assert_eq!(matches!(policy.rule, MergeRule::Downsampling(_)), delta > 0);
            assert!(!policy.window().is_incremental);
        }
    }
}
