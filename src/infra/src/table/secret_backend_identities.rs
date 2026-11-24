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

use config::meta::secret_store::SecretErrorCode;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set, sea_query::OnConflict,
};

pub use super::entity::secret_backend_identities::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

pub async fn get_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    provider: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Provider.eq(provider))
        .one(conn)
        .await?)
}

pub async fn upsert_manual_in<C: ConnectionTrait>(
    conn: &C,
    mut row: ActiveModel,
) -> Result<(), Error> {
    row.source = Set("manual".to_owned());
    let written = Entity::insert(row)
        .on_conflict(
            OnConflict::columns([Column::OrgId, Column::Provider])
                .update_columns([
                    Column::Principal,
                    Column::State,
                    Column::Incarnation,
                    Column::NextPrincipal,
                    Column::NextIncarnation,
                    Column::IdAccount,
                    Column::PolicyHash,
                    Column::DesiredGen,
                    Column::AppliedGen,
                    Column::RotateRequested,
                    Column::DeleteAfter,
                    Column::LeaseOwner,
                    Column::LeaseUntil,
                    Column::LastVerifiedAt,
                    Column::LastError,
                    Column::UpdatedAt,
                ])
                .action_and_where(Column::Source.eq("manual"))
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    if written == 0 {
        return Err(Error::SecretStore(
            SecretErrorCode::IdentityProvisionedInCloud,
        ));
    }
    Ok(())
}

pub async fn list_in<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by_asc(Column::Provider)
        .all(conn)
        .await?)
}

pub async fn delete_manual_by_org_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, Error> {
    Ok(Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Source.eq("manual"))
        .exec(conn)
        .await?
        .rows_affected)
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_in(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_in<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

#[cfg(test)]
mod tests {
    use sea_orm::ActiveModelTrait;

    use super::*;
    use crate::table::testing::{meta_store, unique};

    fn row(org_id: &str, provider: &str, source: &str) -> ActiveModel {
        ActiveModel {
            org_id: Set(org_id.to_owned()),
            provider: Set(provider.to_owned()),
            principal: Set("principal".to_owned()),
            source: Set(source.to_owned()),
            state: Set("active".to_owned()),
            incarnation: Set(config::ider::ksuid()),
            policy_hash: Set("hash".to_owned()),
            desired_gen: Set(1),
            applied_gen: Set(1),
            rotate_requested: Set(false),
            created_by: Set("tester".to_owned()),
            created_at: Set(1),
            updated_at: Set(1),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn manual_upsert_and_deletion_preserve_provisioned_identities() {
        if !meta_store().await {
            return;
        }
        let conn = get_orm_client_rw().await;
        let org = unique("backend_identity");
        let provisioned = row(&org, "gcp_sm", "provisioned")
            .insert(conn)
            .await
            .unwrap();
        let result = upsert_manual_in(conn, row(&org, "gcp_sm", "manual")).await;
        assert!(matches!(
            result,
            Err(Error::SecretStore(
                SecretErrorCode::IdentityProvisionedInCloud
            ))
        ));
        upsert_manual_in(conn, row(&org, "aws_sm", "provisioned"))
            .await
            .unwrap();
        let mut updated = row(&org, "aws_sm", "manual");
        updated.principal = Set("replacement".to_owned());
        upsert_manual_in(conn, updated).await.unwrap();
        let manual = get_in(conn, &org, "aws_sm").await.unwrap().unwrap();
        assert_eq!(manual.source, "manual");
        assert_eq!(manual.principal, "replacement");
        assert_eq!(delete_manual_by_org_in(conn, &org).await.unwrap(), 1);
        assert_eq!(list_in(conn, &org).await.unwrap(), vec![provisioned]);
        assert_eq!(delete_by_org(&org).await.unwrap(), 1);
    }
}
