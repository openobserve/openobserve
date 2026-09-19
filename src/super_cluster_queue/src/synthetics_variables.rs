// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use infra::{
    errors::{Error, Result},
    table::{
        synthetics_environments::{self, SyntheticsEnvironmentRecord},
        synthetics_variables::{self, SyntheticsVariableRecord},
    },
};
use o2_enterprise::enterprise::super_cluster::queue::{
    Message, MessageType, SyntheticsEnvironmentPayload, SyntheticsVariablePayload,
    SyntheticsVariablesMessage, SyntheticsVariablesOp,
};
use sea_orm::{ConnectionTrait, TransactionTrait};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::SyntheticsTable => process_msg(msg.try_into()?).await,
        _ => {
            log::error!(
                "[SUPER_CLUSTER:DB] synthetics_variables: invalid message type {:?} key {}",
                msg.message_type,
                msg.key
            );
            Err(Error::Message("Invalid message type".to_string()))
        }
    }
}

async fn process_msg(msg: SyntheticsVariablesMessage) -> Result<()> {
    let conn = infra::db::get_orm_client_rw().await;
    let org_id = match &msg {
        SyntheticsVariablesMessage::EnvironmentPut { org_id, .. }
        | SyntheticsVariablesMessage::EnvironmentDelete { org_id, .. }
        | SyntheticsVariablesMessage::VariablePut { org_id, .. }
        | SyntheticsVariablesMessage::VariableDelete { org_id, .. }
        | SyntheticsVariablesMessage::Batch { org_id, .. } => org_id.clone(),
    };

    match msg {
        SyntheticsVariablesMessage::EnvironmentPut { payload, .. } => {
            synthetics_environments::apply_upsert(conn, &environment_record(payload)).await?;
        }
        SyntheticsVariablesMessage::EnvironmentDelete { org_id, id } => {
            synthetics_environments::delete(conn, &org_id, &id).await?;
        }
        SyntheticsVariablesMessage::VariablePut { org_id, payload } => {
            let record = variable_record(&org_id, payload).await?;
            apply_ops(conn, &org_id, &[Write::Variable(record)]).await?;
        }
        SyntheticsVariablesMessage::VariableDelete { org_id, id } => {
            synthetics_variables::delete_row(conn, &org_id, &id).await?;
        }
        SyntheticsVariablesMessage::Batch { org_id, ops } => {
            let mut writes = Vec::with_capacity(ops.len());
            for op in ops {
                writes.push(match op {
                    SyntheticsVariablesOp::EnvironmentPut(payload) => {
                        Write::Environment(environment_record(payload))
                    }
                    SyntheticsVariablesOp::VariablePut(payload) => {
                        Write::Variable(variable_record(&org_id, payload).await?)
                    }
                    SyntheticsVariablesOp::VariableDelete(id) => Write::Delete(id),
                });
            }
            apply_ops(conn, &org_id, &writes).await?;
        }
    }

    synthetics_variables::invalidate_and_publish(&org_id).await;
    Ok(())
}

/// Applies writes in one transaction; a variable that loses to a newer row is skipped, not retried.
async fn apply_ops<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    writes: &[Write],
) -> Result<()> {
    let txn = conn.begin().await?;
    for write in writes {
        match write {
            Write::Environment(record) => {
                synthetics_environments::apply_upsert(&txn, record).await?;
            }
            Write::Variable(record) => {
                ensure_global_parent(&txn, record).await?;
                synthetics_variables::apply_upsert(&txn, record).await?;
            }
            Write::Delete(id) => {
                synthetics_variables::delete_row(&txn, org_id, id).await?;
            }
        }
    }
    txn.commit().await?;
    Ok(())
}

/// Mints this region's global environment before a variable that points at it.
async fn ensure_global_parent<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsVariableRecord,
) -> Result<()> {
    if record.env == synthetics_environments::global_environment_id(&record.org_id) {
        synthetics_environments::get_or_create_global(
            conn,
            &record.org_id,
            config::utils::time::now_micros(),
        )
        .await?;
    }
    Ok(())
}

