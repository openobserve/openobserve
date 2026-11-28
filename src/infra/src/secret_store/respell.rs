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
    collections::{HashMap, hash_map::Entry},
    sync::{Arc, LazyLock},
    time::Duration,
};

use async_trait::async_trait;
use config::{
    meta::secret_store::{
        ConsumerType, GateState, SecretErrorCode, StoreMode,
        digest::KAuth,
        grammar::{RefKind, parse_refs},
    },
    utils::time::now_micros,
};
use parking_lot::RwLock;
use sea_orm::{
    ActiveModelTrait, ConnectionTrait, DatabaseConnection, DatabaseTransaction, FromQueryResult,
    IntoActiveModel, Set, TransactionTrait,
    sea_query::{Condition, Expr, Order, Query, SelectStatement},
};
use serde_json::Value;

use super::{
    gate, mode,
    reauthorize::{self, Consumer, ConsumerImage, ReauthError, StaleAt, StaleReason, Via},
};
use crate::{
    db::get_orm_client_rw,
    dist_lock,
    errors::Error,
    org_lifecycle::OrgLifecycleGuard,
    table::{
        org_secrets, organizations, secret_consumer_auth, secret_refs,
        secret_store_job_markers::{self as markers, META_ORG},
    },
};

pub const LOCK_KEY: &str = "/secret_store/maint/respell";
pub const INTERVAL: Duration = Duration::from_secs(300);
const PAGE: u64 = 500;
const RAN_MARKER: &str = "secret_respell_ran";
const SCANNED_MARKER: &str = "secret_respell_scanned";
// Covers renames that commit after a pass starts and clock skew between nodes.
const SCAN_OVERLAP_MICROS: i64 = 2 * INTERVAL.as_micros() as i64;
const SCHEDULE: Schedule<'static> = Schedule {
    ran: RAN_MARKER,
    scanned: SCANNED_MARKER,
    min_gap_micros: INTERVAL.as_micros() as i64 * 4 / 5,
};
const CONSUMER_COLUMNS: [secret_refs::Column; 3] = [
    secret_refs::Column::OrgId,
    secret_refs::Column::ConsumerType,
    secret_refs::Column::ConsumerId,
];

static TARGETS: LazyLock<RwLock<HashMap<ConsumerType, Arc<dyn RespellTarget>>>> =
    LazyLock::new(|| {
        let toolsets: Arc<dyn RespellTarget> = Arc::new(super::toolset::ToolsetRespell);
        RwLock::new(HashMap::from([(ConsumerType::AiToolset, toolsets)]))
    });

#[async_trait]
pub trait RespellTarget: Send + Sync {
    fn consumer_type(&self) -> ConsumerType;

    /// Hold the consumer row lock through re-signing and return the image its save signs.
    async fn load_locked(
        &self,
        txn: &DatabaseTransaction,
        org_id: &str,
        consumer_id: &str,
        k_auth: &KAuth,
    ) -> Result<Option<ConsumerImage>, Error>;

    async fn store_in(
        &self,
        txn: &DatabaseTransaction,
        org_id: &str,
        consumer_id: &str,
        stored: &Value,
    ) -> Result<(), Error>;

    /// The URLs a send reaches, read without a row lock; empty when the consumer is gone.
    async fn request_urls(
        &self,
        txn: &DatabaseTransaction,
        org_id: &str,
        consumer_id: &str,
    ) -> Result<Vec<String>, Error>;

    fn check_shape(&self, _image: &ConsumerImage) -> bool {
        true
    }

    /// Runs only after a respell commits, so caches never reload the old row.
    async fn after_commit(&self, _org_id: &str, _consumer_id: &str) {}
}

pub struct Rename {
    pub ref_id: String,
    pub field: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct PassOutcome {
    /// Another node holds the pass or ran it within the interval.
    pub skipped: bool,
    pub respelled: u64,
    pub skipped_stale: u64,
    pub no_target: u64,
    pub failed: u64,
}

struct TargetConsumer<'a> {
    target: &'a dyn RespellTarget,
    org_id: &'a str,
    consumer_type: ConsumerType,
    consumer_id: &'a str,
}

#[async_trait]
impl Consumer for TargetConsumer<'_> {
    fn org_id(&self) -> &str {
        self.org_id
    }

    fn consumer_type(&self) -> ConsumerType {
        self.consumer_type
    }

    fn consumer_id(&self) -> &str {
        self.consumer_id
    }

    async fn load_locked(
        &self,
        txn: &DatabaseTransaction,
        k_auth: &KAuth,
    ) -> Result<Option<ConsumerImage>, Error> {
        self.target
            .load_locked(txn, self.org_id, self.consumer_id, k_auth)
            .await
    }

    fn check_shape(&self, image: &ConsumerImage) -> bool {
        self.target.check_shape(image)
    }
}

struct Schedule<'a> {
    ran: &'a str,
    scanned: &'a str,
    min_gap_micros: i64,
}

