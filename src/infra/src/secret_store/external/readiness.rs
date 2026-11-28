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

use config::meta::secret_store::{
    SecretErrorCode,
    external::{AuthMode, BackendKind, FetchError, ResolvedIdentity},
};
use parking_lot::RwLock;
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseBackend, EntityTrait, FromQueryResult,
    QueryFilter, QuerySelect, Set, Statement, TransactionTrait, sea_query::OnConflict,
};

use super::{admit_auth_mode, require_region_for};
use crate::{
    secret_store::mode,
    table::{secret_backend_readiness as rows, secret_backends},
};

const UNAVAILABLE: SecretErrorCode = SecretErrorCode::SecretUnavailable;
const SELECT_BACKEND: &str = "
    SELECT b.*, i.incarnation, i.next_incarnation, r.passed_at
    FROM secret_backends b
    JOIN organizations o ON o.identifier = b.org_id AND o.status = 'active'
        AND o.org_incarnation <> ''
    LEFT JOIN secret_backend_identities i ON i.org_id = b.org_id AND i.provider = b.kind
        AND b.auth_mode = 'mapped' AND i.state = 'active'
    LEFT JOIN secret_backend_readiness r ON r.org_id = b.org_id AND r.backend_id = b.id
        AND r.backend_rev = b.backend_rev
        AND r.identity_rev = CASE b.auth_mode
            WHEN 'static' THEN b.credential_rev
            WHEN 'mapped' THEN $3 || ':' || i.incarnation
            WHEN 'region_issuer' THEN $3 || ':' || $4
        END
    WHERE b.org_id = $1 AND b.id = $2 AND b.state = 'active'";
static ISSUER_KID: RwLock<Option<String>> = RwLock::new(None);

pub struct ReadyBackend {
    pub backend: secret_backends::Model,
    pub kind: BackendKind,
    pub identity: ResolvedIdentity,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FailureScope {
    Backend,
    Locator,
}

#[derive(Clone)]
struct Deployment {
    region: String,
    kid: Option<String>,
    admitted: Vec<AuthMode>,
    cloud: bool,
}

impl Deployment {
    fn current() -> Self {
        Self {
            region: config::get_config().common.secret_store_region.clone(),
            kid: ISSUER_KID.read().clone(),
            admitted: config::secret_store_auth_modes(),
            cloud: cfg!(feature = "cloud"),
        }
    }

    fn identity(
        &self,
        mode: AuthMode,
        backend: &secret_backends::Model,
        incarnation: Option<String>,
    ) -> Result<ResolvedIdentity, SecretErrorCode> {
        require_region_for(mode, &self.region)?;
        match mode {
            AuthMode::Static
                if backend.cred_ref.is_some() && !backend.credential_rev.is_empty() =>
            {
                Ok(ResolvedIdentity::Static {
                    credential_rev: backend.credential_rev.clone(),
                })
            }
            AuthMode::Static => Err(UNAVAILABLE),
            AuthMode::Mapped => Ok(ResolvedIdentity::Mapped {
                region: self.region.clone(),
                identity_incarnation: incarnation.filter(|s| !s.is_empty()).ok_or(UNAVAILABLE)?,
            }),
            AuthMode::RegionIssuer => Ok(ResolvedIdentity::RegionIssuer {
                region: self.region.clone(),
                kid: self
                    .kid
                    .clone()
                    .filter(|s| !s.is_empty())
                    .ok_or(UNAVAILABLE)?,
            }),
        }
    }
}

struct Snapshot {
    target: ReadyBackend,
    next_rev: Option<String>,
    passed: bool,
}

impl Snapshot {
    fn ready(self) -> Result<ReadyBackend, SecretErrorCode> {
        self.passed.then_some(self.target).ok_or(UNAVAILABLE)
    }
}

/// The signer publishes its active key on startup and rotation; clearing it immediately blocks
/// issuer reads.
pub fn set_issuer_kid(kid: Option<String>) {
    *ISSUER_KID.write() = kid;
}

pub async fn ready_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    backend_id: &str,
) -> Result<ReadyBackend, SecretErrorCode> {
    mode::require_single_cluster()?;
    select_in(conn, org, backend_id, &Deployment::current())
        .await?
        .ready()
}

/// A connection test needs the current revisions even when no pass exists yet.
pub async fn test_target_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    backend_id: &str,
) -> Result<ReadyBackend, SecretErrorCode> {
    mode::require_single_cluster()?;
    Ok(select_in(conn, org, backend_id, &Deployment::current())
        .await?
        .target)
}

