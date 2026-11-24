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
    collections::BTreeMap,
    future::Future,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use anyhow::{Result, anyhow};
use config::meta::synthetics::{SLOT_META_PREFIX, SlotMeta, Synthetic};
use infra::{
    db::get_orm_client_rw,
    dist_lock,
    org_lifecycle::OrgLifecycleGuard,
    table::{
        cipher,
        entity::{
            organizations,
            synthetics_checks::{Column, Entity, Model},
        },
        secret_store_job_markers::{
            META_ORG, ORIGINS_BACKFILL, SYNTHETICS_WRITE_ONLY, get_marker_in, insert_if_absent_in,
        },
        synthetics_checks,
    },
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, sea_query::Expr,
};
use serde::Deserialize;
use serde_json::{Value, json, value::RawValue};

use crate::service::{
    Origins, decrypt_secret, encrypt_literal, encrypt_secret, stored_check_origins,
    write_only_slot_keys,
};

const LOCK_KEY: &str = "/secret_store/maint/origins_backfill";
const PAGE_SIZE: u64 = 200;
const MAX_PASSES: usize = 5;
const RETRY_INTERVAL: Duration = Duration::from_secs(60);
static BACKFILL_DONE: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize)]
struct RawSecrets<'a> {
    #[serde(borrow, default)]
    config: BTreeMap<String, &'a RawValue>,
}

pub(crate) async fn run(stop: crate::StopToken) {
    run_with_latch(stop, crate::service::durably_latched).await;
}

pub(crate) async fn run_with_latch<F: Future<Output = Result<bool>>>(
    stop: crate::StopToken,
    mut latched: impl FnMut() -> F,
) {
    while !stop.is_cancelled() {
        match run_after_latch(latched()).await {
            Ok(true) => return,
            Ok(false) => {}
            Err(error) => log::warn!("[synthetics] origins backfill: {error}"),
        }
        if stop.sleep(RETRY_INTERVAL).await {
            return;
        }
    }
}

pub async fn run_origins_backfill() -> Result<u64> {
    let conn = get_orm_client_rw().await;
    if !backfill_pending(conn).await? {
        return Ok(0);
    }
    let locker = dist_lock::lock(LOCK_KEY, 0).await?;
    let result = backfill_if_pending(conn).await;
    dist_lock::unlock(&locker).await?;
    result
}

pub async fn origins_backfill_done() -> bool {
    origins_backfill_done_in(get_orm_client_rw().await).await
}

pub(crate) async fn origins_backfill_done_in<C: ConnectionTrait>(conn: &C) -> bool {
    if BACKFILL_DONE.load(Ordering::Relaxed) {
        return true;
    }
    match get_marker_in(conn, META_ORG, ORIGINS_BACKFILL).await {
        Ok(Some(_)) => {
            BACKFILL_DONE.store(true, Ordering::Relaxed);
            true
        }
        Ok(None) => false,
        // An unreadable marker must not relax origin checks; retry the read on the next request.
        Err(_) => true,
    }
}

async fn run_after_latch(latched: impl Future<Output = Result<bool>>) -> Result<bool> {
    if !latched.await? {
        return Ok(false);
    }
    let conn = get_orm_client_rw().await;
    insert_if_absent_in(
        conn,
        META_ORG,
        SYNTHETICS_WRITE_ONLY,
        config::utils::time::now_micros(),
    )
    .await?;
    run_origins_backfill().await?;
    Ok(get_marker_in(conn, META_ORG, ORIGINS_BACKFILL)
        .await?
        .is_some())
}

async fn backfill_pending(conn: &DatabaseConnection) -> Result<bool> {
    Ok(get_marker_in(conn, META_ORG, ORIGINS_BACKFILL)
        .await?
        .is_none()
        && get_marker_in(conn, META_ORG, SYNTHETICS_WRITE_ONLY)
            .await?
            .is_some())
}

