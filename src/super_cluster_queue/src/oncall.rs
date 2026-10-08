// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Super-cluster queue processor for on-call state.
//!
//! Replicates everything the escalation engine reads: teams and their
//! membership, schedules, escalation policies, ownership rules, response
//! records and their timelines.
//!
//! On-call keeps no state in `Trigger.data` — every fact lives in a table. A
//! replicated escalation trigger therefore names a response id and nothing
//! else, and the trigger sync path in `scheduler.rs` will not push a timer for a
//! record the receiving region has never seen. Without these messages that check
//! fails for every replicated trigger, and the failover the design promises
//! resumes nothing.
//!
//! Every handler is an id-preserving upsert or a delete of something that may
//! already be gone, so a redelivery changes nothing. Ids come from the source
//! region and are never regenerated — the id IS the join between a trigger and
//! its record.

use infra::{errors::Result, table};
use o2_enterprise::enterprise::super_cluster::queue::{Message, OncallMessage};

/// What a replicated telephony account PUT does in this region.
#[derive(Debug, PartialEq)]
enum TelephonyPutAction {
    Store,
    SkipNoKey,
}

/// Applies a decodable on-call message, drops the rest. [weak: dropped; the next save re-sends it]
pub(crate) async fn process(msg: Message) -> Result<()> {
    let key = msg.key.clone();
    match OncallMessage::try_from(msg) {
        Ok(msg) => process_msg(msg).await,
        // The consumer acks only on Ok, so an error here would block the queue on a newer variant.
        Err(e) => {
            log::warn!("[SUPER_CLUSTER:oncall] dropped undecodable message key={key}: {e}");
            Ok(())
        }
    }
}

