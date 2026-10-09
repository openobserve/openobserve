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
    rule_results(result, at, config::get_config().limit.alert_max_groups)
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

fn rule_results(result: PromValue, at: i64, cap: usize) -> anyhow::Result<TriggerEvalResults> {
    let PromValue::Vector(series) = result else {
        return Err(anyhow::anyhow!(
            "PromQL rule expression must return an instant vector"
        ));
    };
    let rows: Vec<Map<String, Value>> = series
        .into_iter()
        .map(|series| {
            let mut row: Map<String, Value> = series
                .labels
                .iter()
                .map(|l| (l.name.to_string(), Value::String(l.value.to_string())))
                .collect();
            let value = match series.sample.value {
                v if v.is_nan() => "NaN".to_string(),
                v if v == f64::INFINITY => "+Inf".to_string(),
                v if v == f64::NEG_INFINITY => "-Inf".to_string(),
                v => v.to_string(),
            };
            row.insert("_timestamp".into(), at.into());
            row.insert("value".into(), value.into());
            row
        })
        .collect();
    let observations = rows
        .iter()
        .map(|row| {
            GroupObservation::new(
                config::meta::alerts::dispatch::promql_series_labels(row),
                0.0,
            )
        })
        .collect();
    let mut classification = classify_groups_by(observations, |_| Some(AlertLevel::Critical), cap);
    for group in &mut classification.groups {
        group.rule_value = rows
            .iter()
            .find(|row| config::meta::alerts::dispatch::promql_series_labels(row) == group.labels)
            .and_then(|row| row.get("value").and_then(Value::as_str))
            .map(str::to_string);
    }
    if matches!(
        classification.cap,
        config::meta::alerts::grouping::GroupCapOutcome::Exceeded { .. }
    ) {
        return Err(anyhow::anyhow!(
            "Incomplete PromQL rule evaluation: returned series exceed alert_max_groups"
        ));
    }
    let level = (!rows.is_empty()).then_some(AlertLevel::Critical);
    let first = classification.groups.first();
    let rule_value = first.and_then(|g| g.rule_value.clone());
    let group_label = first.map(|g| config::meta::alerts::grouping::render_labels(&g.labels));
    Ok(TriggerEvalResults {
        end_time: at,
        level,
        data: level.map(|_| rows),
        rule_value,
        group_label,
        group_classification: Some(classification),
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
    fn rule_empty_and_incomplete_results_are_distinct() {
        let result = rule_results(vector(&[]), 600, 1).unwrap();
        assert!(result.data.is_none());
        assert!(result.group_classification.unwrap().groups.is_empty());
        assert!(rule_results(vector(&[1.0, 2.0]), 600, 1).is_err());
        assert!(rule_results(PromValue::Float(1.0), 600, 1).is_err());
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
}
