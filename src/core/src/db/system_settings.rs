// Copyright 2026 OpenObserve Inc.

pub use ::db::system_settings::*;

/// Get the agent-signals failure taxonomy for an organization.
pub async fn get_agent_signals_taxonomy(
    org_id: &str,
) -> config::meta::agent_signals::AgentSignalsTaxonomy {
    use config::meta::{
        agent_signals::AgentSignalsTaxonomy, system_settings::keys::AGENT_SIGNALS_TAXONOMY,
    };

    if let Ok(Some(setting)) =
        ::db::system_settings::get_resolved(Some(org_id), None, AGENT_SIGNALS_TAXONOMY).await
    {
        match serde_json::from_value::<AgentSignalsTaxonomy>(setting.setting_value) {
            Ok(taxonomy) => match taxonomy.normalize_and_validate() {
                Ok(taxonomy) => return taxonomy,
                Err(err) => {
                    log::warn!("Ignoring invalid agent-signals taxonomy for org {org_id}: {err}")
                }
            },
            Err(err) => {
                log::warn!("Ignoring malformed agent-signals taxonomy for org {org_id}: {err}")
            }
        }
    }

    get_default_agent_signals_taxonomy()
}

/// Get the default agent-signals taxonomy.
///
/// Loading repository-managed Enterprise defaults is application configuration
/// orchestration, so it intentionally stays outside the database crate.
pub fn get_default_agent_signals_taxonomy() -> config::meta::agent_signals::AgentSignalsTaxonomy {
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::common::agent_signals_config::load_defaults_from_file()
    }
    #[cfg(not(feature = "enterprise"))]
    {
        config::meta::agent_signals::AgentSignalsTaxonomy {
            error_detail_fields: vec!["status_message".to_string()],
            failure_rules: vec![],
        }
    }
}
