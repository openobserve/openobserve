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

//! Service versions deployed or rolled back in the window that feed an issue stream.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use infra::table::{
    entity::service_version_deploys::Model, service_version_deploys, service_version_verdicts,
};
use o2_enterprise::enterprise::autoobserve::{
    context::{ChangeAsk, ChangeKind, ChangeRecord, Checked, subject_of},
    contract::{Confidence, EntityRef},
    names::{dims, kinds},
    ports::OssSource,
};
use sea_orm::ConnectionTrait;

use super::{failed, issue_streams, link};

/// Also bounds the verdicts read, one batch for every listed deploy.
const ROWS: u64 = 50;
/// Subject dims holding the evidence streams the viewer must read, as `source_streams` stores them.
pub const EVIDENCE: &str = "evidence_streams";
pub const EVIDENCE_OVERFLOW: &str = "evidence_overflow";

pub async fn read(ask: &ChangeAsk) -> (Checked, Vec<ChangeRecord>) {
    let streams = issue_streams(ask);
    if streams.is_empty() {
        return (Checked::Ok, Vec::new());
    }
    let conn = infra::db::get_orm_client_ro().await;
    match deploys(conn, ask, &streams).await {
        Ok(answer) => answer,
        Err(e) => failed(OssSource::Deploys, &ask.org, e),
    }
}

/// The service, scoped to the evidence its Versions tab requires readable before showing a deploy.
/// Each pair is a stored `source_streams` list and its overflow flag; an unreadable list overflows.
pub fn scoped(service: &str, evidence: &[(&str, bool)]) -> EntityRef {
    let mut streams = BTreeSet::new();
    let mut overflow = false;
    for (listed, cut) in evidence {
        match serde_json::from_str::<Vec<String>>(listed) {
            Ok(listed) => streams.extend(listed),
            Err(_) => overflow = true,
        }
        overflow |= cut;
    }
    let streams = serde_json::to_string(&streams).unwrap_or_default();
    let mut subject = EntityRef::new(
        kinds::SERVICE,
        &[(dims::SERVICE_NAME, service), (EVIDENCE, &streams)],
    );
    if overflow {
        subject
            .key_dims
            .insert(EVIDENCE_OVERFLOW.to_string(), true.to_string());
    }
    subject
}

async fn deploys<C: ConnectionTrait>(
    conn: &C,
    ask: &ChangeAsk,
    streams: &BTreeSet<EntityRef>,
) -> anyhow::Result<(Checked, Vec<ChangeRecord>)> {
    let rows = service_version_deploys::in_window(conn, &ask.org, (ask.from, ask.to), ROWS).await?;
    let state = if rows.len() as u64 >= ROWS {
        Checked::Partial
    } else {
        Checked::Ok
    };
    let rows: Vec<(Model, ChangeRecord)> = rows
        .into_iter()
        .filter_map(|row| record(&row, streams).map(|record| (row, record)))
        .collect();
    let keys: Vec<String> = rows
        .iter()
        .filter_map(|(row, _)| row.verdict_key.clone())
        .collect();
    // The deploy is the cause; verdicts that cannot be read only leave it unjudged.
    let verdicts: HashMap<String, _> =
        match service_version_verdicts::get_by_keys(conn, &ask.org, &keys).await {
            Ok(verdicts) => verdicts
                .into_iter()
                .map(|v| (v.verdict_key.clone(), v))
                .collect(),
            Err(e) => {
                log::warn!(
                    "[autoobserve] org {}: reading deploy verdicts: {e}",
                    ask.org
                );
                HashMap::new()
            }
        };
    let records = rows
        .into_iter()
        .map(|(row, mut record)| {
            if let Some(v) = row.verdict_key.as_ref().and_then(|key| verdicts.get(key)) {
                record.subject = scoped(
                    &row.service_name,
                    &[
                        (row.source_streams.as_str(), row.source_streams_overflow),
                        (v.source_streams.as_str(), v.source_streams_overflow),
                    ],
                );
                record
                    .facts
                    .insert("verdict".to_string(), v.verdict.clone());
            }
            record
        })
        .collect();
    Ok((state, records))
}

