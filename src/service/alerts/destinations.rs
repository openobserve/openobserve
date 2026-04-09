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

use config::{
    get_config,
    meta::destinations::{Destination, DestinationType, Email, Module, OAuthConnectionStatus, Template},
};

use crate::{
    common::{
        infra::config::ALERTS,
        meta::authz::Authz,
        utils::auth::{is_ofga_unsupported, remove_ownership, set_ownership},
    },
    service::db::{
        self,
        alerts::{destinations::DestinationError, templates::TemplateError},
        user,
    },
};

/// Helper function to ensure a prebuilt template exists for the given type.
/// Returns the template name if successful.
///
/// This function implements template reuse: if a template with the standardized
/// name already exists, it returns that name. Otherwise, it creates a new template
/// from the prebuilt configuration.
async fn ensure_prebuilt_template(
    org_id: &str,
    prebuilt_type: &str,
) -> Result<String, DestinationError> {
    let template_name = format!("prebuilt_{}", prebuilt_type);

    // CRITICAL: Check if template already exists (avoid duplicates)
    match db::alerts::templates::get(org_id, &template_name).await {
        Ok(_existing_template) => {
            // Template exists, reuse it
            log::info!(
                "Reusing existing template '{}' for org '{}' and prebuilt type '{}'",
                template_name,
                org_id,
                prebuilt_type
            );
            Ok(template_name)
        }
        Err(TemplateError::NotFound) => {
            // Template doesn't exist, create it from prebuilt config
            log::info!(
                "Creating new template '{}' for org '{}' and prebuilt type '{}'",
                template_name,
                org_id,
                prebuilt_type
            );

            // Load template definition from prebuilt config
            let mut template_def = config::prebuilt_loader::get_prebuilt_template(prebuilt_type)
                .ok_or_else(|| {
                    DestinationError::PrebuiltTemplateNotFound(prebuilt_type.to_string())
                })?;

            // Set org_id and name
            template_def.org_id = org_id.to_string();
            template_def.name = template_name.clone();
            template_def.is_default = false;

            // Save to database
            // Note: With unique constraint on (org, name), concurrent creates will fail
            // gracefully with a database constraint violation
            match db::alerts::templates::set(template_def).await {
                Ok(_) => {}
                Err(e) => {
                    let error_msg = e.to_string();
                    // Check if this is a duplicate key error (race condition)
                    if error_msg.contains("UNIQUE constraint")
                        || error_msg.contains("duplicate key")
                        || error_msg.contains("Duplicate entry")
                    {
                        // Template was created by another concurrent request
                        // This is expected behavior with the race condition fix
                        log::info!(
                            "Template '{}' for org '{}' already exists (concurrent creation)",
                            template_name,
                            org_id
                        );
                        return Ok(template_name);
                    }
                    // Other database errors should still fail
                    log::error!(
                        "Failed to create template '{}' for org '{}': {}",
                        template_name,
                        org_id,
                        e
                    );
                    return Err(DestinationError::TemplateCreationFailed(error_msg));
                }
            }

            log::info!(
                "Successfully created template '{}' for org '{}'",
                template_name,
                org_id
            );

            Ok(template_name)
        }
        Err(e) => {
            // Other error (DB failure, etc.)
            log::error!(
                "Error checking for template '{}' in org '{}': {}",
                template_name,
                org_id,
                e
            );
            Err(DestinationError::TemplateRetrievalFailed(e.to_string()))
        }
    }
}

