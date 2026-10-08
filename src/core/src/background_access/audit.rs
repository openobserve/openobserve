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

use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
};

use futures::{StreamExt, stream};
use serde::Serialize;
use utoipa::ToSchema;

use crate::authz::{
    Denial, QuerySource, StreamAccessChecker, TypedStream, active_checker, authorize_with,
    resolve_query_sources,
};

const AUDIT_CONCURRENCY: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuditObjectType {
    Alert,
    Composite,
    Slo,
    Anomaly,
    Report,
    Pipeline,
    Backfill,
    EvalJob,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuditReason {
    OwnerCannotRead,
    OwnerMissing,
    Unparseable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
pub struct DeniedStream {
    pub stream_type: String,
    pub stream_name: String,
    pub org_id: String,
}

impl From<&TypedStream> for DeniedStream {
    fn from(stream: &TypedStream) -> Self {
        Self {
            stream_type: stream.stream_type.to_string(),
            stream_name: stream.name.clone(),
            org_id: stream.org_id.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct AuditFinding {
    pub object_type: AuditObjectType,
    pub id: String,
    pub name: String,
    pub folder: Option<String>,
    pub owner: Option<String>,
    pub enabled: bool,
    pub denied_streams: Vec<DeniedStream>,
    pub reason: AuditReason,
    pub disable_path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct OwnerNotRecorded {
    pub object_type: AuditObjectType,
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub streams_read: Vec<DeniedStream>,
    pub disable_path: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, ToSchema)]
pub struct StreamAccessAudit {
    #[schema(value_type = Object)]
    pub scanned: BTreeMap<AuditObjectType, usize>,
    pub findings: Vec<AuditFinding>,
    pub owner_not_recorded: Vec<OwnerNotRecorded>,
}

struct AuditObject {
    object_type: AuditObjectType,
    id: String,
    name: String,
    folder: Option<String>,
    /// `None` for kinds that store no owner at all.
    owner: Option<Option<String>>,
    enabled: bool,
    sources: Vec<QuerySource>,
    disable_path: String,
}

/// Many objects share an owner and its streams, so each answer is asked once per audit.
struct MemoChecker {
    inner: Arc<dyn StreamAccessChecker>,
    roots: Mutex<HashMap<String, bool>>,
    admins: Mutex<HashMap<(String, String), bool>>,
    streams: Mutex<HashMap<(String, TypedStream), bool>>,
    keys: Mutex<HashMap<(String, String, String), bool>>,
    dashboards: Mutex<HashMap<(String, String, String, String), bool>>,
}

impl MemoChecker {
    fn new(inner: Arc<dyn StreamAccessChecker>) -> Self {
        Self {
            inner,
            roots: Mutex::default(),
            admins: Mutex::default(),
            streams: Mutex::default(),
            keys: Mutex::default(),
            dashboards: Mutex::default(),
        }
    }
}

#[async_trait::async_trait]
impl StreamAccessChecker for MemoChecker {
    async fn is_root(&self, user_id: &str) -> bool {
        let key = user_id.to_string();
        if let Some(hit) = cached(&self.roots, &key) {
            return hit;
        }
        let answer = self.inner.is_root(user_id).await;
        remember(&self.roots, key, answer)
    }

    async fn is_root_or_admin(&self, org_id: &str, user_id: &str) -> bool {
        let key = (org_id.to_string(), user_id.to_string());
        if let Some(hit) = cached(&self.admins, &key) {
            return hit;
        }
        let answer = self.inner.is_root_or_admin(org_id, user_id).await;
        remember(&self.admins, key, answer)
    }

    async fn can_read_stream(&self, user_id: &str, stream: &TypedStream) -> bool {
        let key = (user_id.to_string(), stream.clone());
        if let Some(hit) = cached(&self.streams, &key) {
            return hit;
        }
        let answer = self.inner.can_read_stream(user_id, stream).await;
        remember(&self.streams, key, answer)
    }

    async fn can_use_cipher_key(&self, org_id: &str, user_id: &str, key: &str) -> bool {
        let memo_key = (org_id.to_string(), user_id.to_string(), key.to_string());
        if let Some(hit) = cached(&self.keys, &memo_key) {
            return hit;
        }
        let answer = self.inner.can_use_cipher_key(org_id, user_id, key).await;
        remember(&self.keys, memo_key, answer)
    }

    async fn can_read_dashboard(
        &self,
        org_id: &str,
        user_id: &str,
        folder: &str,
        dashboard_id: &str,
    ) -> bool {
        let key = (
            org_id.to_string(),
            user_id.to_string(),
            folder.to_string(),
            dashboard_id.to_string(),
        );
        if let Some(hit) = cached(&self.dashboards, &key) {
            return hit;
        }
        let answer = self
            .inner
            .can_read_dashboard(org_id, user_id, folder, dashboard_id)
            .await;
        remember(&self.dashboards, key, answer)
    }
}

pub async fn audit_org(org_id: &str) -> Result<StreamAccessAudit, anyhow::Error> {
    let objects = list_objects(org_id).await?;
    let checker = MemoChecker::new(active_checker());
    Ok(audit_objects(org_id, &checker, objects).await)
}

async fn audit_objects(
    org_id: &str,
    checker: &MemoChecker,
    objects: Vec<AuditObject>,
) -> StreamAccessAudit {
    let mut audit = StreamAccessAudit::default();
    for object in &objects {
        *audit.scanned.entry(object.object_type).or_default() += 1;
    }
    let (owned, unowned): (Vec<AuditObject>, Vec<AuditObject>) =
        objects.into_iter().partition(|o| o.owner.is_some());
    for object in unowned {
        let streams_read: Vec<DeniedStream> = resolve_query_sources(&object.sources)
            .streams
            .iter()
            .map(DeniedStream::from)
            .collect();
        if !streams_read.is_empty() {
            audit.owner_not_recorded.push(OwnerNotRecorded {
                object_type: object.object_type,
                id: object.id,
                name: object.name,
                enabled: object.enabled,
                streams_read,
                disable_path: object.disable_path,
            });
        }
    }
    audit.findings = stream::iter(owned)
        .map(|object| audit_owned(org_id, checker, object))
        .buffered(AUDIT_CONCURRENCY)
        .filter_map(|finding| async move { finding })
        .collect()
        .await;
    audit
}

async fn audit_owned(
    org_id: &str,
    checker: &MemoChecker,
    object: AuditObject,
) -> Option<AuditFinding> {
    let owner = object.owner.clone().flatten().filter(|o| !o.is_empty());
    let finding = |reason, denied_streams| AuditFinding {
        object_type: object.object_type,
        id: object.id.clone(),
        name: object.name.clone(),
        folder: object.folder.clone(),
        owner: owner.clone(),
        enabled: object.enabled,
        denied_streams,
        reason,
        disable_path: object.disable_path.clone(),
    };
    let Some(owner_id) = owner.as_deref() else {
        return Some(finding(AuditReason::OwnerMissing, Vec::new()));
    };
    if !checker.is_root(owner_id).await && !is_member(org_id, owner_id).await {
        return Some(finding(AuditReason::OwnerMissing, Vec::new()));
    }
    let denied = authorize_with(checker, owner_id, &object.sources)
        .await
        .err()?;
    let streams: Vec<DeniedStream> = denied
        .denials
        .iter()
        .filter_map(|denial| match denial {
            Denial::Stream(stream) => Some(DeniedStream::from(stream)),
            _ => None,
        })
        .collect();
    let only_unparseable = denied
        .denials
        .iter()
        .all(|denial| matches!(denial, Denial::Unparseable { .. }));
    let reason = if only_unparseable {
        AuditReason::Unparseable
    } else {
        AuditReason::OwnerCannotRead
    };
    Some(finding(reason, streams))
}

async fn is_member(org_id: &str, user_id: &str) -> bool {
    crate::users::get_user(Some(org_id), user_id)
        .await
        .is_some()
}

async fn list_objects(org_id: &str) -> Result<Vec<AuditObject>, anyhow::Error> {
    let mut objects = list_alerts(org_id).await?;
    objects.extend(list_composites(org_id).await?);
    objects.extend(list_slos(org_id).await?);
    objects.extend(list_anomaly_configs(org_id).await?);
    objects.extend(list_reports(org_id).await?);
    objects.extend(list_pipelines_and_backfills(org_id).await?);
    objects.extend(list_eval_jobs(org_id).await?);
    Ok(objects)
}

async fn list_alerts(org_id: &str) -> Result<Vec<AuditObject>, anyhow::Error> {
    use config::meta::alerts::alert::ListAlertsParams;

    let alerts = crate::alerts::alert::list_with_folders_db(ListAlertsParams::new(org_id))
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(alerts
        .into_iter()
        .map(|(folder, alert)| {
            let id = alert.id.map(|id| id.to_string()).unwrap_or_default();
            AuditObject {
                object_type: AuditObjectType::Alert,
                disable_path: alert_disable_path(org_id, &id),
                sources: super::alert_sources(org_id, &alert),
                id,
                name: alert.name,
                folder: Some(folder.folder_id),
                owner: Some(alert.owner),
                enabled: alert.enabled,
            }
        })
        .collect())
}

async fn list_composites(org_id: &str) -> Result<Vec<AuditObject>, anyhow::Error> {
    use infra::table::entity::alert_composites;
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

    let client = infra::db::get_orm_client_ro().await;
    let composites = alert_composites::Entity::find()
        .filter(alert_composites::Column::Org.eq(org_id))
        .all(client)
        .await?;
    Ok(composites
        .into_iter()
        .map(|composite| AuditObject {
            object_type: AuditObjectType::Composite,
            disable_path: alert_disable_path(org_id, &composite.id),
            id: composite.id,
            name: composite.name,
            folder: Some(composite.folder_id),
            owner: Some(composite.owner),
            enabled: composite.enabled,
            sources: Vec::new(),
        })
        .collect())
}

async fn list_slos(org_id: &str) -> Result<Vec<AuditObject>, anyhow::Error> {
    let client = infra::db::get_orm_client_ro().await;
    let slos = infra::table::slos::list(client, org_id, None).await?;
    Ok(slos
        .into_iter()
        .map(|slo| AuditObject {
            object_type: AuditObjectType::Slo,
            disable_path: format!("PUT /api/{org_id}/slos/{}/enable?value=false", slo.id),
            sources: super::slo_sources(&slo),
            id: slo.id,
            name: slo.name,
            folder: Some(slo.folder_id),
            owner: Some(slo.owner),
            enabled: slo.enabled,
        })
        .collect())
}

async fn list_anomaly_configs(org_id: &str) -> Result<Vec<AuditObject>, anyhow::Error> {
    let client = infra::db::get_orm_client_ro().await;
    let configs = infra::table::anomaly_detection::config::list_by_org(client, org_id).await?;
    Ok(configs
        .into_iter()
        .map(|config| AuditObject {
            object_type: AuditObjectType::Anomaly,
            disable_path: alert_disable_path(org_id, &config.anomaly_id),
            sources: super::anomaly_sources(
                org_id,
                &config.stream_type,
                &config.stream_name,
                config.custom_sql.as_deref(),
            ),
            id: config.anomaly_id,
            name: config.name,
            folder: Some(config.folder_id),
            owner: Some(config.owner),
            enabled: config.enabled,
        })
        .collect())
}

async fn list_reports(org_id: &str) -> Result<Vec<AuditObject>, anyhow::Error> {
    use config::meta::dashboards::reports::ReportListFilters;

    let filters = ReportListFilters {
        dashboard: None,
        folder: None,
        destination_less: None,
        name_substring: None,
    };
    let rows = crate::dashboards::reports::list(org_id, filters, None)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut seen = Vec::new();
    let mut objects = Vec::new();
    for row in rows {
        if seen.contains(&row.report_id) {
            continue;
        }
        seen.push(row.report_id.clone());
        let (folder, report) = crate::dashboards::reports::get_by_id(org_id, &row.report_id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        objects.push(AuditObject {
            object_type: AuditObjectType::Report,
            disable_path: format!(
                "PATCH /api/v2/{org_id}/reports/{}/enable?value=false",
                row.report_id
            ),
            sources: report_audit_sources(org_id, &report).await?,
            id: row.report_id,
            name: report.name,
            folder: Some(folder.folder_id),
            owner: Some(Some(report.owner)),
            enabled: report.enabled,
        });
    }
    Ok(objects)
}

/// A report whose dashboard is gone is a finding, so one deleted dashboard cannot fail the audit.
async fn report_audit_sources(
    org_id: &str,
    report: &config::meta::dashboards::reports::Report,
) -> Result<Vec<QuerySource>, anyhow::Error> {
    match super::report_sources(org_id, report).await {
        Ok(sources) => Ok(sources),
        Err(e @ super::ReportSourceError::DashboardMissing { .. }) => {
            Ok(vec![QuerySource::Unparseable {
                source: format!("report {}", report.name),
                error: e.to_string(),
            }])
        }
        Err(super::ReportSourceError::Load(e)) => Err(e),
    }
}

async fn list_pipelines_and_backfills(org_id: &str) -> Result<Vec<AuditObject>, anyhow::Error> {
    let pipelines = crate::pipeline::db::list_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut sources_by_id = HashMap::new();
    let mut objects = Vec::new();
    for pipeline in pipelines {
        let sources = super::pipeline_sources(&pipeline).await?;
        sources_by_id.insert(pipeline.id.clone(), sources.clone());
        objects.push(AuditObject {
            object_type: AuditObjectType::Pipeline,
            disable_path: format!(
                "PUT /api/{org_id}/pipelines/{}/enable?value=false",
                pipeline.id
            ),
            id: pipeline.id,
            name: pipeline.name,
            folder: None,
            owner: None,
            enabled: pipeline.enabled,
            sources,
        });
    }
    for job in crate::alerts::backfill::list_backfill_jobs(org_id).await? {
        objects.push(AuditObject {
            object_type: AuditObjectType::Backfill,
            disable_path: format!(
                "PUT /api/{org_id}/pipelines/{}/backfill/{}/enable?value=false",
                job.pipeline_id, job.job_id
            ),
            sources: sources_by_id
                .get(&job.pipeline_id)
                .cloned()
                .unwrap_or_default(),
            name: job.pipeline_name.unwrap_or_default(),
            id: job.job_id,
            folder: None,
            owner: None,
            enabled: job.enabled,
        });
    }
    Ok(objects)
}

async fn list_eval_jobs(org_id: &str) -> Result<Vec<AuditObject>, anyhow::Error> {
    let jobs = crate::llm_evaluations::eval_jobs::list_jobs(org_id, None, None)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(jobs
        .into_iter()
        .map(|job| AuditObject {
            object_type: AuditObjectType::EvalJob,
            disable_path: format!("POST /api/{org_id}/eval_jobs/{}/pause", job.id),
            sources: super::eval_job_sources(org_id, &job.stream_type, &job.stream),
            enabled: job.status == "active",
            id: job.id,
            name: job.name,
            folder: None,
            owner: None,
        })
        .collect())
}

fn alert_disable_path(org_id: &str, id: &str) -> String {
    format!("PATCH /api/v2/{org_id}/alerts/{id}/enable?value=false")
}

fn cached<K: std::hash::Hash + Eq>(memo: &Mutex<HashMap<K, bool>>, key: &K) -> Option<bool> {
    memo.lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(key)
        .copied()
}

fn remember<K: std::hash::Hash + Eq>(memo: &Mutex<HashMap<K, bool>>, key: K, answer: bool) -> bool {
    memo.lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(key, answer);
    answer
}

#[cfg(all(test, feature = "test-utils"))]
mod tests {
    use common::infra::config::{ORG_USERS, USERS};
    use config::meta::{
        stream::StreamType,
        user::{UserRole, UserType},
    };
    use infra::table::{org_users::OrgUserRecord, users::UserRecord};

    use super::*;
    use crate::authz::FakeStreamChecker;

    fn add_member(org_id: &str, email: &str) {
        USERS.insert(
            email.to_string(),
            UserRecord {
                email: email.to_string(),
                first_name: String::new(),
                last_name: String::new(),
                password: String::new(),
                salt: String::new(),
                is_root: false,
                password_ext: None,
                user_type: UserType::Internal,
                created_at: 0,
                updated_at: 0,
                must_reset_password: false,
                password_reset_reason: None,
                flagged_at: None,
                password_updated_at: None,
            },
        );
        ORG_USERS.insert(
            format!("{org_id}/{email}"),
            OrgUserRecord {
                email: email.to_string(),
                org_id: org_id.to_string(),
                role: UserRole::User,
                token: String::new(),
                rum_token: None,
                created_at: 0,
                allow_static_token: false,
            },
        );
    }

    fn stream(org_id: &str, name: &str) -> TypedStream {
        TypedStream {
            org_id: org_id.to_string(),
            stream_type: StreamType::Logs,
            name: name.to_string(),
        }
    }

    fn object(
        object_type: AuditObjectType,
        id: &str,
        owner: Option<Option<&str>>,
        sources: Vec<QuerySource>,
    ) -> AuditObject {
        AuditObject {
            object_type,
            id: id.to_string(),
            name: format!("{id}_name"),
            folder: None,
            owner: owner.map(|o| o.map(str::to_string)),
            enabled: true,
            sources,
            disable_path: format!("disable {id}"),
        }
    }

    fn sql(org_id: &str, sql: &str) -> Vec<QuerySource> {
        vec![QuerySource::Sql {
            org_id: org_id.to_string(),
            sql: sql.to_string(),
            default_type: StreamType::Logs,
        }]
    }

    async fn run(
        org_id: &str,
        fake: FakeStreamChecker,
        objects: Vec<AuditObject>,
    ) -> StreamAccessAudit {
        let checker = MemoChecker::new(Arc::new(fake));
        audit_objects(org_id, &checker, objects).await
    }

    fn reasons(audit: &StreamAccessAudit) -> Vec<(String, AuditReason)> {
        audit
            .findings
            .iter()
            .map(|f| (f.id.clone(), f.reason))
            .collect()
    }

    #[tokio::test]
    async fn each_reason_is_reported_once_per_object() {
        let org = "aud_org_reasons";
        let owner = "aud_owner_reasons@example.com";
        add_member(org, owner);
        let fake = FakeStreamChecker::default();
        fake.grant_read(owner, &stream(org, "open"));
        let objects = vec![
            object(
                AuditObjectType::Alert,
                "readable",
                Some(Some(owner)),
                sql(org, "SELECT * FROM open"),
            ),
            object(
                AuditObjectType::Alert,
                "denied",
                Some(Some(owner)),
                sql(org, "SELECT * FROM open JOIN closed ON true"),
            ),
            object(
                AuditObjectType::Slo,
                "no_owner",
                Some(None),
                sql(org, "SELECT * FROM open"),
            ),
            object(
                AuditObjectType::Report,
                "empty_owner",
                Some(Some("")),
                Vec::new(),
            ),
            object(
                AuditObjectType::Anomaly,
                "broken",
                Some(Some(owner)),
                vec![QuerySource::Unparseable {
                    source: "custom_sql".to_string(),
                    error: "bad".to_string(),
                }],
            ),
            object(
                AuditObjectType::Pipeline,
                "pipe",
                None,
                sql(org, "SELECT * FROM closed"),
            ),
            object(AuditObjectType::EvalJob, "quiet_job", None, Vec::new()),
        ];
        let audit = run(org, fake, objects).await;

        let mut found = reasons(&audit);
        found.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(
            found,
            vec![
                ("broken".to_string(), AuditReason::Unparseable),
                ("denied".to_string(), AuditReason::OwnerCannotRead),
                ("empty_owner".to_string(), AuditReason::OwnerMissing),
                ("no_owner".to_string(), AuditReason::OwnerMissing),
            ]
        );
        let denied = audit.findings.iter().find(|f| f.id == "denied").unwrap();
        assert_eq!(
            denied.denied_streams,
            vec![DeniedStream::from(&stream(org, "closed"))]
        );
        assert_eq!(denied.disable_path, "disable denied");
        assert!(denied.enabled);

        // an object with no recorded owner is listed apart, and only when it reads a stream
        assert_eq!(audit.owner_not_recorded.len(), 1);
        assert_eq!(audit.owner_not_recorded[0].id, "pipe");
        assert_eq!(
            audit.owner_not_recorded[0].streams_read,
            vec![DeniedStream::from(&stream(org, "closed"))]
        );
        assert_eq!(audit.scanned.values().sum::<usize>(), 7);
        assert_eq!(audit.scanned[&AuditObjectType::Alert], 2);
    }

    #[tokio::test]
    async fn nothing_wrong_answers_explicit_empty_lists() {
        let org = "aud_org_clean";
        let owner = "aud_owner_clean@example.com";
        add_member(org, owner);
        let fake = FakeStreamChecker::default();
        fake.grant_read(owner, &stream(org, "open"));
        let audit = run(
            org,
            fake,
            vec![object(
                AuditObjectType::Alert,
                "a1",
                Some(Some(owner)),
                sql(org, "SELECT * FROM open"),
            )],
        )
        .await;
        let body = serde_json::to_value(&audit).unwrap();
        assert_eq!(body["findings"], serde_json::json!([]));
        assert_eq!(body["owner_not_recorded"], serde_json::json!([]));
        assert_eq!(body["scanned"]["alert"], 1);
    }

    #[tokio::test]
    async fn owner_admin_of_the_object_org_only_is_flagged_for_another_org_source() {
        let org = "aud_org_admin";
        let owner = "aud_owner_admin@example.com";
        add_member(org, owner);
        let fake = FakeStreamChecker::default();
        fake.grant_admin(org, owner);
        let objects = vec![
            object(
                AuditObjectType::Alert,
                "own_org",
                Some(Some(owner)),
                sql(org, "SELECT * FROM anything"),
            ),
            object(
                AuditObjectType::Alert,
                "other_org",
                Some(Some(owner)),
                sql("aud_org_other", "SELECT * FROM theirs"),
            ),
        ];
        let audit = run(org, fake, objects).await;
        assert_eq!(
            reasons(&audit),
            vec![("other_org".to_string(), AuditReason::OwnerCannotRead)]
        );
        assert_eq!(
            audit.findings[0].denied_streams,
            vec![DeniedStream::from(&stream("aud_org_other", "theirs"))]
        );
    }

    #[tokio::test]
    async fn a_root_owner_needs_no_membership() {
        let fake = FakeStreamChecker::default();
        fake.grant_root("aud_root@example.com");
        let audit = run(
            "aud_org_root",
            fake,
            vec![object(
                AuditObjectType::Alert,
                "a1",
                Some(Some("aud_root@example.com")),
                sql("aud_org_root", "SELECT * FROM anything"),
            )],
        )
        .await;
        assert!(audit.findings.is_empty(), "{audit:?}");
    }

    #[tokio::test]
    async fn a_report_on_a_deleted_dashboard_is_a_finding_not_an_audit_failure() {
        use config::meta::dashboards::reports::Report;
        use sea_orm::{ConnectionTrait, Schema};

        let conn = infra::db::get_orm_client_rw().await;
        let backend = conn.get_database_backend();
        let schema = Schema::new(backend);
        for mut stmt in [
            schema.create_table_from_entity(infra::table::entity::folders::Entity),
            schema.create_table_from_entity(infra::table::entity::dashboards::Entity),
        ] {
            conn.execute(backend.build(stmt.if_not_exists()))
                .await
                .unwrap();
        }
        let dashboard = serde_json::from_value(serde_json::json!({
            "dashboard": "audit_gone",
            "folder": "audit_no_folder",
            "tabs": ["t"],
        }))
        .unwrap();
        let report = Report {
            name: "weekly".to_string(),
            dashboards: vec![dashboard],
            ..Default::default()
        };
        assert_eq!(
            report_audit_sources("audit_org", &report).await.unwrap(),
            vec![QuerySource::Unparseable {
                source: "report weekly".to_string(),
                error: "dashboard audit_no_folder/audit_gone of the report not found".to_string(),
            }]
        );
    }
}
