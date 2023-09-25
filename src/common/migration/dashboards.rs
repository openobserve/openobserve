use crate::common::infra::db as infra_db;

pub async fn run() -> Result<(), anyhow::Error> {
    // load dashboards list
    let db_key = format!("/dashboard/");
    let data = infra_db::DEFAULT.list(&db_key).await?;
    for (key, val) in data {
        let new_key = key.replace("/dashboard/", "/dashboard/default/");
        match infra_db::DEFAULT
            .put(&new_key, val, infra_db::NO_NEED_WATCH)
            .await
        {
            Ok(_) => {
                let _ = infra_db::DEFAULT
                    .delete(&key, false, infra_db::NO_NEED_WATCH)
                    .await;
                println!("Migrated dashboard: {} successfully", key);
            }
            Err(_) => {
                println!("Failed to migrate dashboard: {}", new_key);
            }
        }
    }

    Ok(())
}
