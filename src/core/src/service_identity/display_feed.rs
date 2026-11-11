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

//! Feeds the ENT display index and copies its answers onto read responses.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    sync::LazyLock,
};

use config::meta::{
    alerts::incidents::Incident,
    service_identity::{AliasRow, SIGNAL_TRACES, WhereSummaryRecord, service_key},
};
use dashmap::DashSet;
use infra::table::service_streams::ServiceRecord;
use o2_enterprise::enterprise::service_identity::{
    aliases::AliasKind,
    display::{self, DisplayAlias, DisplayScope, ServiceDisplay},
};
use serde_json::Value;

const NAMESPACE_DIM: &str = "k8s-namespace";
const WORKLOAD_DIMS: [&str; 3] = ["k8s-deployment", "k8s-statefulset", "k8s-daemonset"];

// Orgs whose index this process has built at least once, so a read never waits twice.
static BUILT: LazyLock<DashSet<String>> = LazyLock::new(DashSet::new);

/// The four optional response fields of one identity's display.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct DisplayFields {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_candidates: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_qualifier: Option<String>,
}

impl From<ServiceDisplay> for DisplayFields {
    fn from(display: ServiceDisplay) -> Self {
        Self {
            display_name: Some(display.display_name),
            display_source: Some(display.display_source.to_string()),
            display_candidates: (!display.display_candidates.is_empty())
                .then_some(display.display_candidates),
            display_qualifier: display.display_qualifier,
        }
    }
}

/// Wires coordinator events to index rebuilds and replicated alias puts to collision checks.
pub fn init() {
    infra::table::service_name_aliases::set_conflict_rule(super::aliases::conflicted_aliases);
    db::service_identity::set_display_rebuild(|org| {
        Box::pin(async move {
            rebuild_org(&org).await;
        })
    });
}

/// Rebuilds one org from its cached summaries and aliases; a failed read keeps the old index.
pub async fn rebuild_org(org: &str) -> bool {
    let summaries = match db::service_identity::get_cached_summaries(org).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[SERVICE_DISPLAY] summaries for org {org} unavailable: {e}");
            return false;
        }
    };
    let aliases = match db::service_identity::get_cached_aliases(org).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[SERVICE_DISPLAY] aliases for org {org} unavailable: {e}");
            return false;
        }
    };
    let identities = identities(org).await;
    rebuild_placed(org, &summaries, &aliases, &identities);
    BUILT.insert(org.to_string());
    true
}

/// The pure rebuild: trace summary rows (never the registry) plus active aliases.
pub fn rebuild_from(org: &str, summaries: &[WhereSummaryRecord], aliases: &[AliasRow]) {
    display::rebuild(org, trace_scopes(summaries), active_aliases(aliases));
}

/// Like `rebuild_from`, with each unscoped rename placed in the namespaces its identities live in.
pub fn rebuild_placed(
    org: &str,
    summaries: &[WhereSummaryRecord],
    aliases: &[AliasRow],
    identities: &[ServiceRecord],
) {
    // Places can change after the last alias write, so re-derive conflicts from the inputs.
    let conflicted: BTreeSet<String> =
        super::aliases::conflicted_aliases(summaries, aliases, identities)
            .into_iter()
            .collect();
    let current: Vec<AliasRow> = aliases
        .iter()
        .map(|row| AliasRow {
            conflicted: conflicted.contains(&row.alias_key),
            ..row.clone()
        })
        .collect();
    display::rebuild(
        org,
        trace_scopes(summaries),
        placed_aliases(&current, summaries, identities),
    );
}

pub async fn identities(org: &str) -> Vec<ServiceRecord> {
    infra::table::service_streams::list(org)
        .await
        .unwrap_or_else(|e| {
            log::error!("[SERVICE_DISPLAY] registry for org {org} unavailable: {e}");
            Vec::new()
        })
}

/// Boot and hourly: every org with discovered services.
pub async fn rebuild_all() {
    match infra::table::service_streams::list_distinct_orgs().await {
        Ok(orgs) => {
            for org in orgs {
                rebuild_org(&org).await;
            }
        }
        Err(e) => log::error!("[SERVICE_DISPLAY] listing orgs failed: {e}"),
    }
}

/// Builds the org's index on its first read in this process.
pub async fn ensure(org: &str) {
    if !BUILT.contains(org) {
        rebuild_org(org).await;
    }
}