async fn backfill_if_pending(conn: &DatabaseConnection) -> Result<u64> {
    if !backfill_pending(conn).await? {
        return Ok(0);
    }
    let orgs = Entity::find()
        .select_only()
        .column(Column::OrgId)
        .distinct()
        .into_tuple::<String>()
        .all(conn)
        .await?;
    let mut written = 0;
    for org in orgs {
        written += backfill_org_until_settled(conn, &org).await?;
    }
    insert_if_absent_in(
        conn,
        META_ORG,
        ORIGINS_BACKFILL,
        config::utils::time::now_micros(),
    )
    .await?;
    BACKFILL_DONE.store(true, Ordering::Relaxed);
    Ok(written)
}

// A row whose save raced the conditional write is rescanned, so no legacy entry misses the
// backfill before the marker turns a missing `origins` into a refusal.
async fn backfill_org_until_settled(conn: &DatabaseConnection, org: &str) -> Result<u64> {
    let mut written = 0;
    for _ in 0..MAX_PASSES {
        let guard = OrgLifecycleGuard::acquire(org).await?;
        let result = backfill_active_org(conn, org).await;
        guard.release().await;
        let (pass_written, raced) = result?;
        written += pass_written;
        if raced == 0 {
            return Ok(written);
        }
    }
    anyhow::bail!("origins backfill: checks kept changing during {MAX_PASSES} passes")
}

/// Returns the rows written and the rows whose `updated_at` moved before the write.
async fn backfill_active_org(conn: &DatabaseConnection, org: &str) -> Result<(u64, u64)> {
    let status = organizations::Entity::find()
        .select_only()
        .column(organizations::Column::Status)
        .filter(organizations::Column::Identifier.eq(org))
        .into_tuple::<String>()
        .one(conn)
        .await?;
    if status.as_deref() != Some("active") {
        return Ok((0, 0));
    }
    let mut after = None;
    let (mut written, mut raced) = (0, 0);
    loop {
        let mut query = Entity::find().filter(Column::OrgId.eq(org));
        if let Some(id) = after {
            query = query.filter(Column::Id.gt(id));
        }
        let page = query
            .order_by_asc(Column::Id)
            .limit(PAGE_SIZE)
            .all(conn)
            .await?;
        after = page.last().map(|row| row.id.clone());
        let last_page = (page.len() as u64) < PAGE_SIZE;
        for row in page {
            match backfill_check(conn, row).await? {
                Some(0) => raced += 1,
                Some(n) => written += n,
                None => {}
            }
        }
        if last_page {
            return Ok((written, raced));
        }
    }
}

/// `None` when the row needs no write; `Some(0)` when a concurrent save moved it.
async fn backfill_check(conn: &DatabaseConnection, row: Model) -> Result<Option<u64>> {
    let secrets = match backfilled_secrets(&row).await {
        Ok(Some(secrets)) => secrets,
        Ok(None) => return Ok(None),
        Err(_) => {
            log::warn!(
                "[synthetics] origins backfill skipped unresolved check org={} check={}",
                row.org_id,
                row.id
            );
            return Ok(None);
        }
    };
    let res = Entity::update_many()
        .col_expr(Column::Secrets, Expr::value(secrets))
        .filter(Column::OrgId.eq(&row.org_id))
        .filter(Column::Id.eq(&row.id))
        .filter(Column::UpdatedAt.eq(row.updated_at))
        .exec(conn)
        .await?;
    if res.rows_affected > 0 {
        synthetics_checks::invalidate_and_publish(&row.org_id, &row.id).await;
    }
    Ok(Some(res.rows_affected))
}

