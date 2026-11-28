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

use std::{collections::BTreeMap, fmt};

use async_trait::async_trait;
use config::{
    meta::secret_store::{
        ConsumerType, SecretErrorCode,
        digest::{self, AuthTagInput, BoundRef, DepDigests, DepEntry, KAuth},
    },
    utils::time::now_micros,
};
use futures::future::BoxFuture;
use sea_orm::{DatabaseTransaction, DbErr, IntoActiveModel, Set};
use serde_json::Value;
use zeroize::Zeroizing;

use crate::{
    errors::Error,
    table::{
        cipher,
        secret_consumer_auth::{self as auth, AuthState},
        secret_refs,
    },
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Via {
    UserDependency { user_id: String },
    SystemRespell,
    SystemMigrate,
    SystemMerge,
    SystemConvert,
}

impl Via {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UserDependency { .. } => "user:dependency",
            Self::SystemRespell => "system:respell",
            Self::SystemMigrate => "system:migrate",
            Self::SystemMerge => "system:merge",
            Self::SystemConvert => "system:convert",
        }
    }

    pub fn step(&self) -> &'static str {
        match self {
            Self::UserDependency { .. } => "dependency",
            Self::SystemRespell => "respell",
            Self::SystemMigrate => "migration",
            Self::SystemMerge => "merge",
            Self::SystemConvert => "convert",
        }
    }

    fn stale(&self, consumer: &dyn Consumer, reason: StaleReason) -> ReauthError {
        let stale = StaleAt {
            step: self.step(),
            reason,
        };
        log::warn!(
            "{stale} org={} consumer_type={} consumer_id={}",
            consumer.org_id(),
            consumer.consumer_type().as_str(),
            consumer.consumer_id()
        );
        ReauthError::Stale(stale)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StaleReason {
    NoAuthRow,
    ConsumerMissing,
    AuthStateStale,
    ConsumerIdMismatch,
    DeliveryDigest,
    DepDigestMissing,
    DepDigest,
    AuthTag,
    Shape,
}

impl fmt::Display for StaleReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::NoAuthRow => "no_auth_row",
            Self::ConsumerMissing => "consumer_missing",
            Self::AuthStateStale => "auth_state_stale",
            Self::ConsumerIdMismatch => "consumer_id_mismatch",
            Self::DeliveryDigest => "delivery_digest",
            Self::DepDigestMissing => "dep_digest_missing",
            Self::DepDigest => "dep_digest",
            Self::AuthTag => "auth_tag",
            Self::Shape => "shape",
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StaleAt {
    pub step: &'static str,
    pub reason: StaleReason,
}

impl fmt::Display for StaleAt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "stale_at_{}: {}", self.step, self.reason)
    }
}

#[derive(Debug)]
pub enum ReauthError {
    Stale(StaleAt),
    Infra(Error),
}

impl From<Error> for ReauthError {
    fn from(error: Error) -> Self {
        Self::Infra(error)
    }
}

impl From<DbErr> for ReauthError {
    fn from(error: DbErr) -> Self {
        Self::Infra(error.into())
    }
}

#[derive(Clone)]
pub struct ConsumerImage {
    pub name: String,
    pub stored: Value,
    pub keyed_pointers: Vec<String>,
    pub deps: BTreeMap<String, Vec<DepEntry>>,
}

impl ConsumerImage {
    fn delivery_digest(
        &self,
        ty: ConsumerType,
        refs: &[BoundRef],
        k_auth: &KAuth,
    ) -> Result<String, StaleReason> {
        digest::delivery_digest(
            ty,
            &self.stored,
            &self.keyed_pointers,
            k_auth,
            |field, name| {
                refs.iter()
                    .find(|r| r.field == field && r.token_name == name)
                    .map(|r| r.secret_id.clone())
            },
        )
        .map_err(|_| StaleReason::DeliveryDigest)
    }

    fn dep_digests(&self) -> Result<DepDigests, StaleReason> {
        digest::dep_digests(&self.deps).map_err(|_| StaleReason::DepDigest)
    }
}

