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

//! `/badges` — the badge strip's fan-out over the six slice bodies.

use super::{super::models::*, *};

/// The six slice outcomes plus the two conditionally-run fallbacks, ready to
/// fold. A struct rather than parameters so the envelope fold is a callable
/// the tests drive with real member fixtures.
pub(crate) struct BadgeSliceResults {
    pub databases: Result<Value, HttpResponse>,
    pub queries: Result<Value, HttpResponse>,
    pub activity: Result<Value, HttpResponse>,
    pub deadlocks: Result<Value, HttpResponse>,
    pub blocking: Result<Value, HttpResponse>,
    pub table_health: Result<Value, HttpResponse>,
    /// `None` when the fallback condition did not fire — the member is then
    /// ABSENT from the envelope, which is distinct from "fired and failed"
    /// (present as null). The reader must be able to tell "not needed" from
    /// "unknown".
    pub server_queries: Option<Result<Value, HttpResponse>>,
    pub server_samples: Option<Result<Value, HttpResponse>>,
}

impl BadgeSliceResults {
    /// Whether every slice was DENIED — the only case the whole request 403s.
    /// A mix of denials and other failures still answers with the members
    /// that could: each badge owns its own failure.
    pub(crate) fn all_forbidden(&self) -> bool {
        let forbidden = |r: &Result<Value, HttpResponse>| matches!(r, Err(resp) if resp.status() == axum::http::StatusCode::FORBIDDEN);
        let all =
            forbidden(&self.databases) && forbidden(&self.queries) && forbidden(&self.activity);
        // On OSS `deadlocks`, `blocking` and `table_health` are ALWAYS
        // `Err(403)` — they are Enterprise capabilities — so consulting them
        // here would make a whole-request 403 strictly easier to reach, turning
        // a partial-member 200 into a blanket denial. Only members that can
        // actually succeed are consulted. A `let` rebinding rather than
        // `#[cfg]` on a `return`, which trips `clippy::needless_return`.
        #[cfg(feature = "enterprise")]
        let all = all
            && forbidden(&self.deadlocks)
            && forbidden(&self.blocking)
            && forbidden(&self.table_health);
        all
    }

    /// Fold into the response envelope: each member is its endpoint's own
    /// body on success and `null` on any failure — mirroring the frontend's
    /// "null is a failed read, never 0" discipline, so a dead slice blanks
    /// its badges instead of claiming zero.
    pub(crate) fn into_envelope(self) -> Value {
        fn member(r: Result<Value, HttpResponse>) -> Value {
            r.unwrap_or(Value::Null)
        }
        let mut body = json!({
            "databases": member(self.databases),
            "queries": member(self.queries),
            "activity": member(self.activity),
            "deadlocks": member(self.deadlocks),
            "blocking": member(self.blocking),
            "table_health": member(self.table_health),
        });
        let extra = body.as_object_mut().expect("body is an object");
        if let Some(r) = self.server_queries {
            extra.insert("server_queries".into(), member(r));
        }
        if let Some(r) = self.server_samples {
            extra.insert("server_samples".into(), member(r));
        }
        body
    }
}

/// Whether the client-vantage databases slice summed EXACTLY zero finished
/// calls — the condition that arms the `server_samples` fallback. Same
/// unknown-is-not-zero rule as [`queries_slice_reports_zero`]. The sum is the
/// same fold the tab strip performs over these rows (a row without `calls`
/// contributes 0), so the fallback fires exactly where the badge would have
/// read 0.
pub(crate) fn databases_slice_reports_zero_calls(databases: &Result<Value, HttpResponse>) -> bool {
    match databases {
        Ok(body) => match body.get("hits").and_then(Value::as_array) {
            Some(hits) => {
                hits.iter()
                    .map(|r| r.get("calls").and_then(as_f64_loose).unwrap_or(0.0))
                    .sum::<f64>()
                    == 0.0
            }
            // No rows array at all folds like an empty one — the same answer
            // the strip's own `hits ?? []` fold gives.
            None => true,
        },
        Err(_) => false,
    }
}

