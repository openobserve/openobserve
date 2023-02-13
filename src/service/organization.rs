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
use tracing::info_span;

use super::stream::get_streams;
use super::users;
use crate::meta::organization::{IngestionPasscode, OrgSummary};
use crate::service::db;

pub async fn get_summary(org_id: &str) -> OrgSummary {
    let loc_span = info_span!("service:organization:get_summary");
    let _guard = loc_span.enter();
    let streams = get_streams(org_id, None, false).await;
    let functions = db::udf::list(org_id, None).await.unwrap();
    let alerts = db::alerts::list(org_id, None).await.unwrap();
    OrgSummary {
        streams,
        functions,
        alerts,
    }
}

pub async fn get_passcode(org_id: Option<&str>, user_id: &str) -> IngestionPasscode {
    let loc_span = info_span!("service:organization:get_user_passcode");
    let _guard = loc_span.enter();
    let user = db::user::get(org_id, user_id).await.unwrap().unwrap();

    IngestionPasscode {
        user: user.name,
        passcode: user.ingestion_token,
    }
}

pub async fn update_passcode(org_id: Option<&str>, user_id: &str) -> IngestionPasscode {
    let loc_span = info_span!("service:organization:update_passcode");
    let _guard = loc_span.enter();
    let mut loca_org_id = "dummy";
    let mut user = users::get_user(org_id, user_id).await.unwrap();
    user.ingestion_token = Alphanumeric.sample_string(&mut rand::thread_rng(), 16);
    if org_id.is_some() {
        loca_org_id = org_id.unwrap();
    }
    let _ = db::user::set(loca_org_id, user.clone()).await;
    IngestionPasscode {
        user: user.name,
        passcode: user.ingestion_token,
    }
}