#[derive(Clone, Copy)]
enum Window {
    All,
    SecretsChangedSince(i64),
    RefsAddedSince(i64),
}

#[derive(FromQueryResult)]
struct PendingConsumer {
    org_id: String,
    consumer_type: String,
    consumer_id: String,
}

/// The registered loader for a consumer type, for callers that re-sign outside a respell pass.
pub fn target(consumer_type: ConsumerType) -> Option<Arc<dyn RespellTarget>> {
    TARGETS.read().get(&consumer_type).cloned()
}

pub fn register(target: Arc<dyn RespellTarget>) {
    let consumer_type = target.consumer_type();
    TARGETS.write().insert(consumer_type, target);
}

pub fn respell_text(text: &str, from: &str, to: &str) -> Result<String, SecretErrorCode> {
    rewrite_text(text, |name| (name == from).then_some(to))
}

pub fn respell_image(stored: &mut Value, renames: &[Rename]) -> Result<(), SecretErrorCode> {
    let mut by_field = HashMap::<&str, HashMap<&str, &str>>::new();
    for rename in renames {
        let names = by_field.entry(&rename.field).or_default();
        if let Some(previous) = names.insert(&rename.from, &rename.to)
            && previous != rename.to
        {
            return Err(SecretErrorCode::DeliveryStale);
        }
    }
    for (field, names) in by_field {
        let Some(Value::String(text)) = stored.pointer_mut(field) else {
            return Err(SecretErrorCode::DeliveryStale);
        };
        *text = rewrite_text(text, |name| names.get(name).copied())?;
    }
    Ok(())
}

pub async fn respell_consumer(
    org_id: &str,
    consumer_type: ConsumerType,
    consumer_id: &str,
    target: &dyn RespellTarget,
    k_auth: &KAuth,
) -> Result<bool, ReauthError> {
    let consumer = TargetConsumer {
        target,
        org_id,
        consumer_type,
        consumer_id,
    };
    respell_consumer_in(get_orm_client_rw().await, &consumer, k_auth).await
}

pub async fn run_pass_in(conn: &DatabaseConnection) -> Result<PassOutcome, Error> {
    run_scheduled(conn, &SCHEDULE).await
}

pub async fn run_pass() -> Result<PassOutcome, Error> {
    if !enabled() {
        return Ok(PassOutcome::default());
    }
    run_pass_in(get_orm_client_rw().await).await
}

pub async fn run_forever() {
    if matches!(mode::mode(), StoreMode::SuperCluster { .. }) {
        log::info!("secret respell job off in super-cluster mode");
        return;
    }
    loop {
        if run_pass().await.is_err() {
            log::error!("secret respell pass failed");
        }
        tokio::time::sleep(INTERVAL).await;
    }
}

async fn run_scheduled(
    conn: &DatabaseConnection,
    schedule: &Schedule<'_>,
) -> Result<PassOutcome, Error> {
    if !enabled() {
        return Ok(PassOutcome::default());
    }

    let dist_lock::TryLock::Acquired(locker) = dist_lock::try_lock(LOCK_KEY).await? else {
        return Ok(skipped());
    };
    let outcome = claimed_pass(conn, schedule).await;
    let unlock = dist_lock::unlock(&locker).await;
    outcome.and_then(|outcome| unlock.map(|()| outcome))
}

async fn claimed_pass(
    conn: &DatabaseConnection,
    schedule: &Schedule<'_>,
) -> Result<PassOutcome, Error> {
    let started = now_micros();
    if !markers::claim_due_in(
        conn,
        META_ORG,
        schedule.ran,
        started,
        schedule.min_gap_micros,
    )
    .await?
    {
        return Ok(skipped());
    }
    let windows = match markers::get_marker_in(conn, META_ORG, schedule.scanned).await? {
        Some(marker) => {
            let since = marker.done_at.saturating_sub(SCAN_OVERLAP_MICROS);
            vec![
                Window::SecretsChangedSince(since),
                Window::RefsAddedSince(since),
            ]
        }
        None => vec![Window::All],
    };
    let mut outcome = PassOutcome::default();
    for window in windows {
        scan_pending(conn, window, &mut outcome).await?;
    }
    // Unfinished work keeps the old bound, so the next pass sees it again.
    if outcome.failed == 0 && outcome.skipped_stale == 0 && outcome.no_target == 0 {
        markers::set_in(conn, META_ORG, schedule.scanned, started).await?;
    }
    Ok(outcome)
}

fn skipped() -> PassOutcome {
    PassOutcome {
        skipped: true,
        ..Default::default()
    }
}

fn target_for(consumer_type: ConsumerType) -> Option<Arc<dyn RespellTarget>> {
    TARGETS.read().get(&consumer_type).cloned()
}

