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
        alerts::{
            QueryCondition, TriggerEvalResults,
            grouping::{GroupObservation, classify_groups_by},
            level::AlertLevel,
        },
        promql::value::Value as PromValue,
        search::{SearchEventContext, SearchEventType},
    },
    utils::json::{Map, Value},
};

pub(super) async fn evaluate(
    condition: &QueryCondition,
    org: &str,
    at: i64,
    trace_id: &str,
    context: Option<SearchEventContext>,
) -> anyhow::Result<TriggerEvalResults> {
    let query = condition
        .promql
        .as_ref()
        .filter(|q| !q.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("PromQL rule expression is required"))?;
    let req = promql_service::MetricsQueryRequest {
        query: query.clone(),
        start: at,
        end: at,
        step: ::promql::micros(::promql::MINIMAL_INTERVAL),
        query_exemplars: false,
        use_cache: Some(false),
        search_type: Some(SearchEventType::Alerts),
        regions: vec![],
        clusters: vec![],
        search_event_context: context,
    };
    #[cfg(not(feature = "enterprise"))]
    let super_cluster = false;
    #[cfg(feature = "enterprise")]
    let super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    let result =
        promql_service::search::search_rule(trace_id, org, &req, "", 0, super_cluster).await?;
    rule_results(
        result,
        at,
        config::get_config().limit.alert_max_groups,
        condition.promql_multi_alert,
    )
}

pub(super) async fn infer_stream(org: &str, query: &QueryCondition) -> anyhow::Result<String> {
    let names = referenced_streams(query.promql.as_deref().unwrap_or_default())?;
    for name in names {
        let schema =
            infra::schema::get(org, &name, config::meta::stream::StreamType::Metrics).await?;
        if !schema.fields().is_empty() {
            return Ok(name);
        }
    }
    Err(anyhow::anyhow!(
        "expression has no referenced existing metrics stream; supply stream_name"
    ))
}

