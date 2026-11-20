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
    db::get_orm_client_rw,
    errors::{Error, Result},
    table::alert_composites::{self, CompositeWithChildren, ReplicatedKind},
};
use o2_enterprise::enterprise::super_cluster::queue::{
    AlertCompositeMessage, Message, MessageType,
};
use sea_orm::DatabaseConnection;

pub(crate) async fn process(msg: Message) -> Result<()> {
    if msg.message_type != MessageType::AlertCompositesTable {
        log::error!(
            "[SUPER_CLUSTER:DB] Invalid message: type: {:?}, key: {}",
            msg.message_type,
            msg.key
        );
        return Err(Error::Message("Invalid message type".to_string()));
    }
    let message = AlertCompositeMessage::try_from(msg)?;
    // Through `infra`, not `db`: the `db` wrapper would broadcast the write again.
    let conn = get_orm_client_rw().await;
    let (org, id) = match message {
        AlertCompositeMessage::Create { composite } => {
            apply(conn, ReplicatedKind::Create, *composite).await?
        }
        AlertCompositeMessage::Update { composite } => {
            apply(conn, ReplicatedKind::Update, *composite).await?
        }
        AlertCompositeMessage::Delete { org_id, id } => {
            alert_composites::delete_by_id(conn, &org_id, &id).await?;
            (org_id, id)
        }
    };
    // After a skipped write too: a redelivered message has to be able to repair the job.
    openobserve_core::alerts::composite::sync_replica_job(&org, &id).await
}

/// Applies one definition and returns the `(org, id)` whose job has to follow it.
async fn apply(
    conn: &DatabaseConnection,
    kind: ReplicatedKind,
    composite: CompositeWithChildren,
) -> Result<(String, String)> {
    let key = (
        composite.definition.org.clone(),
        composite.definition.id.clone(),
    );
    alert_composites::apply_replicated(conn, kind, composite).await?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use infra::table::entity;
    use o2_enterprise::enterprise::super_cluster::queue::{
        AlertCompositeMessage, Message, MessageType,
    };

    use super::*;

    fn composite() -> CompositeWithChildren {
        CompositeWithChildren {
            definition: entity::alert_composites::Model {
                id: "c1".into(),
                org: "acme".into(),
                updated_at: Some(105),
                ..Default::default()
            },
            children: vec![entity::alert_composite_children::Model {
                composite_id: "c1".into(),
                child_alert_id: "a1".into(),
                child_kind: alert_composites::ChildKind::Alert as i16,
                display_order: 0,
            }],
        }
    }

    #[tokio::test]
    async fn a_message_of_another_table_is_rejected_before_it_is_decoded() {
        let payload = config::utils::json::to_vec(&AlertCompositeMessage::Delete {
            org_id: "acme".into(),
            id: "c1".into(),
        })
        .unwrap();
        let msg = Message::new(
            "/alert_composites/acme/c1".to_string(),
            Some(payload.into()),
            None,
            false,
            MessageType::AlertStatesTable,
        );
        assert!(process(msg).await.is_err());
    }

    #[tokio::test]
    async fn a_malformed_payload_is_an_error_not_a_panic() {
        let msg = Message::new(
            "/alert_composites/acme/c1".to_string(),
            Some(b"not json".to_vec().into()),
            None,
            false,
            MessageType::AlertCompositesTable,
        );
        assert!(process(msg).await.is_err());
    }

    #[test]
    fn a_definition_survives_the_wire_round_trip() {
        let sent = AlertCompositeMessage::Update {
            composite: Box::new(composite()),
        };
        let msg = Message::new(
            "/alert_composites/acme/c1".to_string(),
            Some(config::utils::json::to_vec(&sent).unwrap().into()),
            None,
            false,
            MessageType::AlertCompositesTable,
        );
        let bytes = bytes::Bytes::try_from(&msg).unwrap();
        let decoded = Message::try_from(&bytes).unwrap();
        assert_eq!(decoded.message_type, MessageType::AlertCompositesTable);
        let AlertCompositeMessage::Update { composite: back } =
            AlertCompositeMessage::try_from(decoded).unwrap()
        else {
            panic!("decoded as another variant");
        };
        assert_eq!(*back, composite());
    }

    /// Applying through the publishing layer would hand the same write around the regions forever.
    #[test]
    fn the_processor_applies_below_the_publishing_layer() {
        let source = include_str!("alert_composites.rs");
        // Assembled at runtime so the needles do not match this test's own text.
        let db_layer = ["db", "alerts"].join("::");
        let publish_fn = ["queue", "alert_composites_"].join("::");
        assert!(!source.contains(&db_layer), "{db_layer} publishes");
        assert!(
            !source.contains(&publish_fn),
            "the processor never publishes"
        );
    }
}