pub async fn save(
    name: &str,
    mut destination: Destination,
    create: bool,
    oauth_state: Option<String>,
) -> Result<Destination, DestinationError> {
    // First validate the `destination` according to its `destination_type`
    match &mut destination.module {
        Module::Alert {
            destination_type, ..
        } => match destination_type {
            DestinationType::Email(email) => {
                if email.recipients.is_empty() {
                    return Err(DestinationError::EmptyEmail);
                }
                if !config::get_config().smtp.smtp_enabled {
                    return Err(DestinationError::SMTPUnavailable);
                }
                let mut lowercase_emails = vec![];
                for email in email.recipients.iter() {
                    let email = email.trim().to_lowercase();
                    // Check if the email is part of the org
                    let res = user::get(Some(&destination.org_id), &email).await;
                    if res.is_err() || res.is_ok_and(|usr| usr.is_none()) {
                        return Err(DestinationError::UserNotPermitted);
                    }
                    lowercase_emails.push(email);
                }
                email.recipients = lowercase_emails;
            }
            DestinationType::Http(endpoint) => {
                if endpoint.url.is_empty() {
                    return Err(DestinationError::EmptyUrl);
                }
            }
            DestinationType::Sns(aws_sns) => {
                if aws_sns.sns_topic_arn.is_empty() || aws_sns.aws_region.is_empty() {
                    return Err(DestinationError::InvalidSns);
                }
            }
            DestinationType::OAuth(conn) => {
                use crate::service::oauth_providers::PROVIDER_REGISTRY;
                if conn.connection_id.is_empty() {
                    return Err(DestinationError::EmptyUrl); // connection_id is required
                }
                // Enforce channel_id for providers that have a channel picker
                if let Some(handler) = PROVIDER_REGISTRY.get(&conn.provider) {
                    if handler.has_channel_picker()
                        && conn.channel_id.as_deref().unwrap_or("").is_empty()
                    {
                        return Err(DestinationError::EmptyUrl); // channel_id required
                    }
                }
            }
        },
        Module::Pipeline { endpoint, .. } => {
            if endpoint.url.is_empty() {
                return Err(DestinationError::EmptyUrl);
            }
        }
    }

    if !name.is_empty() {
        destination.name = name.to_string();
    }
    destination.name = destination.name.trim().to_string();
    if destination.name.is_empty() {
        return Err(DestinationError::EmptyName);
    }
    if destination.name.contains('/') || is_ofga_unsupported(&destination.name) {
        return Err(DestinationError::InvalidName);
    }

    match db::alerts::destinations::get(&destination.org_id, &destination.name).await {
        Ok(_) => {
            if create {
                return Err(DestinationError::AlreadyExists);
            }
        }
        Err(_) => {
            if !create {
                return Err(DestinationError::NotFound);
            }
        }
    }

    // For prebuilt destinations, ensure template exists before saving destination
    // This implements template reuse: multiple destinations can share the same prebuilt template
    if let Module::Alert {
        ref mut template,
        ref destination_type,
    } = destination.module
    {
        // Check if this is a prebuilt destination (has destination_type metadata)
        let prebuilt_type = match destination_type {
            DestinationType::Http(endpoint) => endpoint.destination_type.as_deref(),
            DestinationType::Email(_) => {
                // Check if template is prebuilt or not set (assume prebuilt email)
                if template.is_none()
                    || template
                        .as_ref()
                        .is_some_and(|t| t.starts_with("prebuilt_"))
                {
                    Some("email")
                } else {
                    None
                }
            }
            DestinationType::Sns(_) => None, // SNS doesn't have prebuilt templates yet
            DestinationType::OAuth(_) => None, // OAuth: template already set by caller or prebuilt
        };

        // If it's a prebuilt type and doesn't have a custom template, ensure prebuilt template
        // exists
        if let Some(pb_type) = prebuilt_type {
            // Skip "custom" type (user wants to use custom template)
            if pb_type != "custom" {
                // Ensure the prebuilt template exists (creates if needed, reuses if exists)
                let template_name = ensure_prebuilt_template(&destination.org_id, pb_type).await?;

                // Update destination to reference the template (only if not already set)
                if template.is_none() {
                    *template = Some(template_name);
                    log::info!(
                        "Associated destination '{}' with prebuilt template for type '{}'",
                        destination.name,
                        pb_type
                    );
                }
            }
        }
    }

    // Validate that alert destinations have a template
    // Templates are REQUIRED for alert destinations to format alert messages
    if let Module::Alert { template, .. } = &destination.module
        && (template.is_none() || template.as_ref().is_some_and(|t| t.is_empty()))
    {
        return Err(DestinationError::TemplateNotFound);
    }

    // For OAuth destinations: if a state token was provided, migrate token from
    // session table → cipher table and update the team index. This must happen
    // after validation but BEFORE saving the destination row so that a cipher
    // failure aborts the whole operation.
    //
    // Also back-fills token_expires_at on the OAuthConnection from the session
    // so that token refresh fires correctly for expiring tokens (Discord, PagerDuty, etc.).
    if let Module::Alert {
        destination_type: DestinationType::OAuth(ref mut conn),
        ..
    } = destination.module
    {
        if let Some(ref state) = oauth_state {
            let expires_at = migrate_oauth_token(&destination.org_id, conn, state)
                .await
                .map_err(DestinationError::InfraError)?;
            conn.token_expires_at = expires_at;
        }
    }

    let saved = db::alerts::destinations::set(destination).await?;

    // Delete session row only after successful destination save
    if let Module::Alert {
        destination_type: DestinationType::OAuth(_),
        ..
    } = saved.module
    {
        if let Some(ref state) = oauth_state {
            if let Err(e) = infra::table::sessions::delete(state).await {
                log::warn!("save: failed to delete OAuth session after save: {e}");
            }
        }
    }

    if name.is_empty() {
        set_ownership(&saved.org_id, "destinations", Authz::new(&saved.name)).await;
    }
    Ok(saved)
}

