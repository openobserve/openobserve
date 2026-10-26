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

const DB: &str = "delete_db_resources";
const ORG_RECORD: &str = "delete_org_record";
const CLOUD: &str = "delete_org_cloud_resources";
const FILE_LIST: &str = "delete_file_list";
const FILE_LIST_FINAL: &str = "delete_file_list_final";
const DRAIN: &str = "drain_deleted_files";
const DRAIN_FINAL: &str = "drain_deleted_files_final";

/// Cleanup steps a coverage row may name: the worker's steps, plus the cloud sub-step of step 300.
pub const KNOWN_STEPS: &[&str] = &[
    "delete_streams",
    "delete_stream",
    "delete_file_list",
    "drain_deleted_files",
    "delete_db_resources",
    "delete_scheduler_triggers",
    "delete_users",
    "delete_streams_final",
    "delete_stream_final",
    "delete_file_list_final",
    "drain_deleted_files_final",
    "delete_org_record",
    "delete_org_cloud_resources",
];

/// Every org-scoped entity and the step that removes it, or the reason none does.
pub const COVERAGE: &[Coverage] = &[
    table("eval_job_state_transitions", DB),
    table("eval_job_states", DB),
    table("external_identity_links", DB),
    table("fleet_collectors", DB),
    table("fleet_config_versions", DB),
    table("fleet_configs", DB),
    table("fleet_rollout_members", DB),
    table("fleet_rollouts", DB),
    table("fleet_settings", DB),
    table("fleet_tokens", DB),
    table("fleets", DB),
    table("rca_runs", DB),
    table("rca_steering", DB),
    table("slack_channel_defaults", DB),
    table("slack_org_connections", DB),
    table("slack_threads", DB),
    exempt(
        Kind::Table,
        "slack_installations",
        "shared workspace or instance installations survive org deletion; Slack cleanup removes this org's connections",
    ),
    exempt(
        Kind::Table,
        "slack_link_requests",
        "installation-scoped requests expire independently of organizations",
    ),
    table("ai_chat_sessions", DB),
    table("ai_chat_shares", DB),
    table("ai_chat_turns", DB),
    table("alert_calibration_configs", DB),
    table("alert_composite_children", DB),
    table("alert_composites", DB),
    exempt(
        Kind::Table,
        "alert_dedup_state",
        "expires within a day through the alert_dedup_cleanup job; no alert of a deleted org refreshes it",
    ),
    table("alert_eval_intervals", DB),
    table("alert_incident_alerts", DB),
    table("alert_incidents", DB),
    table("alert_state_transitions", DB),
    table("alert_states", DB),
    table("alerts", DB),
    table("anomaly_detection_config", DB),
    table("anomaly_detection_models", DB),
    exempt(
        Kind::Table,
        "aws_marketplace_subscriptions",
        "CASCADE from customer_billings; Q10",
    ),
    table("azure_metadata", CLOUD),
    table("backfill_jobs", DB),
    table("billing_group_invites", CLOUD),
    table("billing_group_members", CLOUD),
    table("cipher_keys", DRAIN_FINAL),
    table("compactor_manual_jobs", DB),
    table("customer_billings", CLOUD),
    table("dashboards", DB),
    table("destinations", DB),
    table("distinct_value_fields", DB),
    table("downtime_notifications", DB),
    table("downtimes", DB),
    table("enrichment_table_urls", DB),
    table("enrichment_tables", DB),
    table("external_alerts", DB),
    table_late("file_list", FILE_LIST, FILE_LIST_FINAL),
    table_late("file_list_deleted", DRAIN, DRAIN_FINAL),
    table_late("file_list_history", FILE_LIST, FILE_LIST_FINAL),
    table_late("file_list_jobs", FILE_LIST, FILE_LIST_FINAL),
    table("folders", DB),
    table("gen_ai_agents", DB),
    table("incident_events", DB),
    table("incident_integration_senders", DB),
    table("incident_integrations", DB),
    table("kv_store", DB),
    table("llm_annotation_queue_bindings", DB),
    table("llm_annotation_queue_items", DB),
    table("llm_annotation_queues", DB),
    table("llm_dataset_items", DB),
    table("llm_datasets", DB),
    table("llm_experiment_slot_retries", DB),
    table("llm_experiments", DB),
    table("llm_idempotency_records", DB),
    table("llm_playground_snapshots", DB),
    table("llm_prompt_label_events", DB),
    table("llm_prompt_labels", DB),
    table("llm_prompt_versions", DB),
    table("llm_prompt_webhook_deliveries", DB),
    table("llm_prompts", DB),
    table("llm_remote_tasks", DB),
    table("llm_secrets", DB),
    table("model_pricing", DB),
    table("oncall_delivery_reads", DB),
    table("oncall_overrides", DB),
    table("oncall_ownership_rules", DB),
    table("oncall_policies", DB),
    table("oncall_response_events", DB),
    table("oncall_response_reports", DB),
    table("oncall_responses", DB),
    table("oncall_routing_config", DB),
    table("oncall_schedules", DB),
    table("oncall_team_members", DB),
    table("oncall_teams", DB),
    table("oncall_unavailability", DB),
    table("oncall_unrouted_signals", DB),
    table("oncall_user_contacts", DB),
    table("online_eval_jobs", DB),
    table("org_ai_toolsets", DB),
    exempt(Kind::Table, "org_cleanup_tasks", "deleted last by step 900"),
    table("org_ingestion_tokens", DB),
    table("org_invites", CLOUD),
    table("org_storage_providers", DRAIN_FINAL),
    table("org_telephony", DB),
    table("org_users", "delete_users"),
    exempt(
        Kind::Table,
        "organizations",
        "the tombstone row; swept by the promotion scheduler",
    ),
    table("pipeline", DB),
    table("pipeline_last_errors", DB),
    table("providers", DB),
    table("query_history", DB),
    table("rate_limit_rules", DB),
    table("re_pattern_stream_map", DB),
    table("re_patterns", DB),
    table("report_dashboards", DB),
    table("reports", DB),
    table("rum_pa_app_settings", DB),
    table("rum_pa_funnels", DB),
    table("rum_pa_named_events", DB),
    table("rum_pa_tombstones", DB),
    table("scheduled_jobs", "delete_scheduler_triggers"),
    table("score_configs", DB),
    table("scorers", DB),
    table("search_job_partitions", DB),
    table("search_job_results", DB),
    table("search_jobs", DB),
    table("search_queue", DB),
    table("service_streams", DB),
    exempt(
        Kind::Table,
        "sessions",
        "login sessions of users, not of an org; they expire",
    ),
    table("short_urls", DB),
    table("slo_backfill_jobs", DB),
    table("slo_budget", DB),
    table("slo_budget_charges", DB),
    table("slo_status", DB),
    table("slos", DB),
    table("source_maps", DB),
    table("status_page_audit_log", DB),
    table("status_page_check_snoozes", DB),
    table("status_page_component_checks", DB),
    table("status_page_components", DB),
    table("status_page_custom_domains", DB),
    table("status_page_notice_components", DB),
    table("status_page_notice_updates", DB),
    table("status_page_notices", DB),
    table("status_page_snapshots", DB),
    table("status_pages", DB),
    table("stream_stats", "delete_file_list"),
    table("synthetics", DB),
    table("synthetics_agents", DB),
    table("synthetics_environments", DB),
    table("synthetics_jobs", DB),
    table("synthetics_locations", DB),
    table("synthetics_probe_tokens", DB),
    table("synthetics_refs", DB),
    table("synthetics_runs", DB),
    table("synthetics_variables", DB),
    table("system_settings", DB),
    table("templates", DB),
    table("timed_annotation_panels", DB),
    table("timed_annotations", DB),
    table("trial_quota_usage", DB),
    table("user_auth_state", "delete_users"),
    table("user_password_history", "delete_users"),
    table("users", "delete_users"),
    table("workflow_associations", DB),
    table("workflow_drafts", DB),
    table("workflow_errors", DB),
    table("workflow_run_data", DB),
    table("workflows", DB),
    covered(Kind::KvPrefix, "/cipher_keys/{org}/", DB),
    covered(Kind::KvPrefix, "/compact/downsampling/{org}/", DB),
    covered(Kind::KvPrefix, "/compact/files/{org}/", DB),
    covered(Kind::KvPrefix, "/compact/organization/{org}/", DB),
    covered(Kind::KvPrefix, "/db_monitoring/offsets/{org}/", DB),
    covered(
        Kind::KvPrefix,
        "/enrichment_table_meta_stream_stats/{org}/",
        DB,
    ),
    covered(Kind::KvPrefix, "/enrichment_table_size/{org}/", DB),
    covered(Kind::KvPrefix, "/function/{org}/", DB),
    covered(
        Kind::KvPrefix,
        "/ingest_rejection/{org}",
        "delete_org_record",
    ),
    covered(Kind::KvPrefix, "/metrics_leader/{org}/", DB),
    covered(Kind::KvPrefix, "/metrics_members/{org}/", DB),
    covered(
        Kind::KvPrefix,
        "/organization/org/{org}",
        "delete_org_record",
    ),
    covered(Kind::KvPrefix, "/organization/savedviews/{org}/", DB),
    covered(Kind::KvPrefix, "/organization/setting/{org}", DB),
    covered(Kind::KvPrefix, "/schema/{org}/", "delete_stream"),
    covered(Kind::KvPrefix, "/service_graph/v4/offsets/{org}/", DB),
    exempt(
        Kind::KvPrefix,
        "/onboarding/first_data_email/{org}",
        "Cloud one-shot marker; kept, as main's org delete keeps it (open item)",
    ),
    exempt(
        Kind::KvPrefix,
        "/organization/status/{org}",
        "the tombstone block; the tombstone sweep evicts it",
    ),
    exempt(
        Kind::KvPrefix,
        "/org_cleanup/tombstone_purge/{org}/",
        "the tombstone sweep's own mark, removed when its purge finishes",
    ),
    exempt(
        Kind::KvPrefix,
        "/org_cleanup/lifecycle/{org}",
        "a lock, released after every use",
    ),
    exempt(
        Kind::KvPrefix,
        "/compact/merge/{org}/",
        "a lock, released after every use",
    ),
    exempt(
        Kind::KvPrefix,
        "/synthetics/composition/{org}",
        "a lock, released after every use",
    ),
    exempt(
        Kind::KvPrefix,
        "/ai_chat_turn/{org}/",
        "a chat's turn lock, released after every turn",
    ),
    exempt(
        Kind::KvPrefix,
        "/ai_session_owners/",
        "o2-ai's claims, keyed by chat id; released as step 300 drops each chat's replica copy, or expire",
    ),
    exempt(
        Kind::KvPrefix,
        "/org_cleanup/worker_lock",
        "global worker lock; names no org",
    ),
    exempt(
        Kind::KvPrefix,
        "/anomaly_detection/write_intent/",
        "global; the enterprise write-intent sweeper removes each record",
    ),
    exempt(
        Kind::KvPrefix,
        "/org_cleanup/lease_nodes/",
        "global per-node rolling-upgrade markers; names no org, pruned when the node leaves",
    ),
    covered(Kind::ObjectPrefix, "anomaly_models/{org}/", DB),
    late(Kind::ObjectPrefix, "files/{org}/", DRAIN, DRAIN_FINAL),
    covered(Kind::ObjectPrefix, "synthetics/{org}/", DB),
    exempt(
        Kind::ObjectPrefix,
        "files/_meta/ usage, audit and trigger rows",
        "the _meta org's own history, kept for billing and audit",
    ),
    covered(Kind::LocalDisk, "enrichment_table_cache/{org}/", DB),
    covered(Kind::LocalDisk, "metrics_results/{org}/", DB),
    covered(Kind::LocalDisk, "results/{org}/", DB),
    covered(Kind::LocalDisk, "service_graph/{org}.json", ORG_RECORD),
    covered(Kind::Cache, "AI_CHAT_INITIALIZED_ORGS", ORG_RECORD),
    covered(Kind::Cache, "ALERTS", DB),
    covered(Kind::Cache, "ALERTS_TEMPLATES", DB),
    covered(Kind::Cache, "DASHBOARD_ID_TO_ORG", DB),
    covered(Kind::Cache, "DESTINATIONS", DB),
    covered(Kind::Cache, "DOWNTIMES", DB),
    covered(Kind::Cache, "ENRICHMENT_TABLES", DB),
    covered(Kind::Cache, "KVS", DB),
    covered(Kind::Cache, "METRIC_CLUSTER_LEADER", DB),
    covered(Kind::Cache, "METRIC_CLUSTER_MAP", DB),
    covered(Kind::Cache, "ORGANIZATION_SETTING", DB),
    covered(Kind::Cache, "ONCALL_BREAKERS", ORG_RECORD),
    covered(Kind::Cache, "ORGANIZATIONS", "delete_org_record"),
    covered(Kind::Cache, "ORG_LIMITS", "delete_org_record"),
    covered(Kind::Cache, "ORG_PAID_OVERAGE", "delete_org_record"),
    covered(Kind::Cache, "ORG_USAGE", "delete_org_record"),
    covered(Kind::Cache, "ORG_USERS", "delete_users"),
    covered(Kind::Cache, "QUERY_FUNCTIONS", DB),
    covered(Kind::Cache, "QUERY_RESULT_CACHE", DB),
    covered(Kind::Cache, "REGISTRY", DB),
    covered(Kind::Cache, "SHORT_URLS", DB),
    covered(Kind::Cache, "STREAM_ALERTS", DB),
    covered(Kind::Cache, "STREAM_SCHEMAS", "delete_stream"),
    covered(Kind::Cache, "SYSTEM_SETTINGS", DB),
    covered(Kind::Cache, "TRIGGERS_STREAM_INITIALIZED_ORGS", ORG_RECORD),
    covered(Kind::Cache, "o2-ai replica copies of the org's chats", DB),
    covered(Kind::Cache, "USERS", "delete_users"),
    exempt(
        Kind::Cache,
        "ORG_STATUS_CACHE",
        "holds the tombstone block until the tombstone sweep evicts it",
    ),
    exempt(Kind::Cache, "TTL caches", "expire on their own TTL"),
    covered(
        Kind::OpenFgaTuples,
        "org:{org} owningOrg {type}:_all_{org}, and every object owned that way",
        ORG_RECORD,
    ),
    covered(
        Kind::OpenFgaTuples,
        "role:{org}/* grants and assignments, o2-sre-readonly included",
        ORG_RECORD,
    ),
    covered(
        Kind::OpenFgaTuples,
        "group:{org}/* members and grants",
        ORG_RECORD,
    ),
    covered(
        Kind::OpenFgaTuples,
        "parent and selfParent links of _all_{org}, folders and streams",
        ORG_RECORD,
    ),
    covered(
        Kind::OpenFgaTuples,
        "user:{email} membership and role in org:{org}",
        "delete_users",
    ),
    covered(
        Kind::OpenFgaTuples,
        "template:{name} owningOrg org:{org}, and org:{name} unless a live org shares the name",
        DB,
    ),
];

