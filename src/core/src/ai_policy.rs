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

//! An org's assistant switch and policy for o2-ai calls made outside the chat routes (RCA).

use common::meta::organization::OrgAiSettings;
use o2_enterprise::enterprise::ai::client::TurnPolicy;

/// The org's settings, the defaults when never saved; `Err` when they cannot be read.
pub async fn org_settings(org_id: &str) -> Result<OrgAiSettings, infra::errors::Error> {
    Ok(db::organization::get_org_ai_settings(org_id)
        .await?
        .unwrap_or_default())
}

/// `None` when the org turned the assistant off or its setting cannot be read (fails closed).
pub async fn rca_policy(org_id: &str) -> Option<TurnPolicy> {
    match org_settings(org_id).await {
        Ok(settings) => policy_for(&settings),
        Err(e) => {
            log::warn!("[org_id:{org_id}] assistant settings unreadable, no analysis runs: {e}");
            None
        }
    }
}

/// An RCA run is no chat, so it carries the org's tier and level and no member's grants.
pub fn policy_for(settings: &OrgAiSettings) -> Option<TurnPolicy> {
    settings.enabled.then(|| TurnPolicy {
        permission_tier: settings.permission_tier.as_str().to_string(),
        data_sharing_level: settings.data_sharing_level.as_str().to_string(),
        grants: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use common::meta::organization::{AiDataSharingLevel, AiPermissionTier};

    use super::*;

    #[test]
    fn an_org_that_is_off_gets_no_rca_and_others_carry_their_own_policy() {
        assert_eq!(
            policy_for(&OrgAiSettings::default()),
            Some(TurnPolicy::default())
        );
        let off = OrgAiSettings {
            enabled: false,
            ..Default::default()
        };
        assert_eq!(policy_for(&off), None);
        let strict = OrgAiSettings {
            permission_tier: AiPermissionTier::Read,
            data_sharing_level: AiDataSharingLevel::Schema,
            ..Default::default()
        };
        let policy = policy_for(&strict).unwrap();
        assert_eq!(
            (
                policy.permission_tier.as_str(),
                policy.data_sharing_level.as_str()
            ),
            ("read", "schema")
        );
        assert!(policy.grants.is_empty());
    }
}
