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

//! The Phase 2 alert and Slack tables on a real Postgres, run when `ZO_META_POSTGRES_DSN` is set.

use config::meta::{
    alerts::ack::{AckSource, AlertAck},
    slack::{AnswerMode, MessageState, SetFrom, SlackAlertMessage, SlackChannelDefault},
};
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection, Statement};
use sea_orm_migration::SchemaManager;
use svix_ksuid::{Ksuid, KsuidLike};

use super::{
    alert_acks,
    migration::{alert_slack_migrations_for_test, create_alert_slack_prerequisites_for_test},
    slack_alert_messages, slack_channel_defaults,
};

const COLUMNS: [(&str, &str); 5] = [
    ("alert_states", "firing_started_at"),
    ("downtimes", "alert_groups"),
    ("downtimes", "end_on_clear"),
    ("downtimes", "mute_source"),
    ("slack_link_requests", "held_action"),
];
const TABLES: [&str; 2] = ["alert_acks", "slack_alert_messages"];
const INDEXES: [(&str, &str); 4] = [
    ("alert_acks", "alert_acks_org_alert_idx"),
    ("slack_alert_messages", "slack_alert_messages_firing_idx"),
    (
        "slack_alert_messages",
        "slack_alert_messages_pending_since_idx",
    ),
    ("slack_alert_messages", "slack_alert_messages_state_idx"),
];

async fn assert_schema(db: &DatabaseConnection, present: bool) {
    let manager = SchemaManager::new(db);
    for (table, column) in COLUMNS {
        assert_eq!(
            manager.has_column(table, column).await.unwrap(),
            present,
            "{table}.{column}"
        );
    }
    for table in TABLES {
        assert_eq!(manager.has_table(table).await.unwrap(), present, "{table}");
    }
    if present {
        for (table, index) in INDEXES {
            assert!(manager.has_index(table, index).await.unwrap(), "{index}");
        }
    }
}

fn ack(group_key: &str, updated_at: i64) -> AlertAck {
    AlertAck {
        org_id: "acme".into(),
        alert_id: "a1".into(),
        group_key: group_key.into(),
        firing_started_at: 10,
        acked_by: "dana@acme.com".into(),
        acked_at: updated_at,
        ack_source: AckSource::Slack,
        updated_at,
        ..Default::default()
    }
}

fn message(destination_id: &str) -> SlackAlertMessage {
    SlackAlertMessage {
        destination_id: destination_id.into(),
        org_id: "acme".into(),
        alert_id: "a1".into(),
        group_key: "k".into(),
        firing_started_at: 10,
        installation_id: "i1".into(),
        channel_id: "C1".into(),
        first_fired_at: 10,
        state: MessageState::Firing,
        created_at: 10,
        updated_at: 10,
        origin_region: "default".into(),
        ..Default::default()
    }
}

fn channel(channel_id: &str, org_id: &str) -> SlackChannelDefault {
    SlackChannelDefault {
        installation_id: "i1".into(),
        channel_id: channel_id.into(),
        channel_name: "ops".into(),
        org_id: org_id.into(),
        answer_mode: AnswerMode::Thread,
        set_from: SetFrom::Destination,
        updated_by: "admin@acme.com".into(),
        updated_at: 1,
        origin_region: "default".into(),
        deleted_at: None,
    }
}

