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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Domain management configuration for SSO login restrictions
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct DomainManagementConfig {
    /// List of allowed domains with their specific configurations
    pub domains: Vec<DomainConfig>,
    /// Whether domain restrictions are enabled
    #[serde(default = "default_disabled")]
    pub enabled: bool,
    /// Timestamp when this configuration was last updated
    #[serde(default)]
    pub updated_at: i64,
}

/// Configuration for a specific domain
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct DomainConfig {
    /// Domain name (e.g., "example.com")
    pub domain: String,
    /// Whether all users from this domain are allowed
    /// MUTUALLY EXCLUSIVE with allowed_emails - when true, allowed_emails must be empty
    #[serde(default = "default_allow_all")]
    pub allow_all_users: bool,
    /// List of specific email addresses allowed from this domain
    /// MUTUALLY EXCLUSIVE with allow_all_users - when not empty, allow_all_users must be false
    #[serde(default)]
    pub allowed_emails: Vec<String>,
    /// Whether this domain configuration is active
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Timestamp when this domain was added
    #[serde(default)]
    pub created_at: i64,
    /// Timestamp when this domain was last updated
    #[serde(default)]
    pub updated_at: i64,
}

/// Request body for creating/updating domain management configuration
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DomainManagementRequest {
    /// List of domain configurations
    pub domains: Vec<DomainConfigRequest>,
    /// Whether domain restrictions are enabled
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

/// Request body for a single domain configuration
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DomainConfigRequest {
    /// Domain name (e.g., "example.com")
    pub domain: String,
    /// Whether all users from this domain are allowed
    /// MUTUALLY EXCLUSIVE with allowed_emails - when true, allowed_emails must be empty
    #[serde(default = "default_allow_all")]
    pub allow_all_users: bool,
    /// List of specific email addresses allowed from this domain
    /// MUTUALLY EXCLUSIVE with allow_all_users - when not empty, allow_all_users must be false
    #[serde(default)]
    pub allowed_emails: Vec<String>,
    /// Whether this domain configuration is active
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

/// Response body for domain management configuration
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DomainManagementResponse {
    /// List of domain configurations
    pub domains: Vec<DomainConfig>,
    /// Whether domain restrictions are enabled
    pub enabled: bool,
    /// Timestamp when this configuration was last updated
    pub updated_at: i64,
}

/// Response for a single domain operation
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DomainOperationResponse {
    /// Success message
    pub message: String,
    /// The domain that was operated on
    pub domain: Option<String>,
}

impl Default for DomainManagementConfig {
    fn default() -> Self {
        Self {
            domains: Vec::new(),
            enabled: false,
            updated_at: 0,
        }
    }
}

impl Default for DomainConfig {
    fn default() -> Self {
        Self {
            domain: String::new(),
            allow_all_users: true,
            allowed_emails: Vec::new(),
            enabled: true,
            created_at: 0,
            updated_at: 0,
        }
    }
}

impl DomainManagementConfig {
    /// Check if a user email is allowed based on domain configuration
    pub fn is_email_allowed(&self, email: &str) -> bool {
        // If domain restrictions are disabled, allow all emails
        if !self.enabled {
            return true;
        }

        // If no domains are configured, allow all emails
        if self.domains.is_empty() {
            return true;
        }

        // Extract domain from email
        let domain = match email.split('@').nth(1) {
            Some(domain) => domain.to_lowercase(),
            None => return false, // Invalid email format
        };

        // Check each domain configuration
        for domain_config in &self.domains {
            if !domain_config.enabled {
                continue;
            }

            if domain_config.domain.to_lowercase() == domain {
                if domain_config.allow_all_users {
                    return true;
                }
                
                // Check if specific email is allowed
                return domain_config.allowed_emails
                    .iter()
                    .any(|allowed_email| allowed_email.to_lowercase() == email.to_lowercase());
            }
        }

        false
    }

    /// Get all allowed domains
    pub fn get_allowed_domains(&self) -> Vec<String> {
        if !self.enabled {
            return Vec::new();
        }

        self.domains
            .iter()
            .filter(|d| d.enabled)
            .map(|d| d.domain.clone())
            .collect()
    }

    /// Add or update a domain configuration
    pub fn upsert_domain(&mut self, domain_config: DomainConfig) {
        let now = config::utils::time::now_micros();
        
        if let Some(existing) = self.domains.iter_mut().find(|d| d.domain == domain_config.domain) {
            existing.allow_all_users = domain_config.allow_all_users;
            existing.allowed_emails = domain_config.allowed_emails;
            existing.enabled = domain_config.enabled;
            existing.updated_at = now;
        } else {
            let mut new_domain = domain_config;
            new_domain.created_at = now;
            new_domain.updated_at = now;
            self.domains.push(new_domain);
        }
        
        self.updated_at = now;
    }

    /// Remove a domain configuration
    pub fn remove_domain(&mut self, domain: &str) -> bool {
        let initial_len = self.domains.len();
        self.domains.retain(|d| d.domain != domain);
        let removed = self.domains.len() != initial_len;
        
        if removed {
            self.updated_at = config::utils::time::now_micros();
        }
        
        removed
    }
}

impl From<DomainManagementRequest> for DomainManagementConfig {
    fn from(request: DomainManagementRequest) -> Self {
        let now = config::utils::time::now_micros();
        
        let domains = request.domains
            .into_iter()
            .map(|req| DomainConfig {
                domain: req.domain,
                allow_all_users: req.allow_all_users,
                allowed_emails: req.allowed_emails,
                enabled: req.enabled,
                created_at: now,
                updated_at: now,
            })
            .collect();

        Self {
            domains,
            enabled: request.enabled,
            updated_at: now,
        }
    }
}

impl From<DomainManagementConfig> for DomainManagementResponse {
    fn from(config: DomainManagementConfig) -> Self {
        Self {
            domains: config.domains,
            enabled: config.enabled,
            updated_at: config.updated_at,
        }
    }
}

fn default_enabled() -> bool {
    true
}

fn default_disabled() -> bool {
    false
}

fn default_allow_all() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_email_allowed_disabled() {
        let config = DomainManagementConfig {
            enabled: false,
            domains: vec![],
            updated_at: 0,
        };
        
        assert!(config.is_email_allowed("user@example.com"));
        assert!(config.is_email_allowed("user@anydomain.com"));
    }

    #[test]
    fn test_is_email_allowed_no_domains() {
        let config = DomainManagementConfig {
            enabled: true,
            domains: vec![],
            updated_at: 0,
        };
        
        assert!(config.is_email_allowed("user@example.com"));
    }

    #[test]
    fn test_is_email_allowed_with_allow_all() {
        let config = DomainManagementConfig {
            enabled: true,
            domains: vec![DomainConfig {
                domain: "example.com".to_string(),
                allow_all_users: true,
                allowed_emails: vec![],
                enabled: true,
                created_at: 0,
                updated_at: 0,
            }],
            updated_at: 0,
        };
        
        assert!(config.is_email_allowed("user@example.com"));
        assert!(config.is_email_allowed("another@example.com"));
        assert!(!config.is_email_allowed("user@other.com"));
    }

    #[test]
    fn test_is_email_allowed_with_specific_emails() {
        let config = DomainManagementConfig {
            enabled: true,
            domains: vec![DomainConfig {
                domain: "example.com".to_string(),
                allow_all_users: false,
                allowed_emails: vec![
                    "user1@example.com".to_string(),
                    "user2@example.com".to_string(),
                ],
                enabled: true,
                created_at: 0,
                updated_at: 0,
            }],
            updated_at: 0,
        };
        
        assert!(config.is_email_allowed("user1@example.com"));
        assert!(config.is_email_allowed("user2@example.com"));
        assert!(!config.is_email_allowed("user3@example.com"));
        assert!(!config.is_email_allowed("user@other.com"));
    }

    #[test]
    fn test_case_insensitive_matching() {
        let config = DomainManagementConfig {
            enabled: true,
            domains: vec![DomainConfig {
                domain: "Example.COM".to_string(),
                allow_all_users: false,
                allowed_emails: vec!["User1@Example.COM".to_string()],
                enabled: true,
                created_at: 0,
                updated_at: 0,
            }],
            updated_at: 0,
        };
        
        assert!(config.is_email_allowed("user1@example.com"));
        assert!(config.is_email_allowed("USER1@EXAMPLE.COM"));
    }

    #[test]
    fn test_upsert_domain() {
        let mut config = DomainManagementConfig::default();
        
        let domain_config = DomainConfig {
            domain: "example.com".to_string(),
            allow_all_users: true,
            allowed_emails: vec![],
            enabled: true,
            created_at: 0,
            updated_at: 0,
        };
        
        config.upsert_domain(domain_config);
        assert_eq!(config.domains.len(), 1);
        assert_eq!(config.domains[0].domain, "example.com");
        
        // Update existing domain
        let updated_domain = DomainConfig {
            domain: "example.com".to_string(),
            allow_all_users: false,
            allowed_emails: vec!["user@example.com".to_string()],
            enabled: true,
            created_at: 0,
            updated_at: 0,
        };
        
        config.upsert_domain(updated_domain);
        assert_eq!(config.domains.len(), 1);
        assert!(!config.domains[0].allow_all_users);
        assert_eq!(config.domains[0].allowed_emails.len(), 1);
    }

    #[test]
    fn test_remove_domain() {
        let mut config = DomainManagementConfig {
            enabled: true,
            domains: vec![
                DomainConfig {
                    domain: "example.com".to_string(),
                    allow_all_users: true,
                    allowed_emails: vec![],
                    enabled: true,
                    created_at: 0,
                    updated_at: 0,
                },
                DomainConfig {
                    domain: "test.com".to_string(),
                    allow_all_users: true,
                    allowed_emails: vec![],
                    enabled: true,
                    created_at: 0,
                    updated_at: 0,
                },
            ],
            updated_at: 0,
        };
        
        assert!(config.remove_domain("example.com"));
        assert_eq!(config.domains.len(), 1);
        assert_eq!(config.domains[0].domain, "test.com");
        
        assert!(!config.remove_domain("nonexistent.com"));
        assert_eq!(config.domains.len(), 1);
    }

    #[test]
    fn test_mutual_exclusivity_behavior() {
        let mut config = DomainManagementConfig::default();
        config.enabled = true;
        
        // Test allow_all_users=true with empty allowed_emails
        let domain_config_allow_all = DomainConfig {
            domain: "example.com".to_string(),
            allow_all_users: true,
            allowed_emails: vec![], // Empty as required by mutual exclusivity
            enabled: true,
            created_at: 123456789,
            updated_at: 123456789,
        };
        config.upsert_domain(domain_config_allow_all);
        
        // Should allow any email from the domain
        assert!(config.is_email_allowed("anyone@example.com"));
        assert!(config.is_email_allowed("user1@example.com"));
        assert!(config.is_email_allowed("user2@example.com"));
        
        // Test allow_all_users=false with specific emails
        let domain_config_specific = DomainConfig {
            domain: "other.com".to_string(),
            allow_all_users: false,
            allowed_emails: vec!["user1@other.com".to_string(), "user2@other.com".to_string()],
            enabled: true,
            created_at: 123456789,
            updated_at: 123456789,
        };
        config.upsert_domain(domain_config_specific);
        
        // Should allow only specific emails
        assert!(config.is_email_allowed("user1@other.com"));
        assert!(config.is_email_allowed("user2@other.com"));
        assert!(!config.is_email_allowed("user3@other.com"));
        assert!(!config.is_email_allowed("anyone@other.com"));
        
        // Emails from other domains should not be allowed
        assert!(!config.is_email_allowed("user@different.com"));
    }
} 