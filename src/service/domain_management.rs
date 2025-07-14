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

use infra::errors::Error;
use regex::Regex;

use crate::{
    common::meta::domain_management::{
        DomainManagementConfig, DomainManagementRequest, DomainManagementResponse,
        DomainOperationResponse,
    },
    service::db::domain_management as db_domain_management,
};

/// Get system-wide domain management configuration
pub async fn get_domain_management_config() -> Result<DomainManagementResponse, Error> {
    let config = db_domain_management::get_domain_management_config().await?;
    Ok(config.into())
}

/// Set system-wide domain management configuration
pub async fn set_domain_management_config(
    request: DomainManagementRequest,
) -> Result<DomainOperationResponse, Error> {
    // Validate the request
    validate_domain_management_request(&request)?;

    let config = DomainManagementConfig::from(request);

    db_domain_management::set_domain_management_config(&config).await?;

    Ok(DomainOperationResponse {
        message: "Domain management configuration updated successfully".to_string(),
        domain: None,
    })
}

/// Check if an email is allowed by the system-wide domain management configuration
pub async fn is_email_allowed(email: &str) -> Result<bool, Error> {
    let config = db_domain_management::get_domain_management_config().await?;
    Ok(config.is_email_allowed(email))
}

/// Validate domain format
fn validate_domain_format(domain: &str) -> Result<(), Error> {
    if domain.is_empty() {
        return Err(Error::Message("Domain cannot be empty".to_string()));
    }

    // Basic domain validation regex
    let domain_regex = Regex::new(r"^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$")
        .map_err(|e| Error::Message(format!("Invalid regex: {e}")))?;

    if !domain_regex.is_match(domain) {
        return Err(Error::Message(format!("Invalid domain format: '{domain}'")));
    }

    // Additional checks
    if domain.len() > 253 {
        return Err(Error::Message(
            "Domain too long (max 253 characters)".to_string(),
        ));
    }

    if domain.starts_with('.') || domain.ends_with('.') {
        return Err(Error::Message(
            "Domain cannot start or end with a dot".to_string(),
        ));
    }

    if domain.contains("..") {
        return Err(Error::Message(
            "Domain cannot contain consecutive dots".to_string(),
        ));
    }

    Ok(())
}

/// Validate allowed emails for a domain
fn validate_emails(emails: &[String], domain: &str) -> Result<(), Error> {
    // Basic email validation
    let email_regex = Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
        .map_err(|e| Error::Message(format!("Invalid email regex: {e}")))?;

    for email in emails {
        if email.is_empty() {
            return Err(Error::Message("Email cannot be empty".to_string()));
        }

        if !email_regex.is_match(email) {
            return Err(Error::Message(format!("Invalid email format: '{email}'")));
        }

        // Check if email domain matches the domain config
        let email_domain = email.split('@').nth(1).unwrap_or("");
        if !email_domain.eq_ignore_ascii_case(domain) {
            return Err(Error::Message(format!(
                "Email '{email}' does not belong to domain '{domain}'"
            )));
        }
    }

    Ok(())
}

/// Validate domain management request
fn validate_domain_management_request(request: &DomainManagementRequest) -> Result<(), Error> {
    for domain_request in &request.domains {
        validate_domain_format(&domain_request.domain)?;
        validate_emails(&domain_request.allowed_emails, &domain_request.domain)?;
        validate_domain_config_exclusivity(domain_request)?;
    }

    Ok(())
}

