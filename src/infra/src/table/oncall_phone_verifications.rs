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

//! Phone verification codes, one row per (user, number); region-local, never replicated.

use config::{
    ider,
    meta::oncall::{
        CODE_MAX_ATTEMPTS, CODE_TTL_MICROS, CodeRow, SendDecision, code_send_decision, next_counts,
    },
};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    Select, Set, SqlErr, TransactionTrait,
    sea_query::{Expr, Func, SimpleExpr},
};

use super::entity::{
    oncall_phone_verifications::{ActiveModel, Column, Entity, Model},
    oncall_user_contacts,
};
use crate::{db::get_orm_client_rw, errors};

/// One verification row as the code decisions read it, plus the hash only confirm compares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredCode {
    pub row: CodeRow,
    pub code_hash: Option<String>,
}

/// Every row this person has, whatever the case of the email.
pub async fn list_for_user(user_email: &str) -> Result<Vec<StoredCode>, errors::Error> {
    list_for_user_in(get_orm_client_rw().await, user_email).await
}

/// Every row for this number, across people.
pub async fn list_for_target(target: &str) -> Result<Vec<StoredCode>, errors::Error> {
    list_for_target_in(get_orm_client_rw().await, target).await
}

/// Saves a fresh code for (user, number), resetting attempts, only if the row still has the
/// `sent_at` the caller read (`None`: no row); false means another send stored first. [strong]
pub async fn store_code(
    user_email: &str,
    target: &str,
    code_hash: &str,
    expected_sent_at: Option<i64>,
    sends_today: u32,
    day_started_at: i64,
    now: i64,
) -> Result<bool, errors::Error> {
    store_code_in(
        get_orm_client_rw().await,
        user_email,
        target,
        code_hash,
        expected_sent_at,
        sends_today,
        day_started_at,
        now,
    )
    .await
}

/// Decides and stores a send under one lock; `None` when this person no longer holds it. [strong]
pub async fn reserve_code(
    user_email: &str,
    target: &str,
    code_hash: &str,
    now: i64,
) -> Result<Option<SendDecision>, errors::Error> {
    reserve_code_in(
        get_orm_client_rw().await,
        user_email,
        target,
        code_hash,
        now,
    )
    .await
}

/// Counts one try on the code sent at `sent_at` if still unspent, live and under the cap. [strong]
pub async fn claim_attempt(
    user_email: &str,
    target: &str,
    sent_at: i64,
    now: i64,
) -> Result<bool, errors::Error> {
    claim_attempt_in(get_orm_client_rw().await, user_email, target, sent_at, now).await
}

/// Spends the code sent at `sent_at`, verifying its number per org; `None` if not current. [strong]
pub async fn confirm(
    user_email: &str,
    target: &str,
    sent_at: i64,
    now: i64,
) -> Result<Option<Vec<(String, String)>>, errors::Error> {
    confirm_in(get_orm_client_rw().await, user_email, target, sent_at, now).await
}

fn to_stored(m: Model) -> Result<StoredCode, errors::Error> {
    let attempts = u32::try_from(m.attempts);
    let sends_today = u32::try_from(m.sends_today);
    let (Ok(attempts), Ok(sends_today)) = (attempts, sends_today) else {
        return Err(errors::DbError::SeaORMError(format!(
            "oncall_phone_verifications {}: counts out of range",
            m.id
        ))
        .into());
    };
    Ok(StoredCode {
        row: CodeRow {
            user_email: m.user_email,
            target: m.target,
            has_code: m.code_hash.is_some(),
            attempts,
            sent_at: m.sent_at,
            sends_today,
            day_started_at: m.day_started_at,
        },
        code_hash: m.code_hash,
    })
}

async fn list_for_user_in<C: ConnectionTrait>(
    conn: &C,
    user_email: &str,
) -> Result<Vec<StoredCode>, errors::Error> {
    list_in(conn, Column::UserEmail.eq(user_email.to_lowercase())).await
}

async fn list_for_target_in<C: ConnectionTrait>(
    conn: &C,
    target: &str,
) -> Result<Vec<StoredCode>, errors::Error> {
    list_in(conn, Column::Target.eq(target)).await
}

async fn list_in<C: ConnectionTrait>(
    conn: &C,
    filter: SimpleExpr,
) -> Result<Vec<StoredCode>, errors::Error> {
    Entity::find()
        .filter(filter)
        .all(conn)
        .await?
        .into_iter()
        .map(to_stored)
        .collect()
}

