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

use crate::meta::organization::OrgSummary;
use crate::service::db;
use tracing::info_span;

use super::stream::get_streams;

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
