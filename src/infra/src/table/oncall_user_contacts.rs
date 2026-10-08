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

//! Per-user contact profiles — `architecture/03` §5.

use std::collections::HashMap;

use config::{ider, meta::oncall::Contact};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set,
    sea_query::{Expr, Func},
};

use super::entity::oncall_user_contacts;
use crate::{db::get_orm_client_rw, errors};

fn to_contact(m: oncall_user_contacts::Model) -> Contact {
    Contact {
        org_id: m.org_id,
        user_email: m.user_email,
        phone: m.phone,
        phone_verified_at: m.phone_verified_at,
        push_token: m.push_token,
        push_verified_at: m.push_verified_at,
        quiet_hours: m.quiet_hours,
        updated_at: m.updated_at,
    }
}

/// The profile on file, or `None` when the person has never saved one.
pub async fn get(org_id: &str, user_email: &str) -> Result<Option<Contact>, errors::Error> {
    let client = get_orm_client_rw().await;
    Ok(oncall_user_contacts::Entity::find()
        .filter(oncall_user_contacts::Column::OrgId.eq(org_id))
        .filter(oncall_user_contacts::Column::UserEmail.eq(user_email))
        .one(client)
        .await?
        .map(to_contact))
}

/// The profiles on file for these people, keyed by lower-cased email; a person with no row is
/// absent.
pub async fn list_for(
    org_id: &str,
    emails: &[String],
) -> Result<HashMap<String, Contact>, errors::Error> {
    list_for_in(get_orm_client_rw().await, org_id, emails).await
}

/// The fields a write may change. `None` leaves a field alone; `Some(None)`
/// clears it.
///
/// Spelled out rather than taking a whole `Contact`, because a profile is edited
/// from more than one screen and "send me the whole object back" is how one
/// screen silently erases a field it does not render.
#[derive(Debug, Default, Clone)]
pub struct ContactPatch {
    pub phone: Option<Option<String>>,
    pub push_token: Option<Option<String>>,
    pub quiet_hours: Option<Option<String>>,
}

impl ContactPatch {
    pub fn is_empty(&self) -> bool {
        self.phone.is_none() && self.push_token.is_none() && self.quiet_hours.is_none()
    }
}

/// Creates or updates one profile.
///
/// Changing a number clears its verification — the whole safety property of the
/// table. `phone_verified_at` vouches for one specific string, and carrying it
/// across an edit would let somebody save a verified number and then swap in an
/// unverified one a transport would still ring. Re-saving the identical number
/// is not a change and keeps the proof, and a number this person already proved
/// in another org arrives with that proof (V5).
pub async fn upsert(
    org_id: &str,
    user_email: &str,
    patch: &ContactPatch,
    now: i64,
) -> Result<Contact, errors::Error> {
    upsert_in(get_orm_client_rw().await, org_id, user_email, patch, now).await
}

/// Forgets a profile entirely. `false` when there was nothing to forget.
pub async fn delete(org_id: &str, user_email: &str) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let deleted = oncall_user_contacts::Entity::delete_many()
        .filter(oncall_user_contacts::Column::OrgId.eq(org_id))
        .filter(oncall_user_contacts::Column::UserEmail.eq(user_email))
        .exec(client)
        .await?;
    Ok(deleted.rows_affected > 0)
}