/// Migrate OAuth token from the session table to the cipher table.
///
/// Session table → cipher table → update team index.
/// Called during `save()` when `oauth_state` is present.
/// Returns the token expiry timestamp so the caller can set `conn.token_expires_at`.
async fn migrate_oauth_token(
    org_id: &str,
    conn: &config::meta::destinations::OAuthConnection,
    state: &str,
) -> Result<Option<i64>, infra::errors::Error> {
    use infra::table::{
        cipher::{self, CipherEntry, EntryKind},
        sessions,
    };

    // Read pending session
    let session_model = match sessions::get(state).await? {
        Some(m) => m,
        None => {
            return Err(infra::errors::Error::Message(
                "OAuth session not found or expired".to_string(),
            ));
        }
    };

    let session: crate::service::oauth_providers::OAuthPendingSession =
        serde_json::from_str(&session_model.access_token).map_err(|e| {
            infra::errors::Error::Message(format!("OAuth session corrupt: {e}"))
        })?;

    // Org isolation
    if session.org_id != org_id {
        return Err(infra::errors::Error::Message(
            "OAuth session org_id mismatch".to_string(),
        ));
    }

    let access_token = session
        .access_token
        .ok_or_else(|| infra::errors::Error::Message("OAuth token not present in session".to_string()))?;

    // Capture expiry before session fields are moved into token_json
    let token_expires_at = session.expires_at_token;

    // Store as JSON so we can also keep refresh_token if present
    let token_json = serde_json::json!({
        "access_token": access_token,
        "refresh_token": session.refresh_token,
        "expires_at": token_expires_at,
    })
    .to_string();

    let cipher_name = format!("{}/{}", conn.provider, conn.connection_id);

    // Use update-or-insert: try add first, fallback to update
    let entry = CipherEntry {
        org: org_id.to_string(),
        created_at: chrono::Utc::now().timestamp(),
        created_by: "system".to_string(),
        name: cipher_name.clone(),
        data: token_json.clone(),
        kind: EntryKind::OAuthToken,
    };

    match cipher::add(entry).await {
        Ok(_) => {}
        Err(infra::errors::Error::DbError(infra::errors::DbError::UniqueViolation)) => {
            // Already exists (reconnect) — update instead
            let update_entry = CipherEntry {
                org: org_id.to_string(),
                created_at: chrono::Utc::now().timestamp(),
                created_by: "system".to_string(),
                name: cipher_name.clone(),
                data: token_json,
                kind: EntryKind::OAuthToken,
            };
            cipher::update(update_entry).await?;
        }
        Err(e) => return Err(e),
    }

    // Update team index for revocation fan-out (skip if no team_id — e.g. PagerDuty)
    if let Some(ref team_id) = conn.team_id {
        let provider_str = conn.provider.to_string();
        let index_key = format!("team_index/{provider_str}/{team_id}");

        let mut entries: Vec<serde_json::Value> =
            match cipher::get_data("_alert_dest_oauth_team_index", EntryKind::OAuthToken, &index_key).await? {
                Some(data) => serde_json::from_str(&data).unwrap_or_default(),
                None => vec![],
            };

        // De-duplicate — remove existing entry for this connection_id then re-append
        entries.retain(|e| {
            e.get("connection_id").and_then(|v| v.as_str())
                != Some(&conn.connection_id)
        });
        entries.push(serde_json::json!({
            "org_id": org_id,
            "connection_id": conn.connection_id,
        }));

        let updated_json = serde_json::to_string(&entries).unwrap_or_default();
        let index_entry = CipherEntry {
            org: "_alert_dest_oauth_team_index".to_string(),
            created_at: chrono::Utc::now().timestamp(),
            created_by: "system".to_string(),
            name: index_key,
            data: updated_json,
            kind: EntryKind::OAuthToken,
        };

        match cipher::add(index_entry.clone()).await {
            Ok(_) => {}
            Err(infra::errors::Error::DbError(infra::errors::DbError::UniqueViolation)) => {
                cipher::update(index_entry).await?;
            }
            Err(e) => return Err(e),
        }
    }

    Ok(token_expires_at)
}

