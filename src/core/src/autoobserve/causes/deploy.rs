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

use std::collections::{BTreeMap, BTreeSet};

use infra::table::{
    entity::service_version_deploys::Model, service_version_deploys, service_version_verdicts,
};
use o2_enterprise::enterprise::autoobserve::{
    context::{ChangeAsk, ChangeKind, ChangeRecord, Checked, subject_of},
    contract::{Confidence, EntityRef},
    names::{dims, kinds},
};

use super::{failed, issue_streams, link};

const PROVIDER: &str = "deploys";
const ROWS: u64 = 50;
const VERDICT_READS: usize = 3;

pub async fn read(ask: &ChangeAsk) -> (Checked, Vec<ChangeRecord>) {
    let streams = issue_streams(ask);
    if streams.is_empty() {
        return (Checked::Ok, Vec::new());
    }
    match deploys(ask, &streams).await {
        Ok(answer) => answer,
        Err(e) => failed(PROVIDER, &ask.org, e),
    }
}

async fn deploys(
    ask: &ChangeAsk,
    streams: &BTreeSet<EntityRef>,
) -> anyhow::Result<(Checked, Vec<ChangeRecord>)> {
    let conn = infra::db::get_orm_client_ro().await;
    let rows = service_version_deploys::in_window(conn, &ask.org, (ask.from, ask.to), ROWS).await?;
    let state = if rows.len() as u64 >= ROWS {
        Checked::Partial
    } else {
        Checked::Ok
    };
    let mut records = Vec::new();
    let mut reads = 0;
    for row in rows {
        let Some(mut record) = record(&row, streams) else {
            continue;
        };
        if let Some(key) = row.verdict_key.as_deref()
            && reads < VERDICT_READS
        {
            reads += 1;
            // The deploy is the cause; a verdict that cannot be read only leaves it unjudged.
            match service_version_verdicts::get(conn, &ask.org, key).await {
                Ok(Some(v)) => {
                    record.facts.insert("verdict".to_string(), v.verdict);
                }
                Ok(None) => {}
                Err(e) => log::warn!("[autoobserve] org {}: verdict {key}: {e}", ask.org),
            }
        }
        records.push(record);
    }
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
        provider: PROVIDER.to_string(),
        kind,
        at: row.at,
        until: None,
        actor: None,
        subject: EntityRef::new(kinds::SERVICE, &[(dims::SERVICE_NAME, service)]),
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
