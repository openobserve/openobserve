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

//! Building the bucketed SLI query (`alerts_2.md` §6b.4a).
//!
//! **One** aggregate produces every slice in the pass — never one query per
//! slice. A 3-slice trailing recompute over a grouped SLO is one scan, not
//! three, and backfilling 90 days is one query per chunk rather than 25,920.
//!
//! Kept pure and string-in/string-out so the SQL is testable without a search
//! cluster. The §6b.4a spike established the one fact this depends on:
//! `histogram(_timestamp, '5 minute')` lowers to `date_bin` with origin
//! 2001-01-01 (978,307,200s), and 60 and 300 both divide that exactly — so the
//! buckets agree with [`align_down`](config::meta::slo::window::align_down)'s
//! epoch-based grid. That agreement is a **coincidence of the origin**, not a
//! guarantee, which is why `slo::spike` pins it.

use config::meta::slo::{CountSource, SliConfig, interval_literal};

/// The alias every SLI query projects its numerator/denominator under.
pub const VALUE_ALIAS: &str = "zo_slo_value";
/// The alias carrying the bucket's start time.
pub const SLICE_ALIAS: &str = "slice_start";

/// A query to run, with the time range it covers.
#[derive(Debug, Clone, PartialEq)]
pub struct SliQuery {
    pub sql: String,
    /// Microseconds — what the search API takes.
    pub start_micros: i64,
    pub end_micros: i64,
}

/// A PromQL range evaluation: `expr` sampled every `step_micros` from
/// `start_micros` through `end_micros` inclusive.
#[derive(Debug, Clone, PartialEq)]
pub struct PromQuery {
    pub expr: String,
    pub start_micros: i64,
    pub end_micros: i64,
    pub step_micros: i64,
}

/// What a pass needs to query, which depends on the SLI shape.
#[derive(Debug, Clone, PartialEq)]
pub enum SliQueryPlan {
    /// One scan yields both numerator and denominator.
    Single(SliQuery),
    /// Two scans that must be joined on the key schema. Used only by the
    /// importer fallback for an unfoldable Datadog pair.
    Dual { good: SliQuery, total: SliQuery },
    /// Two PromQL range evaluations, joined at the group grain.
    PromQl { good: PromQuery, total: PromQuery },
    /// Nothing to query — the SLI reads existing state rather than raw data.
    NoQuery,
}

/// Parameters that do not come from the SLO definition.
#[derive(Debug, Clone, Copy)]
pub struct PlanRange {
    pub start_secs: i64,
    pub end_secs: i64,
    pub slice_interval_secs: i64,
}

/// Build the pass's query plan.
pub fn plan(sli: &SliConfig, group_by: &[String], range: PlanRange) -> SliQueryPlan {
    match sli {
        SliConfig::Count { source } => match source {
            CountSource::SingleQuery {
                stream,
                scope,
                good_expr,
                ..
            } => SliQueryPlan::Single(SliQuery {
                sql: single_count_sql(stream, scope.as_deref(), good_expr, group_by, range),
                start_micros: range.start_secs * 1_000_000,
                end_micros: range.end_secs * 1_000_000,
            }),
            CountSource::DualQuery { good, total } => SliQueryPlan::Dual {
                good: SliQuery {
                    sql: good.sql.clone(),
                    start_micros: range.start_secs * 1_000_000,
                    end_micros: range.end_secs * 1_000_000,
                },
                total: SliQuery {
                    sql: total.sql.clone(),
                    start_micros: range.start_secs * 1_000_000,
                    end_micros: range.end_secs * 1_000_000,
                },
            },
            CountSource::PromQl { good, total } => {
                // PromQL evaluates AT instants, and a sample at T with a
                // slice-wide range selector covers (T-interval, T]. So the
                // instants are the slice ENDS: first = start + interval,
                // last = end. Evaluating at slice STARTS would attribute
                // every value to the wrong slice.
                let step_micros = range.slice_interval_secs * 1_000_000;
                let prom = |expr: &str| PromQuery {
                    expr: expr.to_string(),
                    start_micros: (range.start_secs + range.slice_interval_secs) * 1_000_000,
                    end_micros: range.end_secs * 1_000_000,
                    step_micros,
                };
                SliQueryPlan::PromQl {
                    good: prom(good),
                    total: prom(total),
                }
            }
        },
        SliConfig::TimeSlice {
            stream,
            query,
            scope,
            ..
        } => SliQueryPlan::Single(SliQuery {
            sql: time_slice_sql(stream, query, scope.as_deref(), group_by, range),
            start_micros: range.start_secs * 1_000_000,
            end_micros: range.end_secs * 1_000_000,
        }),
        // Reads the `triggers` stream via the coverage path, not raw data.
        SliConfig::Alert { .. } => SliQueryPlan::NoQuery,
    }
}

