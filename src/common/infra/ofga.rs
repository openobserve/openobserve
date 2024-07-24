// Copyright 2024 Zinc Labs Inc.
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
use {
    crate::common::{infra::config::USERS, meta::organization::DEFAULT_ORG, meta::user::UserRole},
    crate::service::db,
    hashbrown::HashSet,
    infra::dist_lock,
    o2_enterprise::enterprise::openfga::{
        authorizer::authz::{
            get_index_creation_tuples, get_org_creation_tuples, get_user_role_tuple, update_tuples,
        },
        meta::mapping::{NON_OWNING_ORG, OFGA_MODELS},
    },
};

#[cfg(feature = "enterprise")]
pub async fn init() {
    use o2_enterprise::enterprise::openfga::authorizer::authz::get_tuple_for_new_index;

    let mut migrate_native_objects = false;
    let mut need_migrate_index_streams = false;
    let existing_meta = match db::ofga::get_ofga_model().await {
        Ok(Some(model)) => Some(model),
        Ok(None) | Err(_) => {
            migrate_native_objects = true;
            None
        }
    };

    let meta = o2_enterprise::enterprise::openfga::model::read_ofga_model().await;
    if let Some(existing_model) = &existing_meta {
        if meta.version == existing_model.version {
            log::info!("OFGA model already exists & no changes required");
            return;
        }
        // Check if ofga migration of index streams are needed
        let meta_version = version_compare::Version::from(&meta.version).unwrap();
        let existing_model_version =
            version_compare::Version::from(&existing_model.version).unwrap();
        let v0_0_4 = version_compare::Version::from("0.0.4").unwrap();
        let v0_0_5 = version_compare::Version::from("0.0.5").unwrap();
        if meta_version > v0_0_4 && existing_model_version < v0_0_5 {
            need_migrate_index_streams = true;
        }
    }

    // 1. create a cluster lock
    let locker = dist_lock::lock("/ofga/model/", 0, None)
        .await
        .expect("Failed to acquire lock for openFGA");
    match db::ofga::set_ofga_model(existing_meta).await {
        Ok(store_id) => {
            if store_id.is_empty() {
                log::error!("OFGA store id is empty");
            }
            o2_enterprise::enterprise::common::infra::config::OFGA_STORE_ID
                .insert("store_id".to_owned(), store_id);

            let mut tuples = vec![];
            let r = infra::schema::STREAM_SCHEMAS.read().await;
            let mut orgs = HashSet::new();
            for key in r.keys() {
                if !key.contains('/') {
                    continue;
                }
                let key_splitted = key.split('/').collect::<Vec<&str>>();
                let org_name = key_splitted[0];
                orgs.insert(org_name);
                if need_migrate_index_streams
                    && key_splitted.len() > 2
                    && key_splitted[1] == "index"
                    && !migrate_native_objects
                {
                    get_tuple_for_new_index(org_name, key_splitted[2], &mut tuples);
                }
            }
            if migrate_native_objects {
                for org_name in orgs {
                    get_org_creation_tuples(
                        org_name,
                        &mut tuples,
                        OFGA_MODELS
                            .iter()
                            .map(|(_, fga_entity)| fga_entity.key)
                            .collect(),
                        NON_OWNING_ORG.to_vec(),
                    )
                    .await;
                }
                // No Data Ingested hence STREAM_SCHEMAS is empty , so we need to create at
                // least default org
                if tuples.is_empty() {
                    get_org_creation_tuples(
                        DEFAULT_ORG,
                        &mut tuples,
                        OFGA_MODELS
                            .iter()
                            .map(|(_, fga_entity)| fga_entity.key)
                            .collect(),
                        NON_OWNING_ORG.to_vec(),
                    )
                    .await;
                }

                for user_key_val in USERS.iter() {
                    let user = user_key_val.value();
                    if user.is_external {
                        continue;
                    } else {
                        let role = if user.role.eq(&UserRole::Root) {
                            UserRole::Admin.to_string()
                        } else {
                            user.role.to_string()
                        };

                        get_user_role_tuple(&role, &user.email, &user.org, &mut tuples);
                    }
                }
            } else {
                for org_name in orgs {
                    get_index_creation_tuples(org_name, &mut tuples).await;
                }
            }

            if tuples.is_empty() {
                log::info!("No orgs to update to the openfga");
            } else {
                log::debug!("tuples not empty: {:#?}", tuples);
                match update_tuples(tuples, vec![]).await {
                    Ok(_) => {
                        log::info!("Data migrated to openfga");
                    }
                    Err(e) => {
                        log::error!(
                            "Error updating orgs & users to the openfga during migration: {}",
                            e
                        );
                    }
                }
            }
            drop(r);
        }
        Err(e) => {
            log::error!("Error setting OFGA model: {:?}", e);
        }
    }
    // release lock
    dist_lock::unlock(&locker)
        .await
        .expect("Failed to release lock");
}
