use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

// Guarded on the column's existence: a database that was downgraded to v0.40.x by hand and is being
// re-upgraded replays this migration, and the hand-restored schema may not have correlation_key.
// A bare ALTER COLUMN would fail the whole `db init` in that case.
const POSTGRES_ALTER_SQL: &str = r#"DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alert_incidents' AND column_name = 'correlation_key'
  ) THEN
    ALTER TABLE alert_incidents ALTER COLUMN correlation_key TYPE varchar(128);
  END IF;
END $$"#;

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
        assert!(POSTGRES_ALTER_SQL.contains(
            "ALTER TABLE alert_incidents ALTER COLUMN correlation_key TYPE varchar(128)"
        ));
        // The widen must be a no-op when the column is absent (hand-downgraded database).
        assert!(POSTGRES_ALTER_SQL.contains("IF EXISTS"));
    }
}
