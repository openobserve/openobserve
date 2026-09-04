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

use config::utils::{hash::get_passcode_hash, rand::generate_random_string};
use sea_orm::{
    ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SYS_RCA_AGENT_EMAIL_PREFIX: &str = "o2-sre-agent.org-";
const SYS_RCA_AGENT_EMAIL_SUFFIX: &str = "@openobserve.internal";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let txn = db.begin().await?;

        let mut org_pages = organization::Entity::find()
            .order_by_asc(organization::Column::Identifier)
            .paginate(&txn, 100);

        while let Some(orgs) = org_pages.fetch_and_next().await? {
            let mut new_users = vec![];
            let mut new_org_users = vec![];

            for org in orgs {
                let org_id = org.identifier.clone();
                let email = format!(
                    "{}{}{}",
                    SYS_RCA_AGENT_EMAIL_PREFIX, org_id, SYS_RCA_AGENT_EMAIL_SUFFIX
                );

                // Idempotency check: skip if user already exists
                let existing = users::Entity::find()
                    .filter(users::Column::Email.eq(email.clone()))
                    .one(&txn)
                    .await?;
                if existing.is_some() {
                    log::debug!(
                        "sys-rca-agent service account already exists for org '{}', skipping",
                        org_id
                    );
                    continue;
                }

                let now = chrono::Utc::now().timestamp_micros();

                // Generate password
                let random_password = generate_random_string(32);
                let salt = generate_random_string(16);
                let password = get_passcode_hash(&random_password, &salt);

                new_users.push(users::ActiveModel {
                    id: Set(users::ksuid_from_hash(email.clone()).to_string()),
                    email: Set(email.clone()),
                    first_name: Set("SRE Agent".to_string()),
                    last_name: Set("(System)".to_string()),
                    password: Set(password),
                    salt: Set(salt),
                    is_root: Set(false),
                    password_ext: Set(None),
                    user_type: Set(0i16), // Internal
                    created_at: Set(now),
                    updated_at: Set(now),
                });

                // Generate tokens
                let token = generate_random_string(32);
                let rum_token_suffix = generate_random_string(16);
                let rum_token = format!("rum{}", rum_token_suffix);

                new_org_users.push(org_users::ActiveModel {
                    id: Set(org_users::ksuid_from_hash(org_id.clone(), email.clone()).to_string()),
                    org_id: Set(org_id),
                    email: Set(email),
                    role: Set(6i16), // SreAgent
                    token: Set(token),
                    rum_token: Set(Some(rum_token)),
                    allow_static_token: Set(true),
                    created_at: Set(now),
                    updated_at: Set(now),
                });
            }

            if !new_users.is_empty() {
                users::Entity::insert_many(new_users).exec(&txn).await?;
                org_users::Entity::insert_many(new_org_users)
                    .exec(&txn)
                    .await?;
            }
        }

        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // Delete org_users first (foreign key references users.email)
        org_users::Entity::delete_many()
            .filter(org_users::Column::Email.like(format!(
                "{}%{}",
                SYS_RCA_AGENT_EMAIL_PREFIX, SYS_RCA_AGENT_EMAIL_SUFFIX
            )))
            .exec(db)
            .await?;

        users::Entity::delete_many()
            .filter(users::Column::Email.like(format!(
                "{}%{}",
                SYS_RCA_AGENT_EMAIL_PREFIX, SYS_RCA_AGENT_EMAIL_SUFFIX
            )))
            .exec(db)
            .await?;

        Ok(())
    }
}

/// Representation of the organizations table at the time this migration executes.
mod organization {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "organizations")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub identifier: String,
        pub org_name: String,
        pub org_type: i16,
        pub created_at: i64,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the users table at the time this migration executes.
mod users {
    use sea_orm::entity::prelude::*;
    use svix_ksuid::KsuidLike;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "users")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        #[sea_orm(column_type = "String(StringLen::N(100))")]
        pub email: String,
        #[sea_orm(column_type = "String(StringLen::N(100))")]
        pub first_name: String,
        #[sea_orm(column_type = "String(StringLen::N(100))")]
        pub last_name: String,
        #[sea_orm(column_type = "Text")]
        pub password: String,
        pub salt: String,
        pub is_root: bool,
        pub password_ext: Option<String>,
        pub user_type: i16,
        pub created_at: i64,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter)]
    pub enum Relation {}

    impl RelationTrait for Relation {
        fn def(&self) -> RelationDef {
            panic!("No relations defined")
        }
    }

    impl ActiveModelBehavior for ActiveModel {}

    pub fn ksuid_from_hash(user_email: String) -> svix_ksuid::Ksuid {
        use sha1::{Digest, Sha1};
        let mut hasher = Sha1::new();
        hasher.update(user_email);
        let hash = hasher.finalize();
        svix_ksuid::Ksuid::from_bytes(hash.into())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_users_ksuid_from_hash_is_deterministic() {
        let email = "test@example.com".to_string();
        let k1 = super::users::ksuid_from_hash(email.clone());
        let k2 = super::users::ksuid_from_hash(email);
        assert_eq!(k1.to_string(), k2.to_string());
    }

    #[test]
    fn test_users_ksuid_from_hash_different_inputs_produce_different_ksuids() {
        let k1 = super::users::ksuid_from_hash("alice@example.com".to_string());
        let k2 = super::users::ksuid_from_hash("bob@example.com".to_string());
        assert_ne!(k1.to_string(), k2.to_string());
    }

    #[test]
    fn test_org_users_ksuid_from_hash_is_deterministic() {
        let org = "org-1".to_string();
        let email = "admin@example.com".to_string();
        let k1 = super::org_users::ksuid_from_hash(org.clone(), email.clone());
        let k2 = super::org_users::ksuid_from_hash(org, email);
        assert_eq!(k1.to_string(), k2.to_string());
    }

    #[test]
    fn test_org_users_ksuid_same_email_different_org_yields_different_ksuid() {
        let email = "shared@example.com".to_string();
        let k1 = super::org_users::ksuid_from_hash("org-a".to_string(), email.clone());
        let k2 = super::org_users::ksuid_from_hash("org-b".to_string(), email);
        assert_ne!(k1.to_string(), k2.to_string());
    }
}

/// Representation of the org_users table at the time this migration executes.
mod org_users {
    use sea_orm::entity::prelude::*;
    use svix_ksuid::KsuidLike;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "org_users")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        #[sea_orm(column_type = "String(StringLen::N(256))")]
        pub org_id: String,
        #[sea_orm(column_type = "String(StringLen::N(100))")]
        pub email: String,
        pub role: i16,
        pub token: String,
        pub rum_token: Option<String>,
        pub allow_static_token: bool,
        pub created_at: i64,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}

    pub fn ksuid_from_hash(org_id: String, user_email: String) -> svix_ksuid::Ksuid {
        use sha1::{Digest, Sha1};
        let mut hasher = Sha1::new();
        hasher.update(org_id);
        hasher.update(user_email);
        let hash = hasher.finalize();
        svix_ksuid::Ksuid::from_bytes(hash.into())
    }
}
