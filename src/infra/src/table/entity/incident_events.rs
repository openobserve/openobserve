use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "incident_events")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub incident_id: String,
    pub events: Json,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_construction() {
        let m = Model {
            org_id: "default".to_string(),
            incident_id: "inc-1".to_string(),
            events: serde_json::json!([{"type": "alert"}]),
        };
        assert_eq!(m.org_id, "default");
        assert_eq!(m.incident_id, "inc-1");
    }
}
