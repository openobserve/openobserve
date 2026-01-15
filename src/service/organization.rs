// Copyright 2025 OpenObserve Inc.
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

use config::{
    ider,
    meta::{
        alerts::alert::ListAlertsParams,
        dashboards::ListDashboardsParams,
        pipeline::components::PipelineSource,
        self_reporting::usage,
        stream::StreamType,
        user::{UserOrg, UserRole},
    },
    utils::{json, rand::generate_random_string, time},
};
use infra::table::{self, org_users::UserOrgExpandedRecord};
#[cfg(feature = "enterprise")]
use o2_openfga::config::get_config as get_openfga_config;
#[cfg(feature = "cloud")]
use {
    crate::common::meta::organization::{
        OrganizationInviteResponse, OrganizationInviteUserRecord, OrganizationInvites,
    },
    chrono::{Duration, Utc},
    config::{SMTP_CLIENT, get_config},
    lettre::{AsyncTransport, Message, message::SinglePart},
    o2_enterprise::enterprise::cloud::{
        InvitationRecord, OrgInviteStatus, billings::get_billing_by_org_id, org_invites,
    },
};

#[cfg(feature = "cloud")]
use super::self_reporting::cloud_events::{CloudEvent, EventType, enqueue_cloud_event};
use crate::{
    common::{
        infra::config::ORG_USERS,
        meta::organization::{
            AlertSummary, CUSTOM, DEFAULT_ORG, IngestionPasscode, IngestionTokensContainer,
            OrgSummary, Organization, PipelineSummary, RumIngestionToken, StreamSummary,
            TriggerStatus, TriggerStatusSearchResult,
        },
        utils::auth::{delete_org_tuples, is_root_user, save_org_tuples},
    },
    service::{
        db::{self, org_users},
        self_reporting,
        stream::get_streams,
        users::add_admin_to_org,
    },
};

const MASKED_TOKEN: &str = "NOT_AVAILABLE";

/// Checks if a service account token should be masked
/// Returns true if:
/// - The service account has allow_static_token set to false
/// - This prevents exposure of tokens that should only be used via assume_service_account API
fn should_mask_token(org_id: Option<&str>, user_email: &str) -> bool {
    // Check if this user has allow_static_token flag set to false in the requesting org
    if let Some(org) = org_id {
        let key = format!("{}/{}", org, user_email);
        if let Some(user_record) = ORG_USERS.get(&key) {
            return !user_record.allow_static_token;
        }
    }

    false
}

/// Masks a token if necessary based on org context
fn mask_token_if_needed(token: String, org_id: Option<&str>, user_email: &str) -> String {
    if should_mask_token(org_id, user_email) {
        MASKED_TOKEN.to_string()
    } else {
        token
    }
}

#[cfg(feature = "enterprise")]
/// Wrapper function to call o2-enterprise's tenant admin role creation logic
async fn create_and_assign_tenant_admin_role(
    org_id: &str,
    service_account_email: &str,
) -> Result<(), anyhow::Error> {
    o2_openfga::authorizer::roles::create_and_assign_tenant_admin_role(
        org_id,
        service_account_email,
    )
    .await
}

