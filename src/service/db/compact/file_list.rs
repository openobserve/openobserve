pub async fn get_offset() -> Result<i64, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/compact/file_list/offset";
    let value = match db.get(key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from("0"),
    };
    let offset: i64 = value.parse().unwrap();
    Ok(offset)
}

pub async fn set_offset(offset: i64) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/compact/file_list/offset";
    db.put(key, offset.to_string().into()).await?;
    Ok(())
}