/// Validates email destination configuration and sends a test email.
/// Performs the same validations as save() for email destinations:
/// 1. Checks SMTP is enabled
/// 2. Validates recipients are not empty
/// 3. Validates each recipient is a user in the org
/// 4. Sends a test email via the shared send_email_notification function
pub async fn test_email(
    org_id: &str,
    recipients: &[String],
    body: Option<&str>,
) -> Result<String, DestinationError> {
    if !get_config().smtp.smtp_enabled {
        return Err(DestinationError::SMTPUnavailable);
    }

    if recipients.is_empty() {
        return Err(DestinationError::EmptyEmail);
    }

    // Validate each recipient is part of the org (same as save())
    let mut validated_recipients = Vec::with_capacity(recipients.len());
    for email in recipients {
        let email = email.trim().to_lowercase();
        let res = user::get(Some(org_id), &email).await;
        if res.is_err() || res.is_ok_and(|usr| usr.is_none()) {
            return Err(DestinationError::UserNotPermitted);
        }
        validated_recipients.push(email);
    }

    let default_body = "<html><body><h2>OpenObserve Test Email</h2>\
         <p>This is a test email from OpenObserve to verify your email destination \
         is configured correctly.</p>\
         <p>If you received this email, your email destination is working.</p></body></html>";
    let email_body = body.unwrap_or(default_body).to_string();

    let email = Email {
        recipients: validated_recipients,
    };

    super::alert::send_email_notification(
        "OpenObserve - Test Email Destination",
        &email,
        email_body,
    )
    .await
    .map_err(|e| DestinationError::EmailSendFailed(e.to_string()))
}

pub async fn get(org_id: &str, name: &str) -> Result<Destination, DestinationError> {
    db::alerts::destinations::get(org_id, name).await
}

/// Gets a destination with its optional template.
/// Returns the destination and optionally the template if one is configured.
pub async fn get_with_template(
    org_id: &str,
    name: &str,
) -> Result<(Destination, Option<Template>), DestinationError> {
    let dest = get(org_id, name).await?;
    if let Module::Alert { template, .. } = &dest.module {
        if let Some(template_name) = template {
            let template = db::alerts::templates::get(org_id, template_name)
                .await
                .map_err(|_| DestinationError::TemplateNotFound)?;
            Ok((dest, Some(template)))
        } else {
            // Template is optional at destination level
            Ok((dest, None))
        }
    } else {
        // Pipeline destinations don't have templates
        Ok((dest, None))
    }
}

