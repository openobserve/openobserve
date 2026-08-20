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

//! Applies synthetic check *config* replicated from the region a user edited
//! in, plus the one runtime column that travels — the status badge, replicated
//! from the region that ran the check, and only when it flips.
//!
//! Everything here goes through `infra::table::synthetics_checks` on purpose.
//! The publishing wrapper is one layer up, in the enterprise synthetics
//! service, and it exposes the same operations under similar names — so
//! routing an apply through it would look reasonable at the call site and
//! re-broadcast every write, leaving the regions handing each one around
//! forever.
//!
//! The column-selectivity guarantee is inherited rather than restated:
//! `synthetics_checks::update` rebuilds its `ActiveModel` from the row already
//! in this region and only writes the columns a user can edit, so `next_run_at`
//! and the alerting counters keep this region's values. Hand-listing them here
//! would duplicate that list and let the two drift.
//!
//! Applies are idempotent because the queue redelivers: `Create` is a no-op
//! when the row is already here, `Update` and `SetEnabled` are last-write-wins,
//! `Delete` is a delete, and `SetLastCheckStatus` writes only when the value
//! differs, so a repeat touches nothing.
//!
//! The one field that is NOT applied as it arrives is `folder_id`. It is a
//! `folders` KSUID, and the default synthetics folder is minted lazily by
//! whichever region a user first created a check in — so the same folder has a
//! different primary key in each region, and a check applied with the origin's
//! fails `synthetics_folder_fk` here, forever. Messages carry the folder's
//! public slug instead and it is resolved against this region's table below.

use config::meta::{
    folder::{DEFAULT_FOLDER, Folder, FolderType},
    synthetics::Synthetic,
};
use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{Error, Result},
    table,
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType, SyntheticsMessage};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::SyntheticsTable => {
            process_msg(msg.try_into()?).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:DB] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}

/// What to do about the folder a replicated write names.
///
/// Split out of [`resolve_folder_pk`] because the rule is the part worth
/// testing and the two lookups either side of it need a database. The inputs
/// are the slug the message carried and whatever this region's folders table
/// says about it.
#[derive(Debug, PartialEq)]
enum FolderAction {
    /// The slug is known here; this is the local primary key for it.
    Use(String),
    /// The default synthetics folder is minted lazily, on first use, by
    /// whichever region a user happens to create a check in — so a region that
    /// has not had one created in it yet simply does not have the row. That is
    /// an absence to fill, not a replication that has not arrived.
    CreateDefault,
    /// Any other folder is created through the folders API and replicates on
    /// its own topic. Failing here leaves the message unacked so it redelivers
    /// after that folder lands — the same ordering behaviour alerts relies on.
    Missing,
}

fn folder_action(slug: &str, local_pk: Option<String>) -> FolderAction {
    match local_pk {
        Some(pk) => FolderAction::Use(pk),
        None if slug == DEFAULT_FOLDER => FolderAction::CreateDefault,
        None => FolderAction::Missing,
    }
}

/// Translates the folder slug a message carried into THIS region's
/// `folders.id`.
///
/// The slug is the only folder reference that means the same thing in two
/// regions. `folders.id` is a KSUID, and the default synthetics folder is
/// minted lazily and locally, so each region ends up with a different one for
/// the same folder; a check replicated with the origin's PK fails
/// `synthetics_folder_fk` in every other region and redelivers until it dies.
async fn resolve_folder_pk(org_id: &str, slug: &str) -> Result<String> {
    let local_pk = table::folders::get_pk_by_name(org_id, slug, FolderType::Synthetics).await?;
    match folder_action(slug, local_pk) {
        FolderAction::Use(pk) => Ok(pk),
        FolderAction::CreateDefault => create_default_folder(org_id).await,
        FolderAction::Missing => Err(Error::Message(format!(
            "synthetics folder {org_id}/{slug} is not in this region yet"
        ))),
    }
}

/// Mints this region's default synthetics folder.
///
/// The raw table write on purpose. The layer that creates this folder for a
/// user lives in the crate that also publishes every write it makes, and it is
/// deliberately not a dependency of this one — applying a replicated message
/// through it is how a message becomes a loop.
///
/// The KSUID is deliberately this region's own and will not match the origin's.
/// Nothing compares folder primary keys across regions — that assumption is
/// exactly what this file no longer makes.
async fn create_default_folder(org_id: &str) -> Result<String> {
    let (id, _) = table::folders::put(
        org_id,
        None,
        Folder {
            folder_id: DEFAULT_FOLDER.to_owned(),
            name: "default".to_owned(),
            description: "default".to_owned(),
            icon: None,
        },
        FolderType::Synthetics,
    )
    .await?;
    Ok(id.to_string())
}

