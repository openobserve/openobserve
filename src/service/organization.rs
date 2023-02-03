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