async fn exercise_ops(db: &DatabaseConnection) {
    slack_alert_messages::insert_firing_with(db, &message("d1"))
        .await
        .unwrap();
    assert_eq!(
        alert_acks::put_with_outbox_with(db, &ack("k", 20))
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        slack_alert_messages::bump_wanted_with(db, "a1", "k", 10)
            .await
            .unwrap(),
        1
    );
    let key = message("d1").key();
    let row = slack_alert_messages::get_by_key_with(db, &key)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.wanted_seq, 2);
    assert!(
        slack_alert_messages::mark_rendered_cas_with(db, &key, 1)
            .await
            .unwrap()
    );
    assert!(
        slack_alert_messages::get_by_key_with(db, &key)
            .await
            .unwrap()
            .unwrap()
            .pending_since
            .is_some()
    );
    assert!(
        slack_alert_messages::mark_rendered_cas_with(db, &key, 2)
            .await
            .unwrap()
    );
    assert!(
        slack_alert_messages::get_by_key_with(db, &key)
            .await
            .unwrap()
            .unwrap()
            .pending_since
            .is_none()
    );

    assert!(
        !alert_acks::apply_replicated_with(db, &ack("k", 19))
            .await
            .unwrap()
    );
    assert!(
        alert_acks::apply_replicated_with(db, &ack("k", 21))
            .await
            .unwrap()
    );
    assert!(
        alert_acks::unack_with_outbox_with(db, "acme", "a1", "k", 10, "eve@acme.com", 30)
            .await
            .unwrap()
    );
    db.execute_unprepared(
        "INSERT INTO alert_states (alert_id, group_key, firing_started_at) VALUES ('a1', 'k', 10)",
    )
    .await
    .unwrap();
    alert_acks::put_with_outbox_with(db, &ack("ended", 20))
        .await
        .unwrap();
    assert_eq!(
        alert_acks::delete_ended_before_with(db, 100).await.unwrap(),
        1
    );

    for n in 0..10 {
        let id = format!("C{n}");
        let (first, second) = (channel(&id, "acme"), channel(&id, "globex"));
        let (a, b) = tokio::join!(
            slack_channel_defaults::insert_if_absent_with(db, &first),
            slack_channel_defaults::insert_if_absent_with(db, &second)
        );
        let (a, b) = (a.unwrap(), b.unwrap());
        assert!(a ^ b, "{id}: exactly one insert wins, got {a} {b}");
    }
    let rows = slack_channel_defaults::list_by_installation_with(db, "i1")
        .await
        .unwrap();
    assert_eq!(rows.len(), 10);
    db.execute_unprepared(
        "UPDATE slack_channel_defaults SET deleted_at = 1 WHERE channel_id = 'C0'",
    )
    .await
    .unwrap();
    assert!(
        slack_channel_defaults::insert_if_absent_with(db, &channel("C0", "globex"))
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn postgres_phase2_migrations_go_up_and_down_and_the_ops_hold() {
    let Ok(dsn) = std::env::var("ZO_META_POSTGRES_DSN") else {
        return;
    };
    if dsn.trim().is_empty() {
        return;
    }
    let schema = format!(
        "slack_p2_{}",
        Ksuid::new(None, None).to_string().to_ascii_lowercase()
    );
    let admin = Database::connect(&dsn).await.unwrap();
    admin
        .execute(Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            format!(r#"CREATE SCHEMA "{schema}""#),
        ))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(dsn);
    options
        .max_connections(4)
        .min_connections(4)
        .set_schema_search_path(schema.clone());
    let db = Database::connect(options).await.unwrap();
    create_alert_slack_prerequisites_for_test(&db)
        .await
        .unwrap();
    assert_schema(&db, false).await;

    let manager = SchemaManager::new(&db);
    let migrations = alert_slack_migrations_for_test();
    for migration in &migrations {
        migration.up(&manager).await.unwrap();
        migration.up(&manager).await.unwrap();
    }
    assert_schema(&db, true).await;
    exercise_ops(&db).await;

    for migration in migrations.iter().rev() {
        migration.down(&manager).await.unwrap();
    }
    assert_schema(&db, false).await;
    for migration in &migrations {
        migration.up(&manager).await.unwrap();
    }
    assert_schema(&db, true).await;

    db.close().await.unwrap();
    admin
        .execute(Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            format!(r#"DROP SCHEMA "{schema}" CASCADE"#),
        ))
        .await
        .unwrap();
}
