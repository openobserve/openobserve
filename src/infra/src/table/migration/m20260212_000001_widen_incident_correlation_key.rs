use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const POSTGRES_ALTER_SQL: &str =
    "ALTER TABLE alert_incidents ALTER COLUMN correlation_key TYPE varchar(128)";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();
        match backend {
            sea_orm::DbBackend::Postgres => {
                let db = manager.get_connection();
                db.execute(sea_orm::Statement::from_string(
                    backend,
                    POSTGRES_ALTER_SQL.to_string(),
                ))
                .await?;
            }
            _ => {
                // SQLite does not enforce varchar lengths, no-op
            }
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Reversing this migration is not supported.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn postgres() {
        assert_eq!(
            POSTGRES_ALTER_SQL,
            "ALTER TABLE alert_incidents ALTER COLUMN correlation_key TYPE varchar(128)"
        );
    }
}