async fn backfilled_secrets(row: &Model) -> Result<Option<String>> {
    let raw: RawSecrets<'_> =
        serde_json::from_str(&row.secrets).map_err(|_| anyhow!("invalid synthetic secrets"))?;
    let check = Synthetic::try_from(row.clone()).map_err(|_| anyhow!("invalid synthetic check"))?;
    let slots = write_only_slot_keys(&check);
    if slots.is_empty() {
        return Ok(None);
    }
    let dek = cipher::get_dek(&row.org_id).await?;
    let mut entries = decrypt_entries(&raw.config, &dek)?;
    if !entries.values().any(missing_origins)
        && slots
            .iter()
            .all(|key| entries.contains_key(&format!("{SLOT_META_PREFIX}{key}")))
    {
        return Ok(None);
    }
    let origins = stored_check_origins(&row.org_id, &check, &dek).await?;
    for origin in origins.values().flatten() {
        anyhow::ensure!(!origin.contains("{{"), "unresolved synthetic origin");
        let url =
            reqwest::Url::parse(origin).map_err(|_| anyhow!("unresolved synthetic origin"))?;
        anyhow::ensure!(
            url.host_str().is_some() && matches!(url.scheme(), "http" | "https" | "ssh"),
            "unresolved synthetic origin"
        );
    }
    let changed = fill_missing_origins(&mut entries, &origins);
    let mut replacements = Vec::with_capacity(changed.len());
    for key in changed {
        let ciphertext = encrypt_secret(&dek, &entries[&key].to_string())?;
        replacements.push((raw.config[&key], serde_json::to_string(&ciphertext)?));
    }
    let meta = SlotMeta {
        updated_at: row.updated_at,
        updated_by: row.owner.clone().unwrap_or_default(),
        origins: Some(origins),
    };
    let mut additions = BTreeMap::new();
    for key in slots {
        let key = format!("{SLOT_META_PREFIX}{key}");
        if !entries.contains_key(&key) {
            additions.insert(key, encrypt_literal(&dek, &serde_json::to_string(&meta)?)?);
        }
    }
    let updated = replace_raw_values(&row.secrets, replacements);
    Ok(Some(insert_metadata_entries(&updated, &additions)?))
}

fn insert_metadata_entries(source: &str, additions: &BTreeMap<String, String>) -> Result<String> {
    if additions.is_empty() {
        return Ok(source.to_owned());
    }
    let fields: BTreeMap<String, &RawValue> = serde_json::from_str(source)?;
    let encoded = serde_json::to_string(additions)?;
    let (object, inserted, empty) = match fields.get("config") {
        Some(config) => {
            let existing: BTreeMap<String, &RawValue> = serde_json::from_str(config.get())?;
            (
                config.get(),
                encoded[1..encoded.len() - 1].to_owned(),
                existing.is_empty(),
            )
        }
        None => (
            source.trim(),
            format!("\"config\":{encoded}"),
            fields.is_empty(),
        ),
    };
    let offset = object.as_ptr() as usize - source.as_ptr() as usize;
    let at = offset + object.len() - 1;
    let mut out = source.to_owned();
    out.insert_str(at, &format!("{}{inserted}", if empty { "" } else { "," }));
    Ok(out)
}

fn replace_raw_values(source: &str, replacements: Vec<(&RawValue, String)>) -> String {
    let mut spans: Vec<_> = replacements
        .into_iter()
        .map(|(old, new)| {
            // RawValue borrows its exact JSON token, including quotes, from the original column.
            let start = old.get().as_ptr() as usize - source.as_ptr() as usize;
            (start..start + old.get().len(), new)
        })
        .collect();
    spans.sort_unstable_by_key(|(range, _)| range.start);
    let mut out = String::with_capacity(source.len());
    let mut copied = 0;
    for (range, new) in spans {
        out.push_str(&source[copied..range.start]);
        out.push_str(&new);
        copied = range.end;
    }
    out.push_str(&source[copied..]);
    out
}

fn decrypt_entries(
    config: &BTreeMap<String, &RawValue>,
    dek: &[u8],
) -> Result<BTreeMap<String, Value>> {
    let mut entries = BTreeMap::new();
    for (key, value) in config
        .iter()
        .filter(|(key, _)| key.starts_with(SLOT_META_PREFIX))
    {
        let stored: String = serde_json::from_str(value.get())
            .map_err(|_| anyhow!("invalid synthetic slot metadata"))?;
        let plaintext = decrypt_secret(dek, &stored)?;
        let entry: Value = serde_json::from_str(&plaintext)
            .map_err(|_| anyhow!("invalid synthetic slot metadata"))?;
        anyhow::ensure!(entry.is_object(), "invalid synthetic slot metadata");
        entries.insert(key.clone(), entry);
    }
    Ok(entries)
}

fn missing_origins(entry: &Value) -> bool {
    entry.get("origins").is_none_or(Value::is_null)
}