#[async_trait]
pub trait Consumer: Send + Sync {
    fn org_id(&self) -> &str;
    fn consumer_type(&self) -> ConsumerType;
    fn consumer_id(&self) -> &str;
    /// The consumer lock must cover the expanded snapshot and stay held through re-signing.
    async fn load_locked(
        &self,
        txn: &DatabaseTransaction,
        k_auth: &KAuth,
    ) -> Result<Option<ConsumerImage>, Error>;
    fn check_shape(&self, _image: &ConsumerImage) -> bool {
        true
    }
}

pub struct Verified<'c> {
    txn: &'c DatabaseTransaction,
    consumer: &'c dyn Consumer,
    auth: auth::Model,
    k_auth: &'c KAuth,
    via: Via,
}

pub struct Resigned {
    pub consumer_rev: i64,
    pub delivery_digest: String,
    pub dep_digests: DepDigests,
}

/// Call before opening the transaction because the DEK lookup uses its own connection.
pub async fn k_auth_for(org_id: &str) -> Result<KAuth, Error> {
    let dek = cipher::get_existing_dek(org_id)
        .await?
        .ok_or(Error::SecretStore(SecretErrorCode::SecretUnavailable))?;
    Ok(KAuth::derive(&Zeroizing::new(dek)))
}

/// Writers sharing a transaction must sequence mutations of one consumer because its row locks are
/// shared.
pub async fn verify_locked<'c>(
    txn: &'c DatabaseTransaction,
    consumer: &'c dyn Consumer,
    k_auth: &'c KAuth,
    via: Via,
) -> Result<Verified<'c>, ReauthError> {
    let stale = |reason| via.stale(consumer, reason);
    let ty = consumer.consumer_type();
    // Consumer row before auth row, the order every save takes, so the two cannot deadlock.
    let image = consumer
        .load_locked(txn, k_auth)
        .await?
        .ok_or_else(|| stale(StaleReason::ConsumerMissing))?;
    let auth = auth::get_for_update_in(txn, consumer.org_id(), ty.as_str(), consumer.consumer_id())
        .await?
        .ok_or_else(|| stale(StaleReason::NoAuthRow))?;
    if auth.consumer_id != consumer.consumer_id() {
        return Err(stale(StaleReason::ConsumerIdMismatch));
    }
    if auth.auth_state != AuthState::Ok {
        return Err(stale(StaleReason::AuthStateStale));
    }
    let refs = bound_refs(txn, consumer).await?;
    if image.delivery_digest(ty, &refs, k_auth).map_err(stale)? != auth.delivery_digest {
        return Err(stale(StaleReason::DeliveryDigest));
    }
    let deps = verify_deps(&image, &auth.dep_digests).map_err(stale)?;
    let input = tag_input(
        consumer,
        auth.consumer_rev,
        &refs,
        &auth.delivery_digest,
        &deps,
    );
    if !k_auth.verify_auth_tag(&input, &auth.auth_tag) {
        return Err(stale(StaleReason::AuthTag));
    }
    if !consumer.check_shape(&image) {
        return Err(stale(StaleReason::Shape));
    }
    Ok(Verified {
        txn,
        consumer,
        auth,
        k_auth,
        via,
    })
}

pub async fn resign(
    txn: &DatabaseTransaction,
    verified: Verified<'_>,
) -> Result<Resigned, ReauthError> {
    if !std::ptr::eq(txn, verified.txn) {
        return Err(Error::Message(
            "re-sign requires the transaction holding the consumer locks".into(),
        )
        .into());
    }
    let Verified {
        consumer,
        auth,
        k_auth,
        via,
        ..
    } = verified;
    let stale = |reason| via.stale(consumer, reason);
    let image = consumer
        .load_locked(txn, k_auth)
        .await?
        .ok_or_else(|| stale(StaleReason::ConsumerMissing))?;
    // A batch can verify the same consumer twice before either proof is consumed.
    let current = auth::get_in(txn, &auth.org_id, &auth.consumer_type, &auth.consumer_id)
        .await?
        .ok_or_else(|| stale(StaleReason::NoAuthRow))?;
    if current.auth_state != AuthState::Ok {
        return Err(stale(StaleReason::AuthStateStale));
    }
    if current.auth_tag != auth.auth_tag || current.consumer_rev != auth.consumer_rev {
        return Err(stale(StaleReason::AuthTag));
    }
    let refs = bound_refs(txn, consumer).await?;
    let delivery_digest = image
        .delivery_digest(consumer.consumer_type(), &refs, k_auth)
        .map_err(stale)?;
    let dep_digests = image.dep_digests().map_err(stale)?;
    let consumer_rev = auth
        .consumer_rev
        .checked_add(1)
        .ok_or_else(|| Error::Message("consumer revision overflow".into()))?;
    let tag = k_auth.auth_tag(&tag_input(
        consumer,
        consumer_rev,
        &refs,
        &delivery_digest,
        &dep_digests,
    ));
    let mut row = auth.into_active_model();
    row.consumer_name = Set(image.name);
    row.consumer_rev = Set(consumer_rev);
    row.delivery_digest = Set(delivery_digest.clone());
    row.dep_digests = Set(digest::encode_dep_digests(&dep_digests).map_err(Error::SecretStore)?);
    row.auth_tag = Set(tag);
    row.auth_state = Set(AuthState::Ok);
    row.updated_at = Set(now_micros());
    row.via = Set(via.as_str().to_owned());
    if let Via::UserDependency { user_id } = &via {
        row.authorized_by = Set(user_id.clone());
    }
    auth::update_in(txn, consumer.org_id(), row)
        .await?
        .ok_or_else(|| stale(StaleReason::NoAuthRow))?;
    Ok(Resigned {
        consumer_rev,
        delivery_digest,
        dep_digests,
    })
}