/// One write in a batch, with its value already encrypted for this region.
enum Write {
    Environment(SyntheticsEnvironmentRecord),
    Variable(SyntheticsVariableRecord),
    Delete(String),
}

fn environment_record(payload: SyntheticsEnvironmentPayload) -> SyntheticsEnvironmentRecord {
    SyntheticsEnvironmentRecord {
        id: payload.id,
        org_id: payload.org_id,
        name: payload.name,
        description: payload.description,
        owner: payload.owner,
        is_global: payload.is_global,
        created_at: payload.created_at,
        updated_at: payload.updated_at,
    }
}

/// The wire payload with its plaintext value encrypted under this region's key.
async fn variable_record(
    org_id: &str,
    payload: SyntheticsVariablePayload,
) -> Result<SyntheticsVariableRecord> {
    let value = if payload.value.is_empty() {
        String::new()
    } else {
        let dek = infra::table::cipher::get_dek(org_id).await?;
        config::utils::encryption::encrypt_secret_value(&dek, &payload.value)
            .map_err(|e| Error::Message(format!("encrypt on apply failed: {e}")))?
    };
    Ok(SyntheticsVariableRecord {
        id: payload.id,
        org_id: payload.org_id,
        // The wire keeps `env` optional; an absent one can only mean the global environment.
        env: payload
            .env
            .unwrap_or_else(|| synthetics_environments::global_environment_id(org_id)),
        name: payload.name,
        value,
        kind: payload.kind,
        description: payload.description,
        example: payload.example,
        tags: payload.tags,
        owner: payload.owner,
        created_at: payload.created_at,
        updated_at: payload.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::super_cluster::queue::SyntheticsVariablesMessage;

    use super::*;

    fn variable(value: &str) -> SyntheticsVariablePayload {
        SyntheticsVariablePayload {
            id: "var-1".to_string(),
            org_id: "org1".to_string(),
            env: Some("env-prod".to_string()),
            name: "PASSWORD".to_string(),
            value: value.to_string(),
            kind: "secret".to_string(),
            description: String::new(),
            example: String::new(),
            tags: vec![],
            owner: None,
            created_at: 1,
            updated_at: 2,
        }
    }

    #[tokio::test]
    async fn a_message_from_another_table_is_rejected() {
        let payload = config::utils::json::to_vec(&SyntheticsVariablesMessage::VariablePut {
            org_id: "org1".to_string(),
            payload: variable("hunter2"),
        })
        .unwrap();
        let msg = Message::new(
            "/synthetics_variables/".to_string(),
            Some(payload.into()),
            None,
            false,
            MessageType::SyntheticsLocationsTable,
        );
        let err = process(msg).await.unwrap_err();
        assert!(
            err.to_string().contains("Invalid message type"),
            "expected the type check to reject it, got: {err}"
        );
    }

    #[tokio::test]
    async fn an_unset_secret_stays_unset_on_apply() {
        let record = variable_record("org1", variable("")).await.unwrap();
        assert_eq!(record.value, "");
    }

    #[tokio::test]
    async fn a_value_is_encrypted_before_it_is_stored() {
        let Ok(record) = variable_record("org1", variable("hunter2")).await else {
            return;
        };
        assert!(record.value.starts_with("AESenc:"), "{}", record.value);
        assert_ne!(record.value, "hunter2");
    }

    #[tokio::test]
    async fn a_batch_that_fails_halfway_leaves_nothing_behind() {
        use sea_orm::{ConnectionTrait, Database, EntityTrait, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(
            &schema.create_table_from_entity(infra::table::entity::synthetics_variables::Entity),
        ))
        .await
        .unwrap();
        db.execute_unprepared("CREATE UNIQUE INDEX u ON synthetics_variables (org_id, env, name)")
            .await
            .unwrap();

        db.execute_unprepared(
            "CREATE TRIGGER no_second AFTER INSERT ON synthetics_variables \
             WHEN NEW.id = 'var-2' BEGIN SELECT RAISE(ABORT, 'refused'); END",
        )
        .await
        .unwrap();

        let mut first = variable_record("org1", variable("")).await.unwrap();
        first.id = "var-1".to_string();
        let mut second = first.clone();
        second.id = "var-2".to_string();
        second.name = "OTHER".to_string();

        let err = apply_ops(
            &db,
            "org1",
            &[Write::Variable(first), Write::Variable(second)],
        )
        .await
        .expect_err("the second write is refused");
        assert!(!err.to_string().is_empty());

        let left = infra::table::entity::synthetics_variables::Entity::find()
            .all(&db)
            .await
            .unwrap();
        assert!(left.is_empty(), "the first write must have rolled back");
    }

    #[tokio::test]
    async fn a_global_variable_lands_in_a_region_that_has_no_global_environment_yet() {
        use sea_orm::{ConnectOptions, ConnectionTrait, Database, EntityTrait, Schema};

        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        db.execute_unprepared("PRAGMA foreign_keys = ON")
            .await
            .unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(
            &schema.create_table_from_entity(infra::table::entity::synthetics_environments::Entity),
        ))
        .await
        .unwrap();
        let mut vars =
            schema.create_table_from_entity(infra::table::entity::synthetics_variables::Entity);
        vars.foreign_key(
            sea_orm::sea_query::ForeignKey::create()
                .from(
                    infra::table::entity::synthetics_variables::Entity,
                    infra::table::entity::synthetics_variables::Column::Env,
                )
                .to(
                    infra::table::entity::synthetics_environments::Entity,
                    infra::table::entity::synthetics_environments::Column::Id,
                ),
        );
        db.execute(backend.build(&vars)).await.unwrap();

        let payload = SyntheticsVariablePayload {
            env: None,
            kind: "plain".to_string(),
            ..variable("")
        };
        let record = variable_record("org1", payload).await.unwrap();
        apply_ops(&db, "org1", &[Write::Variable(record)])
            .await
            .expect("the global parent must be minted before the variable");

        let envs = infra::table::entity::synthetics_environments::Entity::find()
            .all(&db)
            .await
            .unwrap();
        assert_eq!(envs.len(), 1);
        assert!(envs[0].is_global);
        assert_eq!(envs[0].id, "global_org1");
    }

    #[test]
    fn an_environment_crosses_with_the_origin_id() {
        let record = environment_record(SyntheticsEnvironmentPayload {
            id: "env-prod".to_string(),
            org_id: "org1".to_string(),
            name: "production".to_string(),
            description: String::new(),
            owner: None,
            is_global: false,
            created_at: 1,
            updated_at: 2,
        });
        assert_eq!(record.id, "env-prod");
        assert_eq!(record.name, "production");
        assert!(!record.is_global);
    }

    #[test]
    fn the_global_flag_crosses_with_the_row() {
        let record = environment_record(SyntheticsEnvironmentPayload {
            id: "global_org1".to_string(),
            org_id: "org1".to_string(),
            name: "global".to_string(),
            description: String::new(),
            owner: None,
            is_global: true,
            created_at: 1,
            updated_at: 2,
        });
        assert!(record.is_global);
        assert_eq!(record.id, "global_org1");
    }

    #[tokio::test]
    async fn a_variable_without_an_environment_lands_in_the_global_one() {
        let payload = SyntheticsVariablePayload {
            env: None,
            kind: "plain".to_string(),
            ..variable("")
        };
        let record = variable_record("org1", payload).await.unwrap();
        assert_eq!(record.env, "global_org1");
    }

    #[tokio::test]
    async fn a_variable_message_on_the_synthetics_type_byte_is_decoded() {
        let payload = config::utils::json::to_vec(&SyntheticsVariablesMessage::VariableDelete {
            org_id: "org1".to_string(),
            id: "var-1".to_string(),
        })
        .unwrap();
        let msg = Message::new(
            "/synthetics_variables/".to_string(),
            Some(payload.into()),
            None,
            false,
            MessageType::SyntheticsTable,
        );
        let decoded: SyntheticsVariablesMessage = msg.try_into().unwrap();
        assert!(matches!(
            decoded,
            SyntheticsVariablesMessage::VariableDelete { ref id, .. } if id == "var-1"
        ));
    }
}