fn rule_results(
    result: PromValue,
    at: i64,
    cap: usize,
    multi_alert: bool,
) -> anyhow::Result<TriggerEvalResults> {
    let PromValue::Vector(series) = result else {
        return Err(anyhow::anyhow!(
            "PromQL rule expression must return an instant vector"
        ));
    };
    let mut rows = Vec::with_capacity(series.len());
    let mut rule_series_rows = std::collections::HashMap::with_capacity(series.len());
    let mut raw_values = std::collections::HashMap::with_capacity(series.len());
    let mut observations = Vec::with_capacity(series.len());
    for series in series {
        let labels: std::collections::BTreeMap<String, String> = series
            .labels
            .iter()
            .map(|l| (l.name.to_string(), l.value.to_string()))
            .collect();
        let key = config::meta::alerts::grouping::group_key(&labels);
        let mut row: Map<String, Value> = labels
            .iter()
            .map(|(k, v)| (k.clone(), v.clone().into()))
            .collect();
        let value = match series.sample.value {
            v if v.is_nan() => "NaN".to_string(),
            v if v == f64::INFINITY => "+Inf".to_string(),
            v if v == f64::NEG_INFINITY => "-Inf".to_string(),
            v => v.to_string(),
        };
        raw_values.insert(key.clone(), value.clone());
        observations.push(GroupObservation::new(labels, 0.0));
        row.insert("_timestamp".into(), at.into());
        row.insert("value".into(), value.into());
        rule_series_rows.insert(key, row.clone());
        rows.push(row);
    }
    let level = (!rows.is_empty()).then_some(AlertLevel::Critical);
    let mut rule_value = rows
        .first()
        .and_then(|r| r.get("value"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut group_label = observations
        .first()
        .map(|g| config::meta::alerts::grouping::render_labels(&g.labels));
    let group_classification = if multi_alert {
        let mut classification =
            classify_groups_by(observations, |_| Some(AlertLevel::Critical), cap);
        for group in &mut classification.groups {
            group.rule_value = raw_values
                .get(&config::meta::alerts::grouping::group_key(&group.labels))
                .cloned();
        }
        if matches!(
            classification.cap,
            config::meta::alerts::grouping::GroupCapOutcome::Exceeded { .. }
        ) {
            return Err(anyhow::anyhow!(
                "Incomplete PromQL rule evaluation: returned series exceed alert_max_groups"
            ));
        }
        let first = classification.groups.first();
        rule_value = first.and_then(|g| g.rule_value.clone());
        group_label = first.map(|g| config::meta::alerts::grouping::render_labels(&g.labels));
        Some(classification)
    } else {
        None
    };
    Ok(TriggerEvalResults {
        end_time: at,
        level,
        data: level.map(|_| rows),
        rule_value,
        rule_series_rows: multi_alert.then_some(rule_series_rows),
        group_label,
        group_classification,
        ..Default::default()
    })
}

fn referenced_streams(expression: &str) -> anyhow::Result<Vec<String>> {
    let ast = promql_parser::parser::parse(expression).map_err(|e| anyhow::anyhow!(e))?;
    let mut visitor = ::promql::ast::name_visitor::MetricNameVisitor::new();
    ::promql::ast::visitor::walk_expr(&mut visitor, &ast).map_err(|e| anyhow::anyhow!(e))?;
    let mut names: Vec<_> = visitor.into_names().into_iter().collect();
    names.sort();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::{InstantValue, Label, Sample};

    use super::*;

    fn vector(values: &[f64]) -> PromValue {
        PromValue::Vector(
            values
                .iter()
                .enumerate()
                .map(|(i, &v)| InstantValue {
                    labels: vec![std::sync::Arc::new(Label::new(
                        "host".to_string(),
                        format!("{i}"),
                    ))],
                    sample: Sample::new(0, v),
                })
                .collect(),
        )
    }

    #[test]
    fn rule_series_presence_matches_and_preserves_special_values() {
        let results = rule_results(
            vector(&[0.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY]),
            600,
            10,
            true,
        )
        .unwrap();
        let rows = results.data.unwrap();
        assert_eq!(
            rows.iter()
                .map(|r| r["value"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["0", "NaN", "+Inf", "-Inf"]
        );
        let c = results.group_classification.unwrap();
        assert_eq!(c.firing_observed, 4);
        assert!(
            c.groups
                .iter()
                .all(|g| g.level == Some(AlertLevel::Critical) && g.rule_value.is_some())
        );
        let json = serde_json::to_value(&rows).unwrap();
        assert_eq!(json[2]["value"], "+Inf");
    }

    #[test]
    fn single_rule_matches_any_series_without_group_state_or_group_cap() {
        use config::meta::{
            alerts::{prom_rule::apply_rule_rollup_outcome, state::ROLLUP_GROUP_KEY},
            self_reporting::usage::RunOutcome,
        };
        let first = rule_results(vector(&[f64::NAN, f64::INFINITY]), 600, 1, false).unwrap();
        assert!(first.group_classification.is_none());
        assert!(first.rule_series_rows.is_none());
        assert_eq!(first.data.as_ref().unwrap().len(), 2);
        let initial = apply_rule_rollup_outcome(
            "single-rule",
            None,
            RunOutcome::Firing,
            first.level,
            600,
            first.rule_value.as_deref(),
        );
        let previous = initial.state.unwrap();
        assert_eq!(previous.group_key, ROLLUP_GROUP_KEY);
        assert_eq!(
            initial.transition.unwrap().rule_value.as_deref(),
            Some("NaN")
        );

        let changed = rule_results(
            PromValue::Vector(vec![InstantValue {
                labels: vec![std::sync::Arc::new(Label::new("host", "new-host"))],
                sample: Sample::new(0, f64::NEG_INFINITY),
            }]),
            660,
            1,
            false,
        )
        .unwrap();
        let still_firing = apply_rule_rollup_outcome(
            "single-rule",
            Some(&previous),
            RunOutcome::Firing,
            changed.level,
            660,
            changed.rule_value.as_deref(),
        );
        assert!(still_firing.transition.is_none());
        assert_eq!(still_firing.state.as_ref().unwrap().since, previous.since);
        assert_eq!(changed.data.unwrap()[0]["value"], "-Inf");

        let errored = apply_rule_rollup_outcome(
            "single-rule",
            still_firing.state.as_ref(),
            RunOutcome::Error,
            None,
            720,
            None,
        );
        assert_eq!(
            errored.state.as_ref().unwrap().level,
            Some(AlertLevel::Critical)
        );
        let empty = rule_results(vector(&[]), 780, 1, false).unwrap();
        assert!(empty.data.is_none());
        let recovered = apply_rule_rollup_outcome(
            "single-rule",
            errored.state.as_ref(),
            RunOutcome::Normal,
            Some(AlertLevel::Ok),
            780,
            empty.rule_value.as_deref(),
        );
        let transition = recovered.transition.unwrap();
        assert_eq!(transition.to_outcome, RunOutcome::Normal);
        assert!(transition.rule_value.is_none());
    }

    #[test]
    fn rule_empty_and_incomplete_results_are_distinct() {
        let result = rule_results(vector(&[]), 600, 1, true).unwrap();
        assert!(result.data.is_none());
        assert!(result.group_classification.unwrap().groups.is_empty());
        assert!(rule_results(vector(&[1.0, 2.0]), 600, 1, true).is_err());
        assert!(rule_results(PromValue::Float(1.0), 600, 1, true).is_err());
    }

    #[test]
    fn stream_inference_uses_sorted_ast_references_only() {
        assert_eq!(
            referenced_streams("sum(rate(z[5m])) + a").unwrap(),
            ["a", "z"]
        );
        assert_eq!(referenced_streams(r#"{__name__="foo"}"#).unwrap(), ["foo"]);
        assert!(referenced_streams("vector(1)").unwrap().is_empty());
        assert!(referenced_streams(r#"{__name__=~"foo.*"}"#).is_err());
    }
    #[tokio::test]
    async fn rule_inference_chooses_existing_referenced_metrics_and_never_an_unrelated_stream() {
        use arrow_schema::{DataType, Field, Schema};
        use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache};
        let org = "rule-inference-test";
        let key = |name: &str| format!("{org}/metrics/{name}");
        {
            let mut cache = STREAM_SCHEMAS_LATEST.write().await;
            cache.insert(key("a"), SchemaCache::new(Schema::empty()));
            cache.insert(
                key("z"),
                SchemaCache::new(Schema::new(vec![Field::new(
                    "value",
                    DataType::Float64,
                    false,
                )])),
            );
            cache.insert(
                key("unrelated"),
                SchemaCache::new(Schema::new(vec![Field::new(
                    "value",
                    DataType::Float64,
                    false,
                )])),
            );
        }
        let mut query = QueryCondition {
            promql: Some("z + a".into()),
            ..Default::default()
        };
        assert_eq!(infer_stream(org, &query).await.unwrap(), "z");
        query.promql = Some("a".into());
        assert!(infer_stream(org, &query).await.is_err());
        query.promql = Some("vector(1)".into());
        assert!(infer_stream(org, &query).await.is_err());
        let mut cache = STREAM_SCHEMAS_LATEST.write().await;
        for name in ["a", "z", "unrelated"] {
            cache.remove(&key(name));
        }
    }
    #[test]
    fn rule_dispatch_keeps_legal_reserved_output_labels_as_distinct_identities() {
        use config::meta::alerts::{
            TriggerCondition,
            dispatch::plan_dispatch,
            grouping::{group_key, group_template_vars},
            prom_rule::plan_rule_updates,
        };
        for label in ["value", "_timestamp"] {
            let result = rule_results(
                PromValue::Vector(
                    [("a", f64::NAN), ("b", f64::INFINITY)]
                        .into_iter()
                        .map(|(value, sample)| InstantValue {
                            labels: vec![std::sync::Arc::new(Label::new(label, value))],
                            sample: Sample::new(0, sample),
                        })
                        .collect(),
                ),
                600,
                10,
                true,
            )
            .unwrap();
            let classification = result.group_classification.unwrap();
            assert_eq!(classification.groups.len(), 2);
            let payloads = result.rule_series_rows.unwrap();
            assert_eq!(payloads.len(), 2);
            let plan = plan_rule_updates(
                "rule",
                &classification,
                &std::collections::HashMap::new(),
                600,
                0,
            );
            let states: std::collections::HashMap<_, _> = plan
                .updates
                .into_iter()
                .filter_map(|u| u.state)
                .map(|s| (s.group_key.clone(), s))
                .collect();
            let dispatch = plan_dispatch(
                &classification,
                &states,
                &payloads,
                &TriggerCondition::default(),
                600,
                0,
            );
            assert!(dispatch.inconsistent.is_empty());
            assert_eq!(dispatch.items.len(), 2);
            for item in dispatch.items {
                assert_eq!(item.group_key, group_key(&item.labels));
                let expected = if item.labels[label] == "a" {
                    "NaN"
                } else {
                    "+Inf"
                };
                assert_eq!(item.row["value"], expected);
                assert!(
                    group_template_vars(&item.labels)
                        .contains(&(format!("group.{label}"), item.labels[label].clone()))
                );
                assert!(
                    states[&item.group_key]
                        .group_labels
                        .as_deref()
                        .unwrap()
                        .contains(label)
                );
            }
        }
    }
}