pub async fn get_summary(org_id: &str) -> OrgSummary {
    let streams = get_streams(org_id, None, false, None).await;
    let mut stream_summary = StreamSummary::default();
    let mut has_trigger_stream = false;
    for stream in streams.iter() {
        if stream.name == usage::TRIGGERS_STREAM {
            has_trigger_stream = true;
        }
        if !stream.stream_type.eq(&StreamType::Index)
            && !stream.stream_type.eq(&StreamType::Metadata)
        {
            stream_summary.num_streams += 1;
            stream_summary.total_records += stream.stats.doc_num;
            stream_summary.total_storage_size += stream.stats.storage_size;
            stream_summary.total_compressed_size += stream.stats.compressed_size;
            stream_summary.total_index_size += stream.stats.index_size;
        }
    }

    let trigger_status_results = if !has_trigger_stream {
        vec![]
    } else {
        let sql = format!(
            "SELECT module, status FROM {} WHERE org = '{}' GROUP BY module, status, key",
            usage::TRIGGERS_STREAM,
            org_id
        );
        let end_time = time::now_micros();
        let start_time = end_time - time::second_micros(900); // 15 mins
        self_reporting::search::get_usage(sql, start_time, end_time)
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| json::from_value::<TriggerStatusSearchResult>(v).ok())
            .collect::<Vec<_>>()
    };

    let pipelines = db::pipeline::list_by_org(org_id).await.unwrap_or_default();
    let pipeline_summary = PipelineSummary {
        num_realtime: pipelines
            .iter()
            .filter(|p| matches!(p.source, PipelineSource::Realtime(_)))
            .count() as i64,
        num_scheduled: pipelines
            .iter()
            .filter(|p| matches!(p.source, PipelineSource::Scheduled(_)))
            .count() as i64,
        trigger_status: TriggerStatus::from_search_results(
            &trigger_status_results,
            usage::TriggerDataType::DerivedStream,
        ),
    };

    let alerts = super::alerts::alert::list_with_folders_db(ListAlertsParams::new(org_id))
        .await
        .unwrap_or_default();
    let alert_summary = AlertSummary {
        num_realtime: alerts.iter().filter(|(_, a)| a.is_real_time).count() as i64,
        num_scheduled: alerts.iter().filter(|(_, a)| !a.is_real_time).count() as i64,
        trigger_status: TriggerStatus::from_search_results(
            &trigger_status_results,
            usage::TriggerDataType::Alert,
        ),
    };

    let functions = db::functions::list(org_id).await.unwrap_or_default();
    let dashboards = table::dashboards::list(ListDashboardsParams::new(org_id))
        .await
        .unwrap_or_default();

    OrgSummary {
        streams: stream_summary,
        pipelines: pipeline_summary,
        alerts: alert_summary,
        total_functions: functions.len() as i64,
        total_dashboards: dashboards.len() as i64,
    }
}

pub async fn get_passcode(
    org_id: Option<&str>,
    user_id: &str,
) -> Result<IngestionPasscode, anyhow::Error> {
    let Ok(Some(user)) = db::user::get(org_id, user_id).await else {
        return Err(anyhow::Error::msg("User not found"));
    };
    if user.role.eq(&UserRole::ServiceAccount) && user.is_external {
        return Err(anyhow::Error::msg(
            "Not allowed for external service accounts",
        ));
    }
    let passcode = mask_token_if_needed(user.token, org_id, &user.email);
    Ok(IngestionPasscode {
        user: user.email,
        passcode,
    })
}

pub async fn get_rum_token(
    org_id: Option<&str>,
    user_id: &str,
) -> Result<RumIngestionToken, anyhow::Error> {
    let Ok(Some(user)) = db::user::get(org_id, user_id).await else {
        return Err(anyhow::Error::msg("User not found"));
    };
    Ok(RumIngestionToken {
        user: user.email,
        rum_token: user.rum_token,
    })
}

pub async fn update_rum_token(
    org_id: Option<&str>,
    user_id: &str,
) -> Result<RumIngestionToken, anyhow::Error> {
    let is_rum_update = true;
    match update_passcode_inner(org_id, user_id, is_rum_update).await {
        Ok(IngestionTokensContainer::RumToken(response)) => Ok(response),
        _ => Err(anyhow::Error::msg("User not found")),
    }
}

pub async fn update_passcode(
    org_id: Option<&str>,
    user_id: &str,
) -> Result<IngestionPasscode, anyhow::Error> {
    let is_rum_update = false;
    match update_passcode_inner(org_id, user_id, is_rum_update).await {
        Ok(IngestionTokensContainer::Passcode(response)) => Ok(response),
        Err(e) => Err(e),
        _ => Err(anyhow::Error::msg("User not found")),
    }
}

