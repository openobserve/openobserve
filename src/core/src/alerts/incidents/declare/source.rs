// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use config::meta::alerts::{
    incident_fields::strip_time_predicates,
    incidents::{ContextKind, ContextSource, ContextTarget},
};
use sha2::{Digest, Sha256};
use sqlparser::{ast::Statement, dialect::PostgreSqlDialect, parser::Parser};

use super::{DeclareError, DeclareRuntime, capture::filter_sql};
use crate::authz::{QuerySource, resolve_query_sources};

const MAX_QUERY_BYTES: usize = 8 * 1024;

pub(super) async fn prepare(
    org: &str,
    user: &str,
    mut source: ContextSource,
    runtime: &impl DeclareRuntime,
) -> Result<ContextSource, DeclareError> {
    if source.title.trim().is_empty()
        || source.title.chars().count() > 256
        || source.target.start_us < 0
        || source.target.end_us <= source.target.start_us
    {
        return Err(DeclareError::bad("Invalid context title or time window"));
    }
    let (queries, canonical) = queries(org, &source.target, source.kind)?;
    runtime.authorize(user, &queries).await?;
    let resolved = resolve_query_sources(&queries);
    if !resolved.unparseable.is_empty() {
        return Err(DeclareError::bad(
            "Could not resolve the context query sources",
        ));
    }
    if source.target.filter.is_none() {
        let source_query = queries
            .first()
            .map(std::slice::from_ref)
            .unwrap_or_default();
        source.target.streams = resolve_query_sources(source_query)
            .streams
            .into_iter()
            .map(|stream| stream.name)
            .collect();
        source.target.streams.sort();
        source.target.streams.dedup();
    }
    source.target.fingerprint = canonical.map(|query| sha256(&query));
    if let Some(link) = source.origin.chat_link.as_deref()
        && !url::Url::parse(link).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
    {
        source.origin.chat_link = None;
    }
    Ok(source)
}

pub(super) async fn readable(
    org: &str,
    user: &str,
    target: &str,
    kind: &str,
    runtime: &impl DeclareRuntime,
) -> bool {
    let Ok(target) = serde_json::from_str(target) else {
        return false;
    };
    let Ok(kind) = serde_json::from_value(serde_json::Value::String(kind.to_owned())) else {
        return false;
    };
    let Ok((queries, _)) = queries(org, &target, kind) else {
        return false;
    };
    resolve_query_sources(&queries).unparseable.is_empty()
        && runtime.authorize(user, &queries).await.is_ok()
}

pub(super) fn sha256(input: &str) -> String {
    format!("{:x}", Sha256::digest(input.as_bytes()))
}

pub(in crate::alerts::incidents) fn queries(
    org: &str,
    target: &ContextTarget,
    kind: ContextKind,
) -> Result<(Vec<QuerySource>, Option<String>), DeclareError> {
    let invalid = || DeclareError::bad("Provide one SQL, PromQL or filter query");
    let full_query_len = [
        target.sql.as_deref(),
        target.promql.as_deref(),
        target.filter.as_deref(),
        target.function.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::len)
    .sum::<usize>();
    if full_query_len > MAX_QUERY_BYTES {
        return Err(DeclareError::bad("Context query exceeds 8 KiB"));
    }
    let sql = |sql: String| QuerySource::Sql {
        org_id: org.to_owned(),
        sql,
        default_type: target.stream_type(),
    };
    let (query, mut canonical) = match (
        target.sql.as_deref(),
        target.promql.as_deref(),
        target.filter.as_deref(),
    ) {
        (Some(text), None, None) => (sql(text.to_owned()), canonical_sql(text)?),
        (None, Some(text), None) => {
            let parsed = promql::parse(text).map_err(|_| DeclareError::bad("Invalid PromQL"))?;
            (
                QuerySource::PromQl {
                    org_id: org.to_owned(),
                    query: text.to_owned(),
                },
                parsed.to_string(),
            )
        }
        (None, None, Some(text)) => {
            let query = filter_sql(&target.streams, text).map_err(DeclareError::BadRequest)?;
            let canonical = canonical_sql(&query)?;
            (sql(query), canonical)
        }
        (None, None, None) if kind == ContextKind::Page && target.function.is_none() => {
            return Ok((Vec::new(), None));
        }
        _ => return Err(invalid()),
    };
    let mut sources = vec![query];
    if let Some(function) = &target.function {
        if target.sql.is_none() {
            return Err(DeclareError::bad("A context function requires SQL"));
        }
        let function =
            config::utils::base64::decode_url(function).unwrap_or_else(|_| function.clone());
        canonical.push_str("\nfunction=");
        canonical.push_str(&function);
        sources.push(QuerySource::Vrl {
            org_id: org.to_owned(),
            source: function,
        });
    }
    Ok((
        sources,
        Some(format!("{}\n{canonical}", target.stream_type())),
    ))
}

fn canonical_sql(input: &str) -> Result<String, DeclareError> {
    let input = config::utils::query_select_utils::replace_o2_custom_patterns(input)
        .unwrap_or_else(|_| input.to_owned());
    let mut statements = Parser::parse_sql(&PostgreSqlDialect {}, &input)
        .map_err(|_| DeclareError::bad("Invalid context SQL"))?;
    let [Statement::Query(query)] = statements.as_mut_slice() else {
        return Err(DeclareError::bad("Context SQL must be one query"));
    };
    strip_time_predicates(query);
    query.limit_clause = None;
    Ok(query.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declare_canonicalizes_legacy_promql_and_preserves_the_query() {
        let query = "holt_winters(requests_total[5m],0.5,0.3)";
        let target = serde_json::from_value(serde_json::json!({
            "signal": "metrics",
            "promql": query,
            "start_us": 1,
            "end_us": 2,
        }))
        .unwrap();
        let (sources, canonical) = queries("org", &target, ContextKind::Metrics).unwrap();
        assert_eq!(
            canonical.as_deref(),
            Some("metrics\nholt_winters(requests_total[5m], 0.5, 0.3)")
        );
        assert!(matches!(
            sources.as_slice(),
            [QuerySource::PromQl { query: executed, .. }] if executed == query
        ));
    }
}