#[allow(clippy::too_many_arguments)]
async fn store_code_in<C: ConnectionTrait>(
    conn: &C,
    user_email: &str,
    target: &str,
    code_hash: &str,
    expected_sent_at: Option<i64>,
    sends_today: u32,
    day_started_at: i64,
    now: i64,
) -> Result<bool, errors::Error> {
    let user_email = user_email.to_lowercase();
    let Some(expected) = expected_sent_at else {
        let model = ActiveModel {
            id: Set(ider::uuid()),
            user_email: Set(user_email),
            target: Set(target.to_string()),
            code_hash: Set(Some(code_hash.to_string())),
            attempts: Set(0),
            sent_at: Set(now),
            sends_today: Set(i64::from(sends_today)),
            day_started_at: Set(day_started_at),
            created_at: Set(now),
            updated_at: Set(now),
        };
        return match Entity::insert(model).exec(conn).await {
            Ok(_) => Ok(true),
            Err(e) => match e.sql_err() {
                Some(SqlErr::UniqueConstraintViolation(_)) => Ok(false),
                _ => Err(e.into()),
            },
        };
    };
    let stored = Entity::update_many()
        .col_expr(Column::CodeHash, Expr::value(Some(code_hash.to_string())))
        .col_expr(Column::Attempts, Expr::value(0i32))
        .col_expr(Column::SentAt, Expr::value(now))
        .col_expr(Column::SendsToday, Expr::value(i64::from(sends_today)))
        .col_expr(Column::DayStartedAt, Expr::value(day_started_at))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::UserEmail.eq(user_email))
        .filter(Column::Target.eq(target))
        .filter(Column::SentAt.eq(expected))
        .exec(conn)
        .await?
        .rows_affected;
    Ok(stored == 1)
}

async fn reserve_code_in<C: TransactionTrait>(
    db: &C,
    user_email: &str,
    target: &str,
    code_hash: &str,
    now: i64,
) -> Result<Option<SendDecision>, errors::Error> {
    let txn = db.begin().await?;
    let email = user_email.to_lowercase();
    let locked = profiles_to_lock(user_email, target).all(&txn).await?;
    // Every sender to this number then locks this row too, so their sends queue behind this one.
    if !locked
        .iter()
        .any(|p| p.user_email.to_lowercase() == email && p.phone.as_deref() == Some(target))
    {
        return Ok(None);
    }
    let rows =
        |stored: Vec<StoredCode>| -> Vec<CodeRow> { stored.into_iter().map(|s| s.row).collect() };
    let user_rows = rows(list_for_user_in(&txn, user_email).await?);
    let number_rows = rows(list_for_target_in(&txn, target).await?);
    let decision = code_send_decision(user_email, target, &user_rows, &number_rows, now);
    match decision {
        SendDecision::Send => {
            let pair = user_rows.iter().find(|r| r.target == target);
            let (sends_today, day_started_at) = next_counts(pair, now);
            let expected = pair.map(|r| r.sent_at);
            if !store_code_in(
                &txn,
                user_email,
                target,
                code_hash,
                expected,
                sends_today,
                day_started_at,
                now,
            )
            .await?
            {
                return Err(errors::DbError::SeaORMError(format!(
                    "oncall_phone_verifications: the code row for {target} changed under its lock"
                ))
                .into());
            }
        }
        SendDecision::Wait { .. } => {}
    }
    txn.commit().await?;
    Ok(Some(decision))
}

/// Every profile of this person or holding this number, locked in id order.
fn profiles_to_lock(user_email: &str, target: &str) -> Select<oncall_user_contacts::Entity> {
    // Profiles predate any code row, so first sends queue too (`rum_pa::lock_app_ordered`).
    oncall_user_contacts::Entity::find()
        .filter(
            Condition::any()
                .add(
                    Expr::expr(Func::lower(Expr::col(
                        oncall_user_contacts::Column::UserEmail,
                    )))
                    .eq(user_email.to_lowercase()),
                )
                .add(oncall_user_contacts::Column::Phone.eq(target)),
        )
        .order_by_asc(oncall_user_contacts::Column::Id)
        .lock_exclusive()
}