async fn update_passcode_inner(
    org_id: Option<&str>,
    user_id: &str,
    is_rum_update: bool,
) -> Result<IngestionTokensContainer, anyhow::Error> {
    let mut local_org_id = "";
    let Ok(db_user) = db::user::get_db_user(user_id).await else {
        return Err(anyhow::Error::msg("User not found"));
    };

    if let Some(org_id) = org_id {
        local_org_id = org_id;
    }
    let token = generate_random_string(16);
    let rum_token = format!("rum{}", generate_random_string(16));

    if !is_root_user(user_id) {
        let orgs = db_user
            .organizations
            .iter()
            .filter(|org| org.name.eq(local_org_id))
            .collect::<Vec<&UserOrg>>();
        if orgs.is_empty() {
            return Err(anyhow::Error::msg("User not found"));
        }
        let org_to_update = orgs[0];
        if org_to_update.role.eq(&UserRole::ServiceAccount) && db_user.is_external {
            return Err(anyhow::Error::msg(
                "Not allowed for external service accounts",
            ));
        }
    } else {
        local_org_id = DEFAULT_ORG;
    }

    // Update the org with the new token
    if is_rum_update {
        org_users::update_rum_token(local_org_id, user_id, &rum_token).await?;
    } else {
        org_users::update_token(local_org_id, user_id, &token).await?;
    }

    // TODO : Fix for root users
    let ret = if is_rum_update {
        IngestionTokensContainer::RumToken(RumIngestionToken {
            user: db_user.email.clone(),
            rum_token: Some(rum_token),
        })
    } else {
        let passcode = mask_token_if_needed(token, org_id, &db_user.email);
        IngestionTokensContainer::Passcode(IngestionPasscode {
            user: db_user.email,
            passcode,
        })
    };
    Ok(ret)
}

pub async fn list_all_orgs(limit: Option<i64>) -> Result<Vec<Organization>, anyhow::Error> {
    db::organization::list(limit).await
}

pub async fn list_orgs_by_user(user_email: &str) -> Result<Vec<Organization>, anyhow::Error> {
    let records = db::org_users::list_orgs_by_user(user_email).await?;
    Ok(records
        .into_iter()
        .map(|record| Organization {
            identifier: record.org_id.clone(),
            name: record.org_name.clone(),
            org_type: record.org_type.to_string(),
            service_account: None,
        })
        .collect())
}

pub async fn list_org_users_by_user(
    user_email: &str,
) -> Result<Vec<UserOrgExpandedRecord>, anyhow::Error> {
    db::org_users::list_orgs_by_user(user_email).await
}

/// Always creates a new org. Also, makes the user an admin of the org
pub async fn create_org(
    org: &mut Organization,
    user_email: &str,
) -> Result<
    (
        Organization,
        Option<crate::common::meta::organization::ServiceAccountTokenInfo>,
    ),
    anyhow::Error,