pub async fn reauthorize<'c, M>(
    txn: &DatabaseTransaction,
    consumer: &'c dyn Consumer,
    k_auth: &'c KAuth,
    mutation: M,
    via: Via,
) -> Result<Resigned, ReauthError>
where
    M: for<'t> FnOnce(&'t DatabaseTransaction) -> BoxFuture<'t, Result<(), Error>> + Send,
{
    let verified = verify_locked(txn, consumer, k_auth, via).await?;
    mutation(txn).await?;
    resign(txn, verified).await
}

async fn bound_refs(
    txn: &DatabaseTransaction,
    consumer: &dyn Consumer,
) -> Result<Vec<BoundRef>, Error> {
    let rows = secret_refs::list_for_consumer_in(
        txn,
        consumer.org_id(),
        consumer.consumer_type().as_str(),
        consumer.consumer_id(),
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| BoundRef {
            field: r.field,
            token_name: r.token_name,
            secret_id: r.secret_id,
        })
        .collect())
}

fn verify_deps(image: &ConsumerImage, text: &str) -> Result<DepDigests, StaleReason> {
    let stored = digest::decode_dep_digests(text).map_err(|_| StaleReason::DepDigestMissing)?;
    if stored.is_empty() || image.deps.keys().any(|env| !stored.contains_key(env)) {
        return Err(StaleReason::DepDigestMissing);
    }
    for (env, computed) in image.dep_digests()? {
        if !digest::dep_digest_matches(&stored, &env, &computed) {
            return Err(StaleReason::DepDigest);
        }
    }
    Ok(stored)
}

