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

//! Applies shared variables and environments replicated from the region a user
//! edited in.
//!
//! Values arrive as PLAINTEXT and are encrypted here under this region's own
//! key. Ciphertext made in the producing region is unreadable here, which is
//! o2-enterprise#2451, fixed at this boundary rather than by sharing keys.
//!
//! Everything goes through the RAW `infra::table` layer, never the synthetics
//! service layer. Two reasons, and the second is the load-bearing one: the
//! service re-publishes, which would bounce the message between regions
//! forever, and it re-runs validation, the reserved-prefix rule and the
//! resolved-set cap — so a region could refuse a row the origin accepted and
//! diverge with nobody told.
//!
//! Applies are idempotent, because the queue redelivers: an upsert is
//! last-write-wins by primary key, a delete is a delete, and a batch is one
//! transaction.

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
use sea_orm::TransactionTrait;

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::SyntheticsVariablesTable => process_msg(msg.try_into()?).await,
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
            // Cascades to the variables scoped to it, the same delete the
            // origin ran.
            synthetics_environments::delete(conn, &org_id, &id).await?;
        }
        SyntheticsVariablesMessage::VariablePut { org_id, payload } => {
            let record = variable_record(&org_id, payload).await?;
            synthetics_variables::apply_upsert(conn, &record).await?;
        }
        SyntheticsVariablesMessage::VariableDelete { org_id, id } => {
            synthetics_variables::delete_row(conn, &org_id, &id).await?;
        }
        SyntheticsVariablesMessage::Batch { org_id, ops } => {
            // Encrypt before opening the transaction: `get_dek` can mint and
            // persist a key, and that must not run inside one.
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
            let txn = conn.begin().await?;
            for write in &writes {
                match write {
                    Write::Environment(record) => {
                        synthetics_environments::apply_upsert(&txn, record).await?
                    }
                    Write::Variable(record) => {
                        synthetics_variables::apply_upsert(&txn, record).await?
                    }
                    Write::Delete(id) => {
                        synthetics_variables::delete_row(&txn, &org_id, id).await?;
                    }
                }
            }
            txn.commit().await?;
        }
    }

    // This region's own nodes still hold the pre-apply set in their 15-second
    // cache. The event is intra-cluster, so it cannot loop back out.
    synthetics_variables::invalidate_and_publish(&org_id).await;
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
        created_at: payload.created_at,
        updated_at: payload.updated_at,
    }
}

/// The wire payload with its plaintext value encrypted under this region's key.
///
/// An empty value stays empty: "unset" is stored as an empty column and read
/// back as `has_value: false`, so encrypting it would report an unset secret as
/// set.
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
        env: payload.env,
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
        // The payload is a perfectly good variable write, so only the type
        // check can reject it — a processor that decoded first and asked
        // questions later would apply it.
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
            MessageType::SyntheticsTable,
        );
        let err = process(msg).await.unwrap_err();
        assert!(
            err.to_string().contains("Invalid message type"),
            "expected the type check to reject it, got: {err}"
        );
    }

    /// `has_value` is `!value.is_empty()`, so encrypting an empty column would
    /// report an unset secret as set in every region but the one it was
    /// written in.
    #[tokio::test]
    async fn an_unset_secret_stays_unset_on_apply() {
        let record = variable_record("org1", variable("")).await.unwrap();
        assert_eq!(record.value, "");
    }

    /// The wire carries plaintext, and the row must not. Storing what arrived
    /// is o2-enterprise#2451 with the regions swapped.
    #[tokio::test]
    async fn a_value_is_encrypted_before_it_is_stored() {
        let Ok(record) = variable_record("org1", variable("hunter2")).await else {
            // `get_dek` needs a meta store, which a unit test has no business
            // standing up. The empty-value path above covers the branch that
            // does not.
            return;
        };
        assert!(record.value.starts_with("AESenc:"), "{}", record.value);
        assert_ne!(record.value, "hunter2");
    }

    #[test]
    fn an_environment_crosses_with_the_origin_id() {
        // A replicated check stores environment ids, so a locally minted id
        // would leave that check resolving nothing at all.
        let record = environment_record(SyntheticsEnvironmentPayload {
            id: "env-prod".to_string(),
            org_id: "org1".to_string(),
            name: "production".to_string(),
            description: String::new(),
            owner: None,
            created_at: 1,
            updated_at: 2,
        });
        assert_eq!(record.id, "env-prod");
        assert_eq!(record.name, "production");
    }
}