> {
    #[cfg(not(feature = "enterprise"))]
    let is_allowed = false;
    #[cfg(feature = "enterprise")]
    let is_allowed = if get_openfga_config().enabled {
        // In this case, openfga takes care of permission checks
        // If the request reaches here, it means the user is allowed
        true
    } else {
        false
    };
    if !is_allowed && !is_root_user(user_email) {
        return Err(anyhow::anyhow!("Only root user can create organization"));
    }

    #[cfg(feature = "cloud")]
    {
        let orgs = list_orgs_by_user(user_email).await?;
        for org in orgs {
            let billing = get_billing_by_org_id(&org.identifier).await?;
            if billing.is_none() {
                return Err(anyhow::anyhow!(
                    "A user cannot be part of multiple free accounts"
                ));
            }
        }
    }

    org.name = org.name.trim().to_owned();

    let has_valid_chars = org
        .name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '_');
    if !has_valid_chars {
        return Err(anyhow::anyhow!(
            "Only alphanumeric characters (A-Z, a-z, 0-9), spaces, and underscores are allowed"
        ));
    }

    org.identifier = ider::uuid();
    #[cfg(not(feature = "cloud"))]
    let org_type = CUSTOM.to_owned();
    #[cfg(feature = "cloud")]
    let org_type = org.org_type.clone();
    org.org_type = org_type;
    match db::organization::save_org(org).await {
        Ok(_) => {
            save_org_tuples(&org.identifier).await;

            // Determine which user to add to the org
            // If service_account is specified, add it instead of the caller
            if let Some(ref service_account_email) = org.service_account {
                // Validate email format
                if !service_account_email.contains('@') {
                    return Err(anyhow::anyhow!("Invalid service account email format"));
                }

                log::info!(
                    "Creating/adding service account '{}' to organization '{}' (caller: '{}')",
                    service_account_email,
                    org.identifier,
                    user_email
                );

                // Create user record if it doesn't exist as ServiceAccount
                use crate::service::users::create_service_account_if_not_exists;
                create_service_account_if_not_exists(service_account_email).await?;

                // Add service account to the org with ServiceAccount role
                // Set allow_static_token = false to force use of assume_service_account API
                use config::{meta::user::UserRole, utils::rand::generate_random_string};
                let token = generate_random_string(32); // Generate random token (won't be exposed)
                let rum_token = format!("rum{}", generate_random_string(16));

                db::org_users::add_with_flags(
                    &org.identifier,
                    service_account_email,
                    UserRole::ServiceAccount,
                    &token,
                    Some(rum_token),
                    false,
                )
                .await?;

                // Update OpenFGA and create tenant admin role
                #[cfg(feature = "enterprise")]
                {
                    use o2_openfga::authorizer::authz::{
                        get_add_user_to_org_tuples, update_tuples,
                    };
                    if get_openfga_config().enabled {
                        let mut tuples = vec![];
                        get_add_user_to_org_tuples(
                            &org.identifier,
                            service_account_email,
                            &UserRole::ServiceAccount.to_string(),
                            &mut tuples,
                        );
                        match update_tuples(tuples, vec![]).await {
                            Ok(_) => {
                                log::info!("Service account added to org successfully in openfga");
                            }
                            Err(e) => {
                                log::error!(
                                    "Error adding service account to the org in openfga: {e}"
                                );
                            }
                        }

                        // Create tenant admin role and assign service account to it
                        if let Err(e) = create_and_assign_tenant_admin_role(
                            &org.identifier,
                            service_account_email,
                        )
                        .await
                        {
                            log::error!(
                                "Failed to create/assign tenant admin role for '{}' in org '{}': {}",
                                service_account_email,
                                org.identifier,
                                e
                            );
                            // Don't fail org creation if role assignment fails
                            // The org and service account are already created
                        } else {
                            log::info!(
                                "Created and assigned tenant admin role to '{}' in org '{}'",
                                service_account_email,
                                org.identifier
                            );
                        }
                    }
                }
            } else {
                // No service_account provided: add caller as admin to new org
                log::info!(
                    "No service_account provided, adding caller '{}' as admin for organization '{}'",
                    user_email,
                    org.identifier
                );
                add_admin_to_org(&org.identifier, user_email).await?;
            }
            #[cfg(feature = "cloud")]
            enqueue_cloud_event(CloudEvent {
                org_id: org.identifier.clone(),
                org_name: org.name.clone(),
                org_type: org.org_type.clone(),
                user: Some(user_email.to_string()),
                event: EventType::OrgCreated,
                subscription_type: None,
                stream_name: None,
            })
            .await;

            // if service account provided, and that SA is also SA in _meta,
            // send the info in response, else ignore
            let service_account_info = if let Some(sa) = org.service_account.as_ref() {
                // Check if they're a service account in _meta org
                if let Some(meta_user) =
                    crate::service::users::get_user(Some(config::META_ORG_ID), sa).await
                {
                    if meta_user.role == UserRole::ServiceAccount {
                        // Return service account info with instructions to use
                        // assume_service_account API Tokens are no longer
                        // returned directly for security reasons
                        Some(crate::common::meta::organization::ServiceAccountTokenInfo {
                            email: sa.clone(),
                            token: String::new(), // Not returned for security
                            role: UserRole::ServiceAccount.to_string(),
                            message: format!(
                                "Use POST /api/_meta/assume_service_account with org_id='{}' and service_account='{}' to obtain a temporary session token",
                                org.identifier, sa
                            ),
                        })
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            Ok((org.clone(), service_account_info))
        }
        Err(e) => {
            log::error!("Error creating org: {e}");
            Err(anyhow::anyhow!("Error creating org: {}", e))
        }
    }
}

/// Checks if the org exists, otherwise creates the org. Does not associate any user
/// with the org, only saves the org in the meta and creates org tuples.
pub async fn check_and_create_org(org_id: &str) -> Result<Organization, anyhow::Error> {
    let org_id = org_id.trim();
    if let Some(org) = get_org(org_id).await {
        return Ok(org);
    }

    let org = &Organization {
        identifier: org_id.to_owned(),
        name: org_id.to_owned(),
        org_type: if org_id.eq(DEFAULT_ORG) {
            DEFAULT_ORG.to_owned()
        } else {
            CUSTOM.to_owned()
        },
        service_account: None,
    };
    match db::organization::save_org(org).await {
        Ok(_) => {
            save_org_tuples(&org.identifier).await;
            #[cfg(feature = "cloud")]
            enqueue_cloud_event(CloudEvent {
                org_id: org.identifier.clone(),
                org_name: org.name.clone(),
                org_type: org.org_type.clone(),
                user: None,
                subscription_type: None,
                event: EventType::OrgCreated,
                stream_name: None,
            })
            .await;
            Ok(org.clone())
        }
        Err(e) => {
            log::error!("Error creating org: {e}");
            Err(anyhow::anyhow!("Error creating org: {}", e))
        }
    }
}

pub async fn check_and_create_org_without_ofga(
    org_id: &str,
) -> Result<Organization, anyhow::Error> {
    let org_id = org_id.trim();
    if let Some(org) = get_org(org_id).await {
        return Ok(org);
    }

    let org = &Organization {
        identifier: org_id.to_owned(),
        name: org_id.to_owned(),
        org_type: if org_id.eq(DEFAULT_ORG) {
            DEFAULT_ORG.to_owned()
        } else {
            CUSTOM.to_owned()
        },
        service_account: None,
    };
    match db::organization::save_org(org).await {
        Ok(_) => Ok(org.clone()),
        Err(e) => {
            log::error!("Error creating org: {e}");
            Err(anyhow::anyhow!("Error creating org: {}", e))
        }
    }
}

pub async fn rename_org(
    org_id: &str,
    name: &str,
    user_email: &str,
) -> Result<Organization, anyhow::Error> {
    #[cfg(not(feature = "enterprise"))]
    let is_allowed = false;
    #[cfg(feature = "enterprise")]
    let is_allowed = if get_openfga_config().enabled {
        // In this case, openfga takes care of permission checks
        // If the request reaches here, it means the user is allowed
        true
    } else {
        false
    };
    if !is_allowed && !is_root_user(user_email) {
        return Err(anyhow::anyhow!("Not allowed to rename org"));
    }

    let has_valid_chars = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '_');
    if !has_valid_chars {
        return Err(anyhow::anyhow!(
            "Only alphanumeric characters (A-Z, a-z, 0-9), spaces, and underscores are allowed"
        ));
    }

    if get_org(org_id).await.is_none() {
        return Err(anyhow::anyhow!("Organization doesn't exist"));
    }
    match db::organization::rename_org(org_id, name).await {
        Ok(org) => Ok(org),
        Err(e) => {
            log::error!("Error creating org: {e}");
            Err(anyhow::anyhow!("Error creating org: {}", e))
        }
    }
}

pub async fn remove_org(org_id: &str) -> Result<(), anyhow::Error> {
    if org_id.eq(DEFAULT_ORG) {
        return Err(anyhow::anyhow!("Cannot delete default organization"));
    }

    match db::organization::delete_org(org_id).await {
        Ok(_) => {
            delete_org_tuples(org_id).await;
            #[cfg(feature = "cloud")]
            {
                let org = match get_org(org_id).await {
                    Some(org) => org,
                    None => return Err(anyhow::anyhow!("Organization does not exist")),
                };
                enqueue_cloud_event(CloudEvent {
                    org_id: org.identifier.clone(),
                    org_name: org.name.clone(),
                    org_type: org.org_type.clone(),
                    user: None,
                    subscription_type: None,
                    event: EventType::OrgDeleted,
                    stream_name: None,
                })
                .await;
            }
            Ok(())
        }
        Err(e) => {
            log::error!("Error deleting org: {e}");
            Err(anyhow::anyhow!("Error deleting org: {}", e))
        }
    }
}

#[cfg(feature = "cloud")]
pub async fn get_invitations_for_org(
    org_id: &str,
) -> Result<Vec<OrganizationInviteUserRecord>, anyhow::Error> {
    use crate::common::meta::user::InviteStatus;

    let invites = org_invites::get_invite_list_for_org(org_id).await?;
    Ok(invites
        .into_iter()
        .map(|invite| OrganizationInviteUserRecord {
            email: invite.invitee_id,
            first_name: "".to_owned(),
            last_name: "".to_owned(),
            status: InviteStatus::from(&invite.status),
            expires_at: invite.expires_at,
            is_external: true,
            role: invite.role,
            token: invite.token,
        })
        .collect())
}

#[cfg(feature = "cloud")]
pub async fn delete_invite_by_token(org_id: &str, token: &str) -> Result<(), anyhow::Error> {
    org_invites::delete_invite_by_token(org_id, token).await?;
    Ok(())
}

#[cfg(feature = "cloud")]
pub async fn generate_invitation(
    org_id: &str,
    user_email: &str,
    invites: OrganizationInvites,
) -> Result<OrganizationInviteResponse, anyhow::Error> {
    use org_invites::{get_invite_email_body, get_invite_email_subject};

    use super::users::get_user;

    let mut inviter_name = "".to_owned();
    let cfg = get_config();
    if !is_root_user(user_email) {
        match get_user(Some(org_id), user_email).await {
            Some(user) => {
                inviter_name = format!("{} {}", user.first_name, user.last_name);
                if !(user.role.eq(&UserRole::Admin) || user.role.eq(&UserRole::Root)) {
                    return Err(anyhow::anyhow!("Unauthorized access"));
                }
            }
            None => return Err(anyhow::anyhow!("Unauthorized access")),
        }
    }
    for invitee in &invites.invites {
        match get_user(Some(org_id), invitee).await {
            None => {}
            Some(_) => {
                return Err(anyhow::anyhow!(
                    "user with email {invitee} already part of the organization"
                ));
            }
        }

        if o2_enterprise::enterprise::cloud::email::check_email(invitee)
            .await
            .is_err()
        {
            return Err(anyhow::anyhow!("Email Domain not allowed for {invitee}"));
        }

        if get_billing_by_org_id(org_id).await?.is_none() {
            // If the org we are inviting to is paid, its fine to send invitations
            // irrespective of what other orgs invitees are part of.
            // if it is a free org, we must check that the orgs invitee is already part
            // of are all paid, as one user cannot be part of more than one free org.
            let invitee_orgs = list_orgs_by_user(invitee).await?;
            for org in invitee_orgs {
                if get_billing_by_org_id(&org.identifier).await?.is_none() {
                    return Err(anyhow::anyhow!(
                        "Invitee {invitee} is already part of another free org, cannot be invited in this org"
                    ));
                }
            }
        }
    }
    if let Some(org) = get_org(org_id).await {
        let expires_at = Utc::now().timestamp_micros()
            + Duration::days(cfg.common.org_invite_expiry as i64)
                .num_microseconds()
                .unwrap();

        org_invites::add_many(
            &invites.role.to_string(),
            user_email,
            org_id,
            expires_at,
            invites.invites.clone(),
        )
        .await?;

        if cfg.smtp.smtp_enabled {
            // TODO: Use an env to decide whether to send email or not
            let mut email = Message::builder()
                .from(cfg.smtp.smtp_from_email.parse()?)
                .subject(get_invite_email_subject(&org.name));
            for invite in invites.invites.iter() {
                email = email.to(invite.parse()?);
            }
            if !cfg.smtp.smtp_reply_to.is_empty() {
                email = email.reply_to(cfg.smtp.smtp_reply_to.parse()?);
            }
            let msg =
                get_invite_email_body(org_id, &org.name, &inviter_name, invites.role, expires_at);
            let email = email.singlepart(SinglePart::html(msg)).unwrap();

            // Send the email
            match SMTP_CLIENT.as_ref().unwrap().send(email).await {
                Ok(resp) => {
                    log::info!("sent invite email response code: {}", resp.code());
                }
                Err(e) => {
                    log::error!("Error sending email for invitation: {}", e);
                }
            }
        }
        Ok(OrganizationInviteResponse {
            data: Default::default(),
            message: "Member invitation created successfully".to_owned(),
        })
    } else {
        Err(anyhow::anyhow!("Organization doesn't exist"))
    }
}

#[cfg(feature = "cloud")]
pub async fn accept_invitation(user_email: &str, invite_token: &str) -> Result<(), anyhow::Error> {
    use std::str::FromStr;

    use crate::service::db::org_users::get_cached_user_org;

    let invite = org_invites::get_by_token_user(invite_token, user_email)
        .await
        .map_err(|e| {
            log::info!("error getting token {invite_token} for email {user_email} : {e}");
            anyhow::anyhow!("Provided Token is not valid for this email id")
        })?;

    let now = chrono::Utc::now().timestamp_micros();

    if invite.expires_at < now {
        return Err(anyhow::anyhow!("Invalid token"));
    }
    let org_id = invite.org_id.clone();

    let org = match get_org(&org_id).await {
        Some(org) => org,
        None => return Err(anyhow::anyhow!("Organization doesn't exist")),
    };

    if get_billing_by_org_id(&org_id).await?.is_none() {
        // if the org user is joining is paid, no issues, we can just let them join
        // if it is a free org, we must check that the orgs the joining user is already part
        // of are all paid, as one user cannot be part of more than one free org.
        let user_orgs = list_orgs_by_user(user_email).await?;
        for org in user_orgs {
            if get_billing_by_org_id(&org.identifier).await?.is_none() {
                return Err(anyhow::anyhow!(
                    "User is already a part of a free organization. A user cannot join multiple free orgs."
                ));
            }
        }
    }

    // Check if user is already part of the org
    if get_cached_user_org(&org_id, user_email).is_some() {
        return Ok(()); // User is already part of the org
    }

    let invite_role = UserRole::from_str(&invite.role)
        .map_err(|_| anyhow::anyhow!("Invalid role: {}", invite.role))?;
    org_users::add(
        &org_id,
        user_email,
        invite_role,
        &generate_random_string(16),
        Some(format!("rum{}", generate_random_string(16))),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Failed to add user to org"))?;

    // Add to OFGA
    o2_openfga::authorizer::authz::add_user_to_org(&org_id, user_email, &invite.role).await;

    if let Err(e) =
        org_invites::update_invite_status(invite_token, user_email, OrgInviteStatus::Accepted).await
    {
        log::error!("Error updating the invite status in the db: {e}");
    }
    enqueue_cloud_event(CloudEvent {
        org_id: org.identifier.clone(),
        org_name: org.name.clone(),
        org_type: org.org_type.clone(),
        user: Some(user_email.to_string()),
        event: EventType::UserJoined,
        subscription_type: None,
        stream_name: None,
    })
    .await;
    Ok(())
}

#[cfg(feature = "cloud")]
pub async fn decline_invitation(
    user_email: &str,
    token: &str,
) -> Result<Vec<InvitationRecord>, anyhow::Error> {
    let invite = org_invites::get_by_token_user(token, user_email)
        .await
        .map_err(|e| {
            log::info!("error getting token {token} for email {user_email} : {e}");
            anyhow::anyhow!("Provided Token is not valid for this email id")
        })?;

    let now = chrono::Utc::now().timestamp_micros();

    if invite.expires_at < now {
        return Err(anyhow::anyhow!("Invalid token"));
    }

    if let Err(e) =
        org_invites::update_invite_status(token, user_email, OrgInviteStatus::Rejected).await
    {
        log::error!("Error updating the invite status in the db: {e}");
        return Err(anyhow::anyhow!("Error updating status"));
    }

    let invites = match db::user::list_user_invites(user_email).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error in listing invites for {user_email} : {e}");
            vec![]
        }
    };
    let pending = invites
        .into_iter()
        .filter(|invite| invite.status == OrgInviteStatus::Pending && invite.expires_at > now)
        .collect();

    Ok(pending)
}