pub async fn record_pass_in<C: TransactionTrait>(
    conn: &C,
    org: &str,
    backend_id: &str,
    tested_backend_rev: &str,
    tested_identity: &ResolvedIdentity,
) -> Result<(), SecretErrorCode> {
    mode::require_single_cluster()?;
    pass_in(
        conn,
        org,
        backend_id,
        tested_backend_rev,
        tested_identity,
        Deployment::current,
    )
    .await
}

pub async fn withdraw_in<C: ConnectionTrait>(
    conn: &C,
    target: &ReadyBackend,
    scope: FailureScope,
    failure: &FetchError,
) -> Result<(), SecretErrorCode> {
    mode::require_single_cluster()?;
    if scope == FailureScope::Locator || failure.is_transient() {
        return Ok(());
    }
    rows::Entity::delete_many()
        .filter(rows::Column::OrgId.eq(&target.backend.org_id))
        .filter(rows::Column::BackendId.eq(&target.backend.id))
        .filter(rows::Column::BackendRev.eq(&target.backend.backend_rev))
        .filter(rows::Column::IdentityRev.eq(target.identity.identity_rev()))
        .exec(conn)
        .await
        .map_err(|_| UNAVAILABLE)?;
    Ok(())
}

async fn select_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
    deployment: &Deployment,
) -> Result<Snapshot, SecretErrorCode> {
    let db = conn.get_database_backend();
    let row = conn
        .query_one(Statement::from_sql_and_values(
            db,
            SELECT_BACKEND,
            [
                org.into(),
                id.into(),
                deployment.region.as_str().into(),
                deployment.kid.clone().into(),
            ],
        ))
        .await
        .map_err(|_| UNAVAILABLE)?
        .ok_or(UNAVAILABLE)?;
    let backend = secret_backends::Model::from_query_result(&row, "").map_err(|_| UNAVAILABLE)?;
    let kind = backend.kind.parse().map_err(|_| UNAVAILABLE)?;
    let mode = backend.auth_mode.parse().map_err(|_| UNAVAILABLE)?;
    admit_auth_mode(kind, mode, &deployment.admitted, deployment.cloud)?;
    let incarnation: Option<String> = row.try_get("", "incarnation").map_err(|_| UNAVAILABLE)?;
    let identity = deployment.identity(mode, &backend, incarnation)?;
    let next: Option<String> = row
        .try_get("", "next_incarnation")
        .map_err(|_| UNAVAILABLE)?;
    let passed_at: Option<i64> = row.try_get("", "passed_at").map_err(|_| UNAVAILABLE)?;
    Ok(Snapshot {
        target: ReadyBackend {
            backend,
            kind,
            identity,
        },
        next_rev: next
            .filter(|s| !s.is_empty())
            .map(|s| format!("{}:{s}", deployment.region)),
        passed: passed_at.is_some(),
    })
}

async fn pass_in<C: TransactionTrait>(
    conn: &C,
    org: &str,
    id: &str,
    tested_backend_rev: &str,
    tested_identity: &ResolvedIdentity,
    deployment: impl FnOnce() -> Deployment,
) -> Result<(), SecretErrorCode> {
    let txn = conn.begin().await.map_err(|_| UNAVAILABLE)?;
    // A pass that waited behind a rotation must read the identity and issuer key after taking the
    // lock.
    if txn.get_database_backend() == DatabaseBackend::Postgres {
        secret_backends::Entity::find_by_id(id)
            .filter(secret_backends::Column::OrgId.eq(org))
            .select_only()
            .column(secret_backends::Column::Id)
            .lock_exclusive()
            .into_tuple::<String>()
            .one(&txn)
            .await
            .map_err(|_| UNAVAILABLE)?
            .ok_or(UNAVAILABLE)?;
    }
    let snapshot = select_in(&txn, org, id, &deployment()).await?;
    let current_rev = snapshot.target.identity.identity_rev();
    let tested_rev = tested_identity.identity_rev();
    let next_matches = matches!(tested_identity, ResolvedIdentity::Mapped { .. })
        && snapshot.next_rev.as_deref() == Some(&tested_rev);
    if snapshot.target.backend.backend_rev != tested_backend_rev
        || (snapshot.target.identity != *tested_identity && !next_matches)
    {
        return Err(UNAVAILABLE);
    }
    rows::Entity::insert(rows::ActiveModel {
        org_id: Set(org.to_owned()),
        backend_id: Set(id.to_owned()),
        backend_rev: Set(tested_backend_rev.to_owned()),
        identity_rev: Set(tested_rev),
        passed_at: Set(config::utils::time::now_micros()),
    })
    .on_conflict(
        OnConflict::columns([
            rows::Column::OrgId,
            rows::Column::BackendId,
            rows::Column::IdentityRev,
        ])
        .update_columns([rows::Column::BackendRev, rows::Column::PassedAt])
        .to_owned(),
    )
    .exec_without_returning(&txn)
    .await
    .map_err(|_| UNAVAILABLE)?;
    // A mapped rotation can have two live passes until the provisioner switches every backend.
    let retained = std::iter::once(current_rev).chain(snapshot.next_rev);
    rows::Entity::delete_many()
        .filter(rows::Column::OrgId.eq(org))
        .filter(rows::Column::BackendId.eq(id))
        .filter(
            Condition::any()
                .add(rows::Column::BackendRev.ne(tested_backend_rev))
                .add(rows::Column::IdentityRev.is_not_in(retained)),
        )
        .exec(&txn)
        .await
        .map_err(|_| UNAVAILABLE)?;
    txn.commit().await.map_err(|_| UNAVAILABLE)
}

