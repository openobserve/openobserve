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

//! Alert leases: a temporary alert, or an alert's `creates_incident` held at a value for a window.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The reserved actor id an in-process caller writes leases as.
pub const AUTOOBSERVE_ACTOR: &str = "system:autoobserve";
/// The longest a lease may run; a forgotten lease must not act as a permanent change.
pub const MAX_LEASE_US: i64 = 7 * 24 * 3600 * 1_000_000;
/// How long a temporary alert stays disabled after its lease ends before it is deleted.
pub const PURGE_AFTER_US: i64 = 7 * 24 * 3600 * 1_000_000;
pub const MAX_REASON_CHARS: usize = 500;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LeaseKind {
    /// The alert exists for this lease; it is disabled at the end.
    #[default]
    Created,
    /// `creates_incident` holds `set_value` for the window, then the prior value returns.
    CreatesIncident,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LeaseState {
    #[default]
    Active,
    /// Recorded before the change it covers; a change whose request never finished is undone.
    Pending,
    Ended,
    /// A person made the temporary alert permanent.
    Kept,
    /// The alert changed after the lease's own write, so the lease let go and touched nothing.
    Superseded,
    /// The temporary alert was deleted after its grace period.
    Removed,
}

macro_rules! str_enum {
    ($ty:ident { $($variant:ident => $name:literal),+ $(,)? }) => {
        impl $ty {
            pub fn as_str(&self) -> &'static str {
                match self {
                    $(Self::$variant => $name,)+
                }
            }
        }

        impl std::str::FromStr for $ty {
            type Err = String;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                match s {
                    $($name => Ok(Self::$variant),)+
                    other => Err(format!("unknown {} {other}", stringify!($ty))),
                }
            }
        }
    };
}

str_enum!(LeaseKind {
    Created => "created",
    CreatesIncident => "creates_incident",
});
str_enum!(LeaseState {
    Active => "active",
    Pending => "pending",
    Ended => "ended",
    Kept => "kept",
    Superseded => "superseded",
    Removed => "removed",
});

/// One stored lease. Versions are the alert's `updated_at` in microseconds.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AlertLease {
    pub id: String,
    pub org_id: String,
    pub alert_id: String,
    pub kind: LeaseKind,
    pub set_value: bool,
    pub prior_enabled: Option<bool>,
    pub prior_creates_incident: Option<bool>,
    /// The alert version the lease's own write left; any other version means someone else wrote.
    pub alert_version_us: i64,
    /// The version the end write stamps, fixed at claim time so a retried end knows its own write.
    pub end_version_us: Option<i64>,
    pub starts_at_us: i64,
    pub ends_at_us: i64,
    pub set_by: String,
    pub reason: String,
    pub origin_ref: Option<String>,
    pub state: LeaseState,
    pub state_reason: Option<String>,
    pub ended_at_us: Option<i64>,
    pub claimed_at_us: Option<i64>,
    pub region: String,
    pub created_at_us: i64,
    pub updated_at_us: i64,
}

impl AlertLease {
    /// The version the end write stamps: past the lease's own write and never in the past.
    pub fn end_stamp(&self, now_us: i64) -> i64 {
        self.end_version_us
            .unwrap_or_else(|| now_us.max(self.alert_version_us + 1))
    }

    pub fn view(&self) -> LeaseView {
        LeaseView {
            id: self.id.clone(),
            alert_id: self.alert_id.clone(),
            kind: self.kind,
            set_value: self.set_value,
            starts_at_us: self.starts_at_us,
            ends_at_us: self.ends_at_us,
            set_by: self.set_by.clone(),
            set_by_name: actor_name(&self.set_by),
            reason: self.reason.clone(),
            origin_ref: self.origin_ref.clone(),
            state: self.state,
            state_reason: self.state_reason.clone(),
            ended_at_us: self.ended_at_us,
            version: self.alert_version_us,
        }
    }
}

/// The name people see for who set a lease: a reserved actor's product name, else the user id.
pub fn actor_name(set_by: &str) -> String {
    if set_by == AUTOOBSERVE_ACTOR {
        "AutoObserve".to_string()
    } else {
        set_by.to_string()
    }
}

/// A lease as the API returns it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LeaseView {
    pub id: String,
    pub alert_id: String,
    pub kind: LeaseKind,
    pub set_value: bool,
    pub starts_at_us: i64,
    pub ends_at_us: i64,
    pub set_by: String,
    pub set_by_name: String,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_ref: Option<String>,
    pub state: LeaseState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at_us: Option<i64>,
    /// The alert version the lease's write left.
    pub version: i64,
}

/// The `lease` of a create request: the alert is disabled at `ends_at_us` and deleted 7 days later.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LeaseSpec {
    pub ends_at_us: i64,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_ref: Option<String>,
}

/// `PATCH /v2/{org}/alerts/{id}/creates_incident`. With `until_us`, the prior value returns then.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CreatesIncidentRequest {
    pub value: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until_us: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_ref: Option<String>,
    /// The alert version the caller saw; a different stored version answers 409.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_version: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CreatesIncidentResponse {
    pub creates_incident: bool,
    pub version: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<LeaseView>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LeaseExtendRequest {
    pub ends_at_us: i64,
}

/// A 409 body: `code` is `version_changed`, `lease_active`, `change_in_progress`, `not_active` or
/// `multi_region`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LeaseConflict {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease_id: Option<String>,
}

impl LeaseConflict {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            ..Default::default()
        }
    }
}

/// Checks a lease end and reason against the window rule; the error is the user-facing message.
pub fn check_window(ends_at_us: i64, reason: &str, now_us: i64) -> Result<(), String> {
    if ends_at_us <= now_us {
        return Err("The end time must be in the future.".to_string());
    }
    if ends_at_us - now_us > MAX_LEASE_US {
        return Err("The end time must be within 7 days.".to_string());
    }
    let reason = reason.trim();
    if reason.is_empty() {
        return Err("Give a reason; it is shown on the alert.".to_string());
    }
    if reason.chars().count() > MAX_REASON_CHARS {
        return Err(format!(
            "The reason must be at most {MAX_REASON_CHARS} characters."
        ));
    }
    Ok(())
}
