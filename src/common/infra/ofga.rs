use hashbrown::HashSet;
use infra::db::etcd;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::openfga::authorizer::authz::{
    get_org_creation_tuples, get_user_role_tuple, update_tuples,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::openfga::meta::mapping::{NON_OWNING_ORG, OFGA_MODELS};

#[cfg(feature = "enterprise")]
use crate::common::infra::config::{STREAM_SCHEMAS, USERS};
#[cfg(feature = "enterprise")]
use crate::common::meta::user::UserRole;
use crate::{common::meta::organization::DEFAULT_ORG, service::db};

pub async fn init() {
    let mut migrate_native_objects = false;
    let existing_meta = match db::get_ofga_model().await {
        Ok(Some(model)) => Some(model),
        Ok(None) | Err(_) => {
            migrate_native_objects = true;
            None
        }
    };
    // 1. create a cluster lock for node register
    let mut locker = etcd::Locker::new("/ofga/model/lock");
    locker.lock(0).await.expect("Failed to acquire lock");
    match db::set_ofga_model(existing_meta).await {
        Ok(store_id) => {
            if store_id.is_empty() {
                log::error!("OFGA store id is empty");
            }
            o2_enterprise::enterprise::common::infra::config::OFGA_STORE_ID
                .insert("store_id".to_owned(), store_id);

            if migrate_native_objects {
                let mut tuples = vec![];
                let r = STREAM_SCHEMAS.read().await;
                let mut orgs = HashSet::new();
                for key in r.keys() {
                    if !key.contains('/') {
                        continue;
                    }
                    let org_name = key.split('/').collect::<Vec<&str>>()[0];
                    orgs.insert(org_name);
                }

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

                if tuples.is_empty() {
                    log::info!("No orgs to update to the openfga");
                } else {
                    match update_tuples(tuples, vec![]).await {
                        Ok(_) => {
                            log::info!("Orgs updated to the openfga");
                        }
                        Err(e) => {
                            log::error!("Error updating orgs to the openfga: {}", e);
                        }
                    }
                }
                drop(r);
            }
        }
        Err(e) => {
            log::error!("Error setting OFGA model: {:?}", e);
        }
    }
    // release lock
    locker.unlock().await.expect("Failed to release lock");
}
