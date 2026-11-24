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

//! Super-cluster replication of AI toolsets: the newest write by `(updated_at, region)` wins in
//! every region, secret values never leave their region, and deletes leave 30-day tombstones.

use infra::{
    errors::Result,
    table::{
        ai_toolset_health,
        org_ai_toolsets::{
            self as table, ListFilter, OrgToolset, TOMBSTONE_KEEP_MICROS, Tombstone,
        },
    },
};
use o2_enterprise::enterprise::{
    ai::toolsets::{
        ToolsetKind, push::normalize_tool_name, with_local_secrets, without_secret_values,
    },
    common::config::get_config as get_o2_config,
    super_cluster::queue::AiToolsetMessage,
};

const UPDATE_ATTEMPTS: usize = 3;
/// A row written here has no `origin_region`; at an exact tie it compares as this region.
const LOCAL: &str = "";

/// What a replicated message did to this region's rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Applied {
    Ignored,
    Created,
    /// A local row was replaced by `region`'s write, which the caller audits.
    Replaced {
        name: String,
        region: String,
    },
    Deleted {
        name: String,
        region: String,
    },
}

/// The message another region gets for `row`, or `None` for a "this region only" row or one of an
/// unknown kind, whose secret values can't be told apart.
pub fn put_message(row: &OrgToolset) -> Option<AiToolsetMessage> {
    if row.region_only {
        return None;
    }
    let kind: ToolsetKind = row.kind.parse().ok()?;
    let data = row
        .data
        .as_deref()
        .and_then(|d| serde_json::from_str(d).ok());
    Some(AiToolsetMessage::Put {
        org: row.org.clone(),
        key: normalize_tool_name(&row.name),
        name: row.name.clone(),
        kind: row.kind.clone(),
        description: row.description.clone(),
        data: without_secret_values(kind, data),
        created_by: row.created_by.clone(),
        created_at: row.created_at,
        updated_at: row.updated_at,
        region: row.origin_region.clone().unwrap_or_else(local_region),
    })
}

/// Publishes a toolset just created or updated here.
pub async fn published_put(row: &OrgToolset) {
    if let Some(msg) = put_message(row) {
        publish(&msg).await;
    }
}

/// Records and publishes the delete of a replicated toolset; off a super cluster nothing is kept.
pub async fn published_delete(row: &OrgToolset, deleted_at: i64) -> Result<()> {
    if !replicating() {
        return Ok(());
    }
    let Some(tombstone) = tombstone_for(row, deleted_at) else {
        return Ok(());
    };
    table::put_tombstone(tombstone.clone()).await?;
    publish(&delete_message(tombstone)).await;
    Ok(())
}

/// The tombstone a delete leaves, or `None` for a "this region only" row.
pub fn tombstone_for(row: &OrgToolset, deleted_at: i64) -> Option<Tombstone> {
    (!row.region_only).then(|| Tombstone {
        org: row.org.clone(),
        key: normalize_tool_name(&row.name),
        deleted_at,
        region: local_region(),
    })
}

/// Republishes the org's replicated toolsets and its deletes of the last 30 days; never deletes
/// anything itself. Returns how many messages went out.
pub async fn resync(org: &str, now: i64) -> Result<usize> {
    if !replicating() {
        return Ok(0);
    }
    let rows = table::list(org, ListFilter::default(), None).await?;
    let tombstones = table::live_tombstones(org, now - TOMBSTONE_KEEP_MICROS).await?;
    let messages: Vec<_> = rows
        .iter()
        .filter_map(put_message)
        .chain(tombstones.into_iter().map(delete_message))
        .collect();
    for msg in &messages {
        publish(msg).await;
    }
    Ok(messages.len())
}

