use infra::db::get_orm_client_rw;

pub(super) mod alert_folders;
pub(super) mod anomaly_detection;
pub(super) mod report_folders;
pub(super) mod stream_name_migration;

pub async fn migrate_alert_folders() -> Result<(), anyhow::Error> {
    let db = get_orm_client_rw().await;
    alert_folders::migrate_alert_folders(db).await
}

pub async fn migrate_anomaly_detection() -> Result<(), anyhow::Error> {
    let db = get_orm_client_rw().await;
    anomaly_detection::migrate_anomaly_detection(db).await
}

pub async fn migrate_report_folders() -> Result<(), anyhow::Error> {
    let db = get_orm_client_rw().await;
    report_folders::migrate_report_folders(db).await
}

pub async fn migrate_stream_names() -> Result<(), anyhow::Error> {
    let db = get_orm_client_rw().await;
    stream_name_migration::migrate_stream_names(db).await
}