/// The destination of a move, which is a slug from a current producer and a
/// folders primary key from one still on the previous build.
///
/// The unknown-slug arm probes for a primary key before giving up: a folder
/// created through the folders API replicates *with* its KSUID, so an in-flight
/// move message carrying one of those is valid here and applying it is what
/// this region did before. A create or update needs no such probe — its slug
/// travels in a field of its own, and an old producer leaves it empty.
async fn resolve_move_destination(org_id: &str, dst: &str) -> Result<String> {
    let local_pk = table::folders::get_pk_by_name(org_id, dst, FolderType::Synthetics).await?;
    match folder_action(dst, local_pk) {
        FolderAction::Use(pk) => Ok(pk),
        FolderAction::CreateDefault => create_default_folder(org_id).await,
        FolderAction::Missing => {
            // Read the primary key back as a slug and resolve that, rather than
            // writing it through: `folders.id` is unique across every folder
            // type and org, so an id alone would satisfy the FK while putting
            // the check in another org's dashboard folder. The round trip
            // constrains it to a synthetics folder of this org.
            if let Some(slug) = table::folders::get_name_by_pk(dst).await?
                && let Some(pk) =
                    table::folders::get_pk_by_name(org_id, &slug, FolderType::Synthetics).await?
            {
                Ok(pk)
            } else {
                Err(Error::Message(format!(
                    "synthetics folder {org_id}/{dst} is not in this region yet"
                )))
            }
        }
    }
}

/// Applies the replicated status badge.
///
/// A missing row is **not** an error, deliberately unlike `SetEnabled` below.
/// `enabled` decides whether the check runs at all, so losing it changes
/// behaviour and is worth making the message redeliver; `last_check_status` is
/// the badge the LIST renders, so a status that outran its create — or arrived
/// after a delete — is cosmetic, and the check's next flip republishes it
/// anyway. Erroring would retry a message about a check that does not exist
/// here until it dead-lettered.
///
/// Redelivery is safe for the same reason the producer is quiet:
/// `update_last_check_status` writes only when the value differs, so applying
/// the same message twice is a no-op the second time.
///
/// `org_id` is carried for the log line and for parity with the other variants.
/// The write keys on the check id, which is a KSUID and already unique across
/// orgs.
///
/// Split out of [`process_msg`] so it can be exercised against a real database
/// without going through the process-wide ORM handle.
async fn apply_last_check_status<C: sea_orm::ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    status: i32,
) -> Result<()> {
    if !table::synthetics_checks::update_last_check_status(conn, id, status).await? {
        log::debug!(
            "[SUPER_CLUSTER:DB] synthetics check {org_id}/{id} status {status} was already \
             current, or the check is not in this region"
        );
    }
    Ok(())
}

/// Re-encrypts an arriving check's secrets under THIS region's DEK.
///
/// Secrets cross the queue in clear (see `SyntheticsCheckPayload::for_wire`):
/// the producing region's DEK is its own, so ciphertext made there is
/// unreadable here. Encrypting on arrival is what makes the check runnable
/// locally, and it is why every region can keep a DEK it minted itself —
/// o2-enterprise#2451 is fixed at this boundary rather than by sharing keys.
///
/// Fails the message rather than storing anything partial: a half-encrypted
/// check would leave real credentials in plaintext columns.
async fn encrypt_for_this_region(org_id: &str, check: &mut Synthetic) -> Result<()> {
    // `get_dek` mints and persists a key on first use, so skip it entirely for
    // a check that carries nothing to encrypt.
    if !has_secret_value(check) {
        return Ok(());
    }
    let dek = infra::table::cipher::get_dek(org_id).await?;
    encrypt_with(&dek, check)
}

/// Whether the check carries any non-empty secret.
fn has_secret_value(check: &Synthetic) -> bool {
    let mut found = false;
    let mut probe = check.clone();
    let _ = config::meta::synthetics::for_each_secret(&mut probe, &mut |value: &mut String| {
        if !value.is_empty() {
            found = true;
        }
        Ok::<(), ()>(())
    });
    found
}

