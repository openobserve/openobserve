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

use config::{
    meta::oncall::{ChatInstall, ChatMessage, ChatMessageKind, ChatMessageStatus, Response},
    utils::time::now_micros,
};
use infra::{errors::Result, table};
use o2_enterprise::enterprise::{
    oncall::chat::sync::{ARM_LATER_MICROS, arm_slack_sync},
    super_cluster::queue::{Message, OncallMessage},
};

/// What a replicated PUT carrying a plaintext secret does in this region.
#[derive(Debug, PartialEq)]
enum SecretPutAction {
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
            let known = stored_before(&response).await;
            table::super_cluster_oncall::put_response(&response).await?;
            // SY-1: in the page's home region a new page updates Slack now, any other change later.
            if let Some(known) = known {
                let delay = if known { ARM_LATER_MICROS } else { 0 };
                arm_slack_sync(&response, now_micros() + delay).await;
            }
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
            id,
            org_id,
            user_email,
            phone,
            phone_verified_at,
        } => {
            log::debug!("[SUPER_CLUSTER:oncall] Put contact org={org_id} user={user_email}");
            table::super_cluster_oncall::put_contact(
                &id,
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
        OncallMessage::ChatInstallPut {
            id,
            org_id,
            platform,
            workspace_id,
            workspace_name,
            enterprise_id,
            app_id,
            bot_user_id,
            scopes,
            status,
            installed_by,
            installed_at,
            updated_at,
            bot_token,
        } => {
            let install = ChatInstall {
                id,
                org_id,
                platform,
                workspace_id,
                workspace_name,
                enterprise_id,
                app_id,
                bot_user_id,
                // Replaced by this region's seal of `bot_token` before the row is written.
                bot_token_cipher: String::new(),
                scopes,
                status,
                installed_by,
                installed_at,
                updated_at,
            };
            put_chat_install(&install, &bot_token.0).await?;
        }
        OncallMessage::ChatInstallDelete {
            org_id,
            platform,
            workspace_id,
            id,
            updated_at,
            installed_at,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Delete chat install org={org_id} workspace={workspace_id} id={id}"
            );
            table::oncall_chat_installs::delete_replica(
                &org_id,
                platform,
                &workspace_id,
                updated_at,
                installed_at,
            )
            .await?;
        }
        OncallMessage::ChatIdentityPut { identity } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put chat link org={} id={}",
                identity.org_id,
                identity.id
            );
            table::oncall_chat_identities::put_replica(&identity).await?;
        }
        OncallMessage::ChatMessagePut { message } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put chat message response={} id={}",
                message.response_id,
                message.id
            );
            table::oncall_chat_messages::put_replica(&message).await?;
            arm_for_queued_dm(&message).await;
        }
    }
    Ok(())
}

// Whether a replicated page was here before its put; None arms nothing (Slack off, read failed).
async fn stored_before(response: &Response) -> Option<bool> {
    if !slack_on() {
        return None;
    }
    match table::oncall_responses::get(&response.org_id, &response.id).await {
        Ok(found) => Some(found.is_some()),
        Err(e) => {
            log::error!(
                "[SUPER_CLUSTER:oncall] no Slack sync for {}: {e}",
                response.id
            );
            None
        }
    }
}

// SY-1: a DM queued by a step in another region is a new step, so its page syncs now.
async fn arm_for_queued_dm(message: &ChatMessage) {
    if !slack_on()
        || message.kind != ChatMessageKind::Dm
        || message.status != ChatMessageStatus::Queued
    {
        return;
    }
    match table::oncall_responses::get(&message.org_id, &message.response_id).await {
        Ok(Some(page)) => arm_slack_sync(&page, now_micros()).await,
        Ok(None) => {}
        Err(e) => log::error!(
            "[SUPER_CLUSTER:oncall] no Slack sync for {}: {e}",
            message.response_id
        ),
    }
}

// Whether the deployment has Slack on (IN-1); off, replicated changes read nothing to arm.
fn slack_on() -> bool {
    o2_enterprise::enterprise::common::config::get_config()
        .oncall
        .slack_is_set()
}

/// Stores the install, or logs and skips it with no AES key. [weak: as `put_replica_with_token`]
async fn put_chat_install(install: &ChatInstall, bot_token: &str) -> Result<()> {
    match secret_put_action(table::cipher::is_encrypting()) {
        SecretPutAction::Store => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put chat install org={} workspace={}",
                install.org_id,
                install.workspace_id
            );
            table::oncall_chat_installs::put_replica_with_token(install, bot_token).await?;
        }
        // Erroring would block the queue forever; the source region keeps the install.
        SecretPutAction::SkipNoKey => log::error!(
            "[SUPER_CLUSTER:oncall] chat install for org={} not stored: O2_MASTER_ENCRYPTION_KEY is not set in AES mode",
            install.org_id
        ),
    }
    Ok(())
}

