use infra::db::{ORM_CLIENT, connect_to_orm};

pub(super) mod alert_folders;
pub(super) mod report_folders;

pub async fn migrate_alert_folders() -> Result<(), anyhow::Error> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    alert_folders::migrate_alert_folders(db).await
}

pub async fn migrate_report_folders() -> Result<(), anyhow::Error> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    report_folders::migrate_report_folders(db).await
}