/// `SELECT histogram(...) AS slice_start, <groups>, SUM(good) , COUNT(*) ...`
///
/// The numerator is `SUM(CASE WHEN <good> THEN 1 ELSE 0 END)` rather than a
/// filtered `COUNT`: a filter would drop the bucket entirely when no row in it
/// is good, and "zero good out of 400" would then be indistinguishable from
/// "no traffic". For a count SLI those mean opposite things.
fn single_count_sql(
    stream: &str,
    scope: Option<&str>,
    good_expr: &str,
    group_by: &[String],
    range: PlanRange,
) -> String {
    let bucket = format!(
        "histogram(_timestamp, '{}')",
        interval_literal(range.slice_interval_secs)
    );
    let mut select = vec![format!("{bucket} AS {SLICE_ALIAS}")];
    select.extend(group_by.iter().map(|g| quote_ident(g)));
    select.push(format!(
        "SUM(CASE WHEN ({good_expr}) THEN 1 ELSE 0 END) AS zo_slo_good"
    ));
    select.push(format!("COUNT(*) AS {VALUE_ALIAS}"));

    let mut group = vec![SLICE_ALIAS.to_string()];
    group.extend(group_by.iter().map(|g| quote_ident(g)));

    let mut sql = format!("SELECT {} FROM {}", select.join(", "), quote_ident(stream));
    if let Some(scope) = scope.filter(|s| !s.trim().is_empty()) {
        // Parenthesised: the user fragment must not re-associate against
        // anything this builder adds later.
        sql.push_str(&format!(" WHERE ({scope})"));
    }
    sql.push_str(&format!(" GROUP BY {}", group.join(", ")));
    sql
}

/// A time-slice SLI aggregates first and classifies afterwards, so the query
/// only produces the per-bucket aggregate — the good/bad decision is applied
/// in Rust against the stored comparator and threshold.
///
/// Classifying in SQL would bake the threshold into the query, and a threshold
/// edit would then silently mean the stored slices and the new definition
/// disagree.
fn time_slice_sql(
    stream: &str,
    aggregate: &str,
    scope: Option<&str>,
    group_by: &[String],
    range: PlanRange,
) -> String {
    let bucket = format!(
        "histogram(_timestamp, '{}')",
        interval_literal(range.slice_interval_secs)
    );
    let mut select = vec![format!("{bucket} AS {SLICE_ALIAS}")];
    select.extend(group_by.iter().map(|g| quote_ident(g)));
    select.push(format!("{aggregate} AS {VALUE_ALIAS}"));

    let mut group = vec![SLICE_ALIAS.to_string()];
    group.extend(group_by.iter().map(|g| quote_ident(g)));

    let mut sql = format!("SELECT {} FROM {}", select.join(", "), quote_ident(stream));
    if let Some(scope) = scope.filter(|s| !s.trim().is_empty()) {
        sql.push_str(&format!(" WHERE ({scope})"));
    }
    sql.push_str(&format!(" GROUP BY {}", group.join(", ")));
    sql
}