/// Stores the account, or logs and skips it with no AES key. [weak: as `org_telephony::put`]
async fn put_telephony_account(
    org_id: &str,
    account: &table::org_telephony::StoredAccount,
) -> Result<()> {
    match secret_put_action(table::cipher::is_encrypting()) {
        SecretPutAction::Store => {
            log::debug!("[SUPER_CLUSTER:oncall] Put telephony account org={org_id}");
            table::org_telephony::put(org_id, account, config::utils::time::now_micros()).await?;
        }
        // Erroring would block the queue forever; the source region keeps the account.
        SecretPutAction::SkipNoKey => log::error!(
            "[SUPER_CLUSTER:oncall] telephony account for org={org_id} not stored: O2_MASTER_ENCRYPTION_KEY is not set in AES mode"
        ),
    }
    Ok(())
}

/// Decides whether a replicated secret can be stored here. [pure]
fn secret_put_action(encrypting: bool) -> SecretPutAction {
    if encrypting {
        SecretPutAction::Store
    } else {
        SecretPutAction::SkipNoKey
    }
}

#[cfg(test)]
mod tests {
    use config::meta::oncall::ChatPlatform;
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
            // SAFETY: the single-threaded body of a `OnceCell` initialiser, before the refreshes.
            unsafe {
                std::env::set_var("ZO_WEB_URL", "https://o2.example");
                std::env::set_var("O2_ONCALL_SLACK_CLIENT_ID", "test-client");
                std::env::set_var("O2_ONCALL_SLACK_CLIENT_SECRET", "test-secret");
                std::env::set_var("O2_ONCALL_SLACK_SIGNING_SECRET", "test-signing");
            }
            // Slack on (IN-1), so replicated changes arm.
            config::refresh_config().expect("config");
            o2_enterprise::enterprise::common::config::refresh_config().expect("enterprise config");
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
            r#"{{"ContactPut":{{"id":"c_1","org_id":"{org}","user_email":"ana@o2.ai","phone":"+15550100","phone_verified_at":700}}}}"#
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
    fn a_secret_put_is_stored_only_when_encrypting() {
        for (encrypting, expected) in [
            (true, SecretPutAction::Store),
            (false, SecretPutAction::SkipNoKey),
        ] {
            assert_eq!(secret_put_action(encrypting), expected, "{encrypting}");
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

    /// FL-2: the stored install holds a seal of the wire token that opens back to it.
    #[tokio::test]
    async fn a_replicated_chat_install_is_resealed_and_its_delete_removes_it() {
        meta_store().await;
        encrypting();
        let org = format!("org_{}", config::ider::uuid());
        let workspace = format!("T_{}", config::ider::uuid());
        let key = format!("/oncall/{org}/chat/installs/{workspace}");
        let put = format!(
            r#"{{"ChatInstallPut":{{"id":"{workspace}","org_id":"{org}","platform":"slack","workspace_id":"{workspace}","workspace_name":"Acme","app_id":"A1","bot_user_id":"U0BOT","scopes":"chat:write","status":"active","installed_by":"ana@o2.ai","installed_at":100,"updated_at":100,"bot_token":"xoxb-wire-secret"}}}}"#
        );

        process(oncall_msg(&key, &put)).await.unwrap();

        let stored = table::oncall_chat_installs::get_for_org(&org, ChatPlatform::Slack)
            .await
            .unwrap()
            .expect("the put stored the install");
        assert!(!stored.bot_token_cipher.contains("xoxb-wire-secret"));
        assert_eq!(
            table::oncall_chat_installs::bot_token(&stored)
                .await
                .unwrap(),
            "xoxb-wire-secret"
        );

        let delete = format!(
            r#"{{"ChatInstallDelete":{{"org_id":"{org}","platform":"slack","workspace_id":"{workspace}","id":"{workspace}","updated_at":100,"installed_at":100}}}}"#
        );
        process(oncall_msg(&key, &delete)).await.unwrap();

        assert!(
            table::oncall_chat_installs::get_for_org(&org, ChatPlatform::Slack)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn chat_identity_and_message_puts_apply() {
        meta_store().await;
        let org = format!("org_{}", config::ider::uuid());
        let response = format!("r_{}", config::ider::uuid());
        let identity = format!(
            r#"{{"ChatIdentityPut":{{"identity":{{"id":"{org}","org_id":"{org}","platform":"slack","workspace_id":"T1","platform_user_id":"U1","user_email":"ana@o2.ai","linked_at":100,"changed_at":100}}}}}}"#
        );
        let message = format!(
            r#"{{"ChatMessagePut":{{"message":{{"id":"{response}","org_id":"{org}","response_id":"{response}","team_id":"team_1","ladder_run":1,"platform":"slack","workspace_id":"T1","channel_id":"C1","kind":"room","status":"queued","rendered":"[]","created_at":100,"updated_at":100}}}}}}"#
        );

        process(oncall_msg(
            &format!("/oncall/{org}/chat/identities/l1"),
            &identity,
        ))
        .await
        .unwrap();
        process(oncall_msg(
            &format!("/oncall/{org}/chat/messages/m1"),
            &message,
        ))
        .await
        .unwrap();

        let link =
            table::oncall_chat_identities::get_for_user(&org, ChatPlatform::Slack, "T1", "U1")
                .await
                .unwrap()
                .expect("the put stored the link");
        assert_eq!(link.user_email, "ana@o2.ai");
        let rows = table::oncall_chat_messages::list_for_response(&response)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
    }
    #[tokio::test]
    async fn sy1_a_replicated_change_arms_the_slack_sync_by_what_it_is() {
        use config::meta::{
            oncall::{
                ChatMessage, ChatPlatform, ResponderRole, Response, ResponseState,
                subject::{SubjectRef, SubjectType},
            },
            triggers::TriggerModule,
        };

        meta_store().await;
        let org = format!("org_{}", config::ider::uuid());
        let id = format!("r_{}", config::ider::uuid());
        let page = |state| Response {
            id: id.clone(),
            org_id: org.clone(),
            subject: SubjectRef::new(SubjectType::Alert, &id, 1),
            team_id: Some("team_1".to_string()),
            title: Some("Disk full".to_string()),
            cause: None,
            cause_note: None,
            snoozed_until: None,
            ladder_anchor: None,
            ladder_run: Some(1),
            priority: 2,
            responder_role: ResponderRole::Owner,
            origin_response_id: None,
            state,
            opened_at: 1,
            acked_by: None,
            acked_at: None,
            closed_at: None,
            incident_id: None,
            exhausted_at: None,
            home_region: None,
            updated_at: 1,
        };
        let message = |kind, status| ChatMessage {
            id: config::ider::uuid(),
            org_id: org.clone(),
            response_id: id.clone(),
            team_id: "team_1".to_string(),
            ladder_run: 1,
            platform: ChatPlatform::Slack,
            workspace_id: "T1".to_string(),
            channel_id: "U1".to_string(),
            message_ts: None,
            permalink: None,
            kind,
            recipient: Some("U1".to_string()),
            status,
            rendered: String::new(),
            created_at: 1,
            updated_at: 1,
        };
        let armed_at = || async {
            infra::scheduler::get(&org, TriggerModule::OncallSlackSync, &id)
                .await
                .ok()
                .map(|t| t.next_run_at)
        };
        let disarm = || async {
            infra::scheduler::delete(&org, TriggerModule::OncallSlackSync, &id)
                .await
                .unwrap();
        };
        // (case, message, whether it arms, its delay)
        let cases = [
            (
                "new page",
                OncallMessage::ResponsePut {
                    response: Box::new(page(ResponseState::Triggered)),
                },
                true,
                0,
            ),
            (
                "ack of a stored page",
                OncallMessage::ResponsePut {
                    response: Box::new(page(ResponseState::Acknowledged)),
                },
                true,
                ARM_LATER_MICROS,
            ),
            (
                "queued DM",
                OncallMessage::ChatMessagePut {
                    message: Box::new(message(ChatMessageKind::Dm, ChatMessageStatus::Queued)),
                },
                true,
                0,
            ),
            (
                "sent DM",
                OncallMessage::ChatMessagePut {
                    message: Box::new(message(ChatMessageKind::Dm, ChatMessageStatus::Sent)),
                },
                false,
                0,
            ),
            (
                "room row",
                OncallMessage::ChatMessagePut {
                    message: Box::new(message(ChatMessageKind::Room, ChatMessageStatus::Sent)),
                },
                false,
                0,
            ),
        ];
        for (case, msg, arms, delay) in cases {
            disarm().await;
            let before = now_micros();
            process_msg(msg).await.unwrap();
            let window = before + delay..=now_micros() + delay;
            match armed_at().await {
                Some(at) => assert!(arms && window.contains(&at), "{case}: {at}"),
                None => assert!(!arms, "{case}: not armed"),
            }
        }
        // A resolve replicated right after the ack keeps the ack's time: one pass, one edit.
        disarm().await;
        process_msg(OncallMessage::ResponsePut {
            response: Box::new(page(ResponseState::Acknowledged)),
        })
        .await
        .unwrap();
        let ack = armed_at().await;
        process_msg(OncallMessage::ResponsePut {
            response: Box::new(page(ResponseState::Resolved)),
        })
        .await
        .unwrap();
        assert_eq!(armed_at().await, ack);
    }
}
