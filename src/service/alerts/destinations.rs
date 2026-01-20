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
    service::db::{self, alerts::destinations::DestinationError, user},
};

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
