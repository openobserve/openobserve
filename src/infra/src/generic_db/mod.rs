use crate::errors::Result;

pub mod user_invitation;

pub enum DbType {
    Sqlite,
    Postgres,
    MySql
}

pub struct Table {
    sqlite: Option<Sqlite>,
    postgres: Option<Postgres>,
    mysql: Option<MySql>,
    db_type: DbType,
}

impl Table {
    pub async init() -> Result<()> {
        Ok(())
    }

    pub async execute(query: &str) -> Result<Bytes> {

    }

    pub async get_type(&self) -> String {
        self.db_type.to_string()
    }
}