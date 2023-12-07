use crate::common::infra::db as infra_db;

pub async fn run() -> Result<(), anyhow::Error> {
    // load dashboards list
    let db = infra_db::get_db().await;
    let db_key = "/dashboard/".to_string();
    let data = db.list(&db_key).await?;
    for (key, val) in data {
        let local_key = key.strip_prefix('/').unwrap_or(&key);
        let len = local_key.split('/').collect::<Vec<&str>>().len();
        if len > 3 {
            // println!(
            // "Skip dashboard migration as it is already part of folder: {}",
            // key
            // );
            continue;
        }
        let new_key = key.replace("/dashboard/", "/dashboard/default/");
        match db.put(&new_key, val, infra_db::NO_NEED_WATCH).await {
            Ok(_) => {
                let _ = db.delete(&key, false, infra_db::NO_NEED_WATCH).await;
                println!("Migrated dashboard: {} successfully", key);
            }
            Err(_) => {
                println!("Failed to migrate dashboard: {}", new_key);
            }
        }
    }

    Ok(())
}
