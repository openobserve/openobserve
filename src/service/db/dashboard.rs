use bytes::Bytes;

use crate::meta::dashboards::Dashboard;

pub async fn get(org_id: &str, name: &str) -> Result<Option<Dashboard>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{}/{}", org_id, name);
    let ret = db.get(&key).await?;
    let details = String::from_utf8(ret.to_vec()).unwrap();
    let value = Some(Dashboard {
        name: name.to_string(),
        details,
    });
    Ok(value)
}

pub async fn set(org_id: &str, name: &str, details: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{}/{}", org_id, name);
    db.put(&key, Bytes::from(details.to_string())).await?;
    Ok(())
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{}/{}", org_id, name);
    match db.delete(&key, false).await {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}

pub async fn list(org_id: &str) -> Result<Vec<Dashboard>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{}/", org_id);
    let ret = db.list(&key).await?;
    let mut udf_list: Vec<Dashboard> = Vec::new();
    for (item_key, item_value) in ret {
        let name = item_key.strip_prefix(&key).unwrap().to_string();
        let details = String::from_utf8(item_value.to_vec()).unwrap();
        udf_list.push(Dashboard { name, details })
    }
    Ok(udf_list)
}