pub async fn list(
    org_id: &str,
    module: Option<&str>,
    permitted: Option<Vec<String>>,
) -> Result<Vec<Destination>, DestinationError> {
    Ok(db::alerts::destinations::list(org_id, module)
        .await?
        .into_iter()
        .filter(|dest| {
            permitted.is_none()
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("destination:{}", dest.name))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("destination:_all_{org_id}"))
        })
        .collect())
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), DestinationError> {
    let cacher = ALERTS.read().await;
    for (stream_key, (_, alert)) in cacher.iter() {
        if stream_key.starts_with(&format!("{org_id}/"))
            && alert.destinations.contains(&name.to_string())
        {
            return Err(DestinationError::UsedByAlert(alert.name.to_string()));
        }
    }
    drop(cacher);

    if let Ok(pls) = db::pipeline::list_by_org(org_id).await {
        for pl in pls {
            if pl.contains_remote_destination(name) {
                return Err(DestinationError::UsedByPipeline(pl.name));
            }
        }
    }

    // For OAuth destinations, clean up cipher + team index before deleting the row.
    if let Ok(dest) = db::alerts::destinations::get(org_id, name).await {
        if let Module::Alert {
            destination_type: DestinationType::OAuth(ref conn),
            ..
        } = dest.module
        {
            return delete_oauth_internal(org_id, name, conn).await;
        }
    }

    db::alerts::destinations::delete(org_id, name).await?;
    remove_ownership(org_id, "destinations", Authz::new(name)).await;
    Ok(())
}