#[cfg(test)]
mod tests {
    use config::{ider::ksuid, meta::organization::OrganizationType};
    use sea_orm::{ActiveModelTrait, DatabaseConnection, sea_query::Expr};

    use super::*;
    use crate::{
        db::get_orm_client_rw,
        table::{organizations, secret_backend_identities, testing::meta_store},
    };

    struct Fixture {
        conn: &'static DatabaseConnection,
        org: String,
        id: String,
        deployment: Deployment,
    }

    impl Fixture {
        async fn new(kind: BackendKind, mode: AuthMode) -> Self {
            let conn = get_orm_client_rw().await;
            let org = ksuid();
            let id = ksuid();
            organizations::add(&org, &org, OrganizationType::Custom)
                .await
                .unwrap();
            secret_backends::ActiveModel {
                id: Set(id.clone()),
                org_id: Set(org.clone()),
                kind: Set(kind.as_str().into()),
                name: Set("primary".into()),
                config: Set("{}".into()),
                path_prefixes: Set("[]".into()),
                auth_mode: Set(mode.as_str().into()),
                cred_ref: Set(Some(ksuid())),
                credential_rev: Set(ksuid()),
                state: Set("active".into()),
                backend_rev: Set(ksuid()),
                ttl_secs: Set(60),
                stale_max_secs: Set(300),
                created_by: Set("test".into()),
                updated_by: Set("test".into()),
                created_at: Set(1),
                updated_at: Set(1),
                ..Default::default()
            }
            .insert(conn)
            .await
            .unwrap();
            Self {
                conn,
                org,
                id,
                deployment: Deployment {
                    region: "east".into(),
                    kid: Some("signing-key".into()),
                    admitted: vec![mode],
                    cloud: true,
                },
            }
        }

        async fn snapshot(&self) -> Result<Snapshot, SecretErrorCode> {
            select_in(self.conn, &self.org, &self.id, &self.deployment).await
        }

        async fn pass(&self) -> ReadyBackend {
            let target = self.snapshot().await.unwrap().target;
            pass_in(
                self.conn,
                &self.org,
                &self.id,
                &target.backend.backend_rev,
                &target.identity,
                || self.deployment.clone(),
            )
            .await
            .unwrap();
            self.snapshot().await.unwrap().ready().unwrap()
        }

