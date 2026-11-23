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

//! Which protected streams a search may read unredacted, resolved once where the request arrives.

use config::meta::{search, stream::StreamType};

/// The audit `http_path` of an unredacted read; `target` names the stream.
#[cfg(feature = "enterprise")]
const RAW_READ_AUDIT_PATH: &str = "search/unredacted";

/// How one user's permission to read protected streams unredacted is answered.
#[cfg(any(all(feature = "enterprise", feature = "vectorscan"), test))]
trait RawAccess {
    fn is_root(&self) -> bool;
    fn rbac_enabled(&self) -> bool;
    async fn may_read_raw_logs(&self, stream: &str) -> bool;
}

/// Answers [`RawAccess`] from the user cache and OpenFGA.
#[cfg(all(feature = "enterprise", feature = "vectorscan"))]
struct OpenFgaAccess<'a> {
    org_id: &'a str,
    user_id: &'a str,
    role: Option<String>,
}

#[cfg(all(feature = "enterprise", feature = "vectorscan"))]
impl<'a> OpenFgaAccess<'a> {
    async fn load(org_id: &'a str, user_id: &'a str) -> Self {
        let role = db::user::get(Some(org_id), user_id)
            .await
            .ok()
            .flatten()
            .map(|user| user.role.to_string());
        Self {
            org_id,
            user_id,
            role,
        }
    }
}

#[cfg(all(feature = "enterprise", feature = "vectorscan"))]
impl RawAccess for OpenFgaAccess<'_> {
    fn is_root(&self) -> bool {
        db::user::is_root_user(self.user_id)
    }

    fn rbac_enabled(&self) -> bool {
        o2_openfga::config::get_config().enabled
    }

    async fn may_read_raw_logs(&self, stream: &str) -> bool {
        use o2_openfga::meta::mapping::LOGS_UNREDACTED_KEY;

        let Some(role) = self.role.as_deref() else {
            return false;
        };
        let object = format!(
            "{LOGS_UNREDACTED_KEY}:{}",
            config::utils::str::into_ofga_supported_format(stream)
        );
        o2_openfga::authorizer::authz::is_allowed_fail_closed(
            self.org_id,
            self.user_id,
            "GET",
            &object,
            role,
        )
        .await
    }
}

/// Fills `req.raw_streams` unless a caller already did, and audits the raw reads it grants.
pub async fn resolve_request(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id: Option<&str>,
    req: &mut search::Request,
) {
    if req.raw_streams.is_some() {
        return;
    }
    let raw = resolve_and_audit(trace_id, org_id, stream_type, user_id, &req.query.sql).await;
    req.raw_streams = Some(raw);
}

/// [`resolve`] for a request that returns data, so each raw stream it reads is audited.
pub async fn resolve_and_audit(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id: Option<&str>,
    sql: &str,
) -> search::RawStreams {
    let raw = resolve(org_id, stream_type, sql, user_id).await;
    audit_raw_read(trace_id, org_id, user_id, &raw, sql);
    raw
}

/// The protected streams `sql` reads that `user_id` may read unredacted. A stream that cannot
/// be confirmed is left out, so the scanning node redacts it.
#[cfg(all(feature = "enterprise", feature = "vectorscan"))]
pub async fn resolve(
    org_id: &str,
    stream_type: StreamType,
    sql: &str,
    user_id: Option<&str>,
) -> search::RawStreams {
    let Some(user_id) = user_id else {
        return search::RawStreams::default();
    };
    let protected = protected_streams(org_id, stream_type, sql);
    if protected.is_empty() {
        return search::RawStreams::default();
    }
    let access = OpenFgaAccess::load(org_id, user_id).await;
    raw_for(&protected, &access).await
}

#[cfg(not(all(feature = "enterprise", feature = "vectorscan")))]
pub async fn resolve(
    _org_id: &str,
    _stream_type: StreamType,
    _sql: &str,
    _user_id: Option<&str>,
) -> search::RawStreams {
    search::RawStreams::default()
}

/// Whether `user_id` may read every protected stream `sql` reads unredacted. Stored results such
/// as a search job's may hold raw values; protection that cannot be determined denies.
#[cfg(all(feature = "enterprise", feature = "vectorscan"))]
pub async fn may_read_unredacted(
    org_id: &str,
    stream_type: StreamType,
    sql: &str,
    user_id: &str,
) -> bool {
    let Some(protected) = protected_streams_checked(org_id, stream_type, sql) else {
        return false;
    };
    if protected.is_empty() {
        return true;
    }
    let access = OpenFgaAccess::load(org_id, user_id).await;
    covers(&raw_for(&protected, &access).await, &protected)
}

