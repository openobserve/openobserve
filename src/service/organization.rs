// Copyright 2023 Zinc Labs Inc.
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
use crate::common::meta::organization::{
    IngestionPasscode, IngestionTokensContainer, OrgSummary, RumIngestionToken,
};
use crate::common::meta::user::UserOrg;
use crate::common::utils::auth::is_root_user;
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
pub async fn get_rum_token(org_id: Option<&str>, user_id: &str) -> RumIngestionToken {
    let user = db::user::get(org_id, user_id).await.unwrap().unwrap();
    RumIngestionToken {
        user: user.email,
        rum_token: user.rum_token,
    }
}

#[tracing::instrument]
pub async fn update_rum_token(org_id: Option<&str>, user_id: &str) -> RumIngestionToken {
    let is_rum_update = true;
    match update_passcode_inner(org_id, user_id, is_rum_update).await {
        IngestionTokensContainer::RumToken(response) => response,
        _ => panic!("This shouldn't have happened, we were expecting rum token updates"),
    }
}

#[tracing::instrument]
pub async fn update_passcode(org_id: Option<&str>, user_id: &str) -> IngestionPasscode {
    let is_rum_update = false;
    match update_passcode_inner(org_id, user_id, is_rum_update).await {
        IngestionTokensContainer::Passcode(response) => response,
        _ => panic!("This shouldn't have happened, we were expecting ingestion token updates"),
    }
}

#[tracing::instrument]
async fn update_passcode_inner(
    org_id: Option<&str>,
    user_id: &str,
    is_rum_update: bool,
) -> IngestionTokensContainer {
    let mut local_org_id = "dummy";
    let mut db_user = db::user::get_db_user(user_id).await.unwrap();

    if org_id.is_some() {
        local_org_id = org_id.unwrap();
    }
    let token = Alphanumeric.sample_string(&mut rand::thread_rng(), 16);
    let rum_token = format!(
        "rum{}",
        Alphanumeric.sample_string(&mut rand::thread_rng(), 16)
    );

    let updated_org = |existing_org: &UserOrg| {
        if is_rum_update {
            UserOrg {
                rum_token: Some(rum_token.clone()),
                ..existing_org.clone()
            }
        } else {
            UserOrg {
                token: token.clone(),
                ..existing_org.clone()
            }
        }
    };

    let mut orgs = db_user.clone().organizations;
    let new_orgs = if !is_root_user(user_id) {
        let mut existing_org = orgs.clone();

        // Find the org which we need to update
        existing_org.retain(|org| org.name.eq(&local_org_id));

        // Filter out the org which needs to be updated, so that we can modify and insert it back.
        orgs.retain(|org| !org.name.eq(&local_org_id));

        let updated_org = updated_org(&existing_org[0]);
        orgs.push(updated_org);
        orgs
    } else {
        // This is a root-user, so pick up the first/default org.
        let existing_org = orgs.first().unwrap().clone();
        let updated_org = updated_org(&existing_org);
        vec![updated_org]
    };
    db_user.organizations = new_orgs;
    let _ = db::user::set(db_user.clone()).await;

    if is_rum_update {
        IngestionTokensContainer::RumToken(RumIngestionToken {
            user: db_user.email,
            rum_token: Some(rum_token),
        })
    } else {
        IngestionTokensContainer::Passcode(IngestionPasscode {
            user: db_user.email,
            passcode: token,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        common::{infra::db as infra_db, meta::user::UserRequest},
        service::users,
    };

    #[actix_web::test]
    async fn test_organization() {
        infra_db::create_table().await.unwrap();
        let org_id = "dummy";
        let user_id = "userone@example.com";
        //let passcode = "samplePassCode";
        let resp = users::post_user(
            org_id,
            UserRequest {
                email: user_id.to_string(),
                password: "pass".to_string(),
                role: crate::common::meta::user::UserRole::Admin,
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