/// Quote an identifier, doubling any embedded quote.
///
/// Stream and group-by names reach here from user input. They are validated at
/// save time, but quoting is the layer that does not depend on that validation
/// having been complete.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// The group key for a row, built from the group-by values in definition
/// order.
///
/// Order matters and must come from the definition, not from whatever order
/// the result set happens to present columns in: the key is compared against
/// stored keys, and a reordering would make every group look new.
pub fn group_key(group_by: &[String], values: &[Option<String>]) -> String {
    group_by
        .iter()
        .zip(values)
        .map(|(k, v)| {
            format!(
                "{}={}",
                k,
                v.as_deref()
                    .unwrap_or("")
                    .replace('\\', "\\\\")
                    .replace(',', "\\,")
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::Operator,
        slo::{CountQuery, QueryLanguage},
    };

    use super::*;

    fn range() -> PlanRange {
        PlanRange {
            start_secs: 1_000,
            end_secs: 2_000,
            slice_interval_secs: 300,
        }
    }

    fn count_sli(scope: Option<&str>, good: &str) -> SliConfig {
        SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "requests".into(),
                stream_type: "logs".into(),
                scope: scope.map(str::to_string),
                good_expr: good.into(),
            },
        }
    }

    fn sql_of(plan: SliQueryPlan) -> String {
        match plan {
            SliQueryPlan::Single(q) => q.sql,
            other => panic!("expected a single query, got {other:?}"),
        }
    }

    // ===================== count SLI ======================================

    /// The whole point of §6b.4a: one aggregate for every slice in the pass.
    #[test]
    fn a_count_sli_buckets_by_the_slice_interval() {
        let sql = sql_of(plan(&count_sli(None, "status < 500"), &[], range()));
        assert!(
            sql.contains("histogram(_timestamp, '5 minute') AS slice_start"),
            "{sql}"
        );
        assert!(sql.contains("GROUP BY slice_start"), "{sql}");
    }

    #[test]
    fn a_one_minute_slo_asks_for_one_minute_buckets() {
        let mut r = range();
        r.slice_interval_secs = 60;
        let sql = sql_of(plan(&count_sli(None, "status < 500"), &[], r));
        assert!(sql.contains("'1 minute'"), "{sql}");
    }

    /// A filtered COUNT would drop the bucket entirely when nothing in it is
    /// good, making "zero good out of 400" indistinguishable from "no
    /// traffic". For a count SLI those mean opposite things.
    #[test]
    fn the_numerator_is_a_conditional_sum_not_a_filter() {
        let sql = sql_of(plan(&count_sli(None, "status < 500"), &[], range()));
        assert!(
            sql.contains("SUM(CASE WHEN (status < 500) THEN 1 ELSE 0 END) AS zo_slo_good"),
            "{sql}"
        );
        assert!(sql.contains("COUNT(*) AS zo_slo_value"), "{sql}");
        assert!(
            !sql.contains("WHERE (status < 500)"),
            "the good predicate must not become a filter: {sql}"
        );
    }

    #[test]
    fn a_scope_becomes_a_where_clause() {
        let sql = sql_of(plan(
            &count_sli(Some("service = 'checkout'"), "status < 500"),
            &[],
            range(),
        ));
        assert!(sql.contains("WHERE (service = 'checkout')"), "{sql}");
    }

    /// The user's fragment must not re-associate against anything the builder
    /// adds. `a OR b` unparenthesised next to an appended `AND c` silently
    /// becomes `a OR (b AND c)`.
    #[test]
    fn a_scope_is_parenthesised() {
        let sql = sql_of(plan(
            &count_sli(Some("a = 1 OR b = 2"), "status < 500"),
            &[],
            range(),
        ));
        assert!(sql.contains("WHERE (a = 1 OR b = 2)"), "{sql}");
    }

    #[test]
    fn an_empty_scope_does_not_produce_an_empty_where() {
        for scope in [Some(""), Some("   "), None] {
            let sql = sql_of(plan(&count_sli(scope, "status < 500"), &[], range()));
            assert!(!sql.contains("WHERE"), "{sql}");
        }
    }

    #[test]
    fn group_by_columns_are_projected_and_grouped() {
        let sql = sql_of(plan(
            &count_sli(None, "status < 500"),
            &["region".into(), "tier".into()],
            range(),
        ));
        assert!(sql.contains("\"region\", \"tier\""), "{sql}");
        assert!(
            sql.contains("GROUP BY slice_start, \"region\", \"tier\""),
            "{sql}"
        );
    }

    /// The stream and group-by names reach here from user input. They are
    /// validated at save time; quoting is the layer that does not depend on
    /// that validation having been complete.
    #[test]
    fn identifiers_are_quoted_and_embedded_quotes_doubled() {
        let sli = SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "we\"ird".into(),
                stream_type: "logs".into(),
                scope: None,
                good_expr: "ok".into(),
            },
        };
        let sql = sql_of(plan(&sli, &["a\"b".into()], range()));
        assert!(sql.contains("\"we\"\"ird\""), "{sql}");
        assert!(sql.contains("\"a\"\"b\""), "{sql}");
    }

    #[test]
    fn the_range_is_carried_in_microseconds() {
        let SliQueryPlan::Single(q) = plan(&count_sli(None, "ok"), &[], range()) else {
            panic!("expected single");
        };
        assert_eq!(q.start_micros, 1_000_000_000);
        assert_eq!(q.end_micros, 2_000_000_000);
    }

    // ===================== time-slice SLI =================================

    /// Classifying in SQL would bake the threshold into the query, so a
    /// threshold edit would leave stored slices disagreeing with the
    /// definition. The aggregate is queried; the comparison happens in Rust.
    #[test]
    fn a_time_slice_query_aggregates_but_does_not_classify() {
        let sli = SliConfig::TimeSlice {
            stream: "requests".into(),
            stream_type: "logs".into(),
            query_language: QueryLanguage::Sql,
            query: "approx_percentile_cont(duration_ms, 0.95)".into(),
            scope: None,
            comparator: Operator::LessThan,
            threshold: 300.0,
            absent_is_bad: false,
        };
        let sql = sql_of(plan(&sli, &[], range()));
        assert!(
            sql.contains("approx_percentile_cont(duration_ms, 0.95) AS zo_slo_value"),
            "{sql}"
        );
        assert!(
            !sql.contains("300"),
            "the threshold must not be baked into the query: {sql}"
        );
    }

    // ===================== dual & alert ===================================

    #[test]
    fn a_dual_source_plans_both_queries_over_the_same_range() {
        let sli = SliConfig::Count {
            source: CountSource::DualQuery {
                good: CountQuery {
                    stream: "a".into(),
                    stream_type: "logs".into(),
                    sql: "SELECT 1".into(),
                },
                total: CountQuery {
                    stream: "b".into(),
                    stream_type: "logs".into(),
                    sql: "SELECT 2".into(),
                },
            },
        };
        let SliQueryPlan::Dual { good, total } = plan(&sli, &[], range()) else {
            panic!("expected dual");
        };
        assert_eq!(good.sql, "SELECT 1");
        assert_eq!(total.sql, "SELECT 2");
        assert_eq!(good.start_micros, total.start_micros);
        assert_eq!(good.end_micros, total.end_micros);
    }

    #[test]
    fn an_alert_sli_queries_nothing() {
        let sli = SliConfig::Alert {
            alert_id: "a1".into(),
        };
        assert_eq!(plan(&sli, &[], range()), SliQueryPlan::NoQuery);
    }

    // ===================== group keys =====================================

    #[test]
    fn a_group_key_pairs_names_with_values_in_definition_order() {
        assert_eq!(
            group_key(
                &["region".into(), "tier".into()],
                &[Some("eu".into()), Some("gold".into())]
            ),
            "region=eu,tier=gold"
        );
    }

    /// The key is compared against stored keys. If order came from the result
    /// set rather than the definition, a column reordering would make every
    /// group look new — and every SLO would silently restart.
    #[test]
    fn group_key_order_follows_the_definition_not_the_values() {
        let a = group_key(
            &["region".into(), "tier".into()],
            &[Some("eu".into()), Some("gold".into())],
        );
        let b = group_key(
            &["tier".into(), "region".into()],
            &[Some("gold".into()), Some("eu".into())],
        );
        assert_ne!(a, b);
    }

    #[test]
    fn an_ungrouped_slo_has_the_empty_group_key() {
        assert_eq!(group_key(&[], &[]), "");
    }

    #[test]
    fn a_null_group_value_becomes_an_empty_string_not_a_dropped_column() {
        assert_eq!(
            group_key(
                &["region".into(), "tier".into()],
                &[None, Some("gold".into())]
            ),
            "region=,tier=gold"
        );
    }

    /// Without escaping, a value containing the separator would collide with
    /// a different group — `region=a,b` and `region=a` + `b=` are distinct
    /// groups that must not share a key.
    #[test]
    fn separators_inside_a_value_are_escaped() {
        assert_eq!(
            group_key(&["region".into()], &[Some("a,b".into())]),
            "region=a\\,b"
        );
        assert_eq!(
            group_key(&["region".into()], &[Some("a\\b".into())]),
            "region=a\\\\b"
        );
    }

    #[test]
    fn escaping_keeps_distinct_values_distinct() {
        let a = group_key(
            &["r".into(), "t".into()],
            &[Some("x,y".into()), Some("z".into())],
        );
        let b = group_key(
            &["r".into(), "t".into()],
            &[Some("x".into()), Some("y,z".into())],
        );
        assert_ne!(a, b, "two distinct groups collided on one key");
    }
}

