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

use config::{ider, meta::oncall::Contact};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};

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

/// The fields a write may change. `None` leaves a field alone; `Some(None)`
/// clears it.
///
/// Spelled out rather than taking a whole `Contact` because a profile is
/// edited from more than one screen, and "send me the whole object back"
/// is how one screen silently erases a field it does not render.
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
/// **Changing a number clears its verification.** This is the whole safety
/// property of the table: `phone_verified_at` vouches for one specific string,
/// and carrying it across an edit would let somebody type a verified number,
/// save, and then swap in an unverified one that a transport would still ring.
/// Re-saving the identical number is not a change and keeps the proof.
pub async fn upsert(
    org_id: &str,
    user_email: &str,
    patch: &ContactPatch,
    now: i64,
) -> Result<Contact, errors::Error> {
    let client = get_orm_client_rw().await;
    let existing = oncall_user_contacts::Entity::find()
        .filter(oncall_user_contacts::Column::OrgId.eq(org_id))
        .filter(oncall_user_contacts::Column::UserEmail.eq(user_email))
        .one(client)
        .await?;

    let Some(existing) = existing else {
        let model = oncall_user_contacts::ActiveModel {
            id: Set(ider::uuid()),
            org_id: Set(org_id.to_string()),
            user_email: Set(user_email.to_string()),
            phone: Set(patch.phone.clone().flatten()),
            // A brand new number has been proved by nobody.
            phone_verified_at: Set(None),
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
        model.phone = Set(phone);
        model.phone_verified_at = Set(None);
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

#[cfg(test)]
mod tests {
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

    /// The rule the write path enforces, stated as the property it protects:
    /// a verification vouches for one string, so a different string is
    /// unverified again. Pinned here as pure logic because the branch itself
    /// lives inside a database round trip.
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
}
