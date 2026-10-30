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

//! The auto-investigate decision log route; the log itself lives in `_meta`.

use axum::{
    extract::{Path, Query},
    response::Response,
};
use config::{
    meta::alerts::auto_investigate::{DecisionsQuery, DecisionsResponse},
    utils::time::now_micros,
};
use openobserve_core::alerts::auto_investigate_decisions::{
    self as decisions, DecisionFilter, DecisionSource, ListError, MetaStream,
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// ListAutoInvestigateDecisions
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/auto_investigate/decisions",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListAutoInvestigateDecisions",
    summary = "List the org's auto-investigate decisions",
    description = "Lists the auto-investigate gate's decisions for this org's alerts, newest first, skips included, with the figures and settings each decision used. Reads this region's log only. An org with no decisions yet gets an empty list.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        DecisionsQuery,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DecisionsResponse),
        (status = 400, description = "Invalid filter", content_type = "application/json", body = ()),
        (status = 500, description = "The log could not be read", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"}))
    )
)]
pub async fn list_auto_investigate_decisions(
    Path(org_id): Path<String>,
    Query(query): Query<DecisionsQuery>,
) -> Response {
    respond(&org_id, &query, &MetaStream, now_micros()).await
}

async fn respond(
    org_id: &str,
    query: &DecisionsQuery,
    source: &dyn DecisionSource,
    now: i64,
) -> Response {
    let filter = match DecisionFilter::from_query(query, now) {
        Ok(f) => f,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    match decisions::list(org_id, &filter, source).await {
        Ok(decisions) => MetaHttpResponse::json(DecisionsResponse { decisions }),
        Err(ListError::BadRequest(e)) => MetaHttpResponse::bad_request(e),
        Err(ListError::Search(e)) => {
            log::error!("[AUTO_INVESTIGATE] reading the decision log for {org_id} failed: {e}");
            MetaHttpResponse::internal_error(format!("Failed to read the decision log: {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use config::meta::alerts::auto_investigate::{BudgetCheck, DecisionRow, ReasonCode};
    use openobserve_core::alerts::auto_investigate_decisions::test_support::{
        SeededDecisions, decision_row,
    };

    use super::*;

    const NOW: i64 = 2_000_000_000_000_000;

    async fn call(
        org: &str,
        query: DecisionsQuery,
        seeded: &SeededDecisions,
    ) -> (StatusCode, Vec<DecisionRow>) {
        let resp = respond(org, &query, seeded, NOW).await;
        let status = resp.status();
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        if status != StatusCode::OK {
            return (status, vec![]);
        }
        let parsed: DecisionsResponse = serde_json::from_slice(&body).unwrap();
        (status, parsed.decisions)
    }

    fn seeded() -> SeededDecisions {
        let mut rows = Vec::new();
        for i in 0..1_200 {
            rows.push(decision_row(
                "acme",
                "a1",
                "g1",
                NOW - 10_000 - i,
                BudgetCheck::Allowed,
            ));
        }
        rows.push(decision_row(
            "acme",
            "a2",
            "g2",
            NOW - 5_000,
            BudgetCheck::TurnLimit,
        ));
        rows.push(decision_row(
            "acme",
            "a2",
            "g3",
            NOW - 4_000,
            BudgetCheck::Allowed,
        ));
        rows.push(decision_row(
            "other",
            "a2",
            "g2",
            NOW - 3_000,
            BudgetCheck::TurnLimit,
        ));
        SeededDecisions(rows)
    }

    #[tokio::test]
    async fn the_route_returns_only_the_path_orgs_rows_with_its_filters_and_limit() {
        let log = seeded();

        let (status, rows) = call("acme", DecisionsQuery::default(), &log).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(rows.len(), 100, "the default limit");
        assert_eq!(rows[0].timestamp, NOW - 4_000, "newest first");
        assert!(rows.windows(2).all(|w| w[0].timestamp >= w[1].timestamp));
        assert!(rows.iter().all(|r| r.org_id == "acme"));

        let (_, rows) = call(
            "acme",
            DecisionsQuery {
                limit: Some(5_000),
                ..Default::default()
            },
            &log,
        )
        .await;
        assert_eq!(rows.len(), 1_000, "the limit is capped");

        let (_, rows) = call("other", DecisionsQuery::default(), &log).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].org_id, "other");

        let by_group = DecisionsQuery {
            alert_id: Some("a2".to_string()),
            group_key: Some("g2".to_string()),
            ..Default::default()
        };
        let (_, rows) = call("acme", by_group, &log).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].alert_id.as_str(), rows[0].group_key.as_str()),
            ("a2", "g2")
        );

        let budget = DecisionsQuery {
            reason: Some("budget".to_string()),
            ..Default::default()
        };
        let (_, rows) = call("acme", budget, &log).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].reason, ReasonCode::Budget);
        assert_eq!(rows[0].budget_check, Some(BudgetCheck::TurnLimit));

        let window = DecisionsQuery {
            start_time: Some(NOW - 4_500),
            end_time: Some(NOW),
            ..Default::default()
        };
        let (_, rows) = call("acme", window, &log).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].group_key, "g3");

        let (_, rows) = call("nobody", DecisionsQuery::default(), &log).await;
        assert!(rows.is_empty());
        let (status, rows) =
            call("acme", DecisionsQuery::default(), &SeededDecisions(vec![])).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "an absent stream is an empty list, not a 500"
        );
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn a_filter_that_could_leave_a_sql_literal_is_a_400() {
        let log = seeded();
        for q in [
            DecisionsQuery {
                alert_id: Some("a1' OR '1'='1".to_string()),
                ..Default::default()
            },
            DecisionsQuery {
                group_key: Some("g\\'".to_string()),
                ..Default::default()
            },
            DecisionsQuery {
                reason: Some("nope".to_string()),
                ..Default::default()
            },
        ] {
            assert_eq!(call("acme", q, &log).await.0, StatusCode::BAD_REQUEST);
        }
        assert_eq!(
            call("ac'me", DecisionsQuery::default(), &log).await.0,
            StatusCode::BAD_REQUEST
        );
    }
}