/// The badge strip's whole body, as a callable — the fan-out over the six slice
/// bodies plus the shared fallback, kept out of the handler so the handler is a
/// config guard plus a delegation.
pub(crate) async fn read_badges_response(
    org_id: &str,
    user_id: &str,
    q: &BadgesQuery,
) -> HttpResponse {
    let org = org_id;
    let user = user_id;

    // Each slice's query is the EXACT request the tab strip's own fan-out
    // sent: window + system on databases, window + system + `limit=1` on
    // queries (the badge needs `total`, counted before the cap, and none of
    // the rows), and the bare window on the four event slices.
    let databases_q = DatabasesQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: q.system.clone(),
        // The databases endpoint deserializes only system/service/stream, so
        // instance and namespace are not sent — the Overview tab cannot narrow
        // by them either, and a badge must count what its tab would show.
        service: q.service.clone(),
        baseline_start_time: None,
        baseline_end_time: None,
        // A badge is a COUNT of rows; the per-instance split is a drill-down
        // nothing in the strip renders.
        include_breakdown: None,
    };
    let queries_q = QueriesQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: q.system.clone(),
        instance: q.instance.clone(),
        namespace: q.namespace.clone(),
        env: q.env.clone(),
        service: q.service.clone(),
        stmt_class: None,
        sort: None,
        limit: Some(1),
        search: None,
        baseline_start_time: None,
        baseline_end_time: None,
        // The strip runs its OWN fallback below, over both slices at once and
        // under the same arming rule (`queries_slice_reports_zero`). Setting
        // the flag here would run it twice.
        include_server_fallback: None,
        // A badge counts the window's statements, never one.
        fingerprint: None,
    };
    let activity_q = ActivityQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: q.system.clone(),
        instance: q.instance.clone(),
        // `database` is not a dimension the strip offers; `namespace` is the
        // one the pages actually filter on.
        database: None,
        namespace: q.namespace.clone(),
        limit: None,
    };
    // `DeadlocksQuery` / `BlockingQuery` / `TableHealthQuery` only exist on an
    // enterprise build, so their construction is gated together with the join
    // arm that consumes them. Task 5 does the full badges split; this is the
    // minimum that keeps OSS compiling now that the three types are
    // enterprise-only.
    #[cfg(feature = "enterprise")]
    let deadlocks_q = DeadlocksQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: q.system.clone(),
        instance: q.instance.clone(),
        // `database` is not a dimension the strip offers; `namespace` is the
        // one the pages actually filter on.
        database: None,
        namespace: q.namespace.clone(),
        search: None,
        limit: None,
    };
    #[cfg(feature = "enterprise")]
    let blocking_q = BlockingQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: q.system.clone(),
        instance: q.instance.clone(),
        // `database` is not a dimension the strip offers; `namespace` is the
        // one the pages actually filter on.
        database: None,
        namespace: q.namespace.clone(),
        search: None,
        min_wait_seconds: None,
        limit: None,
    };
    #[cfg(feature = "enterprise")]
    let table_health_q = TableHealthQuery {
        stream: None,
        start_time: q.start_time,
        end_time: q.end_time,
        // Its feed carries no database at all, so namespace is withheld — the
        // Table health tab withholds that select for the same reason.
        system: q.system.clone(),
        instance: q.instance.clone(),
        limit: None,
        include_indexes: None,
    };

    // One (auth, schema) prologue for the three _o2_dbm_server slices — they all
    // read the same default stream, so the OFGA check and the schema read need
    // not run three times. `None` merely declines to share: each slice then
    // computes its own and owns its own denial/error, exactly as before.
    let prologue = server_prologue(org, user).await;
    let prologue = prologue.as_ref();

    #[cfg(feature = "enterprise")]
    let (databases, queries, activity, deadlocks, blocking, table_health) = tokio::join!(
        read_databases_body(org, user, &databases_q),
        read_queries_body(org, user, &queries_q),
        read_activity_body(org, user, &activity_q, true, prologue),
        read_deadlocks_body(org, user, &deadlocks_q, true, prologue),
        read_blocking_body(org, user, &blocking_q, true, prologue),
        read_table_health_body(org, user, &table_health_q),
    );
    // On OSS the three enterprise slices are refused without a read. The
    // envelope already maps `Err` to `null` per member, so their badges render
    // blank rather than as a misleading 0.
    #[cfg(not(feature = "enterprise"))]
    let (databases, queries, activity, deadlocks, blocking, table_health) = {
        let (databases, queries, activity) = tokio::join!(
            read_databases_body(org, user, &databases_q),
            read_queries_body(org, user, &queries_q),
            read_activity_body(org, user, &activity_q, true, prologue),
        );
        (
            databases,
            queries,
            activity,
            Err(unauthorized_response()),
            Err(unauthorized_response()),
            Err(unauthorized_response()),
        )
    };

    // ── The zero-trace fallback, folded server-side ──────────────────────
    //
    // A client-vantage zero is truthful about TRACES and false about the ORG
    // when the databases themselves are reporting: the Top-queries and
    // Slowest-calls tabs render database-reported lists there, and the strip
    // must count what those tabs show. Armed only by an EXACT zero — a null
    // (failed) slice must not fire it, because unknown is not zero.
    let wants_server_queries = queries_slice_reports_zero(&queries);
    let wants_server_samples = databases_slice_reports_zero_calls(&databases);
    let (server_queries, server_samples) = tokio::join!(
        async {
            if !wants_server_queries {
                return None;
            }
            let sq = ServerQueriesQuery {
                start_time: q.start_time,
                end_time: q.end_time,
                stream: None,
                system: q.system.clone(),
                instance: q.instance.clone(),
                database: None,
                namespace: q.namespace.clone(),
                // The badges slice counts the window's statements — narrowing
                // it to one would make the badge report 1.
                fingerprint: None,
                limit: None,
            };
            Some(read_server_queries_body(org, user, &sq).await)
        },
        async {
            if !wants_server_samples {
                return None;
            }
            let ss = ServerSamplesQuery {
                start_time: q.start_time,
                end_time: q.end_time,
                stream: None,
                system: q.system.clone(),
                instance: q.instance.clone(),
                database: None,
                namespace: q.namespace.clone(),
                limit: None,
            };
            Some(read_server_samples_body(org, user, &ss).await)
        },
    );

    let slices = BadgeSliceResults {
        databases,
        queries,
        activity,
        deadlocks,
        blocking,
        table_health,
        server_queries,
        server_samples,
    };
    if slices.all_forbidden() {
        return unauthorized_response();
    }
    MetaHttpResponse::json(slices.into_envelope())
}

