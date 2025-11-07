use actix_web::{
    body::MessageBody,
    dev::{ServiceRequest, ServiceResponse},
    middleware,
};
#[cfg(feature = "cloud")]
use {
    crate::service::organization,
    actix_web::error::ErrorTooManyRequests,
    config::{cluster::LOCAL_NODE, get_config},
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

        // in middleware, we only want to block ingestion request
        // so for non ingester node, we can allow pass.
        if LOCAL_NODE.is_ingester()
            && config::router::INGESTER_ROUTES
                .iter()
                .any(|r| path.ends_with(r))
        {
            // for all ingester routes, the first part of path is org_id
            let org_id = path.split("/").next().unwrap();
            // the function can return error if there ware any db errors or such
            // in that case, we allow the request to proceed
            match organization::is_org_in_free_trial_period(org_id).await {
                Ok(ongoing) => {
                    // if the trial period is not ongoing, we will block the org here itself
                    if !ongoing {
                        log::info!("{org_id} blocked in middleware");
                        return Err(ErrorTooManyRequests(
                            "organization has expired its trial period",
                        ));
                    }
                }
                Err(e) => {
                    log::error!("error in middleware while checking for trial period : {e}");
                }
            }
        }
        let res = next.call(req).await?;
        Ok(res)
    }
}
