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

#[cfg(feature = "enterprise")]
use sea_orm::{EntityTrait, PaginatorTrait, QueryOrder, TransactionTrait};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Step 1: Handle non-enterprise builds gracefully
        #[cfg(not(feature = "enterprise"))]
        {
            log::info!("Non-enterprise build, skipping SRE agent OFGA setup");
        }

        #[cfg(feature = "enterprise")]
        {
            self.run_enterprise_setup(_manager).await?;
        }

        Ok(())
    }
}

#[cfg(feature = "enterprise")]
impl Migration {
    async fn run_enterprise_setup(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Step 2: Initialize OFGA client within migration
        o2_openfga::authorizer::authz::init_open_fga().await;

        // Step 3: Check if OFGA is enabled
        if !o2_openfga::config::get_config().enabled {
            log::info!("OFGA disabled, skipping SRE agent OFGA setup");
            return Ok(());
        }

        // Step 4: Check if old KV flags exist (transition compatibility)
        if self.is_old_backfill_complete().await {
            log::info!("SRE agent OpenFGA backfill already completed via old job system");
            return Ok(());
        }

        if self.is_old_readonly_patch_complete().await {
            log::info!("SRE readonly eval templates already patched via old job system");
            return Ok(());
        }

        let db = manager.get_connection();
        let txn = db.begin().await?;

        // Step 5: Iterate through organizations with pagination
        let mut org_pages = organization::Entity::find()
            .order_by_asc(organization::Column::Identifier)
            .paginate(&txn, 100);

        let mut total_orgs = 0;
        let mut success_count = 0;
        let mut failure_count = 0;

        while let Some(orgs) = org_pages.fetch_and_next().await? {
            total_orgs += orgs.len();

            for org in orgs {
                match self.setup_sre_agent_for_org(&org.identifier).await {
                    Ok(_) => {
                        log::debug!("Successfully set up SRE agent for org '{}'", org.identifier);
                        success_count += 1;
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to set up SRE agent for org '{}': {e}",
                            org.identifier
                        );
                        failure_count += 1;
                        // Continue with other orgs - don't fail the entire migration
                    }
                }
            }
        }

        log::info!(
            "Comprehensive SRE agent OFGA setup completed: {} total orgs, {} successful, {} failed",
            total_orgs,
            success_count,
            failure_count
        );

        // Commit the transaction even if some OFGA operations failed
        // The migration itself succeeded in processing all organizations
        txn.commit().await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // This migration only configures OFGA roles and tuples, it doesn't create database records
        // Rolling back OFGA roles is complex and not implemented here
        // In practice, OFGA roles can be manually reset if needed
        log::info!("Comprehensive SRE agent OFGA setup rollback - no database changes to revert");
        Ok(())
    }
}

#[cfg(feature = "enterprise")]
impl Migration {
    /// Check if the old backfill job has already completed
    async fn is_old_backfill_complete(&self) -> bool {
        crate::service::kv::get("_migration", "sys_rca_agent_openfga_migration_v1")
            .await
            .is_ok()
    }

    /// Check if the old readonly patch job has already completed
    async fn is_old_readonly_patch_complete(&self) -> bool {
        crate::service::kv::get("_migration", "sre_readonly_eval_templates_v1")
            .await
            .is_ok()
    }

    /// Set up complete SRE agent configuration for a single organization
    async fn setup_sre_agent_for_org(
        &self,
        org_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Step 1: Ensure SRE agent service account exists in DB and OFGA
        // This function is idempotent and handles both DB and OFGA setup
        if let Err(e) = crate::service::organization::ensure_sys_rca_agent(org_id).await {
            return Err(format!("Failed to ensure SRE agent for org '{}': {}", org_id, e).into());
        }

        // Step 2: Patch SRE readonly role resources (eval templates access)
        if let Err(e) =
            o2_openfga::authorizer::roles::patch_sre_readonly_role_resources(org_id).await
        {
            return Err(format!(
                "Failed to patch SRE readonly resources for org '{}': {}",
                org_id, e
            )
            .into());
        }

        log::debug!(
            "Completed comprehensive SRE agent setup for org '{}'",
            org_id
        );

        Ok(())
    }
}

/// Representation of the organizations table at the time this migration executes.
mod organization {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "organizations")]
    #[allow(dead_code)]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub identifier: String,
        pub org_name: String,
        pub org_type: i16,
        pub created_at: i64,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    #[allow(dead_code)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
