use crate::infra::config;

pub async fn get() -> Result<String, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let ret = db.get("/meta/kv/version").await?;
    let version = std::str::from_utf8(&ret).unwrap();
    Ok(version.to_string())
}

pub async fn set() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    db.put("/meta/kv/version", bytes::Bytes::from(config::VERSION))
        .await?;
    Ok(())
}
