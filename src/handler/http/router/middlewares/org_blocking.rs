use actix_web::{
    body::MessageBody,
    dev::{ServiceRequest, ServiceResponse},
    middleware,
};
use config::get_config;
#[cfg(feature = "cloud")]
use {
    crate::service::ingestion::check_ingestion_allowed, actix_web::error::ErrorTooManyRequests,
    config::meta::stream::StreamType,
};

pub async fn blocked_orgs_middleware(
    req: ServiceRequest,
    next: middleware::Next<impl MessageBody>,
) -> Result<ServiceResponse<impl MessageBody>, actix_web::Error> {
    #[cfg(not(feature = "cloud"))]
    {
        let res = next.call(req).await?;
        Ok(res)
    }

    #[cfg(feature = "cloud")]
    {
        let prefix = format!("{}/api/", get_config().common.base_uri);
        let path = req
            .path()
            .strip_prefix(&prefix)
            .unwrap()
            .split("?")
            .next()
            .unwrap();

        if config::router::INGESTER_ROUTES
            .iter()
            .any(|r| path.ends_with(r))
        {
            // for all ingester routes, the first part of path is org_id
            let org_id = path.split("/").next().unwrap();
            // stream type doesn't matter here, as we are giving name as None
            match check_ingestion_allowed(&org_id, StreamType::Logs, None).await {
                Ok(_) => {
                    log::warn!("here {org_id} is valid");
                }
                Err(e) => {
                    log::warn!("here, {org_id} expired");
                    return Err(ErrorTooManyRequests(e.to_string()));
                }
            }
        }
        let res = next.call(req).await?;
        Ok(res)
    }
}