/// Display fields of one `service_streams` identity, from its stored JSON dimensions.
pub fn display_of(
    org: &str,
    key: &str,
    disambiguation: &Value,
    all_dimensions: &Value,
) -> DisplayFields {
    display::display_for(
        org,
        key,
        &string_map(disambiguation),
        &string_map(all_dimensions),
    )
    .into()
}

/// The display name of a bare service value, for pickers that carry no dimensions.
pub fn label(org: &str, value: &str) -> String {
    display::display_for(org, value, &HashMap::new(), &HashMap::new()).display_name
}

/// Each bare service key's display, resolved through the registry identities that carry the key.
pub async fn labels(
    org: &str,
    values: impl IntoIterator<Item = String>,
) -> HashMap<String, String> {
    let records = match infra::table::service_streams::list(org).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[SERVICE_DISPLAY] registry for org {org} unavailable: {e}");
            Vec::new()
        }
    };
    labels_from(
        org,
        values,
        records.iter().map(|r| {
            (
                r.service_name.as_str(),
                &r.disambiguation,
                &r.all_dimensions,
            )
        }),
    )
}

/// A key whose identities disagree on a name, or has none, falls back to its dimensionless display.
pub fn labels_from<'a>(
    org: &str,
    values: impl IntoIterator<Item = String>,
    identities: impl IntoIterator<Item = (&'a str, &'a Value, &'a Value)>,
) -> HashMap<String, String> {
    let mut shown: HashMap<&str, BTreeSet<String>> = HashMap::new();
    for (key, disambiguation, all_dimensions) in identities {
        if let Some(name) = display_of(org, key, disambiguation, all_dimensions).display_name {
            shown.entry(key).or_default().insert(name);
        }
    }
    values
        .into_iter()
        .map(|value| {
            let agreed = shown
                .get(value.as_str())
                .filter(|names| names.len() == 1)
                .and_then(|names| names.first().cloned());
            let name = agreed.unwrap_or_else(|| label(org, &value));
            (value, name)
        })
        .collect()
}

/// Fills `group_values_display` and node `display_name` on a response copy only.
pub fn decorate_incident(org: &str, incident: &mut Incident, identities: &[ServiceRecord]) {
    let dimensions = string_map(&incident.group_values);
    let none = HashMap::new();
    let service = dimensions.get("service");
    if let Some(service) = service {
        let shown = incident_display(org, service, &dimensions, identities);
        incident.group_values_display = Some(HashMap::from([("service".to_string(), shown)]));
    }
    if let Some(topology) = incident.topology_context.as_mut() {
        for node in &mut topology.nodes {
            let own = service.is_some_and(|s| service_key(s) == service_key(&node.service_name));
            let dims = if own { &dimensions } else { &none };
            node.display_name = Some(incident_display(org, &node.service_name, dims, identities));
        }
    }
}

/// The dimensions a new incident's title is built from: `service` shows its display name.
pub fn title_dimensions(
    org: &str,
    group_values: &HashMap<String, String>,
    identities: &[ServiceRecord],
) -> HashMap<String, String> {
    let mut dimensions = group_values.clone();
    if let Some(service) = group_values.get("service") {
        let shown = incident_display(org, service, group_values, identities);
        dimensions.insert("service".to_string(), shown);
    }
    dimensions
}

pub fn incident_display(
    org: &str,
    key: &str,
    dimensions: &HashMap<String, String>,
    identities: &[ServiceRecord],
) -> String {
    let wanted = service_key(key);
    let names: BTreeSet<String> = identities
        .iter()
        .filter(|r| r.service_name == wanted && compatible(&r.disambiguation, dimensions))
        .filter_map(|r| display_of(org, key, &r.disambiguation, &r.all_dimensions).display_name)
        .collect();
    match names.len() {
        1 => names.into_iter().next().unwrap_or_default(),
        _ => display::display_for(org, key, &HashMap::new(), dimensions).display_name,
    }
}