async fn claim_attempt_in<C: ConnectionTrait>(
    conn: &C,
    user_email: &str,
    target: &str,
    sent_at: i64,
    now: i64,
) -> Result<bool, errors::Error> {
    // One statement, so concurrent confirms cannot all read the same count and pass the cap.
    let claimed = Entity::update_many()
        .col_expr(Column::Attempts, Expr::col(Column::Attempts).add(1))
        .filter(Column::UserEmail.eq(user_email.to_lowercase()))
        .filter(Column::Target.eq(target))
        .filter(Column::SentAt.eq(sent_at))
        .filter(Column::CodeHash.is_not_null())
        .filter(Column::Attempts.lt(i64::from(CODE_MAX_ATTEMPTS)))
        .filter(Column::SentAt.gt(now - CODE_TTL_MICROS))
        .exec(conn)
        .await?
        .rows_affected;
    Ok(claimed == 1)
}

async fn confirm_in<C: TransactionTrait>(
    db: &C,
    user_email: &str,
    target: &str,
    sent_at: i64,
    now: i64,
) -> Result<Option<Vec<(String, String)>>, errors::Error> {
    let txn = db.begin().await?;
    // Profiles before the code row, as `reserve_code_in` does, so the two cannot deadlock.
    profiles_to_lock(user_email, target).all(&txn).await?;
    // Spent first: a code a resend replaced, or another confirm spent, verifies nothing.
    let spent = Entity::update_many()
        .col_expr(Column::CodeHash, Expr::value(Option::<String>::None))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::UserEmail.eq(user_email.to_lowercase()))
        .filter(Column::Target.eq(target))
        .filter(Column::SentAt.eq(sent_at))
        .filter(Column::CodeHash.is_not_null())
        .exec(&txn)
        .await?
        .rows_affected;
    if spent != 1 {
        return Ok(None);
    }
    // Write before reading: a number changed concurrently no longer matches and is never marked.
    oncall_user_contacts::Entity::update_many()
        .col_expr(
            oncall_user_contacts::Column::PhoneVerifiedAt,
            Expr::value(Some(now)),
        )
        .filter(profile_with_number(user_email, target))
        .exec(&txn)
        .await?;
    let marked = oncall_user_contacts::Entity::find()
        .filter(profile_with_number(user_email, target))
        .filter(oncall_user_contacts::Column::PhoneVerifiedAt.eq(now))
        .all(&txn)
        .await?;
    txn.commit().await?;
    Ok(Some(
        marked
            .into_iter()
            .map(|p| (p.org_id, p.user_email))
            .collect(),
    ))
}

/// This person's profiles in any org that hold this number.
fn profile_with_number(user_email: &str, target: &str) -> Condition {
    Condition::all()
        // Profiles keep the case the request path carried.
        .add(
            Expr::expr(Func::lower(Expr::col(
                oncall_user_contacts::Column::UserEmail,
            )))
            .eq(user_email.to_lowercase()),
        )
        .add(oncall_user_contacts::Column::Phone.eq(target))
}

#[cfg(test)]
mod tests {
    use sea_orm::{
        ActiveModelTrait, ConnectOptions, Database, DatabaseConnection, QueryTrait, Schema,
        Statement,
    };

    use super::*;

    const NUMBER: &str = "+15550100";