fn rewrite_text<'a>(
    text: &str,
    replacement: impl Fn(&str) -> Option<&'a str>,
) -> Result<String, SecretErrorCode> {
    let mut rewritten = String::with_capacity(text.len());
    let mut end = 0;
    for token in parse_refs(text)? {
        if token.kind == RefKind::Secret
            && let Some(name) = replacement(&token.name)
        {
            rewritten.push_str(&text[end..token.start]);
            rewritten.push_str("{{secrets.");
            rewritten.push_str(name);
            rewritten.push_str("}}");
            end = token.end;
        }
    }
    rewritten.push_str(&text[end..]);
    Ok(rewritten)
}

async fn respell_consumer_in(
    conn: &DatabaseConnection,
    consumer: &TargetConsumer<'_>,
    k_auth: &KAuth,
) -> Result<bool, ReauthError> {
    if consumer.target.consumer_type() != consumer.consumer_type {
        return Err(Error::Message("secret respell target type mismatch".into()).into());
    }

    let txn = conn.begin().await?;
    match respell_locked(&txn, consumer, k_auth).await {
        Ok(changed) => {
            txn.commit().await?;
            if changed {
                consumer
                    .target
                    .after_commit(consumer.org_id, consumer.consumer_id)
                    .await;
            }
            Ok(changed)
        }
        Err(error) => {
            txn.rollback().await?;
            Err(error)
        }
    }
}

async fn respell_locked(
    txn: &DatabaseTransaction,
    consumer: &TargetConsumer<'_>,
    k_auth: &KAuth,
) -> Result<bool, ReauthError> {
    let kind = consumer.consumer_type.as_str();
    let pending = pending_select()
        .and_where(consumer_tuple().eq(key_tuple(consumer.org_id, kind, consumer.consumer_id)))
        .limit(1)
        .to_owned();
    if txn
        .query_one(txn.get_database_backend().build(&pending))
        .await?
        .is_none()
    {
        return Ok(false);
    }

    let verified = reauthorize::verify_locked(txn, consumer, k_auth, Via::SystemRespell).await?;
    let refs =
        secret_refs::list_for_consumer_in(txn, consumer.org_id, kind, consumer.consumer_id).await?;
    let renames = locked_renames(txn, consumer.org_id, &refs).await?;
    if renames.is_empty() {
        return Ok(false);
    }

    let original = secret_consumer_auth::get_in(txn, consumer.org_id, kind, consumer.consumer_id)
        .await?
        .ok_or_else(|| mutation_stale(consumer, StaleReason::NoAuthRow))?;
    store_respelled(txn, consumer, k_auth, &renames, refs).await?;
    let resigned = reauthorize::resign(txn, verified).await?;
    if resigned.delivery_digest != original.delivery_digest {
        return Err(mutation_stale(consumer, StaleReason::DeliveryDigest));
    }
    Ok(true)
}

async fn locked_renames(
    txn: &DatabaseTransaction,
    org_id: &str,
    refs: &[secret_refs::Model],
) -> Result<Vec<Rename>, Error> {
    let mut ids: Vec<_> = refs.iter().map(|row| row.secret_id.clone()).collect();
    ids.sort_unstable();
    ids.dedup();
    let active_names: HashMap<_, _> = org_secrets::lock_for_share(txn, org_id, &ids)
        .await?
        .into_iter()
        .filter(|secret| secret.state == "active")
        .map(|secret| (secret.id, secret.name))
        .collect();
    Ok(refs
        .iter()
        .filter_map(|row| {
            let name = active_names.get(&row.secret_id)?;
            (row.token_name != *name).then(|| Rename {
                ref_id: row.id.clone(),
                field: row.field.clone(),
                from: row.token_name.clone(),
                to: name.clone(),
            })
        })
        .collect())
}

async fn store_respelled(
    txn: &DatabaseTransaction,
    consumer: &TargetConsumer<'_>,
    k_auth: &KAuth,
    renames: &[Rename],
    refs: Vec<secret_refs::Model>,
) -> Result<(), ReauthError> {
    let mut image = consumer
        .load_locked(txn, k_auth)
        .await?
        .ok_or_else(|| mutation_stale(consumer, StaleReason::ConsumerMissing))?;
    respell_image(&mut image.stored, renames)
        .map_err(|_| mutation_stale(consumer, StaleReason::DeliveryDigest))?;
    consumer
        .target
        .store_in(txn, consumer.org_id, consumer.consumer_id, &image.stored)
        .await?;

    let token_names: HashMap<_, _> = renames
        .iter()
        .map(|rename| (rename.ref_id.as_str(), &rename.to))
        .collect();
    for row in refs {
        if let Some(name) = token_names.get(row.id.as_str()) {
            let mut update = row.into_active_model();
            update.token_name = Set((*name).clone());
            update.update(txn).await?;
        }
    }
    Ok(())
}

fn mutation_stale(consumer: &TargetConsumer<'_>, reason: StaleReason) -> ReauthError {
    let stale = StaleAt {
        step: Via::SystemRespell.step(),
        reason,
    };
    log::warn!(
        "{stale} org={} consumer_type={} consumer_id={}",
        consumer.org_id,
        consumer.consumer_type.as_str(),
        consumer.consumer_id
    );
    ReauthError::Stale(stale)
}