/// Applies another region's write without publishing it again.
pub async fn apply_replicated(msg: AiToolsetMessage) -> Result<Applied> {
    match msg {
        AiToolsetMessage::Put { .. } => apply_put(msg).await,
        AiToolsetMessage::Delete {
            org,
            key,
            deleted_at,
            region,
        } => {
            apply_delete(Tombstone {
                org,
                key,
                deleted_at,
                region,
            })
            .await
        }
    }
}

async fn apply_put(msg: AiToolsetMessage) -> Result<Applied> {
    let AiToolsetMessage::Put {
        org,
        key,
        name,
        kind,
        description,
        data,
        created_by,
        created_at,
        updated_at,
        region,
    } = msg
    else {
        return Ok(Applied::Ignored);
    };
    let Ok(parsed_kind) = kind.parse::<ToolsetKind>() else {
        return Ok(Applied::Ignored);
    };
    // The unique name can't be taken over and the row holding it must stay as it is.
    if table::is_name_held_unread(&org, &name).await? {
        log::warn!(
            "[SUPER_CLUSTER:sync] toolset '{name}' of org '{org}' isn't applied here: a row of a \
             kind no longer supported has its name"
        );
        return Ok(Applied::Ignored);
    }
    let version = (updated_at, region.as_str());
    if let Some(t) = table::get_tombstone(&org, &key).await?
        && !wins(version, (t.deleted_at, &t.region))
    {
        return Ok(Applied::Ignored);
    }
    for _ in 0..UPDATE_ATTEMPTS {
        let Some(row) = local_row(&org, &key, &name).await? else {
            let entry = OrgToolset {
                id: String::new(),
                org: org.clone(),
                name: name.clone(),
                kind: kind.clone(),
                description: description.clone(),
                data: data.as_ref().map(|d| d.to_string()),
                created_by: created_by.clone(),
                created_at,
                updated_at,
                region_only: false,
                origin_region: Some(region.clone()),
            };
            table::add(entry).await?;
            return Ok(Applied::Created);
        };
        if row.region_only || !wins(version, row_version(&row)) {
            return Ok(Applied::Ignored);
        }
        let stored = row
            .data
            .as_deref()
            .and_then(|d| serde_json::from_str(d).ok());
        let merged = with_local_secrets(parsed_kind, data.clone(), stored.as_ref());
        let read_updated_at = row.updated_at;
        let replaced = OrgToolset {
            name: name.clone(),
            kind: kind.clone(),
            description: description.clone(),
            data: merged.map(|d| d.to_string()),
            updated_at,
            origin_region: Some(region.clone()),
            ..row
        };
        if table::update_if_unchanged(replaced, read_updated_at).await? {
            return Ok(Applied::Replaced { name, region });
        }
    }
    Err(infra::errors::Error::Message(format!(
        "toolset '{name}' in org '{org}' kept changing while a replicated write was applied"
    )))
}

async fn apply_delete(tombstone: Tombstone) -> Result<Applied> {
    table::put_tombstone(tombstone.clone()).await?;
    let Some(row) = local_row(&tombstone.org, &tombstone.key, "").await? else {
        return Ok(Applied::Ignored);
    };
    if row.region_only || !wins((tombstone.deleted_at, &tombstone.region), row_version(&row)) {
        return Ok(Applied::Ignored);
    }
    table::remove(&row.org, &row.id).await?;
    if let Err(e) = ai_toolset_health::remove(&row.org, &tombstone.key).await {
        log::warn!("failed to remove the health of toolset '{}': {e}", row.name);
    }
    Ok(Applied::Deleted {
        name: row.name,
        region: tombstone.region,
    })
}

/// The org's row for `key`: the one named `name` when two normalize alike, else the only one.
async fn local_row(org: &str, key: &str, name: &str) -> Result<Option<OrgToolset>> {
    let mut rows: Vec<OrgToolset> = table::list(org, ListFilter::default(), None)
        .await?
        .into_iter()
        .filter(|r| normalize_tool_name(&r.name) == key)
        .collect();
    if let Some(i) = rows.iter().position(|r| r.name == name) {
        return Ok(Some(rows.swap_remove(i)));
    }
    if rows.len() > 1 {
        log::warn!("[SUPER_CLUSTER:sync] org '{org}' has several toolsets named like '{key}'");
    }
    Ok(rows.pop())
}

