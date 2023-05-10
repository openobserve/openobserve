use crate::{common::json, infra::db, meta::syslog::SyslogRoute};
use tracing::instrument;

#[instrument(err)]
pub async fn list() -> Result<Vec<SyslogRoute>, anyhow::Error> {
    Ok(db::DEFAULT
        .list("/syslog/route/")
        .await?
        .values()
        .map(|val| json::from_slice(val).unwrap())
        .collect())
}

#[instrument(err, skip(route))]
pub async fn set(route: &SyslogRoute) -> Result<(), anyhow::Error> {
    Ok(db::DEFAULT
        .put(
            &format!("/syslog/route/{}", route.id),
            json::to_vec(route).unwrap().into(),
        )
        .await?)
}

#[instrument(err)]
pub async fn get(id: &str) -> Result<SyslogRoute, anyhow::Error> {
    let val = db::DEFAULT.get(&format!("/syslog/route/{id}")).await?;
    Ok(json::from_slice(&val).unwrap())
}

#[instrument(err)]
pub async fn delete(id: &str) -> Result<(), anyhow::Error> {
    Ok(db::DEFAULT
        .delete(&format!("/syslog/route/{id}"), false)
        .await?)
}