fn enabled() -> bool {
    matches!(mode::mode(), StoreMode::SingleCluster) && gate::require(GateState::Latched).is_ok()
}

fn pending_select() -> SelectStatement {
    windowed_select(Window::All)
}

fn windowed_select(window: Window) -> SelectStatement {
    use org_secrets::{Column as Secrets, Entity as S};
    use secret_refs::{Column as Refs, Entity as R};

    let mut stmt = Query::select();
    match window {
        Window::All => {}
        Window::SecretsChangedSince(since) => {
            stmt.and_where(Expr::col((S, Secrets::UpdatedAt)).gte(since));
        }
        Window::RefsAddedSince(since) => {
            stmt.and_where(Expr::col((R, Refs::CreatedAt)).gte(since));
        }
    }
    stmt.distinct()
        .columns(CONSUMER_COLUMNS.map(|column| (R, column)))
        .from(R)
        .inner_join(
            S,
            Condition::all()
                .add(Expr::col((R, Refs::OrgId)).equals((S, Secrets::OrgId)))
                .add(Expr::col((R, Refs::SecretId)).equals((S, Secrets::Id))),
        )
        .and_where(Expr::col((R, Refs::TokenName)).ne(Expr::col((S, Secrets::Name))))
        .and_where(Expr::col((S, Secrets::State)).eq("active"))
        .to_owned()
}

fn consumer_tuple() -> Expr {
    Expr::tuple(CONSUMER_COLUMNS.map(|column| Expr::col((secret_refs::Entity, column)).into()))
}

fn key_tuple(org_id: &str, consumer_type: &str, consumer_id: &str) -> Expr {
    Expr::tuple([org_id, consumer_type, consumer_id].map(|value| Expr::val(value).into()))
}

async fn scan_pending(
    conn: &DatabaseConnection,
    window: Window,
    outcome: &mut PassOutcome,
) -> Result<(), Error> {
    let mut keys = HashMap::new();
    let mut cursor: Option<PendingConsumer> = None;
    loop {
        let mut stmt = windowed_select(window);
        for column in CONSUMER_COLUMNS {
            stmt.order_by((secret_refs::Entity, column), Order::Asc);
        }
        if let Some(last) = &cursor {
            stmt.and_where(consumer_tuple().gt(key_tuple(
                &last.org_id,
                &last.consumer_type,
                &last.consumer_id,
            )));
        }
        stmt.limit(PAGE);
        let mut page = PendingConsumer::find_by_statement(conn.get_database_backend().build(&stmt))
            .all(conn)
            .await?;
        if page.is_empty() {
            return Ok(());
        }
        for pending in &page {
            process_pending(conn, pending, &mut keys, outcome).await;
        }
        cursor = page.pop();
    }
}

async fn process_pending(
    conn: &DatabaseConnection,
    pending: &PendingConsumer,
    keys: &mut HashMap<String, Result<KAuth, Error>>,
    outcome: &mut PassOutcome,
) {
    let guard = match OrgLifecycleGuard::acquire(&pending.org_id).await {
        Ok(guard) => guard,
        Err(error) => {
            outcome.failed += 1;
            log::error!(
                "secret respell lifecycle lock failed org={}: {error}",
                pending.org_id
            );
            return;
        }
    };
    let result: Result<(), Error> = async {
        let Some(org) = organizations::get_in(conn, &pending.org_id).await? else {
            return Ok(());
        };
        if org.status != "active" {
            return Ok(());
        }
        process_active_pending(conn, pending, keys, outcome).await;
        Ok(())
    }
    .await;
    guard.release().await;
    if let Err(error) = result {
        outcome.failed += 1;
        log::error!(
            "secret respell org lookup failed org={}: {error}",
            pending.org_id
        );
    }
}