/// The transformation itself, split from the DEK fetch so it can be tested
/// without a database.
fn encrypt_with(dek: &[u8], check: &mut Synthetic) -> Result<()> {
    config::meta::synthetics::for_each_secret(check, &mut |value: &mut String| {
        // Empty stays empty: a blank optional credential is not a secret, and
        // encrypting it would turn "unset" into ciphertext that decrypts to "".
        if value.is_empty() {
            return Ok(());
        }
        *value = config::utils::encryption::encrypt_secret_value(dek, value)
            .map_err(|e| Error::Message(format!("encrypt on apply failed: {e}")))?;
        Ok::<(), Error>(())
    })
}

async fn process_msg(msg: SyntheticsMessage) -> Result<()> {
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match msg {
        SyntheticsMessage::Create { org_id, payload } => {
            let folder_slug = payload.folder_slug.clone();
            let mut check = payload.into_check();
            if table::synthetics_checks::get(conn, &org_id, &check.id)
                .await?
                .is_some()
            {
                // Redelivery, or a create that raced its own update. Either way
                // the row is here and overwriting it could undo a later edit.
                return Ok(());
            }
            // The incoming `folder_id` is the ORIGIN region's KSUID and means
            // nothing here. Replace it with the local primary key for the same
            // slug. An empty slug is a message from a producer that predates
            // the field: keep the old behaviour rather than inventing a folder.
            if !folder_slug.is_empty() {
                check.folder_id = resolve_folder_pk(&org_id, &folder_slug).await?;
            }
            encrypt_for_this_region(&org_id, &mut check).await?;
            // `use_given_id` — the origin region's primary key is the identity
            // every other region has to agree on. That applies to the CHECK's
            // id; the folder's does not travel at all.
            table::synthetics_checks::create(conn, &org_id, check, true).await?;
        }
        SyntheticsMessage::Update {
            org_id,
            id,
            payload,
        } => {
            let folder_slug = payload.folder_slug.clone();
            let mut check = payload.into_check();
            // `update` writes `folder_id` like any other editable column, so the
            // same translation as `Create` is needed or an edit would move the
            // check into the origin's folder id and fail the FK.
            if !folder_slug.is_empty() {
                check.folder_id = resolve_folder_pk(&org_id, &folder_slug).await?;
            }
            encrypt_for_this_region(&org_id, &mut check).await?;
            // Errors if the row is missing rather than creating it: an update
            // that outran its create is redelivered, and one that arrives after
            // a delete must not resurrect the check.
            table::synthetics_checks::update(conn, &org_id, &id, check).await?;
        }
        // Retired variants: the payload's secrets are ciphertext under the
        // PRODUCING region's DEK and cannot be read here. Applying one would
        // store an unreadable credential and, on update, overwrite a working
        // one. Refuse so it redelivers until the producer is upgraded, rather
        // than persisting something silently broken.
        SyntheticsMessage::CreateEncrypted { org_id, .. }
        | SyntheticsMessage::UpdateEncrypted { org_id, .. } => {
            return Err(Error::Message(format!(
                "[SUPER_CLUSTER:sync] refusing a synthetics message from a pre-plaintext-secret \
                 producer for org {org_id}: its secrets are encrypted under the origin region's \
                 DEK and are unreadable here. Upgrade the producing region."
            )));
        }
        SyntheticsMessage::Delete { org_id, id } => {
            table::synthetics_checks::delete(conn, &org_id, &id).await?;
        }
        SyntheticsMessage::SetEnabled {
            org_id,
            id,
            enabled,
        } => {
            // `set_enabled` reports "no such row" as `false`, not an error, so
            // a pause that outran its create would be acked and lost — and
            // `enabled` is the column that decides whether the check runs at
            // all. Fail instead, and let the redelivery land after the create.
            if !table::synthetics_checks::set_enabled(conn, &org_id, &id, enabled).await? {
                return Err(Error::Message(format!(
                    "synthetics check {org_id}/{id} not found for enable/pause"
                )));
            }
        }
        SyntheticsMessage::SetLastCheckStatus { org_id, id, status } => {
            apply_last_check_status(conn, &org_id, &id, status).await?;
        }
        SyntheticsMessage::MoveToFolder {
            org_id,
            ids,
            dst_folder_id,
        } => {
            // The destination is a slug, so it has to become a local primary
            // key first. Unresolvable IS an error, unlike the partial move
            // below: moving nothing anywhere is not a partial result, and the
            // redelivery lands once the folder does.
            let dst_pk = resolve_move_destination(&org_id, &dst_folder_id).await?;
            // Deliberately tolerant of ids it cannot find, unlike enable/pause.
            // A bulk move can legitimately race a delete of one of its ids, and
            // erroring would retry that message until it dead-lettered. A check
            // left in its old folder is cosmetic and the next edit to it carries
            // its folder anyway.
            let moved =
                table::synthetics_checks::move_to_folder(conn, &org_id, &ids, &dst_pk).await?;
            if moved != ids.len() as u64 {
                log::warn!(
                    "[SUPER_CLUSTER:DB] moved {moved} of {} synthetics checks into folder {dst_folder_id}; the rest are not in this region",
                    ids.len()
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod encrypt_on_apply_tests {
    use config::meta::synthetics::SyntheticAuth;

    use super::*;

    /// The other half of option B: what arrives in clear is stored encrypted
    /// under THIS region's key, which is what makes the check runnable here.
    #[test]
    fn plaintext_from_the_wire_is_encrypted_locally() {
        let dek = vec![5u8; 64];
        let mut check = Synthetic {
            auth: Some(SyntheticAuth::Bearer {
                token: "hunter2".into(),
            }),
            ..Default::default()
        };
        check
            .config_secrets
            .insert("/auth/secret".into(), "s3".into());

        encrypt_with(&dek, &mut check).unwrap();

        let token = match check.auth.as_ref().unwrap() {
            SyntheticAuth::Bearer { token } => token.clone(),
            _ => panic!("auth shape changed"),
        };
        assert!(token.starts_with("AESenc:"));
        assert_eq!(
            config::utils::encryption::decrypt_secret_value(&dek, &token).unwrap(),
            "hunter2"
        );
        assert_eq!(
            config::utils::encryption::decrypt_secret_value(
                &dek,
                &check.config_secrets["/auth/secret"]
            )
            .unwrap(),
            "s3"
        );
    }

    /// A redelivered message re-encrypts an already-encrypted value; wrapping
    /// it twice would make it undecryptable.
    #[test]
    fn re_applying_does_not_double_wrap() {
        let dek = vec![5u8; 64];
        let mut check = Synthetic {
            auth: Some(SyntheticAuth::Bearer {
                token: "hunter2".into(),
            }),
            ..Default::default()
        };
        encrypt_with(&dek, &mut check).unwrap();
        let once = match check.auth.as_ref().unwrap() {
            SyntheticAuth::Bearer { token } => token.clone(),
            _ => unreachable!(),
        };
        encrypt_with(&dek, &mut check).unwrap();
        match check.auth.as_ref().unwrap() {
            SyntheticAuth::Bearer { token } => assert_eq!(token, &once),
            _ => unreachable!(),
        }
    }

    /// "Unset" must not become ciphertext that decrypts to an empty string.
    #[test]
    fn an_empty_secret_stays_empty() {
        let mut check = Synthetic {
            auth: Some(SyntheticAuth::Bearer {
                token: String::new(),
            }),
            ..Default::default()
        };
        encrypt_with(&[5u8; 64], &mut check).unwrap();
        match check.auth.as_ref().unwrap() {
            SyntheticAuth::Bearer { token } => assert!(token.is_empty()),
            _ => unreachable!(),
        }
        assert!(!has_secret_value(&check));
    }
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::super_cluster::queue::{
        Message, MessageType, SyntheticsMessage,
    };

    use super::*;

    #[tokio::test]
    async fn a_message_from_another_table_is_rejected() {
        // The payload is a perfectly good synthetics write, so only the type
        // check can reject it — a processor that decoded first and asked
        // questions later would apply it. Unlike `alerts.rs` there is no legacy
        // `meta` fallback to hand a stranger to.
        let payload = config::utils::json::to_vec(&SyntheticsMessage::Delete {
            org_id: "org1".to_string(),
            id: "check-1".to_string(),
        })
        .unwrap();
        let msg = Message::new(
            "/synthetics/".to_string(),
            Some(payload.into()),
            None,
            false,
            MessageType::Put,
        );
        let err = process(msg).await.unwrap_err();
        assert!(
            err.to_string().contains("Invalid message type"),
            "expected the type check to reject it, got: {err}"
        );
    }

    #[tokio::test]
    async fn a_malformed_payload_is_an_error_not_a_panic() {
        let msg = Message::new(
            "/synthetics/".to_string(),
            Some(b"not json".to_vec().into()),
            None,
            false,
            MessageType::SyntheticsTable,
        );
        assert!(process(msg).await.is_err());
    }

    #[tokio::test]
    async fn a_payload_less_message_is_an_error_not_a_panic() {
        let msg = Message::new(
            "/synthetics/".to_string(),
            None,
            None,
            false,
            MessageType::SyntheticsTable,
        );
        assert!(process(msg).await.is_err());
    }

    /// The bug this whole slug detour exists for: the incoming `folder_id` is
    /// the origin region's KSUID and satisfies nothing here, so when the slug
    /// is known locally the LOCAL primary key is what gets written.
    #[test]
    fn a_known_slug_resolves_to_this_regions_primary_key() {
        let incoming_pk = "2A1b3C4d5E6f7G8h9I0jK1L2m3N".to_string();
        let local_pk = "9Z8y7X6w5V4u3T2s1R0qP9o8N7m".to_string();

        let action = folder_action("default", Some(local_pk.clone()));

        assert_eq!(action, FolderAction::Use(local_pk.clone()));
        assert_ne!(
            FolderAction::Use(local_pk),
            FolderAction::Use(incoming_pk),
            "the primary key that travelled must never be the one written"
        );
    }

    /// The default folder is created lazily by whichever region a user first
    /// creates a check in, so a receiving region legitimately has none. Waiting
    /// for it to replicate would wait forever — nothing publishes it.
    #[test]
    fn a_missing_default_folder_is_created_here_rather_than_waited_for() {
        assert_eq!(
            folder_action(DEFAULT_FOLDER, None),
            FolderAction::CreateDefault
        );
    }

    /// Any other folder does replicate, on the folders topic. Erroring leaves
    /// the message unacked so it redelivers after the folder arrives; inventing
    /// the folder instead would give this region one the origin never had.
    #[test]
    fn a_missing_named_folder_makes_the_message_redeliver() {
        assert_eq!(folder_action("team-a", None), FolderAction::Missing);
    }

    /// An empty slug means the producer predates the field. The apply must fall
    /// back to what it did before rather than resolving `""` — which would be
    /// `Missing`, and would stall every message from an older region.
    #[test]
    fn an_absent_slug_is_not_treated_as_a_folder_named_nothing() {
        assert_eq!(folder_action("", None), FolderAction::Missing);
        // …which is why both call sites test the slug before resolving it.
        // Assembled at runtime so this assertion cannot match its own text.
        let guard = ["folder_slug", "is_empty()"].join(".");
        let source = include_str!("synthetics.rs");
        assert_eq!(
            source.matches(&guard).count(),
            2,
            "create and update must both guard the resolve on a non-empty slug"
        );
    }

    /// The one hazard this file exists to avoid.
    ///
    /// The publish lives one layer up, in the enterprise synthetics service,
    /// because `infra` cannot reach the enterprise crate at all (`o2_enterprise`
    /// depends on `infra`, so the reverse edge would be a cycle). Applying a
    /// replicated write through that upper layer would publish it straight back
    /// out and the regions would hand the same edit around forever. The
    /// `source_cluster` check in `subscribe()` does not save us: it only stops a
    /// region re-consuming its *own* message, not region A re-publishing what it
    /// applied from region B.
    #[test]
    fn the_processor_applies_below_the_publishing_layer() {
        let source = include_str!("synthetics.rs");
        // Assembled at runtime; spelling these out as literals would put them
        // in this file and make the assertions fail on themselves.
        for layer in [
            ["synthetics", "service"].join("::"),
            ["queue", "synthetics_check"].join("::"),
            // The crate the service now lives in, not just the module path.
            // `openobserve-synthetics` is deliberately absent from this crate's
            // dependencies, so this can only ever fire if someone adds it — at
            // which point the loop-prevention guarantee has stopped being a
            // property of the crate graph and become a convention.
            ["openobserve", "synthetics"].join("_"),
        ] {
            assert!(
                !source.contains(&layer),
                "{layer} publishes what it writes; applying through it loops"
            );
        }
    }

    /// A real sqlite holding just the checks table, so the apply below is
    /// measured against what a database actually does rather than against a
    /// queued `rows_affected`. One connection, because separate connections to
    /// `sqlite::memory:` get separate databases.
    async fn db_with_a_check(status: i32) -> sea_orm::DatabaseConnection {
        use infra::table::entity::synthetics_checks::{ActiveModel, Entity, Model};
        use sea_orm::{ActiveModelTrait, ConnectOptions, ConnectionTrait, Database, Schema};

        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(&schema.create_table_from_entity(Entity)))
            .await
            .unwrap();

        let model = Model {
            id: "check-1".to_string(),
            org_id: "org1".to_string(),
            folder_id: "folder-1".to_string(),
            tz_offset: 0,
            name: "Login Flow".to_string(),
            synthetics_type: "browser".to_string(),
            target: "https://app.example.com".to_string(),
            description: String::new(),
            tags: serde_json::json!([]),
            config: serde_json::json!({"browser_devices": [], "steps": []}),
            frequency: serde_json::json!({"type": "minutes", "interval": 5, "cron": ""}),
            locations: serde_json::json!(["aws-us-east-1"]),
            enabled: true,
            destinations: serde_json::json!([]),
            settings: serde_json::json!({}),
            secrets: "{}".to_string(),
            next_run_at: 0,
            last_triggered_at: 0,
            last_check_status: status,
            consecutive_failures: 0,
            last_alert_at: 0,
            alerting: false,
            degraded_notified_at: 0,
            owner: None,
            created_at: 0,
            updated_at: 0,
        };
        // `reset_all` because `From<Model>` marks every field `Unchanged`, which
        // an INSERT would skip.
        let am: ActiveModel = model.into();
        am.reset_all().insert(&db).await.unwrap();
        db
    }

    async fn stored_status(db: &sea_orm::DatabaseConnection, id: &str) -> i32 {
        use sea_orm::EntityTrait;
        infra::table::entity::synthetics_checks::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .last_check_status
    }

    /// The bug this variant exists for: only the region that ran the check
    /// writes `last_check_status`, so before this the LIST in every other region
    /// said "Unknown" for a check whose own detail page — federated search over
    /// the results stream — reported it as passing.
    #[tokio::test]
    async fn a_status_message_lands_on_the_local_row() {
        let db = db_with_a_check(0).await;

        apply_last_check_status(&db, "org1", "check-1", 1)
            .await
            .unwrap();

        assert_eq!(stored_status(&db, "check-1").await, 1);
    }

    /// The queue redelivers, so the same message arrives more than once. The
    /// apply has to be a no-op the second time rather than something that has to
    /// remember what it already did.
    #[tokio::test]
    async fn a_redelivered_status_message_changes_nothing() {
        let db = db_with_a_check(0).await;

        for _ in 0..3 {
            apply_last_check_status(&db, "org1", "check-1", 3)
                .await
                .unwrap();
        }

        assert_eq!(stored_status(&db, "check-1").await, 3);
    }

    /// Deliberately unlike `SetEnabled`, which errors on a missing row. A status
    /// that outran its create, or arrived after a delete, is cosmetic — erroring
    /// would redeliver a message about a check that does not exist here until it
    /// dead-lettered, and the check's next flip republishes it anyway.
    #[tokio::test]
    async fn a_status_for_a_check_that_is_not_here_is_not_an_error() {
        let db = db_with_a_check(1).await;

        apply_last_check_status(&db, "org1", "no-such-check", 3)
            .await
            .expect("a missing row must be acked, not redelivered forever");

        assert_eq!(
            stored_status(&db, "check-1").await,
            1,
            "and it must not have written some other row"
        );
    }

    /// The type check has to reject a status message on the wrong `MessageType`
    /// too. `SetLastCheckStatus` is the only variant a run can produce, so it is
    /// also the one most likely to be published from somewhere new.
    #[tokio::test]
    async fn a_status_message_on_the_wrong_message_type_is_rejected() {
        let payload = config::utils::json::to_vec(&SyntheticsMessage::SetLastCheckStatus {
            org_id: "org1".to_string(),
            id: "check-1".to_string(),
            status: 1,
        })
        .unwrap();
        let msg = Message::new(
            "/synthetics/".to_string(),
            Some(payload.into()),
            None,
            false,
            MessageType::Put,
        );
        let err = process(msg).await.unwrap_err();
        assert!(
            err.to_string().contains("Invalid message type"),
            "expected the type check to reject it, got: {err}"
        );
    }

    /// The runtime tables are region-owned (`synthetics_jobs` is a lease queue,
    /// `synthetics_runs` holds a counter, `synthetics_agents` is liveness for
    /// agents that long-poll one region). Two regions holding copies is a
    /// correctness failure, not a cost one — so this processor must not be able
    /// to write them even if a message somehow asked it to.
    #[test]
    fn the_processor_never_writes_a_runtime_table() {
        let source = include_str!("synthetics.rs");
        for table in ["jobs", "runs", "agents"] {
            let path = ["table", &["synthetics_", table].concat()].join("::");
            assert!(
                !source.contains(&path),
                "{path} is region-owned and must never be applied from a message"
            );
        }
    }
}