/// Plan tests for the PromQL count source. Written before the variant exists.
#[cfg(test)]
mod promql_plan_tests {
    use config::meta::slo::{CountSource, SliConfig};

    use super::*;

    fn promql_sli() -> SliConfig {
        SliConfig::Count {
            source: CountSource::PromQl {
                good: "increase(hits[5m]) - increase(errs[5m])".into(),
                total: "increase(hits[5m])".into(),
            },
        }
    }

    fn aligned_range() -> PlanRange {
        PlanRange {
            start_secs: 1_200,
            end_secs: 2_100,
            slice_interval_secs: 300,
        }
    }

    #[test]
    fn a_promql_source_plans_two_range_queries() {
        let SliQueryPlan::PromQl { good, total } = plan(&promql_sli(), &[], aligned_range()) else {
            panic!("expected a promql plan");
        };
        assert_eq!(good.expr, "increase(hits[5m]) - increase(errs[5m])");
        assert_eq!(total.expr, "increase(hits[5m])");
        assert_eq!(good.step_micros, 300 * 1_000_000);
        assert_eq!(
            (good.start_micros, good.end_micros),
            (total.start_micros, total.end_micros),
            "the two scans must cover identical instants or the join drops rows"
        );
    }

    /// PromQL evaluates AT instants, and a sample at T with a slice-wide
    /// range selector covers (T-interval, T]. So the instants are the slice
    /// ENDS: first = range.start + interval, last = range.end. Evaluating at
    /// slice STARTS instead would attribute every value to the wrong slice.
    #[test]
    fn evaluation_instants_are_slice_ends() {
        let SliQueryPlan::PromQl { good, .. } = plan(&promql_sli(), &[], aligned_range()) else {
            panic!("expected a promql plan");
        };
        assert_eq!(good.start_micros, 1_500 * 1_000_000);
        assert_eq!(good.end_micros, 2_100 * 1_000_000);
    }
}