pub async fn get_org(org: &str) -> Option<Organization> {
    db::organization::get_org(org).await.ok()
}

#[cfg(feature = "cloud")]
pub async fn is_org_in_free_trial_period(org_id: &str) -> Result<bool, anyhow::Error> {
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
    let o2_config = get_o2_config();

    // if trial period check is disabled, everything is free trial period
    if !o2_config.cloud.trial_period_enabled {
        return Ok(true);
    }

    // exception for meta org
    if org_id == "_meta" {
        return Ok(true);
    }
    use o2_enterprise::enterprise::cloud::billings;
    // first check if the org is
    let subscription = billings::get_billing_by_org_id(org_id).await?;

    if subscription.is_none() || subscription.unwrap().subscription_type.is_free_sub() {
        let org = infra::table::organizations::get(org_id).await?;
        let now = Utc::now().timestamp_micros();
        if now > org.trial_ends_at {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use infra::{db as infra_db, table as infra_table};

    use super::*;
    use crate::{common::meta::user::UserRequest, service::users};

    // TODO: move these tests to integration tests,
    // the below test case will fail as is_root_user()
    // will not work as watchers are not initialized
    #[tokio::test]
    #[ignore]
    async fn test_organization() {
        let org_id = "default";
        let user_id = "user-org-1@example.com";
        let init_user = "root@example.com";
        let pwd = "Complexpass#123";

        infra_db::create_table().await.unwrap();
        infra_table::create_user_tables().await.unwrap();
        check_and_create_org_without_ofga(org_id).await.unwrap();
        users::create_root_user_if_not_exists(
            org_id,
            UserRequest {
                email: init_user.to_string(),
                password: pwd.to_string(),
                role: crate::common::meta::user::UserOrgRole {
                    base_role: config::meta::user::UserRole::Root,
                    custom_role: None,
                },
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                is_external: false,
                token: None,
            },
        )
        .await
        .unwrap();

        let resp = users::post_user(
            org_id,
            UserRequest {
                email: user_id.to_string(),
                password: "pass".to_string(),
                role: crate::common::meta::user::UserOrgRole {
                    base_role: config::meta::user::UserRole::Admin,
                    custom_role: None,
                },
                first_name: "admin".to_owned(),
                last_name: "".to_owned(),
                is_external: false,
                token: None,
            },
            init_user,
        )
        .await;
        assert!(resp.is_ok());
        let resp = resp.unwrap();
        println!("Test organization resp: {:?}", resp.body());
        assert!(resp.status().is_success());

        let resp = get_passcode(Some(org_id), user_id).await.unwrap();
        let passcode = resp.passcode.clone();
        assert!(!resp.passcode.is_empty());

        let resp = update_passcode(Some(org_id), user_id).await.unwrap();
        assert_ne!(resp.passcode, passcode);
    }
}