pub(crate) async fn process_msg(msg: OncallMessage) -> Result<()> {
    match msg {
        OncallMessage::TeamPut { team } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put team org={} id={}",
                team.org_id,
                team.id
            );
            table::super_cluster_oncall::put_team(&team).await?;
        }
        OncallMessage::TeamDelete { org_id, team_id } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete team org={org_id} id={team_id}");
            // The source region refuses to delete a team that is its default,
            // so this should never fire — but a replica that somehow holds a
            // stale nomination would otherwise route every unclaimed signal at
            // a team it no longer has, which is a page that goes nowhere and
            // looks routed. Clearing first is cheap and cannot be wrong.
            table::oncall_routing_config::clear_if_default_team(&org_id, &team_id).await?;
            // Deleting a team that is already gone is a no-op, which is what
            // makes a redelivered delete harmless.
            table::oncall_teams::delete(&org_id, &team_id).await?;
        }
        OncallMessage::MembersPut { team_id, members } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put {} member(s) for team={team_id}",
                members.len()
            );
            table::super_cluster_oncall::put_members(&team_id, &members).await?;
        }
        OncallMessage::SchedulePut { schedule } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put schedule org={} team={}",
                schedule.org_id,
                schedule.team_id
            );
            table::super_cluster_oncall::put_schedule(&schedule).await?;
        }
        OncallMessage::ScheduleDelete { org_id, team_id } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete schedule org={org_id} team={team_id}");
            table::oncall_schedules::delete_by_team(&org_id, &team_id).await?;
        }
        OncallMessage::PolicyPut { policy } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put policy org={} team={}",
                policy.org_id,
                policy.team_id
            );
            table::super_cluster_oncall::put_policy(&policy).await?;
        }
        OncallMessage::PolicyDelete { org_id, team_id } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete policy org={org_id} team={team_id}");
            table::oncall_policies::delete_by_team(&org_id, &team_id).await?;
        }
        OncallMessage::OverridePut { record } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put override org={} team={} id={}",
                record.org_id,
                record.team_id,
                record.id
            );
            table::super_cluster_oncall::put_override(&record).await?;
        }
        OncallMessage::OverrideDelete {
            org_id,
            override_id,
        } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete override org={org_id} id={override_id}");
            // Deleting a cover that is already gone is a no-op, which is what
            // makes a redelivered delete harmless.
            table::oncall_overrides::delete(&org_id, &override_id).await?;
        }
        OncallMessage::OwnershipPut { rule } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put ownership rule org={} id={}",
                rule.org_id,
                rule.id
            );
            table::super_cluster_oncall::put_ownership_rule(&rule).await?;
        }
        OncallMessage::OwnershipDelete { org_id, rule_id } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete ownership rule org={org_id} id={rule_id}");
            table::oncall_ownership::delete(&org_id, &rule_id).await?;
        }
        OncallMessage::RoutingConfigPut { config } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put routing config org={} default_team={:?}",
                config.org_id,
                config.default_team_id
            );
            table::super_cluster_oncall::put_routing_config(&config).await?;
        }
        OncallMessage::ResponsePut { response } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put response org={} id={} state={:?}",
                response.org_id,
                response.id,
                response.state
            );
            table::super_cluster_oncall::put_response(&response).await?;
        }
        OncallMessage::ResponseEventPut { response_id, event } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put timeline entry response={response_id} kind={:?}",
                event.kind
            );
            table::super_cluster_oncall::put_event(&response_id, &event).await?;
        }
        OncallMessage::UnavailabilityPut { record } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put absence org={} user={} id={}",
                record.org_id,
                record.user_email,
                record.id
            );
            table::super_cluster_oncall::put_unavailability(&record).await?;
        }
        OncallMessage::UnavailabilityDelete {
            org_id,
            unavailability_id,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Delete absence org={org_id} id={unavailability_id}"
            );
            // Deleting an absence that is already gone is a no-op, which is
            // what makes a redelivered delete harmless.
            table::oncall_unavailability::delete(&org_id, &unavailability_id).await?;
        }
        OncallMessage::UnavailabilityClearedForUser { org_id, user_email } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Clear every absence org={org_id} user={user_email}"
            );
            table::super_cluster_oncall::clear_unavailability_for_user(&org_id, &user_email)
                .await?;
        }
        OncallMessage::ContactPut {
            org_id,
            user_email,
            phone,
            phone_verified_at,
        } => {
            log::debug!("[SUPER_CLUSTER:oncall] Put contact org={org_id} user={user_email}");
            table::super_cluster_oncall::put_contact(
                &org_id,
                &user_email,
                phone,
                phone_verified_at,
            )
            .await?;
        }
        OncallMessage::ContactDelete { org_id, user_email } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete contact org={org_id} user={user_email}");
            table::oncall_user_contacts::delete(&org_id, &user_email).await?;
        }
        OncallMessage::TelephonyAccountPut {
            org_id,
            provider,
            account_sid,
            auth_token,
            from_number,
        } => {
            let account = table::org_telephony::StoredAccount {
                provider,
                account_sid,
                auth_token: auth_token.0,
                from_number,
            };
            put_telephony_account(&org_id, &account).await?;
        }
        OncallMessage::TelephonyAccountDelete { org_id } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete telephony account org={org_id}");
            table::org_telephony::delete(&org_id).await?;
        }
    }
    Ok(())
}

/// Stores the account, or logs and skips it with no AES key. [weak: as `org_telephony::put`]
async fn put_telephony_account(
    org_id: &str,
    account: &table::org_telephony::StoredAccount,
) -> Result<()> {
    match telephony_put_action(table::cipher::is_encrypting()) {
        TelephonyPutAction::Store => {
            log::debug!("[SUPER_CLUSTER:oncall] Put telephony account org={org_id}");
            table::org_telephony::put(org_id, account, config::utils::time::now_micros()).await?;
        }
        // Erroring would block the queue forever; the source region keeps the account.
        TelephonyPutAction::SkipNoKey => log::error!(
            "[SUPER_CLUSTER:oncall] telephony account for org={org_id} not stored: O2_MASTER_ENCRYPTION_KEY is not set in AES mode"
        ),
    }
    Ok(())
}

