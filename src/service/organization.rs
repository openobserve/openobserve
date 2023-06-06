// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use rand::distributions::{Alphanumeric, DistString};

use super::stream::get_streams;
use crate::common::auth::is_root_user;
use crate::meta::organization::{IngestionPasscode, OrgSummary};
use crate::meta::user::UserOrg;
use crate::service::db;

#[tracing::instrument]
pub async fn get_summary(org_id: &str) -> OrgSummary {
    let streams = get_streams(org_id, None, false).await;
    let functions = db::functions::list(org_id).await.unwrap();
    let alerts = db::alerts::list(org_id, None, None).await.unwrap();
    OrgSummary {
        streams,
        functions,
        alerts,
    }
}

#[tracing::instrument]
pub async fn get_passcode(org_id: Option<&str>, user_id: &str) -> IngestionPasscode {
    let user = db::user::get(org_id, user_id).await.unwrap().unwrap();
    IngestionPasscode {
        user: user.email,
        passcode: user.token,
    }
}

#[tracing::instrument]
pub async fn update_passcode(org_id: Option<&str>, user_id: &str) -> IngestionPasscode {
    let mut local_org_id = "dummy";
    let mut db_user = db::user::get_db_user(user_id).await.unwrap();

    if org_id.is_some() {
        local_org_id = org_id.unwrap();
    }
    let token = Alphanumeric.sample_string(&mut rand::thread_rng(), 16);
    let mut orgs = db_user.clone().organizations;
    let new_orgs = if !is_root_user(user_id) {
        let mut existing_org = orgs.clone();

        existing_org.retain(|org| org.name.eq(&local_org_id));
        orgs.retain(|org| !org.name.eq(&local_org_id));

        orgs.push(UserOrg {
            name: local_org_id.to_string(),
            token: token.clone(),
            role: existing_org.first().unwrap().role.clone(),
        });
        orgs
    } else {
        let mut existing_org = orgs.first().unwrap().clone();
        existing_org.token = token.clone();
        vec![existing_org]
    };
    db_user.organizations = new_orgs;
    let _ = db::user::set(db_user.clone()).await;
    IngestionPasscode {
        user: db_user.email,
        passcode: token,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{meta::user::UserRequest, service::users};

    #[actix_web::test]
    async fn test_organization() {
        let org_id = "dummy";
        let user_id = "userone@example.com";
        //let passcode = "samplePassCode";
        let resp = users::post_user(
            org_id,
            UserRequest {
                email: user_id.to_string(),
                password: "pass".to_string(),
                role: crate::meta::user::UserRole::Admin,
                first_name: "admin".to_owned(),
                last_name: "".to_owned(),
            },
        )
        .await;
        assert!(resp.is_ok());

        let resp = get_passcode(Some(org_id), user_id).await;
        let passcode = resp.passcode.clone();
        assert!(!resp.passcode.is_empty());

        let resp = update_passcode(Some(org_id), user_id).await;
        assert_ne!(resp.passcode, passcode);
    }
}