/// What a coverage row names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Table,
    KvPrefix,
    ObjectPrefix,
    /// A path under the node's local data or cache directory, which no object-store listing shows.
    LocalDisk,
    Cache,
    OpenFgaTuples,
}

/// One org-scoped entity; `exempt` holds the reason when no cleanup step removes it.
#[derive(Debug, Clone, Copy)]
pub struct Coverage {
    pub kind: Kind,
    pub name: &'static str,
    pub step: &'static str,
    /// The later step that removes what is written after `step` ran.
    pub late_step: Option<&'static str>,
    pub exempt: Option<&'static str>,
}

const fn covered(kind: Kind, name: &'static str, step: &'static str) -> Coverage {
    Coverage {
        kind,
        name,
        step,
        late_step: None,
        exempt: None,
    }
}

const fn late(kind: Kind, name: &'static str, step: &'static str, then: &'static str) -> Coverage {
    Coverage {
        late_step: Some(then),
        ..covered(kind, name, step)
    }
}

const fn table(name: &'static str, step: &'static str) -> Coverage {
    covered(Kind::Table, name, step)
}

const fn table_late(name: &'static str, step: &'static str, then: &'static str) -> Coverage {
    late(Kind::Table, name, step, then)
}

const fn exempt(kind: Kind, name: &'static str, reason: &'static str) -> Coverage {
    Coverage {
        kind,
        name,
        step: "",
        late_step: None,
        exempt: Some(reason),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    /// Org-scoped tables whose entity sits outside `table/entity/`.
    const EXTRA_TABLES: [&str; 3] = ["distinct_value_fields", "short_urls", "service_streams"];
    /// Steps the worker runs by name, beyond the fixed steps it enqueues.
    const ITEM_STEPS: [&str; 2] = ["delete_stream", "delete_stream_final"];
    /// Tables that name their org through a parent id or key that no `belongs_to` declares.
    const PARENT_ID_SCOPED: [&str; 13] = [
        "alert_state_transitions",
        "alert_states",
        "compactor_manual_jobs",
        "external_identity_links",
        "incident_integration_senders",
        "llm_prompt_labels",
        "oncall_response_events",
        "oncall_team_members",
        "search_job_partitions",
        "search_job_results",
        "slo_backfill_jobs",
        "slo_status",
        "users",
    ];
    /// Entity tables that hold no org data at all.
    const GLOBAL_TABLES: [&str; 5] = [
        "oncall_phone_verifications",
        "sessions",
        "slack_installations",
        "slack_link_requests",
        "system_prompts",
    ];

    fn table_names_of(src: &str) -> Vec<String> {
        src.match_indices("table_name = \"")
            .map(|(at, marker)| {
                let rest = &src[at + marker.len()..];
                rest[..rest.find('"').unwrap()].to_string()
            })
            .collect()
    }

    fn is_org_scoped(src: &str) -> bool {
        src.contains("pub org_id:") || src.contains("pub org:") || src.contains("pub org_name:")
    }

    fn org_scoped_tables_in(dir: &str) -> BTreeSet<String> {
        let mut tables = BTreeSet::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|ext| ext != "rs") {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            if is_org_scoped(&src) {
                tables.extend(table_names_of(&src));
            }
        }
        tables
    }

    /// `(module, table, source)` of every entity in `table/entity/`.
    fn entities() -> Vec<(String, String, String)> {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../infra/src/table/entity");
        let mut entities = Vec::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|ext| ext != "rs") {
                continue;
            }
            let module = path.file_stem().unwrap().to_string_lossy().to_string();
            let src = std::fs::read_to_string(&path).unwrap();
            for table in table_names_of(&src) {
                entities.push((module.clone(), table, src.clone()));
            }
        }
        entities
    }

    /// Entity tables scoped by an org column, a parent id, or a `belongs_to` chain to either.
    fn indirectly_scoped_tables() -> BTreeSet<String> {
        let entities = entities();
        let mut scoped: BTreeSet<String> = entities
            .iter()
            .filter(|(_, table, src)| {
                is_org_scoped(src) || PARENT_ID_SCOPED.contains(&table.as_str())
            })
            .map(|(module, ..)| module.clone())
            .collect();
        loop {
            let before = scoped.len();
            for (module, _, src) in &entities {
                let parent_scoped = scoped.iter().any(|parent| {
                    src.contains(&format!("belongs_to = \"super::{parent}::Entity\""))
                });
                if parent_scoped {
                    scoped.insert(module.clone());
                }
            }
            if scoped.len() == before {
                break;
            }
        }
        entities
            .into_iter()
            .filter(|(module, ..)| scoped.contains(module))
            .map(|(_, table, _)| table)
            .collect()
    }

    #[test]
    fn test_every_org_scoped_entity_is_covered_or_exempt() {
        let table_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../infra/src/table");
        let mut tables = org_scoped_tables_in(&format!("{table_dir}/entity"));
        tables.extend(org_scoped_tables_in(table_dir));
        tables.extend(indirectly_scoped_tables());
        for extra in EXTRA_TABLES {
            assert!(tables.contains(extra), "the scan no longer finds {extra}");
        }
        let listed: BTreeSet<String> = COVERAGE
            .iter()
            .filter(|c| c.kind == Kind::Table)
            .map(|c| c.name.to_string())
            .collect();
        let missing: Vec<_> = tables.difference(&listed).collect();
        assert!(
            missing.is_empty(),
            "org-scoped tables with no cleanup entry: {missing:?}"
        );
    }

    #[test]
    fn test_every_entity_table_is_org_scoped_or_named_global() {
        let scoped = indirectly_scoped_tables();
        let tables: BTreeSet<String> = entities().into_iter().map(|(_, table, _)| table).collect();
        for named in PARENT_ID_SCOPED.iter().chain(GLOBAL_TABLES.iter()) {
            assert!(
                tables.contains(*named),
                "{named} is no longer an entity table"
            );
        }
        let unclassified: Vec<_> = tables
            .iter()
            .filter(|t| !scoped.contains(*t) && !GLOBAL_TABLES.contains(&t.as_str()))
            .collect();
        assert!(
            unclassified.is_empty(),
            "entity tables neither org-scoped nor global: {unclassified:?}"
        );
    }

    #[test]
    fn test_every_covered_step_exists() {
        for c in COVERAGE {
            if c.exempt.is_none() {
                for step in std::iter::once(c.step).chain(c.late_step) {
                    assert!(
                        KNOWN_STEPS.contains(&step),
                        "{} names unknown step {step}",
                        c.name
                    );
                }
            }
        }
    }

    #[test]
    fn test_rows_queued_after_the_first_drain_are_credited_to_the_final_drain() {
        for (kind, name) in [
            (Kind::Table, "file_list_deleted"),
            (Kind::ObjectPrefix, "files/{org}/"),
        ] {
            let row = COVERAGE
                .iter()
                .find(|c| c.kind == kind && c.name == name)
                .unwrap();
            assert_eq!(row.step, "drain_deleted_files", "{name}");
            assert_eq!(row.late_step, Some("drain_deleted_files_final"), "{name}");
        }
        for name in ["file_list", "file_list_history", "file_list_jobs"] {
            let row = COVERAGE.iter().find(|c| c.name == name).unwrap();
            assert_eq!(row.late_step, Some("delete_file_list_final"), "{name}");
        }
    }

    #[test]
    fn test_known_steps_are_steps_the_worker_runs() {
        let fixed: Vec<String> = crate::org_cleanup::fixed_steps("org", "org")
            .into_iter()
            .map(|t| t.step)
            .collect();
        for step in &fixed {
            assert!(
                KNOWN_STEPS.contains(&step.as_str()),
                "{step} is missing from KNOWN_STEPS"
            );
        }
        let source = include_str!("mod.rs");
        for step in KNOWN_STEPS {
            let known = fixed.iter().any(|f| f == step)
                || (ITEM_STEPS.contains(step) && source.contains(&format!("\"{step}:\"")))
                || source.contains(&format!("::{step}(org_id)"));
            assert!(known, "{step} is neither a worker step nor a call of one");
        }
    }

    #[test]
    fn test_exempt_rows_give_a_reason_and_no_step() {
        for c in COVERAGE {
            if let Some(reason) = c.exempt {
                assert!(!reason.is_empty(), "{} is exempt without a reason", c.name);
                assert!(c.step.is_empty(), "{} is exempt but names a step", c.name);
                assert!(
                    c.late_step.is_none(),
                    "{} is exempt but names a step",
                    c.name
                );
            }
        }
    }

    #[test]
    fn test_local_cache_paths_are_local_disk_rows() {
        for path in [
            "enrichment_table_cache/{org}/",
            "metrics_results/{org}/",
            "results/{org}/",
            "service_graph/{org}.json",
        ] {
            let kinds: Vec<Kind> = COVERAGE
                .iter()
                .filter(|c| c.name == path)
                .map(|c| c.kind)
                .collect();
            assert_eq!(kinds, [Kind::LocalDisk], "{path}");
        }
    }

    #[test]
    fn test_openfga_tuples_are_declared() {
        let tuples: Vec<&Coverage> = COVERAGE
            .iter()
            .filter(|c| c.kind == Kind::OpenFgaTuples)
            .collect();
        for needle in [
            "owningOrg",
            "o2-sre-readonly",
            "group:",
            "parent",
            "selfParent",
        ] {
            assert!(
                tuples
                    .iter()
                    .any(|c| c.name.contains(needle) && c.step == "delete_org_record"),
                "no OpenFGA row removed by step 900 names {needle}"
            );
        }
        assert!(
            tuples
                .iter()
                .any(|c| c.name.contains("user:") && c.step == "delete_users"),
            "no OpenFGA row covers the members' tuples"
        );
        assert!(
            tuples
                .iter()
                .any(|c| c.name.starts_with("template:") && c.step == DB && c.exempt.is_none()),
            "no OpenFGA row covers the template ownership tuples"
        );
    }

    #[test]
    fn test_no_entity_is_listed_twice() {
        let mut seen = BTreeSet::new();
        for c in COVERAGE {
            assert!(
                seen.insert((c.kind as u8, c.name)),
                "{} is listed twice",
                c.name
            );
        }
    }
}