#[cfg(not(all(feature = "enterprise", feature = "vectorscan")))]
pub async fn may_read_unredacted(
    _org_id: &str,
    _stream_type: StreamType,
    _sql: &str,
    _user_id: &str,
) -> bool {
    true
}

/// Streams `sql` reads that carry search-time patterns, including ones whose patterns fail
/// to build; none when the pattern manager is not ready, which redacts everything.
#[cfg(all(feature = "enterprise", feature = "vectorscan"))]
fn protected_streams(
    org_id: &str,
    stream_type: StreamType,
    sql: &str,
) -> Vec<(StreamType, String)> {
    protected_streams_checked(org_id, stream_type, sql).unwrap_or_default()
}

/// [`protected_streams`], but `None` when the pattern manager is not ready or `sql` does not parse.
#[cfg(all(feature = "enterprise", feature = "vectorscan"))]
fn protected_streams_checked(
    org_id: &str,
    stream_type: StreamType,
    sql: &str,
) -> Option<Vec<(StreamType, String)>> {
    use config::meta::sql::{TableReferenceExt, resolve_stream_names_with_type};

    let manager = o2_enterprise::enterprise::re_patterns::PATTERN_MANAGER.get()?;
    let streams = resolve_stream_names_with_type(sql).ok()?;
    let protected = streams
        .iter()
        .map(|stream| (stream.get_stream_type(stream_type), stream.stream_name()))
        .filter(|(stype, name)| {
            !matches!(manager.search_protection(org_id, *stype, name), Ok(None))
        })
        .collect();
    Some(protected)
}

/// Root reads every protected stream raw; anyone else only logs streams OpenFGA grants.
#[cfg(any(all(feature = "enterprise", feature = "vectorscan"), test))]
async fn raw_for(
    protected: &[(StreamType, String)],
    access: &impl RawAccess,
) -> search::RawStreams {
    let mut raw = search::RawStreams::default();
    if access.is_root() {
        for (stype, name) in protected {
            raw.insert(*stype, name);
        }
        return raw;
    }
    if !access.rbac_enabled() {
        return raw;
    }
    for (stype, name) in protected {
        if *stype == StreamType::Logs && access.may_read_raw_logs(name).await {
            raw.insert(*stype, name);
        }
    }
    raw
}

#[cfg(any(all(feature = "enterprise", feature = "vectorscan"), test))]
fn covers(raw: &search::RawStreams, protected: &[(StreamType, String)]) -> bool {
    protected
        .iter()
        .all(|(stype, name)| raw.contains(*stype, name))
}

/// Records each stream read unredacted; detached so the query never waits on the audit.
#[cfg(feature = "enterprise")]
fn audit_raw_read(
    trace_id: &str,
    org_id: &str,
    user_id: Option<&str>,
    raw: &search::RawStreams,
    sql: &str,
) {
    let Some(user_id) = user_id else {
        return;
    };
    for msg in raw_read_audits(trace_id, org_id, user_id, raw, sql) {
        tokio::spawn(audit::audit(msg));
    }
}

#[cfg(not(feature = "enterprise"))]
fn audit_raw_read(
    _trace_id: &str,
    _org_id: &str,
    _user_id: Option<&str>,
    _raw: &search::RawStreams,
    _sql: &str,
) {
}