/// Validate that allow_all_users and allowed_emails are mutually exclusive
fn validate_domain_config_exclusivity(
    domain_request: &crate::common::meta::domain_management::DomainConfigRequest,
) -> Result<(), Error> {
    if domain_request.allow_all_users && !domain_request.allowed_emails.is_empty() {
        return Err(Error::Message(format!(
            "Domain '{}': allow_all_users and allowed_emails are mutually exclusive. Use either allow_all_users=true OR provide specific emails in allowed_emails, not both.",
            domain_request.domain
        )));
    }

    if !domain_request.allow_all_users && domain_request.allowed_emails.is_empty() {
        return Err(Error::Message(format!(
            "Domain '{}': when allow_all_users=false, you must provide at least one email in allowed_emails.",
            domain_request.domain
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_domain_format() {
        assert!(validate_domain_format("example.com").is_ok());
        assert!(validate_domain_format("sub.example.com").is_ok());
        assert!(validate_domain_format("test-domain.com").is_ok());
        assert!(validate_domain_format("a.b").is_ok());

        assert!(validate_domain_format("").is_err());
        assert!(validate_domain_format(".example.com").is_err());
        assert!(validate_domain_format("example.com.").is_err());
        assert!(validate_domain_format("example..com").is_err());
        assert!(validate_domain_format("-example.com").is_err());
        assert!(validate_domain_format("example-.com").is_err());
    }

    #[test]
    fn test_validate_emails() {
        assert!(validate_emails(&["test@example.com".to_string()], "example.com").is_ok());
        assert!(
            validate_emails(
                &[
                    "user1@example.com".to_string(),
                    "user2@example.com".to_string()
                ],
                "example.com"
            )
            .is_ok()
        );
        assert!(validate_emails(&[], "example.com").is_ok());

        assert!(validate_emails(&["".to_string()], "example.com").is_err());
        assert!(validate_emails(&["invalid-email".to_string()], "example.com").is_err());
        assert!(validate_emails(&["test@other.com".to_string()], "example.com").is_err());
    }

    #[test]
    fn test_validate_domain_config_exclusivity() {
        use crate::common::meta::domain_management::DomainConfigRequest;

        // Valid case: allow_all_users=true with empty allowed_emails
        let valid_allow_all = DomainConfigRequest {
            domain: "example.com".to_string(),
            allow_all_users: true,
            allowed_emails: vec![],
            enabled: true,
        };
        assert!(validate_domain_config_exclusivity(&valid_allow_all).is_ok());

        // Valid case: allow_all_users=false with non-empty allowed_emails
        let valid_specific_emails = DomainConfigRequest {
            domain: "example.com".to_string(),
            allow_all_users: false,
            allowed_emails: vec![
                "user1@example.com".to_string(),
                "user2@example.com".to_string(),
            ],
            enabled: true,
        };
        assert!(validate_domain_config_exclusivity(&valid_specific_emails).is_ok());

        // Invalid case: allow_all_users=true with non-empty allowed_emails
        let invalid_both = DomainConfigRequest {
            domain: "example.com".to_string(),
            allow_all_users: true,
            allowed_emails: vec!["user1@example.com".to_string()],
            enabled: true,
        };
        let result = validate_domain_config_exclusivity(&invalid_both);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("mutually exclusive")
        );

        // Invalid case: allow_all_users=false with empty allowed_emails
        let invalid_neither = DomainConfigRequest {
            domain: "example.com".to_string(),
            allow_all_users: false,
            allowed_emails: vec![],
            enabled: true,
        };
        let result = validate_domain_config_exclusivity(&invalid_neither);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("must provide at least one email")
        );
    }

    #[test]
    fn test_validate_domain_management_request() {
        use crate::common::meta::domain_management::{
            DomainConfigRequest, DomainManagementRequest,
        };

        // Valid request
        let valid_request = DomainManagementRequest {
            domains: vec![
                DomainConfigRequest {
                    domain: "example.com".to_string(),
                    allow_all_users: true,
                    allowed_emails: vec![],
                    enabled: true,
                },
                DomainConfigRequest {
                    domain: "other.com".to_string(),
                    allow_all_users: false,
                    allowed_emails: vec!["user@other.com".to_string()],
                    enabled: true,
                },
            ],
            enabled: true,
        };
        assert!(validate_domain_management_request(&valid_request).is_ok());

        // Invalid request with mutual exclusivity violation
        let invalid_request = DomainManagementRequest {
            domains: vec![DomainConfigRequest {
                domain: "example.com".to_string(),
                allow_all_users: true,
                allowed_emails: vec!["user@example.com".to_string()], /* This violates mutual
                                                                       * exclusivity */
                enabled: true,
            }],
            enabled: true,
        };
        assert!(validate_domain_management_request(&invalid_request).is_err());
    }
}
