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

//! `/query/insights` — the query-detail fan-out over plans and server metrics.

use super::{super::models::*, *};

/// The query-insights endpoint's whole body, as a callable — the two-section fan-out
/// (plans + server metrics) with its shared `(auth, schema)` prologue, kept out of
/// the handler so the handler is a config guard plus a delegation.
pub(crate) async fn read_query_insights_response(
    org_id: &str,
    user_id: &str,
    q: &QueryInsightsQuery,
) -> HttpResponse {
    let org = org_id;
    let user = user_id;
    // Validated ONCE, up front: a missing fingerprint is a malformed request
    // for both sections, so it stays a 400 rather than becoming two nulls the
    // page would render as "nothing captured".
    if q.fingerprint.as_deref().filter(|f| !f.is_empty()).is_none() {
        return MetaHttpResponse::bad_request("fingerprint is required");
    }

    let plans_q = PlansQuery {
        fingerprint: q.fingerprint.clone(),
        stream: q.stream.clone(),
        start_time: q.start_time,
        end_time: q.end_time,
    };
    let metrics_q = ServerMetricsQuery {
        fingerprint: q.fingerprint.clone(),
        engine: q.engine.clone(),
        database: q.database.clone(),
        stream: q.stream.clone(),
        start_time: q.start_time,
        end_time: q.end_time,
    };

    // One (auth, schema) prologue for both sections — the same sharing the
    // badges fan-out does, and for the same reason: they read the SAME default
    // stream. `None` merely declines to share; each section then computes its
    // own and owns its own denial/error, byte-identically to the standalone
    // endpoints. An explicit `?stream=` is not the prologue's stream, so
    // `read_*_body` ignores the share and re-authorizes.
    let prologue = server_prologue(org, user).await;
    let prologue = prologue.as_ref();

    // No join key, no request.
    let wants_metrics = has_server_metrics_join_key(q.engine.as_deref(), q.database.as_deref());

    let (plans, server_metrics) =
        tokio::join!(read_plans_body(org, user, &plans_q, prologue), async {
            if !wants_metrics {
                return None;
            }
            Some(read_server_metrics_body(org, user, &metrics_q, prologue).await)
        },);

    // A denial on BOTH sections is a denial of the request: returning 200 with
    // two nulls would let the page render "nothing captured" over a permission
    // problem. One section failing is a section flag — the other still answers.
    let plans_forbidden = plans.as_ref().err().is_some_and(is_forbidden);
    let metrics_forbidden = server_metrics
        .as_ref()
        .and_then(|r| r.as_ref().err())
        .is_some_and(is_forbidden);
    if plans_forbidden && (metrics_forbidden || !wants_metrics) {
        return unauthorized_response();
    }

    let (plans_section, plans_read_failed) = match plans {
        Ok(body) => (body, false),
        Err(_) => (Value::Null, true),
    };
    let (metrics_section, metrics_read_failed) = match server_metrics {
        // Not asked for: `null` with the flag FALSE. "We did not look" and "we
        // looked and could not read" are different sentences, and the page
        // renders different copy for each.
        None => (Value::Null, false),
        Some(Ok(body)) => (body, false),
        Some(Err(_)) => (Value::Null, true),
    };

    MetaHttpResponse::json(json!({
        "plans": plans_section,
        "plans_read_failed": plans_read_failed,
        "server_metrics": metrics_section,
        "server_metrics_read_failed": metrics_read_failed,
    }))
}

#[cfg(test)]
mod tests {
    use super::{super::testutil::*, *};

    /// The merged endpoint's contract: two nullable sections, each with its own
    /// read-failed flag, from the SAME callables the standalone endpoints use
    /// (so a section cannot drift from the endpoint it supersedes), and a 403
    /// only when every section the caller asked for was denied.
    #[test]
    fn test_query_insights_folds_two_nullable_sections() {
        let src = dbm_prod_source();
        // Handler + delegated body: the fan-out, the prologue and the section
        // flags are all in the body half now, while the handler half is the
        // config guard that reaches it. The property is about the ENDPOINT.
        let handler = endpoint_impl("get_dbm_query_insights", "read_query_insights_response");
        let handler = handler.as_str();
        assert!(
            handler.len() > 800 && handler.contains("tokio::join!"),
            "scraped the wrong function — get_dbm_query_insights must be found and non-trivial"
        );

        // Same callables, not a re-derivation.
        assert!(handler.contains("read_plans_body("));
        assert!(handler.contains("read_server_metrics_body("));
        // Concurrent, like every other fan-out in this file.
        assert!(handler.contains("tokio::join!"));
        // One prologue for the pair — the whole point of merging two reads of
        // the same stream.
        assert!(handler.contains("server_prologue("));
        // Per-section failure, never a whole-request failure.
        for flag in ["plans_read_failed", "server_metrics_read_failed"] {
            assert!(handler.contains(flag), "missing section flag {flag}");
        }
        // A 403 survives as a 403 rather than becoming "nothing captured".
        assert!(handler.contains("unauthorized_response()"));
        // Both superseded routes stay registered for compatibility.
        assert!(src.contains("pub async fn get_dbm_query_plans("));
        assert!(src.contains("pub async fn get_dbm_query_server_metrics("));
    }

    /// A missing fingerprint is malformed for BOTH sections, so it must stay a
    /// 400 rather than degrading into two nulls the page reads as "nothing
    /// captured".
    #[test]
    fn test_query_insights_rejects_a_missing_fingerprint_up_front() {
        // Unused: this test scrapes `endpoint_impl` below, not the whole corpus.
        // Kept (bound to `_`) so the test's body is untouched by the file split.
        let _src = dbm_prod_source();
        // Handler + delegated body: the fan-out, the prologue and the section
        // flags are all in the body half now, while the handler half is the
        // config guard that reaches it. The property is about the ENDPOINT.
        let handler = endpoint_impl("get_dbm_query_insights", "read_query_insights_response");
        let handler = handler.as_str();
        let reject = handler
            .find("fingerprint is required")
            .expect("insights must reject a missing fingerprint");
        let join = handler
            .find("tokio::join!")
            .expect("insights must fan out to both sections");
        assert!(
            reject < join,
            "the fingerprint check must precede the fan-out, or a malformed \
             request runs two searches before failing"
        );
    }
}