/// An overflowed stream list may still hold the issue stream, so it is kept without `affects`.
fn record(row: &Model, streams: &BTreeSet<EntityRef>) -> Option<ChangeRecord> {
    let kind = match row.kind.as_str() {
        "deploy" | "redeploy" => ChangeKind::Deploy,
        "rollback" => ChangeKind::Rollback,
        _ => return None,
    };
    let listed: BTreeSet<EntityRef> = serde_json::from_str::<Vec<String>>(&row.source_streams)
        .unwrap_or_default()
        .iter()
        .map(|s| subject_of(kinds::STREAM, s))
        .collect();
    let affects: Vec<EntityRef> = streams.intersection(&listed).cloned().collect();
    if affects.is_empty() && !row.source_streams_overflow {
        return None;
    }
    let link_kind = if affects.is_empty() {
        Confidence::Inferred
    } else {
        Confidence::Exact
    };
    let service = row.service_name.as_str();
    let facts = BTreeMap::from([
        ("service".to_string(), service.to_string()),
        ("version".to_string(), row.to_version.clone()),
        ("where".to_string(), row.where_key.clone()),
    ]);
    Some(ChangeRecord {
        provider: String::new(),
        kind,
        at: row.at,
        until: None,
        actor: None,
        subject: scoped(
            service,
            &[(row.source_streams.as_str(), row.source_streams_overflow)],
        ),
        subject_name: service.to_string(),
        affects,
        link: link_kind,
        count: None,
        facts,
        needs: None,
        open: link(
            "traces",
            &[
                ("tab", "services-catalog"),
                ("panel", "versions"),
                ("panelSvc", service),
                ("panelWhere", &row.where_key),
            ],
        ),
    })
}

#[cfg(test)]
mod tests {
    use config::meta::stream::StreamType;
    use infra::table::{
        entity::service_version_verdicts::Model as Verdict,
        service_versions::{create_tables_for_tests, sqlite_and_postgres_for_tests},
    };
    use sha2::{Digest, Sha256};

    use super::{
        super::{stream_ref, tests::ask},
        *,
    };

    #[tokio::test]
    async fn every_listed_deploy_carries_its_verdict() {
        let deploy = |n: i64| {
            let (version, at) = (format!("v{n}"), 100 + n);
            let key = serde_json::json!(["org", "svc", "where", "region", version, at]);
            Model {
                deploy_key: format!("{:x}", Sha256::digest(key.to_string())),
                org_id: "org".into(),
                service_name: "svc".into(),
                where_key: "where".into(),
                scope_key: "scope".into(),
                cluster: "region".into(),
                to_version: version.clone(),
                to_version_key: version.clone(),
                kind: "deploy".into(),
                entry_source: "traffic".into(),
                at,
                updated_at: at,
                source_streams: r#"["logs/app"]"#.into(),
                serving_versions: "[]".into(),
                full_serving: "[]".into(),
                verdict_key: Some(version),
                ..Default::default()
            }
        };
        let verdict = |key: &str| Verdict {
            verdict_key: key.into(),
            org_id: "org".into(),
            deploy_kind: "deploy".into(),
            state: "evaluating".into(),
            verdict: "watch".into(),
            reason_code: "debounce_pending".into(),
            signal: "traces".into(),
            baseline_rule: "previous".into(),
            baseline_rule_initial: "previous".into(),
            source_streams: "[]".into(),
            updated_at: 100,
            last_evaluated_at: 100,
            ..Default::default()
        };
        let ask = ask("org", &[("logs", "app")], (0, 1_000));
        let streams = BTreeSet::from([stream_ref(StreamType::Logs, "app")]);
        for conn in sqlite_and_postgres_for_tests("autoobserve_deploy_verdicts").await {
            create_tables_for_tests(&conn).await.unwrap();
            for n in 0..4 {
                let row = deploy(n);
                let key = row.verdict_key.clone().unwrap();
                assert!(service_version_deploys::put(&conn, row).await.unwrap());
                assert!(
                    service_version_verdicts::put(&conn, verdict(&key), Vec::new())
                        .await
                        .unwrap()
                );
            }
            let (state, records) = deploys(&conn, &ask, &streams).await.unwrap();
            assert_eq!(state, Checked::Ok);
            let judged: Vec<_> = records
                .iter()
                .map(|r| r.facts.get("verdict").map(String::as_str))
                .collect();
            assert_eq!(judged, [Some("watch"); 4]);
        }
    }
}