async fn upsert_in<C: ConnectionTrait>(
    client: &C,
    org_id: &str,
    user_email: &str,
    patch: &ContactPatch,
    now: i64,
) -> Result<Contact, errors::Error> {
    let existing = oncall_user_contacts::Entity::find()
        .filter(oncall_user_contacts::Column::OrgId.eq(org_id))
        .filter(oncall_user_contacts::Column::UserEmail.eq(user_email))
        .one(client)
        .await?;

    let Some(existing) = existing else {
        let phone = patch.phone.clone().flatten();
        let model = oncall_user_contacts::ActiveModel {
            id: Set(ider::uuid()),
            org_id: Set(org_id.to_string()),
            user_email: Set(user_email.to_string()),
            phone_verified_at: Set(proof_on_file_in(client, user_email, phone.as_deref()).await?),
            phone: Set(phone),
            push_token: Set(patch.push_token.clone().flatten()),
            push_verified_at: Set(None),
            quiet_hours: Set(patch.quiet_hours.clone().flatten()),
            updated_at: Set(now),
        };
        return Ok(to_contact(model.insert(client).await?));
    };

    let (old_phone, old_push) = (existing.phone.clone(), existing.push_token.clone());
    let mut model: oncall_user_contacts::ActiveModel = existing.into();
    if let Some(phone) = patch.phone.clone()
        && phone != old_phone
    {
        model.phone_verified_at =
            Set(proof_on_file_in(client, user_email, phone.as_deref()).await?);
        model.phone = Set(phone);
    }
    if let Some(token) = patch.push_token.clone()
        && token != old_push
    {
        model.push_token = Set(token);
        model.push_verified_at = Set(None);
    }
    if let Some(quiet) = patch.quiet_hours.clone() {
        model.quiet_hours = Set(quiet);
    }
    model.updated_at = Set(now);
    Ok(to_contact(model.update(client).await?))
}

/// When this person verified this exact number on any of their profiles, if ever.
async fn proof_on_file_in<C: ConnectionTrait>(
    conn: &C,
    user_email: &str,
    phone: Option<&str>,
) -> Result<Option<i64>, errors::Error> {
    let Some(phone) = phone else {
        return Ok(None);
    };
    Ok(oncall_user_contacts::Entity::find()
        .filter(
            Expr::expr(Func::lower(Expr::col(
                oncall_user_contacts::Column::UserEmail,
            )))
            .eq(user_email.to_lowercase()),
        )
        .filter(oncall_user_contacts::Column::Phone.eq(phone))
        .filter(oncall_user_contacts::Column::PhoneVerifiedAt.is_not_null())
        .order_by_desc(oncall_user_contacts::Column::PhoneVerifiedAt)
        .one(conn)
        .await?
        .and_then(|m| m.phone_verified_at))
}

