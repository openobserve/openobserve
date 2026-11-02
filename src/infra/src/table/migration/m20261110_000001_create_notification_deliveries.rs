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

use sea_orm_migration::prelude::*;

const EPISODE_IDX: &str = "notification_deliveries_episode_idx";
const OBJECT_IDX: &str = "notification_deliveries_object_idx";
const RETRY_IDX: &str = "notification_deliveries_retry_idx";
const CLOSED_IDX: &str = "notification_deliveries_closed_idx";
const EPISODES_CLOSED_IDX: &str = "notification_episodes_closed_idx";
const EPISODE_DESTINATIONS_CLOSED_IDX: &str = "notification_episode_destinations_episode_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(deliveries_table()).await?;
        for index in deliveries_indexes() {
            manager.create_index(index).await?;
        }
        manager.create_table(episodes_table()).await?;
        manager.create_index(episodes_closed_idx()).await?;
        manager.create_table(episode_destinations_table()).await?;
        manager.create_index(episode_destinations_idx()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (table, name) in [
            (NotificationDeliveries::Table.into_iden(), EPISODE_IDX),
            (NotificationDeliveries::Table.into_iden(), OBJECT_IDX),
            (NotificationDeliveries::Table.into_iden(), RETRY_IDX),
            (NotificationDeliveries::Table.into_iden(), CLOSED_IDX),
            (NotificationEpisodes::Table.into_iden(), EPISODES_CLOSED_IDX),
            (
                NotificationEpisodeDestinations::Table.into_iden(),
                EPISODE_DESTINATIONS_CLOSED_IDX,
            ),
        ] {
            manager
                .drop_index(Index::drop().if_exists().name(name).table(table).to_owned())
                .await?;
        }
        for table in [
            NotificationDeliveries::Table.into_iden(),
            NotificationEpisodes::Table.into_iden(),
            NotificationEpisodeDestinations::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum NotificationDeliveries {
    Table,
    Id,
    Org,
    Kind,
    ObjectId,
    EpisodeId,
    Event,
    Destination,
    Channel,
    TemplateSource,
    TemplateName,
    TemplateSkipped,
    OpensEpisode,
    Status,
    Attempt,
    MaxAttempts,
    Retryable,
    StatusCode,
    Error,
    SkipReason,
    Subject,
    Payload,
    ClaimToken,
    ClaimedAt,
    FinishedAt,
    NextRetryAt,
    CreatedAt,
    EpisodeClosedAt,
}

#[derive(DeriveIden)]
enum NotificationEpisodes {
    Table,
    Org,
    Kind,
    EpisodeId,
    ObjectId,
    OpenedAt,
    ClosedAt,
    ClosedBy,
    CreatedAt,
}

#[derive(DeriveIden)]
enum NotificationEpisodeDestinations {
    Table,
    Org,
    Kind,
    EpisodeId,
    Destination,
    Channel,
    Platform,
    TriggerOutcome,
    FirstSentAt,
    UpdatedAt,
}

fn deliveries_table() -> TableCreateStatement {
    use NotificationDeliveries as D;
    Table::create()
        .table(D::Table)
        .if_not_exists()
        .col(ColumnDef::new(D::Id).char_len(27).not_null().primary_key())
        .col(ColumnDef::new(D::Org).string_len(256).not_null())
        .col(ColumnDef::new(D::Kind).string_len(16).not_null())
        .col(ColumnDef::new(D::ObjectId).string_len(256).not_null())
        .col(ColumnDef::new(D::EpisodeId).string_len(512).not_null())
        .col(ColumnDef::new(D::Event).string_len(256).not_null())
        .col(ColumnDef::new(D::Destination).string_len(256).not_null())
        .col(ColumnDef::new(D::Channel).string_len(32).not_null())
        .col(ColumnDef::new(D::TemplateSource).string_len(32).not_null())
        .col(ColumnDef::new(D::TemplateName).string_len(256).not_null())
        .col(ColumnDef::new(D::TemplateSkipped).text().not_null())
        .col(ColumnDef::new(D::OpensEpisode).boolean().not_null())
        .col(ColumnDef::new(D::Status).string_len(16).not_null())
        .col(ColumnDef::new(D::Attempt).integer().not_null())
        .col(ColumnDef::new(D::MaxAttempts).integer().not_null())
        .col(ColumnDef::new(D::Retryable).boolean().not_null())
        .col(ColumnDef::new(D::StatusCode).integer().null())
        .col(ColumnDef::new(D::Error).text().null())
        .col(ColumnDef::new(D::SkipReason).string_len(32).null())
        .col(ColumnDef::new(D::Subject).text().null())
        .col(ColumnDef::new(D::Payload).text().not_null())
        .col(ColumnDef::new(D::ClaimToken).string_len(64).null())
        .col(ColumnDef::new(D::ClaimedAt).big_integer().null())
        .col(ColumnDef::new(D::FinishedAt).big_integer().null())
        .col(ColumnDef::new(D::NextRetryAt).big_integer().null())
        .col(ColumnDef::new(D::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(D::EpisodeClosedAt).big_integer().null())
        .to_owned()
}

fn deliveries_indexes() -> [IndexCreateStatement; 4] {
    use NotificationDeliveries as D;
    [
        Index::create()
            .if_not_exists()
            .unique()
            .name(EPISODE_IDX)
            .table(D::Table)
            .col(D::Org)
            .col(D::Kind)
            .col(D::EpisodeId)
            .col(D::Event)
            .col(D::Destination)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(OBJECT_IDX)
            .table(D::Table)
            .col(D::Org)
            .col(D::Kind)
            .col(D::ObjectId)
            .col(D::CreatedAt)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(RETRY_IDX)
            .table(D::Table)
            .col(D::Status)
            .col(D::NextRetryAt)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(CLOSED_IDX)
            .table(D::Table)
            .col(D::EpisodeClosedAt)
            .to_owned(),
    ]
}

fn episodes_table() -> TableCreateStatement {
    use NotificationEpisodes as E;
    Table::create()
        .table(E::Table)
        .if_not_exists()
        .col(ColumnDef::new(E::Org).string_len(256).not_null())
        .col(ColumnDef::new(E::Kind).string_len(16).not_null())
        .col(ColumnDef::new(E::EpisodeId).string_len(512).not_null())
        .col(ColumnDef::new(E::ObjectId).string_len(256).not_null())
        .col(ColumnDef::new(E::OpenedAt).big_integer().not_null())
        .col(ColumnDef::new(E::ClosedAt).big_integer().null())
        .col(ColumnDef::new(E::ClosedBy).string_len(16).null())
        .col(ColumnDef::new(E::CreatedAt).big_integer().not_null())
        .primary_key(Index::create().col(E::Org).col(E::Kind).col(E::EpisodeId))
        .to_owned()
}

fn episodes_closed_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(EPISODES_CLOSED_IDX)
        .table(NotificationEpisodes::Table)
        .col(NotificationEpisodes::ClosedAt)
        .to_owned()
}

fn episode_destinations_table() -> TableCreateStatement {
    use NotificationEpisodeDestinations as R;
    Table::create()
        .table(R::Table)
        .if_not_exists()
        .col(ColumnDef::new(R::Org).string_len(256).not_null())
        .col(ColumnDef::new(R::Kind).string_len(16).not_null())
        .col(ColumnDef::new(R::EpisodeId).string_len(512).not_null())
        .col(ColumnDef::new(R::Destination).string_len(256).not_null())
        .col(ColumnDef::new(R::Channel).string_len(32).not_null())
        .col(ColumnDef::new(R::Platform).string_len(16).null())
        .col(ColumnDef::new(R::TriggerOutcome).string_len(16).not_null())
        .col(ColumnDef::new(R::FirstSentAt).big_integer().null())
        .col(ColumnDef::new(R::UpdatedAt).big_integer().not_null())
        .primary_key(
            Index::create()
                .col(R::Org)
                .col(R::Kind)
                .col(R::EpisodeId)
                .col(R::Destination),
        )
        .to_owned()
}

fn episode_destinations_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(EPISODE_DESTINATIONS_CLOSED_IDX)
        .table(NotificationEpisodeDestinations::Table)
        .col(NotificationEpisodeDestinations::Org)
        .col(NotificationEpisodeDestinations::Kind)
        .col(NotificationEpisodeDestinations::EpisodeId)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};
    use sea_orm_migration::MigrationName;

    use super::*;

    #[tokio::test]
    async fn up_reruns_and_the_unique_index_refuses_a_second_row() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        for table in [
            "notification_deliveries",
            "notification_episodes",
            "notification_episode_destinations",
        ] {
            assert!(manager.has_table(table).await.unwrap(), "{table}");
        }
        let insert = |id: &str| {
            format!(
                "INSERT INTO notification_deliveries (id, org, kind, object_id, episode_id, event, \
                 destination, channel, template_source, template_name, template_skipped, \
                 opens_episode, status, attempt, max_attempts, retryable, payload, created_at) \
                 VALUES ('{id}', 'acme', 'anomaly', 'a1', 'a1:1', 'firing:1', 'slack', 'slack', \
                 'compiled', 'o2_default_anomaly', '[]', true, 'pending', 1, 5, false, '{{}}', 1)"
            )
        };
        db.execute_unprepared(&insert("n1")).await.unwrap();
        assert!(db.execute_unprepared(&insert("n2")).await.is_err());
    }

    #[tokio::test]
    async fn down_drops_the_tables() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("notification_deliveries").await.unwrap());
        assert!(!manager.has_table("notification_episodes").await.unwrap());
        Migration.down(&manager).await.unwrap();
    }

    #[test]
    fn migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261110_000001_create_notification_deliveries"
        );
    }
}