/// Decides whether a replicated telephony account can be stored here. [pure]
fn telephony_put_action(encrypting: bool) -> TelephonyPutAction {
    if encrypting {
        TelephonyPutAction::Store
    } else {
        TelephonyPutAction::SkipNoKey
    }
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::super_cluster::queue::MessageType;

    use super::*;

    #[tokio::test]
    async fn an_oncall_variant_this_build_cannot_decode_is_acknowledged() {
        let msg = Message::new(
            "/oncall/org1/slack/chan-1".to_string(),
            Some(br#"{"SlackChannelPut":{"token":"xoxb-secret"}}"#.to_vec().into()),
            None,
            true,
            MessageType::OncallTable,
        );
        assert!(process(msg).await.is_ok());
    }

    /// Migrates the meta store once per binary; concurrent SQLite migrations collide.
    async fn meta_store() {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
    }

    fn oncall_msg(key: &str, payload: &str) -> Message {
        Message::new(
            key.to_string(),
            Some(payload.as_bytes().to_vec().into()),
            None,
            true,
            MessageType::OncallTable,
        )
    }

    #[tokio::test]
    async fn contact_put_and_delete_messages_apply() {
        meta_store().await;
        let org = format!("org_{}", config::ider::uuid());
        let key = format!("/oncall/{org}/contacts/ana@o2.ai");
        let put = format!(
            r#"{{"ContactPut":{{"org_id":"{org}","user_email":"ana@o2.ai","phone":"+15550100","phone_verified_at":700}}}}"#
        );

        process(oncall_msg(&key, &put)).await.unwrap();

        let contact = table::oncall_user_contacts::get(&org, "ana@o2.ai")
            .await
            .unwrap()
            .expect("the put inserted the profile");
        assert_eq!(contact.phone.as_deref(), Some("+15550100"));
        assert_eq!(contact.phone_verified_at, Some(700));

        let delete =
            format!(r#"{{"ContactDelete":{{"org_id":"{org}","user_email":"ana@o2.ai"}}}}"#);
        process(oncall_msg(&key, &delete)).await.unwrap();

        assert!(
            table::oncall_user_contacts::get(&org, "ana@o2.ai")
                .await
                .unwrap()
                .is_none()
        );
    }

    /// Installs an AES master key once; it is process-global, so no test here runs keyless.
    fn encrypting() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            table::cipher::install_master_key(Ok(table::cipher::MasterKeyMode::Aes(vec![7; 64])))
                .expect("no other test installs a master key");
        });
    }

    #[test]
    fn a_telephony_put_is_stored_only_when_encrypting() {
        for (encrypting, expected) in [
            (true, TelephonyPutAction::Store),
            (false, TelephonyPutAction::SkipNoKey),
        ] {
            assert_eq!(telephony_put_action(encrypting), expected, "{encrypting}");
        }
    }

    #[tokio::test]
    async fn test_p13_a_replicated_telephony_account_resolves_and_its_delete_removes_it() {
        meta_store().await;
        encrypting();
        let org = format!("org_{}", config::ider::uuid());
        let key = format!("/oncall/{org}/telephony");
        let put = format!(
            r#"{{"TelephonyAccountPut":{{"org_id":"{org}","provider":"twilio","account_sid":"AC123","auth_token":"tok-secret","from_number":"+15550100"}}}}"#
        );

        process(oncall_msg(&key, &put)).await.unwrap();

        let account = table::org_telephony::get(&org)
            .await
            .unwrap()
            .expect("the put stored the account");
        assert_eq!(
            [
                account.provider.as_str(),
                &account.account_sid,
                &account.auth_token,
                &account.from_number
            ],
            ["twilio", "AC123", "tok-secret", "+15550100"]
        );

        let delete = format!(r#"{{"TelephonyAccountDelete":{{"org_id":"{org}"}}}}"#);
        process(oncall_msg(&key, &delete)).await.unwrap();

        assert!(table::org_telephony::get(&org).await.unwrap().is_none());
    }
}