    /// One connection, not a pool: two connections to `sqlite::memory:` are two databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(&schema.create_table_from_entity(Entity)))
            .await
            .unwrap();
        db.execute(backend.build(&schema.create_table_from_entity(oncall_user_contacts::Entity)))
            .await
            .unwrap();
        // The upsert's conflict target needs the migration's unique index.
        db.execute(Statement::from_string(
            backend,
            "CREATE UNIQUE INDEX idx_user_target ON oncall_phone_verifications (user_email, target)",
        ))
        .await
        .unwrap();
        db
    }

    async fn contact(db: &DatabaseConnection, org: &str, email: &str, phone: &str) {
        oncall_user_contacts::ActiveModel::from(oncall_user_contacts::Model {
            id: format!("c_{org}_{email}_{phone}"),
            org_id: org.into(),
            user_email: email.into(),
            phone: Some(phone.into()),
            phone_verified_at: None,
            push_token: None,
            push_verified_at: None,
            quiet_hours: None,
            updated_at: 1,
        })
        .insert(db)
        .await
        .unwrap();
    }

    async fn verified_at(db: &DatabaseConnection, org: &str, email: &str) -> Option<i64> {
        oncall_user_contacts::Entity::find()
            .filter(oncall_user_contacts::Column::OrgId.eq(org))
            .filter(oncall_user_contacts::Column::UserEmail.eq(email))
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .phone_verified_at
    }

    /// Every later write to the verification table aborts, as a lost connection would.
    async fn fail_writes(db: &DatabaseConnection) {
        for event in ["INSERT", "UPDATE"] {
            db.execute(Statement::from_string(
                db.get_database_backend(),
                format!(
                    "CREATE TRIGGER fail_{event} BEFORE {event} ON oncall_phone_verifications \
                     BEGIN SELECT RAISE(ABORT, 'forced'); END"
                ),
            ))
            .await
            .unwrap();
        }
    }

    async fn all(db: &DatabaseConnection) -> Vec<StoredCode> {
        list_in(db, Expr::value(true)).await.unwrap()
    }

    #[tokio::test]
    async fn test_a_new_code_replaces_the_old_one_and_resets_attempts() {
        let db = db().await;
        assert!(
            store_code_in(&db, "ana@o2.ai", NUMBER, "h1", None, 1, 100, 100)
                .await
                .unwrap()
        );
        assert!(
            claim_attempt_in(&db, "ana@o2.ai", NUMBER, 100, 150)
                .await
                .unwrap()
        );

        assert!(
            store_code_in(&db, "Ana@O2.ai", NUMBER, "h2", Some(100), 2, 100, 200)
                .await
                .unwrap()
        );

        let rows = all(&db).await;
        assert_eq!(rows.len(), 1, "one row per (user, number)");
        assert_eq!(rows[0].code_hash.as_deref(), Some("h2"));
        assert_eq!(
            rows[0].row,
            CodeRow {
                user_email: "ana@o2.ai".into(),
                target: NUMBER.into(),
                has_code: true,
                attempts: 0,
                sent_at: 200,
                sends_today: 2,
                day_started_at: 100,
            }
        );
    }

    #[tokio::test]
    async fn test_each_user_and_number_pair_gets_its_own_row() {
        let db = db().await;
        for (user, target) in [
            ("ana@o2.ai", NUMBER),
            ("bo@o2.ai", NUMBER),
            ("ana@o2.ai", "+15550199"),
        ] {
            assert!(
                store_code_in(&db, user, target, "h", None, 1, 1, 1)
                    .await
                    .unwrap()
            );
        }

        assert_eq!(all(&db).await.len(), 3);
    }

    /// F2: two senders that read the same row cannot both store, so only one of them texts.
    #[tokio::test]
    async fn test_a_store_from_a_stale_read_loses() {
        let db = db().await;
        assert!(
            store_code_in(&db, "ana@o2.ai", NUMBER, "h1", None, 1, 100, 100)
                .await
                .unwrap()
        );
        let first = all(&db).await;

        assert!(
            !store_code_in(&db, "ana@o2.ai", NUMBER, "h2", None, 2, 100, 200)
                .await
                .unwrap(),
            "a sender that saw no row loses to the one that inserted"
        );
        assert_eq!(all(&db).await, first);

        assert!(
            store_code_in(&db, "ana@o2.ai", NUMBER, "h2", Some(100), 2, 100, 200)
                .await
                .unwrap()
        );
        let second = all(&db).await;
        assert!(
            !store_code_in(&db, "ANA@o2.ai", NUMBER, "h3", Some(100), 2, 100, 201)
                .await
                .unwrap(),
            "a sender that read sent_at 100 loses once it is 200"
        );
        assert_eq!(all(&db).await, second);
    }

    /// F1: an attempt is claimed only while the code is unspent, unexpired and under the cap.
    #[tokio::test]
    async fn test_an_attempt_is_claimed_only_while_the_code_can_be_tried() {
        let db = db().await;
        assert!(
            !claim_attempt_in(&db, "ana@o2.ai", NUMBER, 100, 1)
                .await
                .unwrap()
        );

        store_code_in(&db, "ana@o2.ai", NUMBER, "h", None, 1, 100, 100)
            .await
            .unwrap();
        let last_valid = 100 + CODE_TTL_MICROS - 1;
        assert!(
            !claim_attempt_in(&db, "ana@o2.ai", NUMBER, 100, last_valid + 1)
                .await
                .unwrap(),
            "expired"
        );
        for n in 0..CODE_MAX_ATTEMPTS {
            assert!(
                claim_attempt_in(&db, "ANA@o2.ai", NUMBER, 100, last_valid)
                    .await
                    .unwrap(),
                "attempt {n}"
            );
        }
        assert!(
            !claim_attempt_in(&db, "ana@o2.ai", NUMBER, 100, last_valid)
                .await
                .unwrap(),
            "over the cap"
        );
        assert_eq!(all(&db).await[0].row.attempts, CODE_MAX_ATTEMPTS);

        store_code_in(&db, "ana@o2.ai", NUMBER, "h", Some(100), 1, 100, 200)
            .await
            .unwrap();
        confirm_in(&db, "ana@o2.ai", NUMBER, 200, 300)
            .await
            .unwrap();
        assert!(
            !claim_attempt_in(&db, "ana@o2.ai", NUMBER, 200, 300)
                .await
                .unwrap(),
            "spent"
        );
    }

    #[tokio::test]
    async fn test_a_failed_store_leaves_the_old_code() {
        let db = db().await;
        store_code_in(&db, "ana@o2.ai", NUMBER, "h1", None, 1, 100, 100)
            .await
            .unwrap();
        let before = all(&db).await;
        fail_writes(&db).await;

        assert!(
            store_code_in(&db, "ana@o2.ai", NUMBER, "h2", Some(100), 2, 100, 200)
                .await
                .is_err()
        );
        assert!(
            store_code_in(&db, "bo@o2.ai", NUMBER, "h2", None, 1, 100, 200)
                .await
                .is_err(),
            "a failed insert is an error, not a lost race"
        );

        assert_eq!(all(&db).await, before);
    }

    /// V7: a send is decided and stored under the lock, only for a holder of the number.
    #[tokio::test]
    async fn test_a_reservation_stores_only_for_a_holder_and_inside_the_limits() {
        let db = db().await;
        contact(&db, "acme", "Ana@O2.ai", NUMBER).await;

        let stranger = reserve_code_in(&db, "bo@o2.ai", NUMBER, "h", 100).await;
        assert_eq!(stranger.unwrap(), None);
        assert!(all(&db).await.is_empty());

        let first = reserve_code_in(&db, "ana@o2.ai", NUMBER, "h1", 100).await;
        assert_eq!(first.unwrap(), Some(SendDecision::Send));
        let stored = all(&db).await;
        assert_eq!(stored[0].code_hash.as_deref(), Some("h1"));
        assert_eq!((stored[0].row.sends_today, stored[0].row.sent_at), (1, 100));

        let again = reserve_code_in(&db, "ana@o2.ai", NUMBER, "h2", 200).await;
        assert!(matches!(again.unwrap(), Some(SendDecision::Wait { .. })));
        assert_eq!(all(&db).await, stored, "a refused send stores nothing");
    }

    /// The lock clause is the whole V7 race fix on PostgreSQL; SQLite has one writer connection.
    #[test]
    fn test_the_reservation_locks_the_profiles_on_postgres() {
        let sql = profiles_to_lock("ana@o2.ai", NUMBER)
            .build(sea_orm::DatabaseBackend::Postgres)
            .to_string();
        assert!(sql.ends_with("FOR UPDATE"), "{sql}");
    }

    #[tokio::test]
    async fn test_a_failed_reservation_stores_nothing() {
        let db = db().await;
        contact(&db, "acme", "ana@o2.ai", NUMBER).await;
        fail_writes(&db).await;

        assert!(
            reserve_code_in(&db, "ana@o2.ai", NUMBER, "h", 100)
                .await
                .is_err()
        );

        assert!(all(&db).await.is_empty());
    }

    #[tokio::test]
    async fn test_a_failed_claim_leaves_the_count() {
        let db = db().await;
        store_code_in(&db, "ana@o2.ai", NUMBER, "h", None, 1, 1, 1)
            .await
            .unwrap();
        fail_writes(&db).await;

        assert!(
            claim_attempt_in(&db, "ana@o2.ai", NUMBER, 1, 2)
                .await
                .is_err()
        );

        assert_eq!(all(&db).await[0].row.attempts, 0);
    }

    #[tokio::test]
    async fn test_lists_find_mixed_case_emails_and_only_their_own_rows() {
        let db = db().await;
        store_code_in(&db, "Ana@O2.ai", NUMBER, "h", None, 1, 1, 1)
            .await
            .unwrap();
        store_code_in(&db, "bo@o2.ai", NUMBER, "h", None, 1, 1, 1)
            .await
            .unwrap();
        store_code_in(&db, "bo@o2.ai", "+15550199", "h", None, 1, 1, 1)
            .await
            .unwrap();

        let ana = list_for_user_in(&db, "ANA@o2.ai").await.unwrap();
        assert_eq!(ana.len(), 1);
        assert_eq!(ana[0].row.target, NUMBER);

        let mut on_number: Vec<String> = list_for_target_in(&db, NUMBER)
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.row.user_email)
            .collect();
        on_number.sort();
        assert_eq!(on_number, vec!["ana@o2.ai", "bo@o2.ai"]);
    }

    #[tokio::test]
    async fn test_confirm_marks_every_org_with_this_email_and_number_and_spends_the_code() {
        let db = db().await;
        contact(&db, "acme", "Ana@O2.ai", NUMBER).await;
        contact(&db, "beta", "ana@o2.ai", NUMBER).await;
        contact(&db, "gamma", "ana@o2.ai", "+15550199").await;
        contact(&db, "acme", "bo@o2.ai", NUMBER).await;
        store_code_in(&db, "ana@o2.ai", NUMBER, "h", None, 1, 1, 1)
            .await
            .unwrap();

        let mut marked = confirm_in(&db, "ANA@o2.ai", NUMBER, 1, 500)
            .await
            .unwrap()
            .expect("the code is current");

        marked.sort();
        assert_eq!(
            marked,
            vec![
                ("acme".to_string(), "Ana@O2.ai".to_string()),
                ("beta".to_string(), "ana@o2.ai".to_string()),
            ],
            "each org with the email as stored, not as asked"
        );
        assert_eq!(verified_at(&db, "acme", "Ana@O2.ai").await, Some(500));
        assert_eq!(verified_at(&db, "beta", "ana@o2.ai").await, Some(500));
        assert_eq!(verified_at(&db, "gamma", "ana@o2.ai").await, None);
        assert_eq!(verified_at(&db, "acme", "bo@o2.ai").await, None);
        let code = &all(&db).await[0];
        assert_eq!(code.code_hash, None, "a code confirms once");
        assert!(!code.row.has_code);
    }

    /// F1: a profile of this person that no longer holds the confirmed number stays unproved.
    #[tokio::test]
    async fn test_confirm_never_marks_a_profile_holding_another_number() {
        let db = db().await;
        contact(&db, "acme", "ana@o2.ai", NUMBER).await;
        contact(&db, "beta", "ana@o2.ai", "+15550199").await;
        store_code_in(&db, "ana@o2.ai", NUMBER, "h", None, 1, 1, 1)
            .await
            .unwrap();

        let marked = confirm_in(&db, "ana@o2.ai", NUMBER, 1, 500)
            .await
            .unwrap()
            .expect("the code is current");

        assert_eq!(marked, vec![("acme".to_string(), "ana@o2.ai".to_string())]);
        assert_eq!(verified_at(&db, "beta", "ana@o2.ai").await, None);
    }

    #[tokio::test]
    async fn test_a_failed_confirm_changes_neither_the_profiles_nor_the_code() {
        let db = db().await;
        contact(&db, "acme", "ana@o2.ai", NUMBER).await;
        store_code_in(&db, "ana@o2.ai", NUMBER, "h", None, 1, 1, 1)
            .await
            .unwrap();
        fail_writes(&db).await;

        assert!(confirm_in(&db, "ana@o2.ai", NUMBER, 1, 500).await.is_err());

        assert_eq!(verified_at(&db, "acme", "ana@o2.ai").await, None);
        assert_eq!(all(&db).await[0].code_hash.as_deref(), Some("h"));
    }

    /// V8: a code checked before a resend replaced it neither claims an attempt nor verifies.
    #[tokio::test]
    async fn test_a_code_replaced_by_a_resend_neither_claims_nor_confirms() {
        let db = db().await;
        contact(&db, "acme", "ana@o2.ai", NUMBER).await;
        store_code_in(&db, "ana@o2.ai", NUMBER, "hA", None, 1, 100, 100)
            .await
            .unwrap();
        let code_a = all(&db).await[0].row.sent_at;
        store_code_in(&db, "ana@o2.ai", NUMBER, "hB", Some(code_a), 2, 100, 200)
            .await
            .unwrap();
        let resent = all(&db).await;

        assert!(
            !claim_attempt_in(&db, "ana@o2.ai", NUMBER, code_a, 250)
                .await
                .unwrap()
        );
        assert_eq!(
            confirm_in(&db, "ana@o2.ai", NUMBER, code_a, 250)
                .await
                .unwrap(),
            None
        );

        assert_eq!(verified_at(&db, "acme", "ana@o2.ai").await, None);
        assert_eq!(all(&db).await, resent, "code B is still stored, untried");
    }
}