fn delete_message(t: Tombstone) -> AiToolsetMessage {
    AiToolsetMessage::Delete {
        org: t.org,
        key: t.key,
        deleted_at: t.deleted_at,
        region: t.region,
    }
}

fn row_version(row: &OrgToolset) -> (i64, &str) {
    let region = row.origin_region.as_deref().unwrap_or(LOCAL);
    (row.updated_at, region)
}

/// `a` replaces `b`: a later time, or at the same time the smaller region name.
fn wins(a: (i64, &str), b: (i64, &str)) -> bool {
    let local = local_region();
    let name = |r: &str| {
        if r == LOCAL {
            local.clone()
        } else {
            r.to_string()
        }
    };
    a.0 > b.0 || (a.0 == b.0 && name(a.1) < name(b.1))
}

fn local_region() -> String {
    get_o2_config().super_cluster.region.clone()
}

fn replicating() -> bool {
    get_o2_config().super_cluster.enabled && !config::get_config().common.local_mode
}

async fn publish(msg: &AiToolsetMessage) {
    if !replicating() {
        return;
    }
    if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::ai_toolsets(msg).await {
        log::error!(
            "[SUPER_CLUSTER:sync] failed to publish the toolset write {}: {e}",
            msg.key()
        );
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn row(name: &str, data: &str) -> OrgToolset {
        OrgToolset {
            id: "t1".into(),
            org: "acme".into(),
            name: name.into(),
            kind: "mcp".into(),
            description: None,
            data: Some(data.into()),
            created_by: "u1".into(),
            created_at: 1,
            updated_at: 7,
            region_only: false,
            origin_region: Some("us-1".into()),
        }
    }

    #[test]
    fn the_message_carries_secret_names_only_and_the_row_s_own_region() {
        let r = row(
            "Datadog-Prod",
            r#"{"url":"https://m","headers":{"DD_API_KEY":"s3cret"}}"#,
        );
        let msg = put_message(&r).unwrap();
        assert_eq!(msg.key(), "/ai_toolsets/acme/datadog-prod");
        let AiToolsetMessage::Put { data, region, .. } = &msg else {
            panic!("a put")
        };
        assert_eq!(data.as_ref().unwrap()["headers"]["DD_API_KEY"], "");
        assert_eq!(region, "us-1");
        assert!(!serde_json::to_string(&msg).unwrap().contains("s3cret"));
    }

    #[test]
    fn an_oauth_row_is_sent_with_its_client_and_without_its_secrets() {
        let data = json!({
            "url": "https://m.example/mcp",
            "auth": {
                "type": "oauth_client_credentials",
                "token_url": "https://sso.example.com/token",
                "client_id": "id-1",
                "client_secret": "c-s3cret",
                "scope": "a b",
                "extra_params": {"resource": "e-s3cret"},
                "client_auth": "body"
            }
        });
        let msg = put_message(&row("dt", &data.to_string())).unwrap();
        assert!(!serde_json::to_string(&msg).unwrap().contains("s3cret"));
        let AiToolsetMessage::Put { data: sent, .. } = msg else {
            panic!("a put")
        };
        let mut expected = data["auth"].clone();
        expected["client_secret"] = json!("");
        expected["extra_params"] = json!({"resource": ""});
        assert_eq!(sent.unwrap()["auth"], expected);
    }

    #[tokio::test]
    async fn a_replicated_oauth_edit_keeps_the_local_secret_only_for_the_same_hosts() {
        if !meta_store().await {
            return;
        }
        let org = format!("r1_oauth_{}", config::utils::time::now_micros());
        let auth = |token_url: &str, secret: &str| {
            json!({"url": "https://m.example/mcp", "auth": {
                "type": "oauth_client_credentials", "token_url": token_url,
                "client_id": "id-1", "client_secret": secret
            }})
        };
        let home = "https://sso.example.com/token";
        apply_replicated(put(&org, 10, auth(home, "")))
            .await
            .unwrap();
        edit_here(&org, 11, |r| r.data = Some(auth(home, "mine").to_string())).await;
        for (at, token_url, want) in [
            (20, "https://sso.example.com/v2/token", "mine"),
            (30, "https://evil.example/token", ""),
        ] {
            apply_replicated(put(&org, at, auth(token_url, "")))
                .await
                .unwrap();
            let data: serde_json::Value =
                serde_json::from_str(&stored(&org).await.unwrap().data.unwrap()).unwrap();
            assert_eq!(data["auth"]["client_secret"], want, "{token_url}");
        }
    }

    #[test]
    fn a_cli_row_is_never_sent() {
        let r = OrgToolset {
            kind: "cli".into(),
            ..row("gh", r#"{"env":{"GH_TOKEN":"s3cret"}}"#)
        };
        assert!(put_message(&r).is_none());
    }

    #[tokio::test]
    async fn a_received_cli_row_and_one_whose_name_a_cli_row_holds_are_ignored() {
        if !meta_store().await {
            return;
        }
        let org = format!("r1_cli_{}", config::utils::time::now_micros());
        let received = AiToolsetMessage::Put {
            org: org.clone(),
            key: "gh".into(),
            name: "gh".into(),
            kind: "cli".into(),
            description: None,
            data: Some(json!({"command": "gh"})),
            created_by: "u1".into(),
            created_at: 1,
            updated_at: 10,
            region: "zz-1".into(),
        };
        assert_eq!(
            apply_replicated(received).await.unwrap(),
            Applied::Ignored,
            "the kind is not applied"
        );
        assert!(!table::is_name_held_unread(&org, "gh").await.unwrap());

        let held = OrgToolset {
            id: String::new(),
            org: org.clone(),
            kind: "cli".into(),
            ..row("dd", "{}")
        };
        table::add(held).await.unwrap();
        let taken = put(&org, 10, json!({"url": "https://a"}));
        assert_eq!(apply_replicated(taken).await.unwrap(), Applied::Ignored);
        assert!(stored(&org).await.is_none());
        assert!(table::is_name_held_unread(&org, "dd").await.unwrap());
        table::delete_by_org(&org).await.unwrap();
        assert!(!table::is_name_held_unread(&org, "dd").await.unwrap());
    }

    #[test]
    fn a_region_only_row_is_never_sent_and_leaves_no_tombstone() {
        let r = OrgToolset {
            region_only: true,
            ..row("x", "{}")
        };
        assert!(put_message(&r).is_none());
        assert!(tombstone_for(&r, 9).is_none());
        let switched_off = OrgToolset {
            region_only: false,
            ..r
        };
        assert!(
            put_message(&switched_off).is_some(),
            "turning the switch off sends the row"
        );
        let t = tombstone_for(&switched_off, 9).unwrap();
        assert_eq!((t.key.as_str(), t.deleted_at), ("x", 9));
    }

    #[tokio::test]
    async fn off_a_super_cluster_a_delete_records_no_tombstone() {
        if !meta_store().await || replicating() {
            return;
        }
        let org = format!("r1_off_{}", config::utils::time::now_micros());
        let r = OrgToolset {
            org: org.clone(),
            ..row("dd", "{}")
        };
        published_delete(&r, 5).await.unwrap();
        assert!(table::get_tombstone(&org, "dd").await.unwrap().is_none());
    }

    /// Needs the meta store CI configures through `ZO_META_STORE`.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
            infra::table::cipher::boot(None).await.expect("cipher");
        })
        .await;
        true
    }

    fn put(org: &str, updated_at: i64, data: serde_json::Value) -> AiToolsetMessage {
        AiToolsetMessage::Put {
            org: org.into(),
            key: "dd".into(),
            name: "dd".into(),
            kind: "mcp".into(),
            description: None,
            data: Some(data),
            created_by: "u1".into(),
            created_at: 1,
            updated_at,
            region: "zz-1".into(),
        }
    }

    fn delete(org: &str, deleted_at: i64) -> AiToolsetMessage {
        AiToolsetMessage::Delete {
            org: org.into(),
            key: "dd".into(),
            deleted_at,
            region: "zz-1".into(),
        }
    }

    async fn stored(org: &str) -> Option<OrgToolset> {
        local_row(org, "dd", "dd").await.unwrap()
    }

    async fn edit_here(org: &str, updated_at: i64, edit: impl FnOnce(&mut OrgToolset)) {
        let mut row = stored(org).await.unwrap();
        let read = row.updated_at;
        edit(&mut row);
        row.updated_at = updated_at;
        row.origin_region = None;
        assert!(table::update_if_unchanged(row, read).await.unwrap());
    }

    #[tokio::test]
    async fn replicated_writes_keep_local_secrets_spare_region_only_rows_and_respect_tombstones() {
        if !meta_store().await {
            return;
        }
        let org = format!("r1_{}", config::utils::time::now_micros());
        let first = json!({"url": "https://a", "headers": {"K": ""}});
        assert_eq!(
            apply_replicated(put(&org, 10, first)).await.unwrap(),
            Applied::Created
        );
        edit_here(&org, 11, |r| {
            r.data = Some(r#"{"url":"https://a","headers":{"K":"mine"}}"#.into())
        })
        .await;

        for (at, url, kept) in [(20, "https://a/v2", "mine"), (22, "https://b", "")] {
            let newer = json!({"url": url, "headers": {"K": "", "N": ""}});
            let replaced = apply_replicated(put(&org, at, newer)).await.unwrap();
            assert!(matches!(replaced, Applied::Replaced { .. }), "{replaced:?}");
            let data: serde_json::Value =
                serde_json::from_str(&stored(&org).await.unwrap().data.unwrap()).unwrap();
            assert_eq!(
                data,
                json!({"url": url, "headers": {"K": kept, "N": ""}}),
                "a value is kept only for the host it was entered for"
            );
        }
        let stale = put(&org, 5, json!({"url": "https://old"}));
        assert_eq!(apply_replicated(stale).await.unwrap(), Applied::Ignored);

        edit_here(&org, 23, |r| r.region_only = true).await;
        assert_eq!(
            apply_replicated(put(&org, 30, json!({}))).await.unwrap(),
            Applied::Ignored
        );
        assert_eq!(
            apply_replicated(delete(&org, 31)).await.unwrap(),
            Applied::Ignored
        );
        edit_here(&org, 32, |r| r.region_only = false).await;

        let gone = apply_replicated(delete(&org, 40)).await.unwrap();
        assert!(matches!(gone, Applied::Deleted { .. }), "{gone:?}");
        assert!(stored(&org).await.is_none());
        let resynced = put(&org, 35, json!({"url": "https://b"}));
        assert_eq!(apply_replicated(resynced).await.unwrap(), Applied::Ignored);
        assert!(
            stored(&org).await.is_none(),
            "a tombstone stops a stale re-sync"
        );
        assert_eq!(
            apply_replicated(put(&org, 50, json!({}))).await.unwrap(),
            Applied::Created
        );
    }

    #[test]
    fn the_later_write_wins_and_a_tie_goes_to_the_smaller_region() {
        assert!(wins((8, "us-1"), (7, "eu-1")));
        assert!(!wins((6, "aa"), (7, "zz")));
        assert!(wins((7, "eu-1"), (7, "us-1")));
        assert!(!wins((7, "us-1"), (7, "eu-1")));
        assert!(
            !wins((7, "eu-1"), (7, "eu-1")),
            "a redelivered write changes nothing"
        );
    }
}