fn fill_missing_origins(entries: &mut BTreeMap<String, Value>, origins: &Origins) -> Vec<String> {
    let mut changed = Vec::new();
    for (key, entry) in entries {
        if missing_origins(entry) {
            entry["origins"] = json!(origins);
            changed.push(key.clone());
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn origins_backfill_waits_for_a_durable_latch() {
        assert!(!run_after_latch(async { Ok(false) }).await.unwrap());
    }

    #[tokio::test]
    async fn origins_backfill_stops_when_cancelled_before_latch() {
        let (sender, stop) = crate::StopToken::new();
        sender.send(true).unwrap();
        run_with_latch(stop, || async {
            panic!("cancelled worker must not read the latch")
        })
        .await;
    }

    #[test]
    fn only_missing_origins_are_filled_once() {
        let before = json!({"updated_at":1,"updated_by":"writer","future_field":true});
        let recorded =
            json!({"updated_at":2,"updated_by":"other","origins":{"prod":["https://b:443"]}});
        let mut entries = BTreeMap::from([
            ("#m/body".to_owned(), before.clone()),
            ("#m/auth/password".to_owned(), recorded.clone()),
        ]);
        let origins = BTreeMap::from([("_org".to_owned(), vec!["https://a:443".to_owned()])]);
        assert_eq!(
            fill_missing_origins(&mut entries, &origins),
            vec!["#m/body"]
        );
        assert_eq!(entries["#m/auth/password"], recorded);
        let mut expected = before;
        expected["origins"] = json!(origins);
        assert_eq!(entries["#m/body"], expected);
        assert!(fill_missing_origins(&mut entries, &origins).is_empty());
    }

    #[tokio::test]
    async fn concurrent_backfills_write_one_check_and_the_marker() {
        const CHILD: &str = "O2_ORIGINS_BACKFILL_TEST";
        if std::env::var_os(CHILD).is_none() {
            // The DEK, database pool and deployment marker are process-wide.
            let dir = std::env::temp_dir().join(format!(
                "o2-origins-{}-{}",
                std::process::id(),
                config::utils::time::now_micros()
            ));
            std::fs::create_dir(&dir).unwrap();
            let mut cmd = std::process::Command::new(std::env::current_exe().unwrap());
            for (key, _) in
                std::env::vars_os().filter(|(k, _)| k.to_string_lossy().starts_with("ZO_"))
            {
                cmd.env_remove(key);
            }
            let output = cmd
                .current_dir(&dir)
                .env(CHILD, "1")
                .env("ZO_LOCAL_MODE", "true")
                .env("ZO_META_STORE", "sqlite")
                .env("ZO_DATA_DIR", &dir)
                .args([
                    "--exact",
                    "origins_backfill::tests::concurrent_backfills_write_one_check_and_the_marker",
                    "--nocapture",
                ])
                .output();
            std::fs::remove_dir_all(dir).unwrap();
            let output = output.unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            assert!(
                output.status.success() && stdout.contains("1 passed"),
                "{stdout}\n{}",
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        let dek = vec![7u8; 64];
        let conn = seed_sqlite(&dek).await;
        assert_eq!(run_origins_backfill().await.unwrap(), 0);
        assert!(!origins_backfill_done().await);
        insert_if_absent_in(conn, META_ORG, SYNTHETICS_WRITE_ONLY, 1)
            .await
            .unwrap();
        let original = Entity::find_by_id("check")
            .one(conn)
            .await
            .unwrap()
            .unwrap();
        let (a, b) = tokio::join!(run_origins_backfill(), run_origins_backfill());
        assert_eq!(a.unwrap() + b.unwrap(), 1);
        assert!(
            get_marker_in(conn, META_ORG, ORIGINS_BACKFILL)
                .await
                .unwrap()
                .is_some()
        );
        assert!(origins_backfill_done().await);
        assert_eq!(run_origins_backfill().await.unwrap(), 0);
        let row = Entity::find_by_id("check")
            .one(conn)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.updated_at, 9);
        let raw: Value = serde_json::from_str(&row.secrets).unwrap();
        assert_eq!(
            raw["variables"][0]["value"],
            encrypt_secret(&dek, "a.example").unwrap()
        );
        assert_eq!(raw["unknown"], json!({"keep":["this"]}));
        assert_eq!(
            raw["config"]["/body"],
            encrypt_secret(&dek, "body").unwrap()
        );
        let raw: RawSecrets<'_> = serde_json::from_str(&row.secrets).unwrap();
        let entries = decrypt_entries(&raw.config, &dek).unwrap();
        assert_eq!(
            entries["#m/body"],
            json!({"updated_at":1, "updated_by":"writer", "origins":{"_org":["https://a.example:443"]}})
        );
        verify_concurrent_save_is_skipped(conn, original).await;
    }

    async fn verify_concurrent_save_is_skipped(conn: &DatabaseConnection, mut stale: Model) {
        use sea_orm::IntoActiveModel;

        stale.id = "raced".to_owned();
        let mut newer = stale.clone();
        newer.target = "https://new.example/".into();
        newer.updated_at += 1;
        Entity::insert(newer.clone().into_active_model())
            .exec(conn)
            .await
            .unwrap();
        assert_eq!(backfill_check(conn, stale).await.unwrap(), Some(0));
        let row = Entity::find_by_id("raced")
            .one(conn)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.secrets, newer.secrets);
        assert_eq!(row.updated_at, newer.updated_at);
    }

    #[test]
    fn replacements_preserve_unrelated_literal_bytes_and_order() {
        let source = r##"{ "unknown": "\u0061", "config" : {
    "#m\/z" : "s\/ame",  "ordinary": "s\/ame", "#m/a" : "s\/ame"
}, "n": 1.00e+01 }"##;
        let raw: RawSecrets<'_> = serde_json::from_str(source).unwrap();
        let out = replace_raw_values(
            source,
            vec![
                (raw.config["#m/a"], r#""first""#.to_owned()),
                (raw.config["#m/z"], r#""second""#.to_owned()),
            ],
        );
        let expected = r##"{ "unknown": "\u0061", "config" : {
    "#m\/z" : "second",  "ordinary": "s\/ame", "#m/a" : "first"
}, "n": 1.00e+01 }"##;
        assert_eq!(out, expected);
    }

    async fn seed_sqlite(dek: &[u8]) -> &'static DatabaseConnection {
        use config::meta::organization::OrganizationType;
        use infra::table::{
            entity::{cipher_keys, synthetics_variables},
            organizations as orgs, secret_store_job_markers,
        };
        use sea_orm::{ConnectionTrait, IntoActiveModel, Schema};

        infra::db::create_table().await.unwrap();
        let conn = get_orm_client_rw().await;
        let backend = conn.get_database_backend();
        let schema = Schema::new(backend);
        for statement in [
            schema.create_table_from_entity(Entity),
            schema.create_table_from_entity(organizations::Entity),
            schema.create_table_from_entity(synthetics_variables::Entity),
            schema.create_table_from_entity(cipher_keys::Entity),
            schema.create_table_from_entity(secret_store_job_markers::Entity),
        ] {
            conn.execute(backend.build(&statement)).await.unwrap();
        }
        orgs::add("org", "org", OrganizationType::Custom)
            .await
            .unwrap();
        cipher::install_master_key(Ok(cipher::MasterKeyMode::None)).unwrap();
        cipher::add(cipher::CipherEntry {
            org: "org".into(),
            created_at: 1,
            created_by: "system".into(),
            name: cipher::DEFAULT_DEK_NAME.into(),
            data: config::utils::base64::encode_raw(dek),
            kind: cipher::EntryKind::CipherKey,
            is_system: true,
        })
        .await
        .unwrap();
        let stored = json!({
            "config": {
                "#m/body": encrypt_secret(dek, r#"{"updated_at":1,"updated_by":"writer"}"#).unwrap(),
                "/body": encrypt_secret(dek,"body").unwrap(),
            },
            "variables":[{"name":"HOST","value":encrypt_secret(dek, "a.example").unwrap()}],
            "unknown":{"keep":["this"]}
        });
        let row = Model {
            id: "check".into(),
            org_id: "org".into(),
            synthetics_type: "http".into(),
            target: "https://{{HOST}}/".into(),
            config: json!({"body":""}),
            secrets: stored.to_string(),
            updated_at: 9,
            destinations: json!([]),
            locations: json!([]),
            ..Default::default()
        };
        Entity::insert(row.into_active_model())
            .exec(conn)
            .await
            .unwrap();
        conn
    }
}
