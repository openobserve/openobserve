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

//! Storage of the instance-wide authentication policy.
//!
//! The policy is a single `system_settings` row under `_meta`, written only by the admin API. There
//! is no environment-variable path and nothing runs at startup: an instance with no row enforces
//! `PasswordPolicy::default`, which is a permanent valid state rather than a bootstrap phase.
//!
//! The reads here are the caching layer over `system_settings`, which is why they stayed on this
//! side: `o2_enterprise` cannot depend on this crate. [`validate_password`] and
//! [`cookie_max_age_secs`] exist in an OSS build too, answering from the static rule and from
//! `ZO_COOKIE_MAX_AGE`, so their callers need no feature gate of their own.

#[cfg(feature = "enterprise")]
use config::{
    META_ORG_ID,
    meta::system_settings::{SettingCategory, SettingScope, SystemSetting, keys},
};
#[cfg(feature = "enterprise")]
use infra::table::users;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::password_policy::{
    meta::{PasswordPolicy, PasswordResetReason},
    validate::validate_password_strength_with_policy,
};

#[cfg(feature = "enterprise")]
const POLICY_LOCK_KEY: &str = "/password_policy/write";

/// Reject a password the instance would not accept, naming what it fails.
///
/// The single funnel for every human-set password. Without the enterprise feature there is no
/// configurable policy, so this is the static rule that has always applied.
pub async fn validate_password(password: &str) -> Result<(), String> {
    #[cfg(feature = "enterprise")]
    {
        validate_password_strength_with_policy(password, &get_effective_policy().await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        config::utils::password::validate_password_strength(password).map_err(str::to_string)
    }
}

/// How long a sign-in cookie should live, in seconds.
///
/// The policy wins when an administrator has set it; otherwise `ZO_COOKIE_MAX_AGE` stands, so an
/// instance nobody has configured keeps the lifetime its deployment chose. Every place that issues
/// the auth cookie reads this rather than the config value directly.
pub async fn cookie_max_age_secs() -> i64 {
    let fallback = config::get_config().auth.cookie_max_age;
    #[cfg(feature = "enterprise")]
    {
        get_effective_policy().await.cookie_max_age_secs(fallback)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        fallback
    }
}

/// The policy every enforcement point should read, served from the system-settings cache.
///
/// The rotation check consults it on every authenticated request, so the read has to stay off the
/// database — see [`read_stored_policy`] for how an instance with no row does that.
#[cfg(feature = "enterprise")]
pub async fn get_effective_policy() -> PasswordPolicy {
    match read_stored_policy().await {
        Ok(Some(policy)) => policy,
        Ok(None) => PasswordPolicy::default(),
        Err(e) => {
            log::error!("Failed to read the password policy, falling back to the default: {e}");
            PasswordPolicy::default()
        }
    }
}

/// Persist `policy`, flagging every eligible user for a forced password reset if the complexity
/// requirements grew. Returns the number of users flagged, which is 0 when nothing tightened.
///
/// The only writer. Callers must validate the policy first.
#[cfg(feature = "enterprise")]
pub async fn set_policy(policy: &PasswordPolicy) -> Result<u64, anyhow::Error> {
    // Two admins submitting at once would otherwise both read the pre-change policy, and the second
    // write could land a tightening whose sweep never ran.
    let locker = infra::dist_lock::lock(POLICY_LOCK_KEY, 0).await?;
    let result = set_locked(policy).await;
    infra::dist_lock::unlock(&locker).await?;
    result
}

#[cfg(feature = "enterprise")]
async fn set_locked(policy: &PasswordPolicy) -> Result<u64, anyhow::Error> {
    // The *effective* policy, not the stored row: an instance with no row is genuinely enforcing
    // the default, so a first write that raises the bar above it is a real tightening. Diffing
    // against the raw row would skip the sweep on exactly the write most likely to need it.
    let previous = get_effective_policy().await;

    // Sweep before the write. Flagging against a policy that then fails to land is recoverable
    // friction; a landed policy with nobody flagged is a silent enforcement gap.
    let flagged = if policy.is_stricter_than(&previous) {
        let flagged =
            users::flag_all_for_password_reset(PasswordResetReason::PolicyTightened.as_str())
                .await?;
        // The sweep is a bulk UPDATE and emits no per-user event, so without this every node keeps
        // serving must_reset_password = false from cache and the flag enforces nothing.
        crate::user::broadcast_bulk_refresh().await?;
        flagged
    } else {
        0
    };

    write_policy(policy).await?;

    if flagged > 0 {
        log::info!(
            "Password policy tightened, flagged {flagged} native user(s) for a password reset"
        );
    }
    Ok(flagged)
}

/// Read the row, caching the default in its place when there is none.
///
/// The settings cache only ever holds rows that exist, so without the seed every read on an
/// unconfigured instance falls through to a database lookup that can only return nothing — once per
/// request, forever, since no row is a permanent valid state. The cached default says exactly what
/// an absent row means, so callers need not tell the two apart, and a real row written on any node
/// replaces it through `set` or the settings watcher.
#[cfg(feature = "enterprise")]
async fn read_stored_policy() -> Result<Option<PasswordPolicy>, anyhow::Error> {
    let Some(setting) = crate::system_settings::get(
        &SettingScope::Org,
        Some(META_ORG_ID),
        None,
        keys::PASSWORD_POLICY,
    )
    .await?
    else {
        crate::system_settings::set_only_cached(&policy_setting(&PasswordPolicy::default())?).await;
        return Ok(None);
    };

    Ok(Some(serde_json::from_value(setting.setting_value)?))
}

#[cfg(feature = "enterprise")]
async fn write_policy(policy: &PasswordPolicy) -> Result<(), anyhow::Error> {
    crate::system_settings::set(&policy_setting(policy)?).await?;
    Ok(())
}

#[cfg(feature = "enterprise")]
fn policy_setting(policy: &PasswordPolicy) -> Result<SystemSetting, anyhow::Error> {
    Ok(SystemSetting::new_org(
        META_ORG_ID,
        keys::PASSWORD_POLICY,
        serde_json::to_value(policy)?,
    )
    .with_category(SettingCategory::Security)
    .with_description("Instance-wide authentication policy for native users"))
}