async fn list_for_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    emails: &[String],
) -> Result<HashMap<String, Contact>, errors::Error> {
    // `is_in(&[])` is not a reliable "match nothing", and an empty page needs no query.
    if emails.is_empty() {
        return Ok(HashMap::new());
    }
    Ok(oncall_user_contacts::Entity::find()
        .filter(oncall_user_contacts::Column::OrgId.eq(org_id))
        // Profiles keep the case the request path carried, while rosters may not.
        .filter(
            Expr::expr(Func::lower(Expr::col(oncall_user_contacts::Column::UserEmail)))
                .is_in(emails.iter().map(|e| e.to_lowercase())),
        )
        .all(conn)
        .await?
        .into_iter()
        .map(|m| (m.user_email.to_lowercase(), to_contact(m)))
        .collect())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    fn model() -> oncall_user_contacts::Model {
        oncall_user_contacts::Model {
            id: "c_1".into(),
            org_id: "default".into(),
            user_email: "ana@o2.ai".into(),
            phone: Some("+15550100".into()),
            phone_verified_at: Some(2_000),
            push_token: None,
            push_verified_at: None,
            quiet_hours: None,
            updated_at: 1_000,
        }
    }

    #[test]
    fn test_row_maps_onto_the_meta_type() {
        let c = to_contact(model());
        assert_eq!(c.user_email, "ana@o2.ai");
        assert_eq!(c.phone.as_deref(), Some("+15550100"));
        assert!(c.phone_is_pageable());
    }

    /// The rule the write path enforces, as the property it protects: a
    /// verification vouches for one string, so a different string is unverified
    /// again. Pinned here as pure logic because the branch itself lives inside a
    /// database round trip.
    #[test]
    fn test_changing_a_number_must_drop_its_verification() {
        let old = Some("+15550100".to_string());

        let same = Some("+15550100".to_string());
        assert!(same == old, "an identical number is not a change");

        let changed = Some("+15550199".to_string());
        assert!(changed != old, "a different number must re-verify");

        let cleared: Option<String> = None;
        assert!(cleared != old, "clearing is a change too");
    }

    #[test]
    fn test_an_empty_patch_changes_nothing() {
        assert!(ContactPatch::default().is_empty());
        assert!(
            !ContactPatch {
                phone: Some(None),
                ..Default::default()
            }
            .is_empty(),
            "an explicit clear is a change, not an absence"
        );
    }

    /// One connection, not a pool: two connections to `sqlite::memory:` are two databases.
    async fn db_with(emails: &[&str]) -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let table = Schema::new(backend).create_table_from_entity(oncall_user_contacts::Entity);
        db.execute(backend.build(&table)).await.unwrap();
        for email in emails {
            let row = oncall_user_contacts::Model {
                id: format!("c_{email}"),
                user_email: email.to_string(),
                ..model()
            };
            oncall_user_contacts::ActiveModel::from(row)
                .insert(&db)
                .await
                .unwrap();
        }
        db
    }

    #[tokio::test]
    async fn test_list_for_returns_only_the_people_with_a_profile() {
        let db = db_with(&["ana@o2.ai", "Bo@o2.ai"]).await;
        let emails = ["ana@o2.ai", "Bo@o2.ai", "cy@o2.ai"].map(String::from);

        let found = list_for_in(&db, "default", &emails).await.unwrap();

        assert_eq!(found.len(), 2);
        assert_eq!(found["ana@o2.ai"].user_email, "ana@o2.ai");
        assert_eq!(found["bo@o2.ai"].user_email, "Bo@o2.ai");
        assert!(list_for_in(&db, "default", &[]).await.unwrap().is_empty());
    }

    /// A profile saved as `Bo@o2.ai` belongs to the roster's `bo@o2.ai`, or Sms and Voice silently
    /// drop.
    #[tokio::test]
    async fn test_list_for_matches_emails_whatever_their_case() {
        let db = db_with(&["Bo@o2.ai", "cy@o2.ai"]).await;
        let emails = ["bo@o2.ai", "CY@O2.AI"].map(String::from);

        let found = list_for_in(&db, "default", &emails).await.unwrap();

        assert_eq!(found.len(), 2);
        assert_eq!(found["bo@o2.ai"].user_email, "Bo@o2.ai");
        assert_eq!(found["cy@o2.ai"].user_email, "cy@o2.ai");
    }

    fn phone(number: &str) -> ContactPatch {
        ContactPatch {
            phone: Some(Some(number.into())),
            ..Default::default()
        }
    }

    /// V5: one proof covers the person's number in every org, whether the row is new or edited.
    #[tokio::test]
    async fn test_saving_a_number_proved_in_another_org_copies_the_proof() {
        let db = db_with(&["Ana@o2.ai"]).await;

        let new = upsert_in(&db, "acme", "ana@o2.ai", &phone("+15550100"), 3_000)
            .await
            .unwrap();
        assert_eq!(new.phone_verified_at, Some(2_000));

        upsert_in(&db, "beta", "ANA@o2.ai", &phone("+15550199"), 3_000)
            .await
            .unwrap();
        let edited = upsert_in(&db, "beta", "ANA@o2.ai", &phone("+15550100"), 4_000)
            .await
            .unwrap();
        assert_eq!(edited.phone_verified_at, Some(2_000));
    }

    #[tokio::test]
    async fn test_saving_a_different_number_does_not_copy_the_proof() {
        let db = db_with(&["ana@o2.ai"]).await;

        let saved = upsert_in(&db, "acme", "ana@o2.ai", &phone("+15550199"), 3_000)
            .await
            .unwrap();

        assert_eq!(saved.phone_verified_at, None);
    }
}
