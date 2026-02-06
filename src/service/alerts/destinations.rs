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

use config::meta::destinations::{Destination, DestinationType, Module, Template};

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

    let saved = db::alerts::destinations::set(destination).await?;
    if name.is_empty() {
        set_ownership(&saved.org_id, "destinations", Authz::new(&saved.name)).await;
    }
    Ok(saved)
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

    db::alerts::destinations::delete(org_id, name).await?;
    remove_ownership(org_id, "destinations", Authz::new(name)).await;
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