fn tag_input<'a>(
    consumer: &'a dyn Consumer,
    consumer_rev: i64,
    refs: &'a [BoundRef],
    delivery_digest: &'a str,
    dep_digests: &'a DepDigests,
) -> AuthTagInput<'a> {
    AuthTagInput {
        org_id: consumer.org_id(),
        consumer_type: consumer.consumer_type(),
        consumer_id: consumer.consumer_id(),
        consumer_rev,
        refs,
        delivery_digest,
        dep_digests,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
    };

    use async_trait::async_trait;
    use config::meta::secret_store::{
        ConsumerType,
        digest::{
            AuthTagInput, BoundRef, DepEntry, KAuth, decode_dep_digests, delivery_digest,
            dep_digests, encode_dep_digests,
        },
    };
    use parking_lot::Mutex;
    use sea_orm::{
        ActiveModelTrait, DatabaseConnection, DatabaseTransaction, Set, TransactionTrait,
    };
    use serde_json::json;

    use super::{
        Consumer, ConsumerImage, ReauthError, StaleAt, StaleReason, Via, reauthorize, resign,
        verify_locked,
    };
    use crate::{
        db::get_orm_client_rw,
        errors::Error,
        table::{cipher, entity::secret_refs, secret_consumer_auth as auth, testing::unique},
    };

    struct Fake {
        org: String,
        image: Mutex<Option<ConsumerImage>>,
    }

    impl Fake {
        async fn fixture(prefix: &str) -> (Self, KAuth, DatabaseTransaction) {
            let org = unique(prefix);
            let key = KAuth::derive(&cipher::get_dek(&org).await.unwrap());
            let txn = get_orm_client_rw().await.begin().await.unwrap();
            let image = ConsumerImage {
                name: "check".into(),
                stored: json!({"route": "old", "header": "{{secrets.TOKEN}}"}),
                keyed_pointers: vec![],
                deps: BTreeMap::from([("prod".into(), vec![]), ("staging".into(), vec![])]),
            };
            (
                Self {
                    org,
                    image: Mutex::new(Some(image)),
                },
                key,
                txn,
            )
        }

        fn edit(&self, change: impl FnOnce(&mut ConsumerImage)) {
            change(self.image.lock().as_mut().unwrap());
        }

        async fn auth(&self, txn: &DatabaseTransaction) -> Option<auth::Model> {
            auth::get_in(
                txn,
                self.org_id(),
                self.consumer_type().as_str(),
                self.consumer_id(),
            )
            .await
            .unwrap()
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

        fn ref_row(&self, binding: &BoundRef) -> secret_refs::ActiveModel {
            secret_refs::ActiveModel {
                id: Set(config::ider::ksuid()),
                org_id: Set(self.org.clone()),
                consumer_type: Set(self.consumer_type().as_str().into()),
                consumer_id: Set(self.consumer_id().into()),
                field: Set(binding.field.clone()),
                secret_id: Set(binding.secret_id.clone()),
                token_name: Set(binding.token_name.clone()),
                created_at: Set(config::utils::time::now_micros()),
            }
        }
    }

    #[async_trait]
    impl Consumer for Fake {
        fn org_id(&self) -> &str {
            &self.org
        }
        fn consumer_type(&self) -> ConsumerType {
            ConsumerType::SyntheticsCheck
        }
        fn consumer_id(&self) -> &str {
            "check-id"
        }
        async fn load_locked(
            &self,
            _: &DatabaseTransaction,
            _: &KAuth,
        ) -> Result<Option<ConsumerImage>, Error> {
            Ok(self.image.lock().clone())
        }
        fn check_shape(&self, image: &ConsumerImage) -> bool {
            image.name != "invalid"
        }
    }

    fn vias() -> [(Via, &'static str, &'static str); 5] {
        [
            (
                Via::UserDependency {
                    user_id: "writer".into(),
                },
                "dependency",
                "user:dependency",
            ),
            (Via::SystemRespell, "respell", "system:respell"),
            (Via::SystemMigrate, "migration", "system:migrate"),
            (Via::SystemMerge, "merge", "system:merge"),
            (Via::SystemConvert, "convert", "system:convert"),
        ]
    }

    fn binding(secret_id: &str) -> BoundRef {
        BoundRef {
            field: "/header".into(),
            token_name: "TOKEN".into(),
            secret_id: secret_id.into(),
        }
    }

    async fn sign_first_row(
        txn: &DatabaseTransaction,
        fake: &Fake,
        key: &KAuth,
        rev: i64,
    ) -> auth::Model {
        let binding = binding("secret-1");
        fake.ref_row(&binding).insert(txn).await.unwrap();
        let delivery = fake.digest(key, &binding);
        let deps = dep_digests(&fake.image.lock().as_ref().unwrap().deps).unwrap();
        let tag = key.auth_tag(&AuthTagInput {
            org_id: fake.org_id(),
            consumer_type: fake.consumer_type(),
            consumer_id: fake.consumer_id(),
            consumer_rev: rev,
            refs: &[binding],
            delivery_digest: &delivery,
            dep_digests: &deps,
        });
        auth::insert_in(
            txn,
            auth::ActiveModel {
                org_id: Set(fake.org.clone()),
                consumer_type: Set(fake.consumer_type().as_str().into()),
                consumer_id: Set(fake.consumer_id().into()),
                consumer_name: Set("check".into()),
                consumer_rev: Set(rev),
                delivery_digest: Set(delivery),
                dep_digests: Set(encode_dep_digests(&deps).unwrap()),
                authorized_by: Set("creator".into()),
                via: Set("user".into()),
                auth_tag: Set(tag),
                auth_state: Set(auth::AuthState::Ok),
                updated_at: Set(1),
            },
        )
        .await
        .unwrap()
    }

    fn assert_stale<T>(result: Result<T, ReauthError>, step: &'static str, reason: StaleReason) {
        match result {
            Err(ReauthError::Stale(actual)) => assert_eq!(actual, StaleAt { step, reason }),
            Err(ReauthError::Infra(error)) => panic!("unexpected infrastructure error: {error}"),
            Ok(_) => panic!("expected stale authorization"),
        }
    }

    fn change_dependencies(image: &mut ConsumerImage) {
        image
            .deps
            .get_mut("staging")
            .unwrap()
            .push(DepEntry::Absent { name: "VAR".into() });
    }

    #[test]
    fn displays_stale_step_for_every_writer() {
        for (via, step, _) in vias() {
            let at = StaleAt {
                step: via.step(),
                reason: StaleReason::DepDigestMissing,
            };
            assert_eq!(
                at.to_string(),
                format!("stale_at_{step}: dep_digest_missing")
            );
        }
    }

    #[tokio::test]
    async fn transactional_reauthorization() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        const CASE: &str = "secret_store::reauthorize::tests::transactional_reauthorization";
        const CHILD: &str = "O2_REAUTHORIZE_TEST_CHILD";
        // The cipher key installs once per process, and the cipher tests require an uninitialized
        // key.
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
        key_lookup_requires_an_existing_dek().await;
        every_writer_rejects_mismatched_and_recomputed_digests_before_mutation().await;
        every_writer_signs_the_written_image_and_refs().await;
        missing_or_stale_preimages_fail_at_the_first_failed_check().await;
        variable_writer_must_verify_before_writing().await;
        resign_rejects_a_vanished_consumer_or_authorization().await;
        verification_expires_after_a_resign_in_the_same_transaction().await;
        consumer_row_locks_before_the_auth_row().await;
    }

    async fn key_lookup_requires_an_existing_dek() {
        let org = unique("reauth_key");
        assert!(matches!(
            super::k_auth_for(&org).await,
            Err(Error::SecretStore(
                config::meta::secret_store::SecretErrorCode::SecretUnavailable
            ))
        ));
        let expected = KAuth::derive(&cipher::get_dek(&org).await.unwrap());
        let actual = super::k_auth_for(&org).await.unwrap();
        assert_eq!(actual.literal("fixture"), expected.literal("fixture"));
    }

    async fn every_writer_rejects_mismatched_and_recomputed_digests_before_mutation() {
        for (via, step, _) in vias() {
            let (fake, key, txn) = Fake::fixture("reauth_forged").await;
            let original = sign_first_row(&txn, &fake, &key, 12).await;
            let calls = AtomicUsize::new(0);
            let mutate = || {
                calls.fetch_add(1, Ordering::Relaxed);
                async { Ok(()) }
            };
            fake.edit(|image| image.stored["route"] = json!("changed"));
            assert_stale(
                reauthorize(&txn, &fake, &key, |_| Box::pin(mutate()), via.clone()).await,
                step,
                StaleReason::DeliveryDigest,
            );
            assert_eq!(fake.auth(&txn).await.unwrap(), original);

            let mut forged: auth::ActiveModel = original.clone().into();
            forged.delivery_digest = Set(fake.digest(&key, &binding("secret-1")));
            let forged = forged.update(&txn).await.unwrap();
            assert_stale(
                reauthorize(&txn, &fake, &key, |_| Box::pin(mutate()), via.clone()).await,
                step,
                StaleReason::AuthTag,
            );
            assert_eq!(fake.auth(&txn).await.unwrap(), forged);

            fake.edit(|image| {
                image.stored["route"] = json!("old");
                change_dependencies(image);
            });
            let mut forged: auth::ActiveModel = forged.into();
            forged.delivery_digest = Set(original.delivery_digest);
            let deps = dep_digests(&fake.image.lock().as_ref().unwrap().deps).unwrap();
            forged.dep_digests = Set(encode_dep_digests(&deps).unwrap());
            let forged = forged.update(&txn).await.unwrap();
            assert_stale(
                reauthorize(&txn, &fake, &key, |_| Box::pin(mutate()), via).await,
                step,
                StaleReason::AuthTag,
            );
            assert_eq!(fake.auth(&txn).await.unwrap(), forged);
            assert_eq!(calls.load(Ordering::Relaxed), 0);
            txn.rollback().await.unwrap();
        }
    }

    async fn every_writer_signs_the_written_image_and_refs() {
        for (via, _, via_text) in vias() {
            let (fake, key, txn) = Fake::fixture("reauth_valid").await;
            let original = sign_first_row(&txn, &fake, &key, 7).await;
            let changed = binding("secret-2");
            let expected_by = match &via {
                Via::UserDependency { user_id } => user_id.clone(),
                _ => original.authorized_by.clone(),
            };
            let new_ref = fake.ref_row(&changed);
            let org = fake.org.clone();
            let kind = fake.consumer_type().as_str().to_owned();
            let id = fake.consumer_id().to_owned();
            let result = reauthorize(
                &txn,
                &fake,
                &key,
                |txn| {
                    fake.edit(|image| {
                        image.name = "updated".into();
                        image.stored["route"] = json!("new");
                        change_dependencies(image);
                    });
                    Box::pin(async move {
                        crate::table::secret_refs::replace_for_consumer_in(
                            txn,
                            &org,
                            &kind,
                            &id,
                            vec![new_ref],
                        )
                        .await
                    })
                },
                via,
            )
            .await
            .unwrap();
            let row = fake.auth(&txn).await.unwrap();
            let deps = dep_digests(&fake.image.lock().as_ref().unwrap().deps).unwrap();
            let delivery = fake.digest(&key, &changed);
            assert_eq!(row.consumer_rev, 8);
            assert_eq!(result.consumer_rev, row.consumer_rev);
            assert_eq!(result.delivery_digest, delivery);
            assert_eq!(result.dep_digests, deps);
            assert_eq!(row.delivery_digest, delivery);
            assert_eq!(decode_dep_digests(&row.dep_digests).unwrap(), deps);
            assert_eq!(row.via, via_text);
            assert_eq!(row.consumer_name, "updated");
            assert_eq!(row.authorized_by, expected_by);
            assert_eq!(row.auth_state, auth::AuthState::Ok);
            assert!(row.updated_at > original.updated_at);
            assert!(key.verify_auth_tag(
                &AuthTagInput {
                    org_id: fake.org_id(),
                    consumer_type: fake.consumer_type(),
                    consumer_id: fake.consumer_id(),
                    consumer_rev: row.consumer_rev,
                    refs: &[changed],
                    delivery_digest: &delivery,
                    dep_digests: &deps,
                },
                &row.auth_tag
            ));
            txn.rollback().await.unwrap();
        }
    }

    async fn missing_or_stale_preimages_fail_at_the_first_failed_check() {
        let (fake, key, txn) = Fake::fixture("reauth_missing").await;
        let verify = || verify_locked(&txn, &fake, &key, Via::SystemMigrate);
        assert_stale(verify().await, "migration", StaleReason::NoAuthRow);
        assert!(fake.auth(&txn).await.is_none());
        let original = sign_first_row(&txn, &fake, &key, 1).await;
        fake.edit(|image| image.name = "invalid".into());
        assert_stale(verify().await, "migration", StaleReason::Shape);
        let mut stale: auth::ActiveModel = original.clone().into();
        stale.auth_state = Set(auth::AuthState::Stale);
        stale.update(&txn).await.unwrap();
        assert_stale(verify().await, "migration", StaleReason::AuthStateStale);
        let mut single = decode_dep_digests(&original.dep_digests).unwrap();
        single.remove("staging");
        for text in [
            "{}".into(),
            encode_dep_digests(&single).unwrap(),
            "{".into(),
        ] {
            let mut row: auth::ActiveModel = original.clone().into();
            row.auth_state = Set(auth::AuthState::Ok);
            row.dep_digests = Set(text);
            row.update(&txn).await.unwrap();
            assert_stale(verify().await, "migration", StaleReason::DepDigestMissing);
        }
        *fake.image.lock() = None;
        assert_stale(verify().await, "migration", StaleReason::ConsumerMissing);
        txn.rollback().await.unwrap();
    }

    async fn consumer_row_locks_before_the_auth_row() {
        let (fake, key, setup) = Fake::fixture("reauth_lock_order").await;
        setup.rollback().await.unwrap();
        let mut observed = match get_orm_client_rw().await {
            DatabaseConnection::SqlxPostgresPoolConnection(pool) => {
                DatabaseConnection::SqlxPostgresPoolConnection(pool.clone())
            }
            DatabaseConnection::SqlxSqlitePoolConnection(pool) => {
                DatabaseConnection::SqlxSqlitePoolConnection(pool.clone())
            }
            _ => panic!("expected a meta-store pool"),
        };
        let auth_reads = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&auth_reads);
        observed.set_metric_callback(move |info| {
            if info.statement.sql.contains("secret_consumer_auth") {
                count.fetch_add(1, Ordering::Relaxed);
            }
        });
        let txn = observed.begin().await.unwrap();
        sign_first_row(&txn, &fake, &key, 1).await;
        auth_reads.store(0, Ordering::Relaxed);
        *fake.image.lock() = None;
        assert_stale(
            verify_locked(&txn, &fake, &key, Via::SystemMigrate).await,
            "migration",
            StaleReason::ConsumerMissing,
        );
        assert_eq!(auth_reads.load(Ordering::Relaxed), 0);
        txn.rollback().await.unwrap();
    }

    async fn variable_writer_must_verify_before_writing() {
        let (fake, key, txn) = Fake::fixture("reauth_variable").await;
        sign_first_row(&txn, &fake, &key, 2).await;
        let verify = || {
            verify_locked(
                &txn,
                &fake,
                &key,
                Via::UserDependency {
                    user_id: "writer".into(),
                },
            )
        };
        let verified = verify().await.unwrap();
        fake.edit(change_dependencies);
        assert_stale(verify().await, "dependency", StaleReason::DepDigest);
        let result = resign(&txn, verified).await.unwrap();
        let row = fake.auth(&txn).await.unwrap();
        let deps = dep_digests(&fake.image.lock().as_ref().unwrap().deps).unwrap();
        assert_eq!(result.consumer_rev, 3);
        assert_eq!(result.dep_digests, deps);
        assert_eq!(decode_dep_digests(&row.dep_digests).unwrap(), deps);
        txn.rollback().await.unwrap();
    }

    async fn resign_rejects_a_vanished_consumer_or_authorization() {
        let (fake, key, txn) = Fake::fixture("reauth_vanished").await;
        let original = sign_first_row(&txn, &fake, &key, 2).await;
        let verify = || verify_locked(&txn, &fake, &key, Via::SystemMerge);
        let verified = verify().await.unwrap();
        let image = fake.image.lock().take();
        assert_stale(
            resign(&txn, verified).await,
            "merge",
            StaleReason::ConsumerMissing,
        );
        assert_eq!(fake.auth(&txn).await.unwrap(), original);
        *fake.image.lock() = image;
        let verified = verify().await.unwrap();
        auth::delete_in(
            &txn,
            fake.org_id(),
            fake.consumer_type().as_str(),
            fake.consumer_id(),
        )
        .await
        .unwrap();
        assert_stale(
            resign(&txn, verified).await,
            "merge",
            StaleReason::NoAuthRow,
        );
        assert!(fake.auth(&txn).await.is_none());
        txn.rollback().await.unwrap();
    }

    async fn verification_expires_after_a_resign_in_the_same_transaction() {
        let (fake, key, txn) = Fake::fixture("reauth_repeat").await;
        sign_first_row(&txn, &fake, &key, 2).await;
        let verified = verify_locked(&txn, &fake, &key, Via::SystemMerge)
            .await
            .unwrap();
        let nested = txn.begin().await.unwrap();
        assert!(matches!(
            resign(&nested, verified).await,
            Err(ReauthError::Infra(_))
        ));
        nested.rollback().await.unwrap();
        let first = verify_locked(&txn, &fake, &key, Via::SystemMerge)
            .await
            .unwrap();
        let second = verify_locked(&txn, &fake, &key, Via::SystemRespell)
            .await
            .unwrap();
        assert_eq!(resign(&txn, first).await.unwrap().consumer_rev, 3);
        let signed = fake.auth(&txn).await.unwrap();
        assert_stale(resign(&txn, second).await, "respell", StaleReason::AuthTag);
        assert_eq!(fake.auth(&txn).await.unwrap(), signed);
        txn.rollback().await.unwrap();
    }
}