#[cfg(feature = "enterprise")]
fn raw_read_audits(
    trace_id: &str,
    org_id: &str,
    user_id: &str,
    raw: &search::RawStreams,
    sql: &str,
) -> Vec<o2_enterprise::enterprise::common::auditor::AuditMessage> {
    use o2_enterprise::enterprise::common::auditor::{AuditMessage, Protocol, ResponseMeta};

    raw.iter()
        .map(|stream| AuditMessage {
            user_email: user_id.to_string(),
            org_id: org_id.to_string(),
            _timestamp: config::utils::time::now_micros(),
            protocol: Protocol::Http,
            login_ip: None,
            user_agent: None,
            response_meta: ResponseMeta {
                http_method: "GET".to_string(),
                http_path: RAW_READ_AUDIT_PATH.to_string(),
                http_query_params: String::new(),
                http_body: sql.to_string(),
                http_response_code: 200,
                error_msg: None,
                trace_id: Some(trace_id.to_string()),
            },
            delegated: None,
            fleet_id: None,
            target: Some(stream.clone()),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    struct Fake {
        root: bool,
        rbac: bool,
        granted: HashSet<&'static str>,
    }

    impl RawAccess for Fake {
        fn is_root(&self) -> bool {
            self.root
        }

        fn rbac_enabled(&self) -> bool {
            self.rbac
        }

        async fn may_read_raw_logs(&self, stream: &str) -> bool {
            self.granted.contains(stream)
        }
    }

    fn protected() -> Vec<(StreamType, String)> {
        vec![
            (StreamType::Logs, "app".to_string()),
            (StreamType::Logs, "billing".to_string()),
            (StreamType::Traces, "app".to_string()),
        ]
    }

    fn user(granted: &[&'static str]) -> Fake {
        Fake {
            root: false,
            rbac: true,
            granted: granted.iter().copied().collect(),
        }
    }

    #[tokio::test]
    async fn a_single_stream_grant_opens_only_that_stream() {
        let raw = raw_for(&protected(), &user(&["app"])).await;
        assert_eq!(raw.to_vec(), vec!["logs/app".to_string()]);
    }

    #[tokio::test]
    async fn a_grant_on_every_stream_opens_only_logs() {
        let raw = raw_for(&protected(), &user(&["app", "billing"])).await;
        assert!(raw.contains(StreamType::Logs, "app"));
        assert!(raw.contains(StreamType::Logs, "billing"));
        assert!(!raw.contains(StreamType::Traces, "app"));
    }

    #[tokio::test]
    async fn without_a_grant_everything_is_redacted() {
        assert!(raw_for(&protected(), &user(&[])).await.is_empty());
    }

    #[tokio::test]
    async fn root_reads_every_protected_stream_raw() {
        let root = Fake {
            root: true,
            rbac: false,
            granted: HashSet::new(),
        };
        let raw = raw_for(&protected(), &root).await;
        assert_eq!(raw.to_vec().len(), 3);
        assert!(raw.contains(StreamType::Traces, "app"));
    }

    #[tokio::test]
    async fn with_rbac_off_only_root_reads_raw() {
        let mut admin = user(&["app", "billing"]);
        admin.rbac = false;
        assert!(raw_for(&protected(), &admin).await.is_empty());
    }

    #[tokio::test]
    async fn stored_results_need_raw_access_to_every_protected_stream() {
        let partial = raw_for(&protected(), &user(&["app", "billing"])).await;
        assert!(!covers(&partial, &protected()));
        let root = Fake {
            root: true,
            rbac: true,
            granted: HashSet::new(),
        };
        assert!(covers(&raw_for(&protected(), &root).await, &protected()));
        let logs_only = &protected()[..2];
        assert!(covers(
            &raw_for(logs_only, &user(&["app", "billing"])).await,
            logs_only
        ));
    }

    #[tokio::test]
    async fn a_request_without_a_user_is_redacted() {
        let mut req = search::Request::default();
        req.query.sql = "SELECT * FROM app".to_string();
        resolve_request("t", "org", StreamType::Logs, None, &mut req).await;
        assert_eq!(req.raw_streams, Some(search::RawStreams::default()));
    }

    #[tokio::test]
    async fn a_resolved_request_is_never_resolved_again() {
        let mut given = search::RawStreams::default();
        given.insert(StreamType::Logs, "app");
        let mut req = search::Request {
            raw_streams: Some(given.clone()),
            ..Default::default()
        };
        resolve_request("t", "org", StreamType::Logs, Some("root@x"), &mut req).await;
        assert_eq!(req.raw_streams, Some(given));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn each_raw_stream_gets_one_audit_record() {
        let mut raw = search::RawStreams::default();
        raw.insert(StreamType::Logs, "app");
        raw.insert(StreamType::Logs, "billing");
        let audits = raw_read_audits("trace-1", "org", "alice@x", &raw, "SELECT * FROM app");
        let targets: Vec<_> = audits.iter().map(|a| a.target.clone().unwrap()).collect();
        assert_eq!(targets, ["logs/app", "logs/billing"]);
        assert!(audits.iter().all(|a| a.user_email == "alice@x"
            && a.response_meta.http_body == "SELECT * FROM app"
            && a.response_meta.trace_id.as_deref() == Some("trace-1")));
        assert!(raw_read_audits("t", "org", "bob@x", &Default::default(), "q").is_empty());
    }
}