        async fn map_identity(&self, current: String, next: Option<String>) {
            secret_backend_identities::upsert_manual_in(
                self.conn,
                secret_backend_identities::ActiveModel {
                    org_id: Set(self.org.clone()),
                    provider: Set(BackendKind::AwsSm.as_str().into()),
                    principal: Set("role".into()),
                    state: Set("active".into()),
                    incarnation: Set(current),
                    next_incarnation: Set(next),
                    desired_gen: Set(1),
                    applied_gen: Set(1),
                    policy_hash: Set("hash".into()),
                    rotate_requested: Set(false),
                    created_by: Set("test".into()),
                    created_at: Set(1),
                    updated_at: Set(1),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn pass_withdrawal_is_scoped_to_failure_and_revisions() {
        if !meta_store().await {
            return;
        }
        let f = Fixture::new(BackendKind::AwsSm, AuthMode::Static).await;
        assert!(f.snapshot().await.unwrap().ready().is_err());
        let old = f.pass().await;
        for (scope, failure) in [
            (
                FailureScope::Locator,
                FetchError::Missing { reason: "missing" },
            ),
            (
                FailureScope::Locator,
                FetchError::Denied { reason: "denied" },
            ),
            (
                FailureScope::Backend,
                FetchError::Transient { reason: "timeout" },
            ),
        ] {
            withdraw_in(f.conn, &old, scope, &failure).await.unwrap();
            assert!(f.snapshot().await.unwrap().ready().is_ok());
        }
        let denied = FetchError::Denied {
            reason: "authentication",
        };
        withdraw_in(f.conn, &old, FailureScope::Backend, &denied)
            .await
            .unwrap();
        assert!(f.snapshot().await.unwrap().ready().is_err());
        f.pass().await;

        secret_backends::Entity::update_many()
            .col_expr(secret_backends::Column::CredentialRev, Expr::value(ksuid()))
            .filter(secret_backends::Column::Id.eq(&f.id))
            .exec(f.conn)
            .await
            .unwrap();
        assert!(f.snapshot().await.unwrap().ready().is_err());
        f.pass().await;
        withdraw_in(f.conn, &old, FailureScope::Backend, &denied)
            .await
            .unwrap();
        assert_eq!(
            pass_in(
                f.conn,
                &f.org,
                &f.id,
                &old.backend.backend_rev,
                &old.identity,
                || f.deployment.clone()
            )
            .await,
            Err(UNAVAILABLE)
        );
        assert!(f.snapshot().await.unwrap().ready().is_ok());
        assert!(
            rows::get_in(f.conn, &f.org, &f.id, &old.identity.identity_rev())
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn pending_deletion_in_db_refuses_an_already_ready_backend() {
        if !meta_store().await {
            return;
        }
        let f = Fixture::new(BackendKind::AwsSm, AuthMode::Static).await;
        f.pass().await;
        assert!(
            organizations::set_status_if_in(f.conn, &f.org, "active", "pending_deletion")
                .await
                .unwrap()
        );
        assert_eq!(organizations::get(&f.org).await.unwrap().status, "active");
        assert!(matches!(f.snapshot().await, Err(UNAVAILABLE)));
    }

    #[tokio::test]
    async fn mapped_region_change_and_rotation_keep_only_live_passes() {
        if !meta_store().await {
            return;
        }
        let mut f = Fixture::new(BackendKind::AwsSm, AuthMode::Mapped).await;
        let current = ksuid();
        let next = ksuid();
        f.map_identity(current, Some(next.clone())).await;
        let east = f.pass().await;
        f.deployment.region = "west".into();
        assert!(f.snapshot().await.unwrap().ready().is_err());
        let west = f.pass().await;
        assert!(
            rows::get_in(f.conn, &f.org, &f.id, &east.identity.identity_rev())
                .await
                .unwrap()
                .is_none()
        );

        let pending = ResolvedIdentity::Mapped {
            region: "west".into(),
            identity_incarnation: next.clone(),
        };
        pass_in(
            f.conn,
            &f.org,
            &f.id,
            &west.backend.backend_rev,
            &pending,
            || f.deployment.clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            f.snapshot().await.unwrap().ready().unwrap().identity,
            west.identity
        );
        f.map_identity(next, None).await;
        assert_eq!(
            f.snapshot().await.unwrap().ready().unwrap().identity,
            pending
        );
        f.pass().await;
        assert!(
            rows::get_in(f.conn, &f.org, &f.id, &west.identity.identity_rev())
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn issuer_reads_need_admission_and_the_current_region_and_key() {
        if !meta_store().await {
            return;
        }
        let mut f = Fixture::new(BackendKind::GcpSm, AuthMode::RegionIssuer).await;
        f.deployment.admitted.clear();
        assert!(matches!(
            f.snapshot().await,
            Err(SecretErrorCode::AuthModeNotEnabled)
        ));
        f.deployment.admitted.push(AuthMode::RegionIssuer);
        f.pass().await;
        f.deployment.region = "west".into();
        assert!(f.snapshot().await.unwrap().ready().is_err());
        f.pass().await;
        f.deployment.kid = Some("rotated-key".into());
        assert!(f.snapshot().await.unwrap().ready().is_err());
        f.pass().await;
    }
}
