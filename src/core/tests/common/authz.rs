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

use std::{collections::HashSet, env};

use common::infra::config::{ORG_USERS, USERS};
use config::meta::user::{UserRole, UserType};
use infra::table::{org_users::OrgUserRecord, users::UserRecord};
use o2_dex::meta::auth::O2EntityAuthorization;
use o2_openfga::{
    authorizer::{
        authz::{get_add_user_to_org_tuples, init_open_fga, update_tuples},
        roles,
    },
    config::{OFGA_STORE_ID, refresh_config},
    model::{create_open_fga_store, read_ofga_model, write_auth_models},
};

pub async fn connect(url: &str, seeded_store: Option<&str>) -> String {
    // SAFETY: called in the serial test before any OpenFGA work starts.
    unsafe {
        env::set_var("O2_OPENFGA_ENABLED", "true");
        env::set_var("O2_OPENFGA_BASE_URL", url);
        if seeded_store.is_none() {
            env::set_var(
                "O2_OPENFGA_STORE_NAME",
                format!("authz-it-{}", config::ider::uuid()),
            );
        }
    }
    refresh_config().expect("refresh OpenFGA configuration");
    init_open_fga().await;
    let store_id = match seeded_store {
        Some(id) => id.to_owned(),
        None => {
            let id = create_open_fga_store()
                .await
                .expect("create fresh OpenFGA store");
            write_auth_models(&read_ofga_model().await, &id)
                .await
                .expect("write OpenFGA authorization model");
            id
        }
    };
    OFGA_STORE_ID.insert("store_id".to_string(), store_id.clone());
    store_id
}

pub fn declare_deadline(ms: &str) {
    // SAFETY: called between cells while no authorization or proxy request is running.
    unsafe { env::set_var("O2_OPENFGA_LIST_SERVER_DEADLINE_MS", ms) };
    refresh_config().expect("refresh OpenFGA configuration");
}

pub async fn add_member(org: &str, id: &str, email: &str, role: UserRole) {
    let mut tuples = Vec::new();
    get_add_user_to_org_tuples(org, email, &role.to_string(), &mut tuples);
    update_tuples(tuples, vec![])
        .await
        .expect("write org membership");
    cache_member(org, id, user_record(email), role);
}

pub fn user_record(email: &str) -> UserRecord {
    UserRecord {
        email: email.to_string(),
        first_name: String::new(),
        last_name: String::new(),
        password: String::new(),
        salt: String::new(),
        is_root: false,
        password_ext: None,
        user_type: UserType::Internal,
        created_at: 0,
        updated_at: 0,
        must_reset_password: false,
        password_reset_reason: None,
        flagged_at: None,
        password_updated_at: None,
    }
}

pub fn cache_member(org: &str, id: &str, record: UserRecord, role: UserRole) {
    let id = id.to_lowercase();
    let email = record.email.clone();
    USERS.insert(id.clone(), record);
    ORG_USERS.insert(
        format!("{org}/{id}"),
        OrgUserRecord {
            email,
            org_id: org.to_string(),
            role,
            token: String::new(),
            rum_token: None,
            created_at: 0,
            allow_static_token: false,
        },
    );
}

pub async fn seed_role(
    org: &str,
    role: &str,
    grants: &[O2EntityAuthorization],
    members: HashSet<String>,
) {
    roles::create_role(role, org)
        .await
        .expect("create custom role");
    if !members.is_empty() {
        roles::update_role(org, role, vec![], vec![], Some(members), None)
            .await
            .expect("assign custom role");
    }
    for chunk in grants.chunks(50) {
        roles::update_role(org, role, chunk.to_vec(), vec![], None, None)
            .await
            .expect("write role grants");
    }
}