/// One scope per distinct (service, env, namespace) of the trace summary rows, for every env seen.
pub fn trace_scopes(rows: &[WhereSummaryRecord]) -> Vec<DisplayScope> {
    let mut scopes: BTreeMap<(String, String, String), i64> = BTreeMap::new();
    for row in rows.iter().filter(|row| row.signal == SIGNAL_TRACES) {
        for env in std::iter::once(&row.env).chain(&row.envs) {
            let seen = scopes
                .entry((
                    row.service_name.clone(),
                    env.clone(),
                    row.k8s_namespace.clone(),
                ))
                .or_insert(row.last_seen);
            *seen = (*seen).max(row.last_seen);
        }
    }
    scopes
        .into_iter()
        .map(|((service, env, k8s_namespace), last_seen)| DisplayScope {
            service,
            env,
            k8s_namespace,
            last_seen,
        })
        .collect()
}

/// Live `active` aliases of a known kind.
pub fn active_aliases(rows: &[AliasRow]) -> Vec<DisplayAlias> {
    rows.iter()
        .filter(|row| row.status == "active" && !row.conflicted && row.deleted_at.is_none())
        .filter_map(display_alias)
        .collect()
}

pub fn display_alias(row: &AliasRow) -> Option<DisplayAlias> {
    Some(DisplayAlias {
        kind: alias_kind(&row.kind)?,
        scope: row.scope.clone(),
        alias: row.alias.clone(),
        canonical: row.canonical.clone(),
        places: Vec::new(),
    })
}

pub fn placed_aliases(
    aliases: &[AliasRow],
    summaries: &[WhereSummaryRecord],
    identities: &[ServiceRecord],
) -> Vec<DisplayAlias> {
    let mut out = Vec::new();
    let live = aliases
        .iter()
        .filter(|row| row.status == "active" && !row.conflicted && row.deleted_at.is_none());
    for row in live {
        let Some(mut alias) = display_alias(row) else {
            continue;
        };
        alias.places = alias_places(row, summaries, identities);
        if row.kind != "rename" || !row.scope.trim().is_empty() {
            out.push(alias);
            continue;
        }
        let alias_key = service_key(&row.alias);
        let namespaces: BTreeSet<String> = identities
            .iter()
            .filter(|r| service_key(&r.service_name) == alias_key)
            .filter_map(|r| string_map(&r.disambiguation).remove("k8s-namespace"))
            .filter(|ns| !ns.trim().is_empty())
            .collect();
        if namespaces.is_empty() {
            out.push(alias);
            continue;
        }
        for namespace in namespaces {
            let places = alias
                .places
                .iter()
                .filter(|place| {
                    place.k8s_namespace.is_empty()
                        || place.k8s_namespace.eq_ignore_ascii_case(&namespace)
                })
                .cloned()
                .collect();
            out.push(DisplayAlias {
                scope: namespace,
                places,
                ..alias.clone()
            });
        }
    }
    out
}

/// Each place a detected identity of the alias lives, with its env; empty when none is known.
pub fn alias_places(
    row: &AliasRow,
    summaries: &[WhereSummaryRecord],
    identities: &[ServiceRecord],
) -> Vec<DisplayScope> {
    let mut places: BTreeSet<(String, String)> = identities
        .iter()
        .filter(|record| detects(row, record))
        .map(|record| {
            let namespace = dimension(record, NAMESPACE_DIM).unwrap_or_default();
            let env = env_of(summaries, &record.service_name, &namespace);
            (env, namespace)
        })
        .collect();
    if row.kind != "k8s_workload" {
        let alias_key = service_key(&row.alias);
        places.extend(
            summaries
                .iter()
                .filter(|s| service_key(&s.service_name) == alias_key)
                .filter(|s| {
                    row.scope.is_empty() || s.k8s_namespace.eq_ignore_ascii_case(&row.scope)
                })
                .map(|s| (s.env.trim().to_string(), s.k8s_namespace.trim().to_string())),
        );
    }
    places
        .into_iter()
        .map(|(env, k8s_namespace)| DisplayScope {
            service: row.alias.clone(),
            env,
            k8s_namespace,
            ..Default::default()
        })
        .collect()
}

pub fn alias_kind(kind: &str) -> Option<AliasKind> {
    match kind {
        "rename" => Some(AliasKind::Rename),
        "k8s_workload" => Some(AliasKind::K8sWorkload),
        "rum_service" => Some(AliasKind::RumService),
        _ => None,
    }
}

/// An identity fits when every dimension it is distinguished by and the incident carries agrees.
fn compatible(disambiguation: &Value, dimensions: &HashMap<String, String>) -> bool {
    string_map(disambiguation).iter().all(|(name, value)| {
        dimensions
            .get(name)
            .is_none_or(|given| given.eq_ignore_ascii_case(value))
    })
}