async fn process_active_pending(
    conn: &DatabaseConnection,
    pending: &PendingConsumer,
    keys: &mut HashMap<String, Result<KAuth, Error>>,
    outcome: &mut PassOutcome,
) {
    let target = pending
        .consumer_type
        .parse::<ConsumerType>()
        .ok()
        .and_then(|kind| target_for(kind).map(|target| (kind, target)));
    let Some((consumer_type, target)) = target else {
        outcome.no_target += 1;
        log::debug!(
            "no secret respell target org={} consumer_type={} consumer_id={}",
            pending.org_id,
            pending.consumer_type,
            pending.consumer_id
        );
        return;
    };

    let key = match keys.entry(pending.org_id.clone()) {
        Entry::Occupied(entry) => entry.into_mut(),
        Entry::Vacant(entry) => entry.insert(reauthorize::k_auth_for(&pending.org_id).await),
    };
    if let Ok(key) = key {
        let consumer = TargetConsumer {
            target: target.as_ref(),
            org_id: &pending.org_id,
            consumer_type,
            consumer_id: &pending.consumer_id,
        };
        match respell_consumer_in(conn, &consumer, key).await {
            Ok(changed) => {
                outcome.respelled += u64::from(changed);
                return;
            }
            Err(ReauthError::Stale(_)) => {
                outcome.skipped_stale += 1;
                return;
            }
            Err(ReauthError::Infra(_)) => {}
        }
    }
    outcome.failed += 1;
    log::warn!(
        "secret respell failed org={} consumer_type={} consumer_id={}",
        pending.org_id,
        pending.consumer_type,
        pending.consumer_id
    );
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        sync::atomic::{AtomicUsize, Ordering},
    };

    use config::{
        ider::ksuid,
        meta::secret_store::digest::{
            AuthTagInput, BoundRef, delivery_digest, dep_digests, encode_dep_digests,
        },
        utils::time::now_micros,
    };
    use parking_lot::Mutex;
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
    use serde_json::json;

    use super::*;
    use crate::{
        secret_store::gate::GateView,
        table::{cipher, secret_consumer_auth as auth, testing},
    };

    const CONSUMER_ID: &str = "check-id";

    struct Fake {
        image: Mutex<Option<ConsumerImage>>,
        stores: AtomicUsize,
        commits: AtomicUsize,
    }

    impl Fake {
        fn new() -> Self {
            Self {
                image: Mutex::new(Some(ConsumerImage {
                    name: "check".into(),
                    stored: json!({"route": "old", "header": "{{secrets.OLD}}"}),
                    keyed_pointers: vec![],
                    deps: BTreeMap::from([("prod".into(), vec![])]),
                })),
                stores: AtomicUsize::new(0),
                commits: AtomicUsize::new(0),
            }
        }

        fn edit(&self, change: impl FnOnce(&mut ConsumerImage)) {
            change(self.image.lock().as_mut().unwrap());
        }

        fn header(&self) -> Value {
            self.image.lock().as_ref().unwrap().stored["header"].clone()
        }

        fn digest(&self, key: &KAuth, binding: &BoundRef) -> String {
            let image = self.image.lock();
            let image = image.as_ref().unwrap();
            delivery_digest(
                self.consumer_type(),
                &image.stored,
                &image.keyed_pointers,
                key,
                |field, name| {
                    (field == binding.field && name == binding.token_name)
                        .then(|| binding.secret_id.clone())
                },
            )
            .unwrap()
        }
    }

    #[async_trait]
    impl RespellTarget for Fake {
        fn consumer_type(&self) -> ConsumerType {
            ConsumerType::SyntheticsCheck
        }

        async fn load_locked(
            &self,
            _: &DatabaseTransaction,
            _: &str,
            _: &str,
            _: &KAuth,
        ) -> Result<Option<ConsumerImage>, Error> {
            Ok(self.image.lock().clone())
        }

        async fn store_in(
            &self,
            _: &DatabaseTransaction,
            _: &str,
            _: &str,
            stored: &Value,
        ) -> Result<(), Error> {
            self.stores.fetch_add(1, Ordering::Relaxed);
            self.edit(|image| image.stored = stored.clone());
            Ok(())
        }

        async fn request_urls(
            &self,
            _: &DatabaseTransaction,
            _: &str,
            _: &str,
        ) -> Result<Vec<String>, Error> {
            Ok(Vec::new())
        }

        async fn after_commit(&self, _: &str, consumer_id: &str) {
            assert_eq!(consumer_id, CONSUMER_ID);
            self.commits.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[tokio::test]
    async fn respell_skips_deleted_and_deleting_orgs_before_key_access() {
        if !testing::meta_store().await {
            return;
        }
        register(Arc::new(Fake::new()));
        let conn = get_orm_client_rw().await;
        for status in ["deleting", "deleted"] {
            let org = testing::unique(status);
            crate::table::organizations::add(
                &org,
                &org,
                config::meta::organization::OrganizationType::Default,
            )
            .await
            .unwrap();
            crate::table::entity::organizations::Entity::update_many()
                .col_expr(
                    crate::table::entity::organizations::Column::Status,
                    Expr::value(status),
                )
                .filter(crate::table::entity::organizations::Column::Identifier.eq(&org))
                .exec(conn)
                .await
                .unwrap();
            let mut keys = HashMap::new();
            let mut outcome = PassOutcome::default();
            process_pending(
                conn,
                &PendingConsumer {
                    org_id: org.clone(),
                    consumer_type: ConsumerType::SyntheticsCheck.as_str().into(),
                    consumer_id: CONSUMER_ID.into(),
                },
                &mut keys,
                &mut outcome,
            )
            .await;
            assert!(keys.is_empty(), "{status} org accessed its signing key");
            assert_eq!(outcome, PassOutcome::default());
            crate::table::organizations::remove(&org).await.unwrap();
        }
    }

    #[test]
    fn respell_text_preserves_other_tokens_and_bytes() {
        for (text, expected) in [
            (
                "é {{secrets.OLD}}/{{vars.OLD}} {{secrets.OLDER}}\n{{secrets.OLD}}!",
                "é {{secrets.NEW}}/{{vars.OLD}} {{secrets.OLDER}}\n{{secrets.NEW}}!",
            ),
            (
                "{{vars.OLD}} {{secrets.old}} {{OLD}}",
                "{{vars.OLD}} {{secrets.old}} {{OLD}}",
            ),
            ("", ""),
        ] {
            assert_eq!(respell_text(text, "OLD", "NEW").unwrap(), expected);
        }
        assert_eq!(
            respell_text("{{secret.OLD}}", "OLD", "NEW"),
            Err(SecretErrorCode::RefTypo)
        );
    }

    #[test]
    fn respell_image_only_updates_the_named_fields() {
        let mut stored = json!({
            "headers": {"a/b": "{{secrets.OLD}}/{{secrets.NEW}}"},
            "other": "{{secrets.OLD}}",
            "plain": 42,
        });
        let rename = |field: &str, from: &str, to: &str| Rename {
            ref_id: "ref-id".into(),
            field: field.into(),
            from: from.into(),
            to: to.into(),
        };
        respell_image(
            &mut stored,
            &[
                rename("/headers/a~1b", "OLD", "NEW"),
                rename("/headers/a~1b", "NEW", "FINAL"),
            ],
        )
        .unwrap();
        assert_eq!(
            stored["headers"]["a/b"],
            "{{secrets.NEW}}/{{secrets.FINAL}}"
        );
        assert_eq!(stored["other"], "{{secrets.OLD}}");
        for field in ["/missing", "/plain"] {
            assert_eq!(
                respell_image(&mut stored, &[rename(field, "OLD", "NEW")]),
                Err(SecretErrorCode::DeliveryStale)
            );
        }
    }

    #[tokio::test]
    async fn transactional_respell() {
        if !testing::meta_store().await {
            return;
        }
        const CASE: &str = "secret_store::respell::tests::transactional_respell";
        const CHILD: &str = "O2_RESPELL_TEST_CHILD";
        // The cipher tests need a process with no master key installed.
        if std::env::var_os(CHILD).is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", CASE, "--nocapture"])
                .env(CHILD, "1")
                .output()
                .unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            assert!(
                output.status.success() && stdout.contains("1 passed"),
                "{stdout}\n{}",
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        cipher::install_master_key(Ok(cipher::MasterKeyMode::None)).unwrap();
        pass_obeys_mode_and_gate_and_skips_stale().await;
        pass_skips_inside_the_gap_and_scans_only_its_window().await;
        respell_preserves_delivery_digest().await;
        respell_rejects_stale_and_forged_consumers().await;
    }

    async fn renamed_secret(txn: &DatabaseTransaction, org: &str) -> org_secrets::Model {
        let now = now_micros();
        org_secrets::ActiveModel {
            id: Set(ksuid()),
            org_id: Set(org.into()),
            name: Set("OLD".into()),
            kind: Set("secret".into()),
            state: Set("active".into()),
            policy_rev: Set(ksuid()),
            policy_version: Set(1),
            created_by: Set("creator".into()),
            updated_by: Set("creator".into()),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        }
        .insert(txn)
        .await
        .unwrap()
    }

    async fn insert_ref(
        txn: &DatabaseTransaction,
        org: &str,
        kind: ConsumerType,
        id: &str,
        secret_id: &str,
    ) -> BoundRef {
        let binding = BoundRef {
            field: "/header".into(),
            token_name: "OLD".into(),
            secret_id: secret_id.into(),
        };
        secret_refs::ActiveModel {
            id: Set(ksuid()),
            org_id: Set(org.into()),
            consumer_type: Set(kind.as_str().into()),
            consumer_id: Set(id.into()),
            field: Set(binding.field.clone()),
            secret_id: Set(binding.secret_id.clone()),
            token_name: Set(binding.token_name.clone()),
            created_at: Set(now_micros()),
        }
        .insert(txn)
        .await
        .unwrap();
        binding
    }

    async fn sign_first_row(
        txn: &DatabaseTransaction,
        org: &str,
        fake: &Fake,
        key: &KAuth,
        binding: &BoundRef,
    ) -> auth::Model {
        let kind = fake.consumer_type();
        let rev = 7;
        let delivery = fake.digest(key, binding);
        let deps = dep_digests(&fake.image.lock().as_ref().unwrap().deps).unwrap();
        let tag = key.auth_tag(&AuthTagInput {
            org_id: org,
            consumer_type: kind,
            consumer_id: CONSUMER_ID,
            consumer_rev: rev,
            refs: std::slice::from_ref(binding),
            delivery_digest: &delivery,
            dep_digests: &deps,
        });
        auth::insert_in(
            txn,
            auth::ActiveModel {
                org_id: Set(org.into()),
                consumer_type: Set(kind.as_str().into()),
                consumer_id: Set(CONSUMER_ID.into()),
                consumer_name: Set("check".into()),
                consumer_rev: Set(rev),
                delivery_digest: Set(delivery),
                dep_digests: Set(encode_dep_digests(&deps).unwrap()),
                authorized_by: Set("creator".into()),
                via: Set("user".into()),
                auth_tag: Set(tag),
                auth_state: Set(auth::AuthState::Ok),
                updated_at: Set(now_micros()),
            },
        )
        .await
        .unwrap()
    }

    async fn fixture(prefix: &str, fake: &Fake) -> (String, KAuth, BoundRef, auth::Model) {
        let org = testing::unique(prefix);
        organizations::add(
            &org,
            &org,
            config::meta::organization::OrganizationType::Default,
        )
        .await
        .unwrap();
        let key = KAuth::derive(&cipher::get_dek(&org).await.unwrap());
        let txn = get_orm_client_rw().await.begin().await.unwrap();
        let secret = renamed_secret(&txn, &org).await;
        let binding = insert_ref(&txn, &org, fake.consumer_type(), CONSUMER_ID, &secret.id).await;
        let signed = sign_first_row(&txn, &org, fake, &key, &binding).await;
        let mut secret = secret.into_active_model();
        secret.name = Set("NEW".into());
        secret.update(&txn).await.unwrap();
        txn.commit().await.unwrap();
        (org, key, binding, signed)
    }

    async fn refs(org: &str, fake: &Fake, id: &str) -> Vec<secret_refs::Model> {
        secret_refs::list_for_consumer_in(
            get_orm_client_rw().await,
            org,
            fake.consumer_type().as_str(),
            id,
        )
        .await
        .unwrap()
    }

    async fn authorization(org: &str, fake: &Fake) -> auth::Model {
        auth::get_in(
            get_orm_client_rw().await,
            org,
            fake.consumer_type().as_str(),
            CONSUMER_ID,
        )
        .await
        .unwrap()
        .unwrap()
    }

    async fn apply(org: &str, fake: &Fake, key: &KAuth) -> Result<bool, ReauthError> {
        respell_consumer(org, fake.consumer_type(), CONSUMER_ID, fake, key).await
    }

    async fn respell_preserves_delivery_digest() {
        let fake = Fake::new();
        let (org, key, _, signed) = fixture("respell_valid", &fake).await;
        assert!(apply(&org, &fake, &key).await.unwrap());
        assert_eq!(fake.stores.load(Ordering::Relaxed), 1);
        assert_eq!(fake.commits.load(Ordering::Relaxed), 1);
        assert_eq!(fake.header(), "{{secrets.NEW}}");
        assert_eq!(refs(&org, &fake, CONSUMER_ID).await[0].token_name, "NEW");
        let resigned = authorization(&org, &fake).await;
        assert_eq!(resigned.consumer_rev, signed.consumer_rev + 1);
        assert_eq!(resigned.delivery_digest, signed.delivery_digest);
        assert_eq!(resigned.auth_state, auth::AuthState::Ok);
        assert_eq!(resigned.via, "system:respell");
        assert!(!apply(&org, &fake, &key).await.unwrap());
        assert_eq!(fake.stores.load(Ordering::Relaxed), 1);
        assert_eq!(fake.commits.load(Ordering::Relaxed), 1);
        assert_eq!(authorization(&org, &fake).await, resigned);
    }

    async fn respell_rejects_stale_and_forged_consumers() {
        let fake = Fake::new();
        let (org, key, binding, signed) = fixture("respell_forged", &fake).await;
        let original_refs = refs(&org, &fake, CONSUMER_ID).await;
        fake.edit(|image| image.stored["route"] = json!("changed"));
        assert!(matches!(
            apply(&org, &fake, &key).await,
            Err(ReauthError::Stale(StaleAt {
                step: "respell",
                reason: StaleReason::DeliveryDigest
            }))
        ));
        assert_eq!(authorization(&org, &fake).await, signed);
        assert_eq!(fake.stores.load(Ordering::Relaxed), 0);
        assert_eq!(refs(&org, &fake, CONSUMER_ID).await, original_refs);

        let mut forged = signed.into_active_model();
        forged.delivery_digest = Set(fake.digest(&key, &binding));
        let forged = forged.update(get_orm_client_rw().await).await.unwrap();
        assert!(matches!(
            apply(&org, &fake, &key).await,
            Err(ReauthError::Stale(StaleAt {
                step: "respell",
                reason: StaleReason::AuthTag
            }))
        ));
        assert_eq!(authorization(&org, &fake).await, forged);
        assert_eq!(fake.stores.load(Ordering::Relaxed), 0);
        assert_eq!(fake.commits.load(Ordering::Relaxed), 0);
        assert_eq!(refs(&org, &fake, CONSUMER_ID).await, original_refs);
    }

    async fn pass_obeys_mode_and_gate_and_skips_stale() {
        let fake = Arc::new(Fake::new());
        let (org, _, binding, signed) = fixture("respell_pass", &fake).await;
        let stale_id = "stale-id";
        let txn = get_orm_client_rw().await.begin().await.unwrap();
        insert_ref(
            &txn,
            &org,
            fake.consumer_type(),
            stale_id,
            &binding.secret_id,
        )
        .await;
        txn.commit().await.unwrap();
        register(fake.clone());
        let original_refs = refs(&org, &fake, CONSUMER_ID).await;

        gate::force_state_for_tests(Some(GateView {
            state: GateState::Latched,
            suspended: false,
        }));
        mode::set_super_cluster(true, "r1");
        let super_cluster = run_pass().await;
        mode::set_super_cluster(false, "");
        assert_eq!(super_cluster.unwrap(), PassOutcome::default());
        assert_eq!(authorization(&org, &fake).await, signed);
        assert_eq!(refs(&org, &fake, CONSUMER_ID).await, original_refs);

        gate::force_state_for_tests(Some(GateView {
            state: GateState::Closed,
            suspended: false,
        }));
        assert_eq!(run_pass().await.unwrap(), PassOutcome::default());
        assert_eq!(authorization(&org, &fake).await, signed);
        assert_eq!(refs(&org, &fake, CONSUMER_ID).await, original_refs);
        assert_eq!(fake.stores.load(Ordering::Relaxed), 0);

        gate::force_state_for_tests(Some(GateView {
            state: GateState::Latched,
            suspended: false,
        }));
        let schedule = test_schedule();
        let borrowed = schedule.as_schedule();
        let pass = run_scheduled(get_orm_client_rw().await, &borrowed);
        let outcome = tokio::time::timeout(Duration::from_secs(10), pass).await;
        gate::force_state_for_tests(None);
        schedule.drop_markers().await;
        // The meta store outlives a test run, so other orgs' leftovers may add to the counts.
        let outcome = outcome.unwrap().unwrap();
        assert!(
            outcome.respelled >= 1 && outcome.skipped_stale >= 1,
            "{outcome:?}"
        );
        assert!(fake.stores.load(Ordering::Relaxed) >= 1);
        assert_eq!(refs(&org, &fake, CONSUMER_ID).await[0].token_name, "NEW");
        assert_eq!(refs(&org, &fake, stale_id).await[0].token_name, "OLD");
    }

    struct TestSchedule {
        ran: String,
        scanned: String,
    }

    impl TestSchedule {
        fn as_schedule(&self) -> Schedule<'_> {
            Schedule {
                ran: &self.ran,
                scanned: &self.scanned,
                min_gap_micros: SCHEDULE.min_gap_micros,
            }
        }

        async fn drop_markers(&self) {
            markers::Entity::delete_many()
                .filter(markers::Column::OrgId.eq(META_ORG))
                .filter(markers::Column::Job.is_in([self.ran.as_str(), self.scanned.as_str()]))
                .exec(get_orm_client_rw().await)
                .await
                .unwrap();
        }
    }

    fn test_schedule() -> TestSchedule {
        TestSchedule {
            ran: testing::unique("respell_ran"),
            scanned: testing::unique("respell_scanned"),
        }
    }

    async fn backdate(org: &str, secrets_at: i64, refs_at: i64) {
        let conn = get_orm_client_rw().await;
        org_secrets::Entity::update_many()
            .col_expr(org_secrets::Column::UpdatedAt, Expr::value(secrets_at))
            .filter(org_secrets::Column::OrgId.eq(org))
            .exec(conn)
            .await
            .unwrap();
        secret_refs::Entity::update_many()
            .col_expr(secret_refs::Column::CreatedAt, Expr::value(refs_at))
            .filter(secret_refs::Column::OrgId.eq(org))
            .exec(conn)
            .await
            .unwrap();
    }

    async fn pass_skips_inside_the_gap_and_scans_only_its_window() {
        let conn = get_orm_client_rw().await;
        let fake = Arc::new(Fake::new());
        let (org, ..) = fixture("respell_window", &fake).await;
        register(fake.clone());
        backdate(&org, 1, 1).await;
        gate::force_state_for_tests(Some(GateView {
            state: GateState::Latched,
            suspended: false,
        }));

        let schedule = test_schedule();
        markers::set_in(conn, META_ORG, &schedule.scanned, now_micros())
            .await
            .unwrap();
        let first = run_scheduled(conn, &schedule.as_schedule()).await.unwrap();
        assert!(!first.skipped, "{first:?}");
        assert_eq!(
            refs(&org, &fake, CONSUMER_ID).await[0].token_name,
            "OLD",
            "a rename older than the scanned marker is outside the window"
        );
        let second = run_scheduled(conn, &schedule.as_schedule()).await.unwrap();
        assert_eq!(second, skipped(), "a pass inside the gap does no work");

        // A ref saved through an alias after the marker is inside the window though its secret is
        // old.
        backdate(&org, 1, now_micros()).await;
        let schedule = test_schedule();
        markers::set_in(conn, META_ORG, &schedule.scanned, now_micros())
            .await
            .unwrap();
        let third = run_scheduled(conn, &schedule.as_schedule()).await;
        gate::force_state_for_tests(None);
        assert!(third.unwrap().respelled >= 1);
        assert_eq!(refs(&org, &fake, CONSUMER_ID).await[0].token_name, "NEW");
        schedule.drop_markers().await;
    }
}