// ─── FR-1 instance health · the receiver-vantage metric sweep ────────────────
//
// This sweep is served here rather than from the generic `/streams` and
// `/_search?type=metrics` endpoints for an authorization reason, not a
// performance one: those endpoints authorize against `metrics` and `stream`
// objects, so a user holding only the `db_monitoring` module grant gets a 403
// from every one of them on a page they are entitled to read. Served from a
// `/db_monitoring/*`
// route the read authorizes against `db_monitoring`, which is the whole point
// of a module grant.
//
// THE SQL IS SERVER-CONSTRUCTED AND THE CATALOG IS A CONSTANT. There is no
// parameter here that lets a caller name a stream or contribute SQL, and that
// is a security property rather than an ergonomic one: the module grant must
// buy DATABASE HEALTH COLUMNS, not arbitrary access to the metrics streams.
// Adding a `?streams=` or `?sql=` knob would convert this endpoint into the
// generic search API wearing a DBM route, and hand every DBM grantee exactly
// the access the module boundary exists to withhold.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{super::testutil::*, *};

    /// A slice set where everything answered, and no fallback fired.
    fn all_ok_slices() -> BadgeSliceResults {
        BadgeSliceResults {
            databases: Ok(json!({"hits": [{"calls": 12}], "top_n_subset": false})),
            queries: Ok(json!({"hits": [], "total": 7, "other": []})),
            activity: Ok(json!({"hits": [], "by_state": [{"state": "active", "sessions": 3}]})),
            deadlocks: Ok(json!({"hits": [], "total": 0, "truncated": false})),
            blocking: Ok(json!({"hits": [], "total": 0, "truncated": false})),
            table_health: Ok(json!({"hits": [], "total": 0})),
            server_queries: None,
            server_samples: None,
        }
    }

    /// The envelope carries each endpoint's body UNDER ITS OWN KEY, unchanged
    /// — agreement with the tabs is the whole design, so the member must be
    /// the body, not a digest of it. Fallback members are ABSENT when their
    /// condition never fired: absent means "not needed", which the reader
    /// must be able to tell from "fired and failed" (null).
    #[test]
    fn test_badges_envelope_shape() {
        let env = all_ok_slices().into_envelope();
        assert_eq!(env["databases"]["hits"][0]["calls"], json!(12));
        assert_eq!(env["queries"]["total"], json!(7));
        assert_eq!(env["activity"]["by_state"][0]["sessions"], json!(3));
        assert_eq!(env["deadlocks"]["truncated"], json!(false));
        assert_eq!(env["blocking"]["total"], json!(0));
        assert_eq!(env["table_health"]["total"], json!(0));
        let obj = env.as_object().expect("envelope is an object");
        assert!(
            !obj.contains_key("server_queries") && !obj.contains_key("server_samples"),
            "an unfired fallback must be absent, not null: {env}"
        );
    }

    /// One failed slice nulls ITS member and nothing else — the per-badge
    /// failure isolation the browser fan-out's `allSettled` provided, kept
    /// across the move server-side.
    #[test]
    fn test_badges_member_failure_is_null_and_isolated() {
        let mut slices = all_ok_slices();
        slices.queries = Err(MetaHttpResponse::internal_error("search failed"));
        let env = slices.into_envelope();
        assert_eq!(env["queries"], Value::Null, "the failed member reads null");
        assert_eq!(
            env["databases"]["hits"][0]["calls"],
            json!(12),
            "the other members must be untouched"
        );
        assert_eq!(env["activity"]["by_state"][0]["sessions"], json!(3));
    }

    /// A fallback that FIRED and then failed is `null` — present, unknown —
    /// while one that fired and answered carries its body.
    #[test]
    fn test_badges_fired_fallback_failure_is_null_not_absent() {
        let mut slices = all_ok_slices();
        slices.server_queries = Some(Err(MetaHttpResponse::internal_error("read failed")));
        slices.server_samples = Some(Ok(json!({"hits": [], "total": 0, "truncated": false})));
        let env = slices.into_envelope();
        assert_eq!(env["server_queries"], Value::Null);
        assert_eq!(env["server_samples"]["total"], json!(0));
    }

    /// The fallback arms on an EXACT zero and never on a failure: unknown is
    /// not zero, and a blipped client read must not put a database-reported
    /// claim on the badge.
    #[test]
    fn test_badges_fallback_fires_on_zero_not_on_null() {
        // Queries → server_queries.
        assert!(queries_slice_reports_zero(&Ok(
            json!({"hits": [], "total": 0})
        )));
        assert!(!queries_slice_reports_zero(&Ok(
            json!({"hits": [], "total": 5})
        )));
        assert!(
            !queries_slice_reports_zero(&Err(MetaHttpResponse::internal_error("down"))),
            "a failed slice is unknown, and unknown is not zero"
        );

        // Databases → server_samples. The sum folds exactly as the strip
        // does: missing `calls` contributes 0, an empty list sums to 0.
        assert!(databases_slice_reports_zero_calls(&Ok(json!({"hits": []}))));
        assert!(databases_slice_reports_zero_calls(&Ok(
            json!({"hits": [{"db_system": "postgresql"}]})
        )));
        assert!(!databases_slice_reports_zero_calls(&Ok(
            json!({"hits": [{"calls": 3}]})
        )));
        assert!(
            !databases_slice_reports_zero_calls(&Err(MetaHttpResponse::internal_error("down"))),
            "a failed slice is unknown, and unknown is not zero"
        );
    }

    /// The whole request 403s ONLY when every slice was denied; a mix of
    /// denials and other failures still answers with what it could.
    #[test]
    fn test_badges_403_only_when_every_slice_is_denied() {
        let denied = || -> Result<Value, HttpResponse> { Err(unauthorized_response()) };
        let all_denied = BadgeSliceResults {
            databases: denied(),
            queries: denied(),
            activity: denied(),
            deadlocks: denied(),
            blocking: denied(),
            table_health: denied(),
            server_queries: None,
            server_samples: None,
        };
        assert!(all_denied.all_forbidden());

        // The readable slice is `activity` — an OSS member on purpose. The
        // three enterprise members are ALWAYS `Err(403)` on OSS and
        // `all_forbidden` deliberately does not consult them there, so using
        // one of them here would assert nothing on the OSS build.
        let mut one_answers = BadgeSliceResults {
            databases: denied(),
            queries: denied(),
            activity: Ok(json!({"hits": [], "total": 0})),
            deadlocks: denied(),
            blocking: denied(),
            table_health: denied(),
            server_queries: None,
            server_samples: None,
        };
        assert!(
            !one_answers.all_forbidden(),
            "one readable slice means the caller gets an answer, not a 403"
        );
        one_answers.activity = Err(MetaHttpResponse::internal_error("down"));
        assert!(
            !one_answers.all_forbidden(),
            "a non-auth failure is not a denial — the caller may retry, not be locked out"
        );
    }

    /// **The OSS badge strip: the three enterprise members read `null`, the
    /// rest read their real counts, and the request is NOT a blanket 403.**
    ///
    /// This is the exact slice set `get_dbm_badges` builds on an OSS build —
    /// the three enterprise reads are refused without ever running, and the
    /// OSS three answer. Two things must hold together, and each protects
    /// against a different regression:
    ///
    /// 1. `null`, never `0`. A `0` is an affirmative claim that this org had no deadlocks in the
    ///    window; an OSS build did not look and cannot make it. `null` is what the strip already
    ///    renders as a blank badge.
    /// 2. No whole-request 403. `all_forbidden` must not consult the three always-denied members on
    ///    OSS — if it did, this very set (three healthy answers plus three licence denials) would
    ///    403 the caller out of badges that do work.
    #[cfg(not(feature = "enterprise"))]
    #[test]
    fn test_badges_on_oss_nulls_the_enterprise_three_without_denying_the_request() {
        let slices = BadgeSliceResults {
            databases: Ok(json!({"hits": [{"calls": 12}], "top_n_subset": false})),
            queries: Ok(json!({"hits": [], "total": 7, "other": []})),
            activity: Ok(json!({"hits": [], "by_state": [{"state": "active", "sessions": 3}]})),
            // Exactly what the OSS arm of the join substitutes.
            deadlocks: Err(unauthorized_response()),
            blocking: Err(unauthorized_response()),
            table_health: Err(unauthorized_response()),
            server_queries: None,
            server_samples: None,
        };
        assert!(
            !slices.all_forbidden(),
            "three licence denials must not deny a request whose OSS members all answered"
        );

        let env = slices.into_envelope();
        for member in ["deadlocks", "blocking", "table_health"] {
            assert_eq!(
                env[member],
                Value::Null,
                "{member} must be null on OSS — a 0 would claim the window was read and empty"
            );
            assert_ne!(env[member], json!(0), "{member} must never read as 0");
        }
        assert_eq!(
            env["databases"]["hits"][0]["calls"],
            json!(12),
            "the OSS members keep their real counts"
        );
        assert_eq!(env["queries"]["total"], json!(7));
        assert_eq!(env["activity"]["by_state"][0]["sessions"], json!(3));
    }

    /// The route + re-export wiring, source-pinned like its siblings, and
    /// ungated beside them — an `#[cfg]` here would 404 the endpoint on OSS.
    #[test]
    fn test_badges_route_is_registered() {
        let router = include_str!("../../../../../http/src/handler/http/router/mod.rs");
        assert!(
            router.contains("db_monitoring/badges"),
            "the badges route must be registered"
        );
        assert!(router.contains("get_dbm_badges"));
        let idx = router
            .find("db_monitoring/badges")
            .expect("route must exist");
        let neighbourhood = &router[idx.saturating_sub(2000)..idx];
        assert!(
            neighbourhood.contains("db_monitoring/"),
            "the badges route must live beside the other ungated DBM routes"
        );
        assert!(
            router.contains("db_monitoring::handler::get_dbm_badges"),
            "the route must name the handler through its own module — \
             a route pointing anywhere else is not this handler"
        );
    }

    /// A badge counts what its tab would show: each scope dimension reaches
    /// exactly the slices whose endpoint accepts it.
    #[test]
    fn test_badges_forwards_each_dimension_to_the_slices_that_accept_it() {
        // `src` is the whole production corpus, because this test reaches across
        // two layers: `BadgesQuery` is in `models.rs` while the per-slice query
        // structs are built in the badges body in `service.rs`.
        let src = dbm_prod_source();
        // Handler + delegated body: the slice structs are constructed in the
        // body half now.
        let body = endpoint_impl("get_dbm_badges", "read_badges_response");
        let body = body.as_str();

        // The query struct must be able to CARRY the scope in the first place.
        let bq_start = src
            .find("pub struct BadgesQuery")
            .expect("BadgesQuery must exist");
        let bq_end = bq_start
            + src[bq_start..]
                .find("\n}")
                .expect("BadgesQuery must be a closed struct");
        let bq = &src[bq_start..bq_end];
        for dim in ["system", "instance", "namespace", "env", "service"] {
            assert!(
                bq.contains(&format!("pub {dim}:")),
                "BadgesQuery must carry `{dim}` — a badge that cannot receive a \
                 dimension can never respond to it"
            );
        }

        // No slice may hardcode a dimension its endpoint accepts. The four
        // event slices are the ones that regressed, so they are named.
        for slice in ["activity_q", "deadlocks_q", "blocking_q", "table_health_q"] {
            let at = body.find(&format!("let {slice} = ")).unwrap_or_else(|| {
                panic!("{slice} must be constructed in the badges implementation")
            });
            let decl = &body[at..at + body[at..].find("};").unwrap_or(600)];
            assert!(
                decl.contains("q.system.clone()"),
                "{slice} must receive the caller's `system`, not a hardcoded None"
            );
            assert!(
                decl.contains("q.instance.clone()"),
                "{slice} must receive the caller's `instance`, not a hardcoded None"
            );
        }
    }
}