fn string_map(value: &Value) -> HashMap<String, String> {
    value
        .as_object()
        .map(|map| {
            map.iter()
                .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn detects(row: &AliasRow, record: &ServiceRecord) -> bool {
    let namespace = dimension(record, NAMESPACE_DIM).unwrap_or_default();
    let in_scope = row.scope.is_empty() || namespace.eq_ignore_ascii_case(&row.scope);
    if row.kind == "k8s_workload" {
        return !row.scope.is_empty()
            && in_scope
            && WORKLOAD_DIMS.iter().any(|dim| {
                dimension(record, dim).is_some_and(|w| w.eq_ignore_ascii_case(&row.alias))
            });
    }
    in_scope && service_key(&record.service_name) == service_key(&row.alias)
}

fn dimension(record: &ServiceRecord, name: &str) -> Option<String> {
    [&record.disambiguation, &record.all_dimensions]
        .into_iter()
        .find_map(|dims| {
            dims.get(name)?
                .as_str()
                .map(str::trim)
                .filter(|v| !v.is_empty())
        })
        .map(str::to_string)
}

/// The one env the identity's own summary rows carry in its namespace, else empty (unknown).
fn env_of(summaries: &[WhereSummaryRecord], service: &str, namespace: &str) -> String {
    let key = service_key(service);
    let envs: BTreeSet<String> = summaries
        .iter()
        .filter(|s| service_key(&s.service_name) == key)
        .filter(|s| s.k8s_namespace.eq_ignore_ascii_case(namespace))
        .map(|s| s.env.trim().to_string())
        .filter(|env| !env.is_empty())
        .collect();
    match envs.len() {
        1 => envs.into_iter().next().unwrap_or_default(),
        _ => String::new(),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use config::meta::service_identity::alias_key;
    use serde_json::json;

    use super::*;

    const FIXTURE: &str = r#"{"trace_scopes": [
        {"service": "CartService", "env": "prod", "k8s_namespace": "shop"},
        {"service": "CheckoutService", "env": "prod", "k8s_namespace": "shop"},
        {"service": "InventoryService", "env": "prod", "k8s_namespace": "shop"},
        {"service": "PaymentService", "env": "prod", "k8s_namespace": "shop"},
        {"service": "alertmanager", "env": "pentest", "k8s_namespace": "pentest"},
        {"service": "billing-worker", "env": "prod", "k8s_namespace": "batch"},
        {"service": "compactor", "env": "prod", "k8s_namespace": "o2"},
        {"service": "ingester", "env": "prod", "k8s_namespace": "o2"},
        {"service": "querier", "env": "pentest", "k8s_namespace": "pentest"},
        {"service": "querier", "env": "prod", "k8s_namespace": "o2"},
        {"service": "report-worker", "env": "prod", "k8s_namespace": "batch"},
        {"service": "stock-svc", "env": "prod", "k8s_namespace": "shop"},
        {"service": "unknown_service:node", "env": "default", "k8s_namespace": ""}
    ], "aliases": [
        {"kind": "k8s_workload", "scope": "batch", "alias": "worker", "canonical": "billing-worker", "status": "proposed", "confidence": "low"},
        {"kind": "k8s_workload", "scope": "o2", "alias": "compactor", "canonical": "compactor", "status": "active", "confidence": "high"},
        {"kind": "k8s_workload", "scope": "o2", "alias": "ingester", "canonical": "ingester", "status": "active", "confidence": "high"},
        {"kind": "k8s_workload", "scope": "o2", "alias": "querier", "canonical": "querier", "status": "active", "confidence": "high"},
        {"kind": "k8s_workload", "scope": "pentest", "alias": "alertquerier", "canonical": "querier", "status": "proposed", "confidence": "medium"},
        {"kind": "k8s_workload", "scope": "shop", "alias": "cart", "canonical": "CartService", "status": "active", "confidence": "high"},
        {"kind": "k8s_workload", "scope": "shop", "alias": "checkout", "canonical": "CheckoutService", "status": "active", "confidence": "high"},
        {"kind": "k8s_workload", "scope": "shop", "alias": "inventory", "canonical": "InventoryService", "status": "active", "confidence": "high"},
        {"kind": "k8s_workload", "scope": "shop", "alias": "payments", "canonical": "PaymentService", "status": "active", "confidence": "high"},
        {"kind": "rename", "scope": "", "alias": "legacy-cart", "canonical": "CartService", "status": "active", "confidence": "high"},
        {"kind": "rename", "scope": "shop", "alias": "stock-svc", "canonical": "InventoryService", "status": "proposed", "confidence": "high"}
    ], "rows": [
        {"service_name": "alertmanager", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "pentest", "k8s-deployment": "alertquerier"}},
        {"service_name": "billing-worker", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "batch"}},
        {"service_name": "cartservice", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "shop", "k8s-deployment": "cart"}},
        {"service_name": "checkoutservice", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "shop", "k8s-deployment": "checkout"}},
        {"service_name": "compactor", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "o2", "k8s-deployment": "compactor"}},
        {"service_name": "ingester", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "o2", "k8s-deployment": "ingester"}},
        {"service_name": "inventoryservice", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "shop", "k8s-deployment": "inventory"}},
        {"service_name": "legacy-cart", "disambiguation": {}},
        {"service_name": "payments-api", "disambiguation": {"k8s-namespace": "shop", "k8s-deployment": "payments"}},
        {"service_name": "paymentservice", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "shop", "k8s-deployment": "payments"}},
        {"service_name": "pentest-openobserve-alertquerier", "disambiguation": {"k8s-namespace": "pentest", "k8s-deployment": "alertquerier"}},
        {"service_name": "querier", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "o2", "k8s-deployment": "querier"}},
        {"service_name": "querier", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "pentest", "k8s-deployment": "alertquerier"}},
        {"service_name": "report-worker", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "batch"}},
        {"service_name": "stock-svc", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "shop", "k8s-deployment": "inventory"}}
    ]}"#;

    fn golden() -> Value {
        json!({"incident_detail": {
            "group_values": {"service": "checkoutservice"},
            "group_values_display": {"service": "CheckoutService"},
            "id": "3LPhhbjJ3gtA0figDTJjZEB441c",
            "title": "Checkout latency high on CheckoutService",
            "topology_context": {
                "edges": [],
                "nodes": [{
                    "alert_count": 1,
                    "alert_id": "3LPhheFd4CsjjtqaoT6FvSc19ZG",
                    "alert_name": "Checkout latency high",
                    "display_name": "CheckoutService",
                    "first_fired_at": 1793361730690582_i64,
                    "last_fired_at": 1793361730690582_i64,
                    "service_name": "checkoutservice"
                }],
                "related_incident_ids": []
            }
        }})
    }

    pub(crate) fn fixture() -> Value {
        let mut fixture: Value = serde_json::from_str(FIXTURE).unwrap();
        for row in fixture["rows"].as_array_mut().unwrap() {
            let mut all = json!({"service": row["service_name"]});
            all.as_object_mut()
                .unwrap()
                .extend(row["disambiguation"].as_object().unwrap().clone());
            row["all_dimensions"] = all;
        }
        fixture
    }

    pub(crate) fn summaries(org: &str, fixture: &Value, signal: &str) -> Vec<WhereSummaryRecord> {
        fixture["trace_scopes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|scope| {
                let namespace = scope["k8s_namespace"].as_str().unwrap();
                serde_json::from_value(json!({
                    "summary_key": "", "org_id": org, "service_name": scope["service"],
                    "where_key": format!("k8s:stage8/{namespace}"), "scope_key": "", "source_stream": "default",
                    "signal": signal, "k8s_cluster": "stage8", "k8s_namespace": namespace,
                    "env": scope["env"], "env_source": "attribute", "env_source_value": scope["env"],
                    "newest_version": "", "newest_version_key": "", "newest_first_seen": 0,
                    "has_version": false, "first_seen": 0, "last_seen": 0, "purged_versions": 0, "updated_at": 0,
                }))
                .unwrap()
            })
            .collect()
    }

    pub(crate) fn aliases(org: &str, fixture: &Value) -> Vec<AliasRow> {
        fixture["aliases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| {
                let text = |k: &str| a[k].as_str().unwrap_or_default().to_string();
                AliasRow {
                    alias_key: alias_key(org, &text("kind"), &text("scope"), &text("alias")),
                    org_id: org.into(),
                    kind: text("kind"),
                    scope: text("scope"),
                    alias: text("alias"),
                    canonical: text("canonical"),
                    status: text("status"),
                    confidence: text("confidence"),
                    origin: "learned".into(),
                    created_by: "system".into(),
                    writer_cluster: "fixture-region".into(),
                    updated_at: 10,
                    ..Default::default()
                }
            })
            .collect()
    }

    pub(crate) fn records(org: &str, fixture: &Value) -> Vec<ServiceRecord> {
        fixture["rows"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, row)| record(org, &format!("r{i}"), row))
            .collect()
    }

    pub(crate) fn record(org: &str, id: &str, row: &Value) -> ServiceRecord {
        ServiceRecord {
            id: id.to_string(),
            org_id: org.to_string(),
            service_name: row["service_name"].as_str().unwrap().to_string(),
            set_id: "kubernetes".into(),
            disambiguation: row["disambiguation"].clone(),
            all_dimensions: row["all_dimensions"].clone(),
            logs_streams: json!([]),
            traces_streams: json!([]),
            metrics_streams: json!([]),
            profiles_streams: json!([]),
            field_name_mapping: None,
            last_seen: 0,
        }
    }

    #[test]
    fn rebuild_reads_summary_not_registry() {
        let fixture = fixture();
        let org = "display_feed_summary_only";
        let mut rows = summaries(org, &fixture, "rum");
        rows.extend(summaries(
            org,
            &json!({"trace_scopes": [
                {"service": "CheckoutService", "env": "prod", "k8s_namespace": "shop"}
            ]}),
            SIGNAL_TRACES,
        ));
        rebuild_from(org, &rows, &[]);
        assert_eq!(label(org, "checkoutservice"), "CheckoutService");
        // A name only a non-trace summary row carries never becomes a trace match.
        let shown = display_of(org, "paymentservice", &Value::Null, &Value::Null);
        assert_eq!(shown.display_source.as_deref(), Some("detection"));
        assert_eq!(trace_scopes(&rows).len(), 1);
    }

    #[test]
    fn every_env_a_trace_row_was_seen_in_feeds_the_index() {
        let mut rows = summaries(
            "display_feed_envs",
            &json!({"trace_scopes": [
                {"service": "CheckoutService", "env": "prod", "k8s_namespace": "shop"}
            ]}),
            SIGNAL_TRACES,
        );
        rows[0].envs = vec!["prod".into(), "staging".into()];
        let envs: Vec<_> = trace_scopes(&rows).into_iter().map(|s| s.env).collect();
        assert_eq!(envs, ["prod", "staging"]);
    }

    #[test]
    fn inactive_tombstoned_and_unknown_aliases_never_feed_the_index() {
        let org = "display_feed_aliases";
        let mut rows = aliases(org, &fixture());
        let active = rows.iter().filter(|row| row.status == "active").count();
        assert_eq!(active_aliases(&rows).len(), active);
        for row in &mut rows {
            row.deleted_at = Some(1);
        }
        assert!(active_aliases(&rows).is_empty());
        let unknown = AliasRow {
            kind: "workload".into(),
            status: "active".into(),
            ..Default::default()
        };
        assert!(display_alias(&unknown).is_none());
    }

    #[test]
    fn recorded_aliases_carry_the_places_their_detected_identities_live_in() {
        let fixture = fixture();
        let org = "display_feed_places";
        let rows = summaries(org, &fixture, SIGNAL_TRACES);
        let identities = records(org, &fixture);
        let aliases = aliases(org, &fixture);
        let placed = placed_aliases(&aliases, &rows, &identities);
        assert!(placed.iter().any(|alias| !alias.places.is_empty()));
        for alias in placed.iter().filter(|a| a.kind == AliasKind::K8sWorkload) {
            for place in &alias.places {
                assert!(
                    place.k8s_namespace.eq_ignore_ascii_case(&alias.scope),
                    "{alias:?}"
                );
            }
        }
        let row = aliases.iter().find(|row| row.status == "active").unwrap();
        let expected = alias_places(row, &rows, &identities);
        let first = placed.iter().find(|a| a.alias == row.alias).unwrap();
        assert!(first.places.iter().all(|place| expected.contains(place)));
    }

    #[test]
    fn new_incident_title_uses_the_display_and_keeps_the_key() {
        let fixture = fixture();
        let org = "display_feed_title";
        rebuild_from(
            org,
            &summaries(org, &fixture, SIGNAL_TRACES),
            &aliases(org, &fixture),
        );
        let group_values = HashMap::from([
            ("service".to_string(), "checkoutservice".to_string()),
            ("host".to_string(), "node-1".to_string()),
        ]);
        let dims = title_dimensions(org, &group_values, &[]);
        assert_eq!(
            o2_enterprise::enterprise::alerts::incidents::generate_title("Latency", &dims),
            "Latency on CheckoutService"
        );
        assert_eq!(group_values["service"], "checkoutservice");
        let unknown = HashMap::from([("host".to_string(), "node-1".to_string())]);
        assert_eq!(title_dimensions(org, &unknown, &[]), unknown);
    }

    #[test]
    fn bare_keys_resolve_through_their_registry_identities() {
        let fixture = fixture();
        let org = "display_feed_labels";
        rebuild_from(
            org,
            &summaries(org, &fixture, SIGNAL_TRACES),
            &aliases(org, &fixture),
        );
        let rows = fixture["rows"].as_array().unwrap();
        let identities = || {
            rows.iter().map(|row| {
                (
                    row["service_name"].as_str().unwrap(),
                    &row["disambiguation"],
                    &row["all_dimensions"],
                )
            })
        };
        let keys = ["payments-api", "checkoutservice", "no-such-service"].map(String::from);
        let shown = labels_from(org, keys.clone(), identities());
        // A workload alias needs the identity's namespace and workload, which a bare key lacks.
        assert_eq!(label(org, "payments-api"), "payments-api");
        assert_eq!(shown["payments-api"], "PaymentService");
        assert_eq!(shown["checkoutservice"], "CheckoutService");
        assert_eq!(shown["no-such-service"], "no-such-service");
        let elsewhere = json!({"k8s-namespace": "other", "k8s-deployment": "payments"});
        let disagreeing = labels_from(
            org,
            keys,
            identities().chain([("payments-api", &elsewhere, &elsewhere)]),
        );
        assert_eq!(disagreeing["payments-api"], "payments-api");
    }

    #[test]
    fn incident_display_resolves_workload_aliases_through_registry_identities() {
        let golden = golden();
        let fixture = fixture();
        let org = "display_feed_incident_workload";
        rebuild_from(
            org,
            &summaries(org, &fixture, SIGNAL_TRACES),
            &aliases(org, &fixture),
        );
        let identities = records(org, &fixture);
        let mut topology = golden["incident_detail"]["topology_context"].clone();
        for node in topology["nodes"].as_array_mut().into_iter().flatten() {
            node["service_name"] = json!("payments-api");
            node.as_object_mut().unwrap().remove("display_name");
        }
        let mut incident: Incident = serde_json::from_value(json!({
            "id": "inc-workload", "org_id": org, "status": "open", "severity": "P1",
            "first_alert_at": 1, "last_alert_at": 1, "alert_count": 1, "created_at": 1, "updated_at": 1,
            "title": "payments-api", "group_values": {"service": "payments-api"},
            "topology_context": topology,
        }))
        .unwrap();
        decorate_incident(org, &mut incident, &identities);
        assert_eq!(
            incident.group_values_display,
            Some(HashMap::from([(
                "service".to_string(),
                "PaymentService".to_string()
            )]))
        );
        let nodes: Vec<_> = incident
            .topology_context
            .iter()
            .flat_map(|t| &t.nodes)
            .collect();
        assert!(!nodes.is_empty());
        for node in nodes {
            assert_eq!(node.display_name.as_deref(), Some("PaymentService"));
        }
        let group = HashMap::from([("service".to_string(), "payments-api".to_string())]);
        assert_eq!(
            title_dimensions(org, &group, &identities)["service"],
            "PaymentService"
        );
        let mut disagreeing = identities.clone();
        disagreeing.push(record(
            org,
            "elsewhere",
            &json!({"service_name": "payments-api", "disambiguation": {"k8s-cluster": "stage8", "k8s-namespace": "batch"}, "all_dimensions": {}}),
        ));
        assert_eq!(
            title_dimensions(org, &group, &disagreeing)["service"],
            "payments-api"
        );
        let shop = HashMap::from([
            ("service".to_string(), "payments-api".to_string()),
            ("k8s-namespace".to_string(), "shop".to_string()),
        ]);
        assert_eq!(
            title_dimensions(org, &shop, &disagreeing)["service"],
            "PaymentService"
        );
    }
}