async fn delete_oauth_internal(
    org_id: &str,
    name: &str,
    conn: &config::meta::destinations::OAuthConnection,
) -> Result<(), DestinationError> {
    use infra::table::cipher::{self, CipherEntry, EntryKind};

    let provider = conn.provider.to_string();
    let connection_id = conn.connection_id.clone();
    let team_id = conn.team_id.clone();
    let cipher_name = format!("{provider}/{connection_id}");

    // 1. Remove cipher token first — abort if fails
    if let Err(e) = cipher::remove(org_id, EntryKind::OAuthToken, &cipher_name).await {
        log::error!("delete_oauth: cipher removal failed for {cipher_name}: {e}");
        return Err(DestinationError::InfraError(e));
    }

    // 2. Remove from team index
    if let Some(team_id) = team_id {
        let index_key = format!("team_index/{provider}/{team_id}");
        if let Ok(Some(data)) =
            cipher::get_data("_alert_dest_oauth_team_index", EntryKind::OAuthToken, &index_key).await
        {
            if let Ok(mut entries) =
                serde_json::from_str::<Vec<serde_json::Value>>(&data)
            {
                entries.retain(|e| {
                    e.get("connection_id").and_then(|v| v.as_str())
                        != Some(&connection_id)
                });
                let updated = serde_json::to_string(&entries).unwrap_or_default();
                let entry = CipherEntry {
                    org: "_alert_dest_oauth_team_index".to_string(),
                    created_at: chrono::Utc::now().timestamp(),
                    created_by: "system".to_string(),
                    name: index_key,
                    data: updated,
                    kind: EntryKind::OAuthToken,
                };
                if let Err(e) = cipher::update(entry).await {
                    log::warn!("delete_oauth: team index update failed: {e}");
                }
            }
        }
    }

    // 3. Delete destination row
    db::alerts::destinations::delete(org_id, name).await?;
    remove_ownership(org_id, "destinations", Authz::new(name)).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// OAuth-specific helpers (used by alert.rs and oauth_destinations.rs)
// ---------------------------------------------------------------------------

/// Set the OAuth connection status to `Revoked` for a given connection_id.
/// Searches all destinations in the org that reference this connection.
pub async fn set_oauth_status_revoked(
    org_id: &str,
    connection_id: &str,
) -> Result<(), DestinationError> {
    set_oauth_connection_status(org_id, connection_id, OAuthConnectionStatus::Revoked).await
}

/// Set the OAuth connection status to `Revoked` by connection_id (alias for compatibility).
pub async fn set_oauth_status_revoked_by_connection(
    org_id: &str,
    connection_id: &str,
) -> Result<(), DestinationError> {
    set_oauth_status_revoked(org_id, connection_id).await
}

/// Set the OAuth connection status to `TokenExpired` for a given connection_id.
pub async fn set_oauth_status_token_expired(
    org_id: &str,
    connection_id: &str,
) -> Result<(), DestinationError> {
    set_oauth_connection_status(org_id, connection_id, OAuthConnectionStatus::TokenExpired).await
}

/// Update the `token_expires_at` field on an OAuth destination after a successful refresh.
pub async fn update_oauth_token_expiry(
    org_id: &str,
    connection_id: &str,
    new_expires_at: i64,
) -> Result<(), DestinationError> {
    let destinations = db::alerts::destinations::list(org_id, Some("alert")).await?;
    for mut dest in destinations {
        if let Module::Alert {
            ref mut destination_type,
            ..
        } = dest.module
        {
            if let DestinationType::OAuth(conn) = destination_type {
                if conn.connection_id == connection_id {
                    conn.token_expires_at = Some(new_expires_at);
                    db::alerts::destinations::set(dest).await?;
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

async fn set_oauth_connection_status(
    org_id: &str,
    connection_id: &str,
    new_status: OAuthConnectionStatus,
) -> Result<(), DestinationError> {
    // List all alert destinations for this org and find the matching connection
    let destinations = db::alerts::destinations::list(org_id, Some("alert")).await?;
    for mut dest in destinations {
        if let Module::Alert {
            ref mut destination_type,
            ..
        } = dest.module
        {
            if let DestinationType::OAuth(conn) = destination_type {
                if conn.connection_id == connection_id {
                    conn.status = new_status.clone();
                    db::alerts::destinations::set(dest).await?;
                    return Ok(());
                }
            }
        }
    }
    // Not found is not necessarily an error (destination may have been deleted)
    Ok(())
}


#[cfg(test)]
mod tests {
    use config::meta::destinations::{DestinationType, Endpoint, HTTPType, Module};

    use super::*;

    /// Test that ensure_prebuilt_template creates a new template when it doesn't exist
    #[tokio::test]
    #[ignore] // Test requires full infrastructure (NATS/DB)
    async fn test_ensure_prebuilt_template_creates_new() {
        let org_id = "test_org_create";
        let prebuilt_type = "slack";

        // Clean up any existing template
        let _ = db::alerts::templates::delete(org_id, &format!("prebuilt_{}", prebuilt_type)).await;

        // Ensure template - should create new one
        let result = ensure_prebuilt_template(org_id, prebuilt_type).await;

        assert!(
            result.is_ok(),
            "Should successfully create template, error: {:?}",
            result.as_ref().err()
        );
        let template_name = result.unwrap();
        assert_eq!(template_name, "prebuilt_slack");

        // Verify template was created in database
        let template = db::alerts::templates::get(org_id, &template_name).await;
        assert!(template.is_ok(), "Template should exist in database");

        // Clean up
        let _ = db::alerts::templates::delete(org_id, &template_name).await;
    }

    /// Test that ensure_prebuilt_template reuses existing template
    #[tokio::test]
    #[ignore] // Test requires full infrastructure (NATS/DB)
    async fn test_ensure_prebuilt_template_reuses_existing() {
        let org_id = "test_org_reuse";
        let prebuilt_type = "slack";
        let template_name = format!("prebuilt_{}", prebuilt_type);

        // Clean up
        let _ = db::alerts::templates::delete(org_id, &template_name).await;

        // Create template first time
        let result1 = ensure_prebuilt_template(org_id, prebuilt_type).await;
        assert!(
            result1.is_ok(),
            "Should successfully create template on first call, error: {:?}",
            result1.as_ref().err()
        );

        // Get template ID to verify it's the same one later
        let template1 = db::alerts::templates::get(org_id, &template_name)
            .await
            .unwrap();

        // Try to ensure template again - should reuse existing
        let result2 = ensure_prebuilt_template(org_id, prebuilt_type).await;
        assert!(
            result2.is_ok(),
            "Should successfully reuse existing template, error: {:?}",
            result2.as_ref().err()
        );
        assert_eq!(result2.unwrap(), template_name);

        // Verify it's the same template (not recreated)
        let template2 = db::alerts::templates::get(org_id, &template_name)
            .await
            .unwrap();
        assert_eq!(template1.name, template2.name);
        assert_eq!(template1.body, template2.body);

        // Clean up
        let _ = db::alerts::templates::delete(org_id, &template_name).await;
    }

    /// Test that multiple destinations of same type share one template
    #[tokio::test]
    #[ignore] // Test requires full infrastructure (NATS/DB)
    async fn test_multiple_destinations_share_template() {
        let org_id = "test_org_share";

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_1").await;
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_2").await;
        let _ = db::alerts::templates::delete(org_id, "prebuilt_slack").await;

        // Create first Slack destination
        let dest1 = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "slack_dest_1".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://hooks.slack.com/services/TEST1".to_string(),
                    method: HTTPType::POST,
                    destination_type: Some("slack".to_string()),
                    ..Default::default()
                }),
            },
        };

        let saved1 = save("slack_dest_1", dest1.clone(), true).await;
        assert!(
            saved1.is_ok(),
            "First destination should save successfully: {:?}",
            saved1.err()
        );

        // Verify template was created
        let template_check1 = db::alerts::templates::get(org_id, "prebuilt_slack").await;
        assert!(
            template_check1.is_ok(),
            "Template should be created after first destination"
        );

        // Create second Slack destination
        let dest2 = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "slack_dest_2".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://hooks.slack.com/services/TEST2".to_string(),
                    method: HTTPType::POST,
                    destination_type: Some("slack".to_string()),
                    ..Default::default()
                }),
            },
        };

        let saved2 = save("slack_dest_2", dest2.clone(), true).await;
        assert!(
            saved2.is_ok(),
            "Second destination should save successfully: {:?}",
            saved2.err()
        );

        // Verify both destinations reference the same template
        let dest1_retrieved = get(org_id, "slack_dest_1").await.unwrap();
        let dest2_retrieved = get(org_id, "slack_dest_2").await.unwrap();

        if let Module::Alert {
            template: template1,
            ..
        } = dest1_retrieved.module
            && let Module::Alert {
                template: template2,
                ..
            } = dest2_retrieved.module
        {
            assert_eq!(template1, Some("prebuilt_slack".to_string()));
            assert_eq!(template2, Some("prebuilt_slack".to_string()));
            assert_eq!(
                template1, template2,
                "Both destinations should use the same template"
            );
        }

        // Verify only ONE template exists
        let templates = db::alerts::templates::list(org_id).await.unwrap();
        let slack_templates: Vec<_> = templates
            .iter()
            .filter(|t| t.name == "prebuilt_slack")
            .collect();
        assert_eq!(
            slack_templates.len(),
            1,
            "Should have exactly one prebuilt_slack template"
        );

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_1").await;
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_2").await;
        let _ = db::alerts::templates::delete(org_id, "prebuilt_slack").await;
    }

    /// Test that template is auto-recreated if manually deleted
    #[tokio::test]
    #[ignore] // Test requires full infrastructure (NATS/DB)
    async fn test_template_recreation_after_deletion() {
        let org_id = "test_org_recreate";

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_recreate").await;
        let _ = db::alerts::templates::delete(org_id, "prebuilt_slack").await;

        // Create first destination (creates template)
        let dest1 = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "slack_dest_recreate".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://hooks.slack.com/services/TEST".to_string(),
                    method: HTTPType::POST,
                    destination_type: Some("slack".to_string()),
                    ..Default::default()
                }),
            },
        };

        let _ = save("slack_dest_recreate", dest1.clone(), true).await;

        // Verify template exists
        assert!(
            db::alerts::templates::get(org_id, "prebuilt_slack")
                .await
                .is_ok()
        );

        // Force delete the template (simulating manual deletion)
        let _ = db::alerts::templates::delete(org_id, "prebuilt_slack").await;

        // Verify template is gone
        assert!(
            db::alerts::templates::get(org_id, "prebuilt_slack")
                .await
                .is_err()
        );

        // Create another destination of same type - should recreate template
        let dest2 = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "slack_dest_recreate2".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://hooks.slack.com/services/TEST2".to_string(),
                    method: HTTPType::POST,
                    destination_type: Some("slack".to_string()),
                    ..Default::default()
                }),
            },
        };

        let result = save("slack_dest_recreate2", dest2.clone(), true).await;
        assert!(
            result.is_ok(),
            "Should successfully create destination and recreate template: {:?}",
            result.err()
        );

        // Verify template was recreated
        assert!(
            db::alerts::templates::get(org_id, "prebuilt_slack")
                .await
                .is_ok(),
            "Template should be recreated"
        );

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_recreate").await;
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_recreate2").await;
        let _ = db::alerts::templates::delete(org_id, "prebuilt_slack").await;
    }

    /// Test that custom destination type is skipped from auto-template
    #[tokio::test]
    #[ignore] // Test requires full infrastructure (NATS/DB)
    async fn test_custom_destination_no_auto_template() {
        let org_id = "test_org_custom";

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "custom_webhook").await;

        // Create custom destination with "custom" type
        let dest = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "custom_webhook".to_string(),
            module: Module::Alert {
                template: Some("my_custom_template".to_string()),
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://my-service.com/webhook".to_string(),
                    method: HTTPType::POST,
                    destination_type: Some("custom".to_string()),
                    ..Default::default()
                }),
            },
        };

        let _ = save("custom_webhook", dest.clone(), true).await;

        // Verify no "prebuilt_custom" template was created
        let template_check = db::alerts::templates::get(org_id, "prebuilt_custom").await;
        assert!(
            template_check.is_err(),
            "Should not create prebuilt template for 'custom' type"
        );

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "custom_webhook").await;
    }

    /// Test that alert destinations cannot be created without a template
    #[tokio::test]
    async fn test_alert_destination_requires_template() {
        let org_id = "test_org_no_template";

        // Clean up any leftover state
        let _ = db::alerts::destinations::delete(org_id, "test_no_template").await;
        let _ = db::alerts::destinations::delete(org_id, "test_empty_template").await;

        // Try to create an alert destination without a template
        let dest = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "test_no_template".to_string(),
            module: Module::Alert {
                template: None, // No template!
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://example.com/webhook".to_string(),
                    method: HTTPType::POST,
                    ..Default::default()
                }),
            },
        };

        // Attempt to save should fail with TemplateNotFound error
        let result = save("test_no_template", dest, true).await;
        assert!(result.is_err(), "Should fail when template is None");
        assert!(
            matches!(result.unwrap_err(), DestinationError::TemplateNotFound),
            "Should return TemplateNotFound error"
        );

        // Try with empty string template
        let dest_empty = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "test_empty_template".to_string(),
            module: Module::Alert {
                template: Some("".to_string()), // Empty template!
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://example.com/webhook".to_string(),
                    method: HTTPType::POST,
                    ..Default::default()
                }),
            },
        };

        let result_empty = save("test_empty_template", dest_empty, true).await;
        assert!(result_empty.is_err(), "Should fail when template is empty");
        assert!(
            matches!(
                result_empty.unwrap_err(),
                DestinationError::TemplateNotFound
            ),
            "Should return TemplateNotFound error for empty template"
        );
    }
}
