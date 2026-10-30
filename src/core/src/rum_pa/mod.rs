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

//! RUM Product Analytics named events and saved funnels: API shapes and validation.

pub mod replication;
pub mod service;

use infra::table::rum_pa::{
    AppSettingsRow, FunnelRow, MAX_NAME_KEY_CHARS, MAX_PER_APP, NamedEventRow, name_fits,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use utoipa::ToSchema;

pub const MAX_APP_LENGTH: usize = 256;
pub const MAX_NAME_LENGTH: usize = infra::table::rum_pa::MAX_NAME_LENGTH;
pub const MAX_RULES: usize = 10;
pub const MAX_TARGETS: usize = 20;
/// Mirrors the web's `MAX_KEY_LENGTH`, in UTF-16 units as JS `.length` counts.
pub const MAX_KEY_LENGTH: usize = 1024;
pub const MAX_REGEX_LENGTH: usize = 256;
pub const MIN_FUNNEL_STEPS: usize = 2;
pub const MAX_FUNNEL_STEPS: usize = 10;
pub const MAX_DESCRIPTION_LENGTH: usize = 500;
/// Bytes; the enterprise audit log stores request bodies verbatim.
pub const MAX_SQL_BYTES: usize = 65_536;
pub const ID_LENGTH: usize = 27;
pub const MAX_SESSION_RULES: usize = 20;
pub const MAX_PAGE_RULES: usize = 20;
pub const MAX_RULE_VALUES: usize = 20;
pub const MAX_EXCLUSIONS: usize = 5;
pub const MAX_FUNNEL_FILTERS: usize = 10;
pub const MAX_VIEW_CONDS: usize = 5;
/// One day in ms, the bound of an exclusion window and of a step's time on page.
pub const MAX_STEP_MS: i64 = 86_400_000;
pub const MAX_PARAM_NAME_LENGTH: usize = 128;
pub const MAX_ATTRIBUTE_LENGTH: usize = 128;
pub const RULES_HASH_LENGTH: usize = 16;
/// Bot labels removed by the built-in rule; raise `version` whenever the lists change.
pub const BUILTIN_BOTS: BuiltinBotList = BuiltinBotList {
    version: 1,
    families: &["HeadlessChrome", "PhantomJS", "Spider"],
    devices: &["Spider"],
};
const WINDOWS: [&str; 4] = ["session", "1h", "1d", "7d"];
const BREAKDOWNS: [&str; 7] = [
    "browser", "os", "device", "country", "version", "env", "app",
];
/// A rule must never select on a URL parameter that carries a credential.
const CREDENTIAL_PARAMS: [&str; 4] = ["id_token", "access_token", "code", "token"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ViewOp {
    Eq,
    Prefix,
    Regex,
    Param,
    Ref,
}

/// How a rule value is compared with a field: `in` lists every value, the rest take one each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum MatchOp {
    Eq,
    In,
    Prefix,
    Suffix,
    Contains,
    Regex,
}

/// One way a named event matches: a page view, a click, or an error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "t", rename_all = "lowercase", deny_unknown_fields)]
pub enum Rule {
    View {
        op: ViewOp,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(rename = "onPage", default, skip_serializing_if = "Option::is_none")]
        on_page: Option<String>,
    },
    Action {
        /// Absent means `in`, the form stored before click ops existed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        op: Option<MatchOp>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        targets: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<String>,
        #[serde(rename = "onPage", default, skip_serializing_if = "Option::is_none")]
        on_page: Option<String>,
    },
    Error {
        op: MatchOp,
        value: String,
        #[serde(rename = "onPage", default, skip_serializing_if = "Option::is_none")]
        on_page: Option<String>,
    },
}

/// A built-in session field a rule can select on, named as its `_rumdata` column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionField {
    UserAgentUserAgentFamily,
    UserAgentOsFamily,
    UserAgentDeviceFamily,
    GeoInfoCountry,
    GeoInfoCity,
    UsrId,
    UsrEmail,
    UsrAnonymousId,
    Env,
    Version,
}

/// An app filter that hides sessions whose `field` matches one of `values`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SessionRule {
    pub field: SessionField,
    pub op: MatchOp,
    pub values: Vec<String>,
}

/// Takes `PageOp`, not `ViewOp`, because `param` and `ref` mean nothing on a page key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PageRule {
    pub op: PageOp,
    pub value: String,
}

/// How an ignored-page rule compares its value with a page key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PageOp {
    Eq,
    Prefix,
    Regex,
}

/// The body of a settings PUT: the built-in bot switch, session rules and ignored pages.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PutAppSettings {
    pub bots: bool,
    pub sessions: Vec<SessionRule>,
    pub pages: Vec<PageRule>,
    /// 0 creates; any other must equal the stored version.
    pub version: i32,
}

pub struct BuiltinBotList {
    pub version: u32,
    pub families: &'static [&'static str],
    pub devices: &'static [&'static str],
}

/// The `builtinBots` response field, built from `BUILTIN_BOTS`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BuiltinBots {
    pub version: u32,
    pub families: Vec<String>,
    pub devices: Vec<String>,
}

impl From<&BuiltinBotList> for BuiltinBots {
    fn from(list: &BuiltinBotList) -> Self {
        let owned = |labels: &[&str]| labels.iter().map(|l| l.to_string()).collect();
        Self {
            version: list.version,
            families: owned(list.families),
            devices: owned(list.devices),
        }
    }
}

/// An app's exclusions; with no stored row, `id` and the audit fields are null and `version` 0.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub id: Option<String>,
    pub app: String,
    pub bots: bool,
    pub builtin_bots: BuiltinBots,
    #[schema(value_type = Vec<SessionRule>)]
    pub sessions: serde_json::Value,
    #[schema(value_type = Vec<PageRule>)]
    pub pages: serde_json::Value,
    pub version: i32,
    pub rules_hash: String,
    pub created_by: Option<String>,
    pub created_at: Option<i64>,
    pub updated_by: Option<String>,
    pub updated_at: Option<i64>,
}

impl AppSettings {
    /// The built-in default every app has until its first save.
    pub fn unsaved(app: &str) -> Self {
        let sessions = serde_json::json!([]);
        Self {
            id: None,
            app: app.to_string(),
            bots: true,
            builtin_bots: (&BUILTIN_BOTS).into(),
            rules_hash: rules_hash(true, &sessions),
            sessions,
            pages: serde_json::json!([]),
            version: 0,
            created_by: None,
            created_at: None,
            updated_by: None,
            updated_at: None,
        }
    }
}

impl From<AppSettingsRow> for AppSettings {
    fn from(row: AppSettingsRow) -> Self {
        Self {
            id: Some(row.id),
            app: row.app,
            bots: row.bots,
            builtin_bots: (&BUILTIN_BOTS).into(),
            rules_hash: rules_hash(row.bots, &row.sessions),
            sessions: row.sessions,
            pages: row.pages,
            version: row.version,
            created_by: Some(row.created_by),
            created_at: Some(row.created_at),
            updated_by: Some(row.updated_by),
            updated_at: Some(row.updated_at),
        }
    }
}

/// A funnel as the web's `funnelParam` writes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FunnelDef {
    #[schema(value_type = Vec<Vec<Object>>)]
    pub s: Vec<Step>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub u: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub b: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<Object>>)]
    pub x: Option<Vec<Exclusion>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<Object>>)]
    pub f: Option<Vec<FunnelFilter>>,
}

/// `[kind, key]` or `[kind, key, options]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Step {
    Plain(String, String),
    WithOpts(String, String, StepOpts),
}

impl Step {
    fn kind(&self) -> &str {
        match self {
            Self::Plain(kind, _) | Self::WithOpts(kind, ..) => kind,
        }
    }

    fn key(&self) -> &str {
        match self {
            Self::Plain(_, key) | Self::WithOpts(_, key, _) => key,
        }
    }

    fn opts(&self) -> Option<&StepOpts> {
        match self {
            Self::Plain(..) => None,
            Self::WithOpts(_, _, opts) => Some(opts),
        }
    }
}

/// A page step's filters: time on page (ms), `fr: 1`, `er: 1` and view conditions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StepOpts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fr: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub er: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vc: Option<Vec<ViewCond>>,
}

/// A page step's view condition: a URL parameter, or the referrer host, equals one of `values`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase", deny_unknown_fields)]
pub enum ViewCond {
    Param {
        key: String,
        op: MatchOp,
        values: Vec<String>,
    },
    Ref {
        op: MatchOp,
        values: Vec<String>,
    },
}

/// A step that must not occur between steps `a` and `b`, or within `w` ms after step `a`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Exclusion {
    pub s: Step,
    pub a: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub b: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<i64>,
}

/// Filter all steps: keeps sessions where `field` matches one of `values`, or never does if `not`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FunnelFilter {
    pub field: FilterField,
    pub op: MatchOp,
    pub values: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub not: bool,
}

/// A built-in session field, or any other column of the RUM stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum FilterField {
    Builtin(SessionField),
    Attribute(String),
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateNamedEvent {
    pub name: String,
    pub rules: Vec<Rule>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateNamedEvent {
    pub name: String,
    pub rules: Vec<Rule>,
    /// The edit counter the caller read; a different stored one is a `version_conflict`.
    pub version: i32,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateFunnel {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub def: FunnelDef,
    pub sql: String,
    /// The `rulesHash` of the settings `sql` was compiled with.
    #[serde(default)]
    pub rules_hash: Option<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateFunnel {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub def: FunnelDef,
    pub sql: String,
    pub version: i32,
    /// The `rulesHash` of the settings `sql` was compiled with.
    #[serde(default)]
    pub rules_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NamedEvent {
    pub id: String,
    pub app: String,
    pub name: String,
    #[schema(value_type = Vec<Rule>)]
    pub rules: serde_json::Value,
    pub version: i32,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
}

impl From<NamedEventRow> for NamedEvent {
    fn from(row: NamedEventRow) -> Self {
        Self {
            id: row.id,
            app: row.app,
            name: row.name,
            rules: row.rules,
            version: row.version,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_by: row.updated_by,
            updated_at: row.updated_at,
        }
    }
}

/// A saved funnel; `sql` is a snapshot compiled by the web at save time, never re-run here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SavedFunnel {
    pub id: String,
    pub app: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[schema(value_type = FunnelDef)]
    pub def: serde_json::Value,
    pub sql: String,
    #[schema(value_type = Vec<String>)]
    pub event_ids: serde_json::Value,
    pub version: i32,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
    /// Null for a funnel saved before rules existed, which counts as changed.
    #[serde(default)]
    pub rules_hash: Option<String>,
    /// The app's `rulesHash` now; a different `rulesHash` means `sql` is stale.
    pub current_rules_hash: String,
}

impl SavedFunnel {
    pub fn new(row: FunnelRow, current_rules_hash: String) -> Self {
        Self {
            id: row.id,
            app: row.app,
            name: row.name,
            description: row.description,
            def: row.definition,
            sql: row.sql,
            event_ids: row.event_ids,
            version: row.version,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_by: row.updated_by,
            updated_at: row.updated_at,
            rules_hash: row.rules_hash,
            current_rules_hash,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct FunnelRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct NamedEventList {
    pub list: Vec<NamedEvent>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SavedFunnelList {
    pub list: Vec<SavedFunnel>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FunnelRefList {
    pub list: Vec<FunnelRef>,
}

/// A deleted named event's id and the name it had when it was deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct NamedEventRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct NamedEventRefList {
    pub list: Vec<NamedEventRef>,
}

/// The stored row a `version_conflict` returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(untagged)]
pub enum Current {
    Event(NamedEvent),
    Funnel(SavedFunnel),
    AppSettings(AppSettings),
}

/// Every error body: a stable `code`, a message, and the conflict detail where there is one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct RumPaErrorBody {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<Current>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funnels: Option<Vec<FunnelRef>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RumPaError {
    InvalidBody(String),
    InvalidName(String),
    InvalidRules(String),
    InvalidDefinition(String),
    InvalidSql(String),
    InvalidApp(String),
    InvalidId(String),
    NotFound,
    DuplicateName,
    VersionConflict(Box<Current>),
    LimitReached,
    EventInUse(Vec<FunnelRef>),
    UnknownEvent(Vec<String>),
    /// `retry` marks a Postgres deadlock or serialization failure, which is retried once.
    Internal {
        message: String,
        retry: bool,
    },
}

impl RumPaError {
    pub fn status(&self) -> u16 {
        match self {
            Self::InvalidBody(_)
            | Self::InvalidName(_)
            | Self::InvalidRules(_)
            | Self::InvalidDefinition(_)
            | Self::InvalidSql(_)
            | Self::InvalidApp(_)
            | Self::InvalidId(_) => 400,
            Self::NotFound => 404,
            Self::DuplicateName
            | Self::VersionConflict(_)
            | Self::LimitReached
            | Self::EventInUse(_)
            | Self::UnknownEvent(_) => 409,
            Self::Internal { .. } => 500,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidBody(_) => "invalid_body",
            Self::InvalidName(_) => "invalid_name",
            Self::InvalidRules(_) => "invalid_rules",
            Self::InvalidDefinition(_) => "invalid_definition",
            Self::InvalidSql(_) => "invalid_sql",
            Self::InvalidApp(_) => "invalid_app",
            Self::InvalidId(_) => "invalid_id",
            Self::NotFound => "not_found",
            Self::DuplicateName => "duplicate_name",
            Self::VersionConflict(_) => "version_conflict",
            Self::LimitReached => "limit_reached",
            Self::EventInUse(_) => "event_in_use",
            Self::UnknownEvent(_) => "unknown_event",
            Self::Internal { .. } => "internal_error",
        }
    }

    pub fn body(&self) -> RumPaErrorBody {
        let message = match self {
            Self::InvalidBody(m)
            | Self::InvalidName(m)
            | Self::InvalidRules(m)
            | Self::InvalidDefinition(m)
            | Self::InvalidSql(m)
            | Self::InvalidApp(m)
            | Self::InvalidId(m) => m.clone(),
            Self::NotFound => "Not found".to_string(),
            Self::DuplicateName => "Name already exists".to_string(),
            Self::VersionConflict(_) => "Version conflict".to_string(),
            Self::LimitReached => {
                format!("Limit reached: at most {MAX_PER_APP} per app")
            }
            Self::EventInUse(_) => "Event is used by saved funnels".to_string(),
            Self::UnknownEvent(ids) => format!("Unknown named event: {}", ids.join(", ")),
            Self::Internal { .. } => "Internal server error".to_string(),
        };
        RumPaErrorBody {
            code: self.code().to_string(),
            message,
            current: match self {
                Self::VersionConflict(current) => Some((**current).clone()),
                _ => None,
            },
            funnels: match self {
                Self::EventInUse(funnels) => Some(funnels.clone()),
                _ => None,
            },
        }
    }
}

impl From<sea_orm::DbErr> for RumPaError {
    fn from(e: sea_orm::DbErr) -> Self {
        if matches!(
            e.sql_err(),
            Some(sea_orm::SqlErr::UniqueConstraintViolation(_))
        ) {
            return Self::DuplicateName;
        }
        let retry = matches!(sql_state(&e).as_deref(), Some("40P01" | "40001"));
        Self::Internal {
            message: e.to_string(),
            retry,
        }
    }
}

/// Lengths as JS `.length` counts them, so the server never rejects what the web accepted.
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

pub fn validate_app(app: Option<&str>) -> Result<String, RumPaError> {
    match app {
        Some(app) if !app.is_empty() && utf16_len(app) <= MAX_APP_LENGTH => Ok(app.to_string()),
        _ => Err(RumPaError::InvalidApp(format!(
            "app must be 1 to {MAX_APP_LENGTH} characters"
        ))),
    }
}

/// The 27-character KSUID `config::ider::uuid()` mints.
pub fn is_id(id: &str) -> bool {
    id.len() == ID_LENGTH && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

pub fn validate_id(id: &str) -> Result<(), RumPaError> {
    if is_id(id) {
        Ok(())
    } else {
        Err(RumPaError::InvalidId(format!(
            "id must be {ID_LENGTH} letters or digits"
        )))
    }
}

/// The trimmed name to store.
pub fn validate_name(name: &str) -> Result<String, RumPaError> {
    let trimmed = name.trim();
    if !name_fits(trimmed) {
        return Err(RumPaError::InvalidName(format!(
            "name must be 1 to {MAX_NAME_LENGTH} characters, and at most {MAX_NAME_KEY_CHARS} once lowercased"
        )));
    }
    Ok(trimmed.to_string())
}

pub fn validate_rules(rules: &[Rule]) -> Result<(), RumPaError> {
    if rules.is_empty() || rules.len() > MAX_RULES {
        return Err(invalid_rules(format!("1 to {MAX_RULES} rules")));
    }
    rules.iter().try_for_each(validate_rule)
}

/// The definition as stored, plus the distinct named-event ids its steps and exclusions use.
pub fn validate_def(def: &FunnelDef) -> Result<(serde_json::Value, Vec<String>), RumPaError> {
    if def.s.len() < MIN_FUNNEL_STEPS || def.s.len() > MAX_FUNNEL_STEPS {
        return Err(invalid_def(format!(
            "a funnel has {MIN_FUNNEL_STEPS} to {MAX_FUNNEL_STEPS} steps"
        )));
    }
    let mut event_ids: Vec<String> = Vec::new();
    for step in &def.s {
        validate_step(step, &mut event_ids)?;
    }
    validate_exclusions(def, &mut event_ids)?;
    validate_filters(def.f.as_deref())?;
    let unit = def.u.as_deref().unwrap_or("sessions");
    if unit != "sessions" && unit != "users" {
        return Err(invalid_def("u must be sessions or users".to_string()));
    }
    let window = def.w.as_deref().unwrap_or("session");
    if !WINDOWS.contains(&window) {
        return Err(invalid_def(format!(
            "w must be one of {}",
            WINDOWS.join(", ")
        )));
    }
    if let Some(b) = def.b.as_deref()
        && !BREAKDOWNS.contains(&b)
    {
        return Err(invalid_def(format!(
            "b must be one of {}",
            BREAKDOWNS.join(", ")
        )));
    }
    let stored = FunnelDef {
        s: def.s.clone(),
        u: Some(unit.to_string()),
        w: Some(
            if unit == "sessions" {
                "session"
            } else {
                window
            }
            .to_string(),
        ),
        b: def.b.clone(),
        x: def.x.clone(),
        f: def.f.clone(),
    };
    let stored = serde_json::to_value(stored).map_err(|e| RumPaError::Internal {
        message: e.to_string(),
        retry: false,
    })?;
    Ok((stored, event_ids))
}

/// `None` for an absent or empty description.
pub fn validate_description(description: Option<&str>) -> Result<Option<String>, RumPaError> {
    match description {
        None | Some("") => Ok(None),
        Some(d) if utf16_len(d) <= MAX_DESCRIPTION_LENGTH => Ok(Some(d.to_string())),
        Some(_) => Err(RumPaError::InvalidDefinition(format!(
            "description must be at most {MAX_DESCRIPTION_LENGTH} characters"
        ))),
    }
}

pub fn validate_sql(sql: &str) -> Result<(), RumPaError> {
    if sql.is_empty() || sql.len() > MAX_SQL_BYTES {
        return Err(RumPaError::InvalidSql(format!(
            "sql must be 1 to {MAX_SQL_BYTES} bytes"
        )));
    }
    Ok(())
}

/// `None` is allowed: a node or client older than rules sends no hash.
pub fn validate_rules_hash(hash: Option<&str>) -> Result<(), RumPaError> {
    match hash {
        Some(h)
            if h.len() != RULES_HASH_LENGTH
                || !h
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) =>
        {
            Err(RumPaError::InvalidBody(format!(
                "rules_hash must be {RULES_HASH_LENGTH} lowercase hex characters"
            )))
        }
        _ => Ok(()),
    }
}

pub fn validate_settings(body: &PutAppSettings) -> Result<(), RumPaError> {
    if body.sessions.len() > MAX_SESSION_RULES {
        return Err(invalid_rules(format!(
            "at most {MAX_SESSION_RULES} session rules"
        )));
    }
    if body.pages.len() > MAX_PAGE_RULES {
        return Err(invalid_rules(format!(
            "at most {MAX_PAGE_RULES} page rules"
        )));
    }
    for rule in &body.sessions {
        if rule.values.is_empty() || rule.values.len() > MAX_RULE_VALUES {
            return Err(invalid_rules(format!(
                "a session rule has 1 to {MAX_RULE_VALUES} values"
            )));
        }
        for value in &rule.values {
            validate_match_value(value, rule.op == MatchOp::Regex)?;
        }
    }
    for rule in &body.pages {
        validate_match_value(&rule.value, rule.op == PageOp::Regex)?;
    }
    Ok(())
}

/// The first 27 hex characters of SHA-256 over `{org}/{app}`, so every region derives the same id.
pub fn settings_id(org: &str, app: &str) -> String {
    sha256_hex(format!("{org}/{app}").as_bytes())[..ID_LENGTH].to_string()
}

/// Covers only what changes a funnel's query, so ignored pages are left out.
pub fn rules_hash(bots: bool, sessions: &serde_json::Value) -> String {
    let builtin_version = bots.then_some(BUILTIN_BOTS.version);
    let canonical = serde_json::json!({
        "bots": bots,
        "builtin_version": builtin_version,
        "sessions": sorted_keys(sessions),
    });
    sha256_hex(canonical.to_string().as_bytes())[..RULES_HASH_LENGTH].to_string()
}

fn validate_step(step: &Step, event_ids: &mut Vec<String>) -> Result<(), RumPaError> {
    let (kind, key) = (step.kind(), step.key());
    match kind {
        "p" | "c" | "r" if is_key(key) => {}
        "e" if is_id(key) => {
            if !event_ids.iter().any(|id| id == key) {
                event_ids.push(key.to_string());
            }
        }
        "p" | "c" | "e" | "r" => return Err(invalid_def(format!("invalid {kind} step key"))),
        _ => return Err(invalid_def(format!("unknown step kind {kind:?}"))),
    }
    let Some(opts) = step.opts() else {
        return Ok(());
    };
    if kind != "p" {
        return Err(invalid_def(
            "step options apply only to p steps".to_string(),
        ));
    }
    if opts
        .min
        .is_some_and(|min| !(0..=MAX_STEP_MS).contains(&min))
    {
        return Err(invalid_def(format!("min is 0 to {MAX_STEP_MS} ms")));
    }
    if [opts.fr, opts.er]
        .iter()
        .any(|flag| flag.is_some_and(|f| f != 1))
    {
        return Err(invalid_def("fr and er are 1 when set".to_string()));
    }
    validate_view_conds(opts.vc.as_deref())
}

/// Reuses the named-event param and referrer checks, so credential parameters stay refused.
fn validate_view_conds(conds: Option<&[ViewCond]>) -> Result<(), RumPaError> {
    let Some(conds) = conds else {
        return Ok(());
    };
    if conds.is_empty() || conds.len() > MAX_VIEW_CONDS {
        return Err(invalid_def(format!(
            "a step has 1 to {MAX_VIEW_CONDS} view conditions"
        )));
    }
    for cond in conds {
        let (op, values) = match cond {
            ViewCond::Param { op, values, .. } | ViewCond::Ref { op, values } => (*op, values),
        };
        if op != MatchOp::Eq {
            return Err(invalid_def("a view condition takes eq".to_string()));
        }
        if values.is_empty() || values.len() > MAX_RULE_VALUES {
            return Err(invalid_def(format!(
                "a view condition has 1 to {MAX_RULE_VALUES} values"
            )));
        }
        for value in values {
            let checked = match cond {
                ViewCond::Param { key, .. } => validate_view(ViewOp::Param, Some(value), Some(key)),
                ViewCond::Ref { .. } => validate_view(ViewOp::Ref, Some(value), None),
            };
            checked.map_err(as_def)?;
        }
    }
    Ok(())
}

// Env and version stay page-wide, so a saved funnel never carries its own scope.
fn validate_filters(filters: Option<&[FunnelFilter]>) -> Result<(), RumPaError> {
    let Some(filters) = filters else {
        return Ok(());
    };
    if filters.len() > MAX_FUNNEL_FILTERS {
        return Err(invalid_def(format!(
            "a funnel has at most {MAX_FUNNEL_FILTERS} filters"
        )));
    }
    for filter in filters {
        match &filter.field {
            FilterField::Builtin(SessionField::Env | SessionField::Version) => {
                return Err(invalid_def(
                    "a funnel filter cannot use env or version".to_string(),
                ));
            }
            FilterField::Attribute(name) if !is_filter_column(name) => {
                return Err(invalid_def(
                    "a funnel filter field is a stream column name".to_string(),
                ));
            }
            _ => {}
        }
        if filter.values.is_empty() || filter.values.len() > MAX_RULE_VALUES {
            return Err(invalid_def(format!(
                "a funnel filter has 1 to {MAX_RULE_VALUES} values"
            )));
        }
        for value in &filter.values {
            validate_match_value(value, filter.op == MatchOp::Regex).map_err(as_def)?;
        }
    }
    Ok(())
}

// The name is quoted into SQL, so only what ingest writes passes; `_` columns are internal.
fn is_filter_column(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_ATTRIBUTE_LENGTH
        && !name.starts_with('_')
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

fn validate_exclusions(def: &FunnelDef, event_ids: &mut Vec<String>) -> Result<(), RumPaError> {
    let Some(exclusions) = &def.x else {
        return Ok(());
    };
    if exclusions.len() > MAX_EXCLUSIONS {
        return Err(invalid_def(format!(
            "a funnel has at most {MAX_EXCLUSIONS} exclusions"
        )));
    }
    let steps = def.s.len() as i64;
    for exclusion in exclusions {
        // The queries match an exclusion by its step alone, so options on it would be ignored.
        if exclusion.s.opts().is_some() {
            return Err(invalid_def(
                "an exclusion step takes no options".to_string(),
            ));
        }
        validate_step(&exclusion.s, event_ids)?;
        let a = exclusion.a;
        match (exclusion.b, exclusion.w) {
            (Some(b), None) if 1 <= a && a < b && b <= steps => {
                // Every session reaching b passed each step inside the span, so excluding one
                // removes all.
                let inside = &def.s[a as usize..(b - 1) as usize];
                if matches!(exclusion.s.kind(), "p" | "c")
                    && inside
                        .iter()
                        .any(|s| s.kind() == exclusion.s.kind() && s.key() == exclusion.s.key())
                {
                    return Err(invalid_def(
                        "a between exclusion cannot be a step inside its span".to_string(),
                    ));
                }
            }
            (None, Some(w)) if (1..=steps).contains(&a) && (1..=MAX_STEP_MS).contains(&w) => {
                let anchor = &def.s[(a - 1) as usize];
                if exclusion.s.kind() == "p"
                    && anchor.kind() == "p"
                    && exclusion.s.key() == anchor.key()
                {
                    return Err(invalid_def(
                        "a within exclusion cannot be the step-a page".to_string(),
                    ));
                }
            }
            _ => {
                return Err(invalid_def(format!(
                    "an exclusion has 1 <= a < b <= {steps}, or 1 <= a <= {steps} and w of 1 to {MAX_STEP_MS} ms"
                )));
            }
        }
    }
    Ok(())
}

fn validate_rule(rule: &Rule) -> Result<(), RumPaError> {
    match rule {
        Rule::View {
            op,
            value,
            name,
            on_page,
        } => {
            validate_on_page(on_page.as_deref())?;
            validate_view(*op, value.as_deref(), name.as_deref())
        }
        Rule::Action {
            op,
            targets,
            value,
            on_page,
        } => {
            validate_on_page(on_page.as_deref())?;
            validate_action(*op, targets, value.as_deref())
        }
        Rule::Error { op, value, on_page } => {
            validate_on_page(on_page.as_deref())?;
            if matches!(op, MatchOp::In | MatchOp::Suffix) {
                return Err(invalid_rules(
                    "an error rule takes eq, prefix, contains or regex".to_string(),
                ));
            }
            validate_match_value(value, *op == MatchOp::Regex)
        }
    }
}

fn validate_view(op: ViewOp, value: Option<&str>, name: Option<&str>) -> Result<(), RumPaError> {
    match op {
        ViewOp::Param => {
            let Some(name) = name else {
                return Err(invalid_rules("a param rule names a parameter".to_string()));
            };
            let charset = name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'));
            if name.is_empty() || name.len() > MAX_PARAM_NAME_LENGTH || !charset {
                return Err(invalid_rules(format!(
                    "a parameter name is 1 to {MAX_PARAM_NAME_LENGTH} of A-Z a-z 0-9 _ . -"
                )));
            }
            if CREDENTIAL_PARAMS.contains(&name) {
                return Err(invalid_rules(format!(
                    "a rule cannot select on the {name} parameter"
                )));
            }
            match value {
                Some(value) => validate_match_value(value, false),
                None => Ok(()),
            }
        }
        ViewOp::Ref => {
            let host = value.unwrap_or_default();
            let charset = host
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-'));
            if !is_key(host) || !charset {
                return Err(invalid_rules(
                    "a referrer rule names a host of a-z 0-9 . -".to_string(),
                ));
            }
            Ok(())
        }
        ViewOp::Eq | ViewOp::Prefix | ViewOp::Regex => match value {
            Some(value) => validate_match_value(value, op == ViewOp::Regex),
            None => Err(invalid_rules(format!(
                "a view value is 1 to {MAX_KEY_LENGTH} characters"
            ))),
        },
    }
}

fn validate_action(
    op: Option<MatchOp>,
    targets: &[String],
    value: Option<&str>,
) -> Result<(), RumPaError> {
    match op {
        None | Some(MatchOp::In) => {
            if targets.is_empty() || targets.len() > MAX_TARGETS {
                return Err(invalid_rules(format!("1 to {MAX_TARGETS} click targets")));
            }
            if !targets.iter().all(|t| is_key(t)) {
                return Err(invalid_rules(format!(
                    "a click target is 1 to {MAX_KEY_LENGTH} characters"
                )));
            }
            Ok(())
        }
        Some(op @ (MatchOp::Prefix | MatchOp::Contains | MatchOp::Regex)) => {
            validate_match_value(value.unwrap_or_default(), op == MatchOp::Regex)
        }
        Some(MatchOp::Eq | MatchOp::Suffix) => Err(invalid_rules(
            "a click rule takes in, prefix, contains or regex".to_string(),
        )),
    }
}

fn validate_on_page(on_page: Option<&str>) -> Result<(), RumPaError> {
    if on_page.is_some_and(|p| !is_key(p)) {
        return Err(invalid_rules(format!(
            "onPage is 1 to {MAX_KEY_LENGTH} characters"
        )));
    }
    Ok(())
}

/// A pattern is compiled by `regex`, the engine's regex crate, so the query never fails on it.
fn validate_match_value(value: &str, regex: bool) -> Result<(), RumPaError> {
    if !is_key(value) {
        return Err(invalid_rules(format!(
            "a value is 1 to {MAX_KEY_LENGTH} characters"
        )));
    }
    if regex {
        if utf16_len(value) > MAX_REGEX_LENGTH {
            return Err(invalid_rules(format!(
                "a pattern is at most {MAX_REGEX_LENGTH} characters"
            )));
        }
        regex::Regex::new(value).map_err(|e| invalid_rules(format!("invalid pattern: {e}")))?;
    }
    Ok(())
}

fn is_key(value: &str) -> bool {
    !value.is_empty() && utf16_len(value) <= MAX_KEY_LENGTH
}

fn invalid_rules(message: String) -> RumPaError {
    RumPaError::InvalidRules(message)
}

fn invalid_def(message: String) -> RumPaError {
    RumPaError::InvalidDefinition(message)
}

/// A rule check reused inside a funnel definition reports as the definition's error.
fn as_def(e: RumPaError) -> RumPaError {
    match e {
        RumPaError::InvalidRules(message) => invalid_def(message),
        other => other,
    }
}

// Postgres jsonb reorders object keys, so the hash must not depend on the order they were sent in.
fn sorted_keys(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut entries: Vec<_> = map.iter().collect();
            entries.sort_unstable_by(|a, b| a.0.cmp(b.0));
            serde_json::Value::Object(
                entries
                    .into_iter()
                    .map(|(k, v)| (k.clone(), sorted_keys(v)))
                    .collect(),
            )
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(sorted_keys).collect())
        }
        other => other.clone(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The SQLSTATE of a database error, when the driver reports one.
fn sql_state(e: &sea_orm::DbErr) -> Option<String> {
    use sea_orm::{DbErr, RuntimeErr, sqlx};
    match e {
        DbErr::Exec(RuntimeErr::SqlxError(sqlx::Error::Database(db)))
        | DbErr::Query(RuntimeErr::SqlxError(sqlx::Error::Database(db))) => {
            db.code().map(|c| c.into_owned())
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(op: ViewOp, value: &str) -> Rule {
        serde_json::from_value(serde_json::json!({"t": "view", "op": op, "value": value})).unwrap()
    }

    fn action(targets: usize, on_page: Option<String>) -> Rule {
        let targets: Vec<String> = (0..targets).map(|i| format!("t{i}")).collect();
        let mut rule = serde_json::json!({"t": "action", "targets": targets});
        if let Some(page) = on_page {
            rule["onPage"] = page.into();
        }
        serde_json::from_value(rule).unwrap()
    }

    fn def(steps: &[(&str, &str)], u: Option<&str>, w: Option<&str>, b: Option<&str>) -> FunnelDef {
        let s: Vec<[&str; 2]> = steps.iter().map(|(k, v)| [*k, *v]).collect();
        let mut def = serde_json::json!({"s": s});
        for (key, value) in [("u", u), ("w", w), ("b", b)] {
            if let Some(value) = value {
                def[key] = value.into();
            }
        }
        serde_json::from_value(def).unwrap()
    }

    const ID_A: &str = "2kY9pF34Qy6nB3Wwd25rq4f5zr3";
    const ID_B: &str = "2A7YeEEBY3ABp3e2zS8iq9y7Ajz";

    #[test]
    fn name_counts_utf16_units_after_trimming() {
        assert!(validate_name("").is_err());
        assert!(validate_name("   ").is_err());
        assert_eq!(validate_name(" a ").unwrap(), "a");
        assert!(validate_name(&"a".repeat(80)).is_ok());
        assert!(validate_name(&"a".repeat(81)).is_err());
        let emoji_at_80 = format!("{}😀", "a".repeat(78));
        assert_eq!(utf16_len(&emoji_at_80), 80);
        assert!(validate_name(&emoji_at_80).is_ok());
        let emoji_at_81 = format!("{}😀", "a".repeat(79));
        assert_eq!(emoji_at_81.chars().count(), 80);
        assert!(validate_name(&emoji_at_81).is_err());
    }

    #[test]
    fn a_name_whose_lowercase_overflows_the_key_column_is_invalid_name() {
        let dotted_i = |n: usize| "\u{130}".repeat(n);
        assert_eq!(
            infra::table::rum_pa::name_key(&dotted_i(64))
                .chars()
                .count(),
            128
        );
        assert!(validate_name(&dotted_i(64)).is_ok());
        for n in [65, 80] {
            assert_eq!(
                validate_name(&dotted_i(n)).unwrap_err().code(),
                "invalid_name"
            );
        }
    }

    #[test]
    fn rules_hold_one_to_ten() {
        let one = view(ViewOp::Eq, "/");
        assert!(validate_rules(&[]).is_err());
        assert!(validate_rules(&vec![one.clone(); 1]).is_ok());
        assert!(validate_rules(&vec![one.clone(); 10]).is_ok());
        assert_eq!(
            validate_rules(&vec![one; 11]).unwrap_err().code(),
            "invalid_rules"
        );
    }

    #[test]
    fn an_action_holds_one_to_twenty_targets() {
        assert!(validate_rules(&[action(0, None)]).is_err());
        assert!(validate_rules(&[action(1, None)]).is_ok());
        assert!(validate_rules(&[action(20, None)]).is_ok());
        assert!(validate_rules(&[action(21, None)]).is_err());
    }

    #[test]
    fn value_target_and_on_page_are_bounded_by_the_key_length() {
        let ok = "a".repeat(1024);
        let long = "a".repeat(1025);
        assert!(validate_rules(&[view(ViewOp::Eq, &ok)]).is_ok());
        assert!(validate_rules(&[view(ViewOp::Prefix, &long)]).is_err());
        assert!(validate_rules(&[view(ViewOp::Eq, "")]).is_err());
        let target = |t: &str| -> Rule {
            serde_json::from_value(serde_json::json!({"t": "action", "targets": [t]})).unwrap()
        };
        assert!(validate_rules(&[target(&ok)]).is_ok());
        assert!(validate_rules(&[target(&long)]).is_err());
        assert!(validate_rules(&[action(1, Some(ok))]).is_ok());
        assert!(validate_rules(&[action(1, Some(long))]).is_err());
        assert!(validate_rules(&[action(1, Some(String::new()))]).is_err());
    }

    #[test]
    fn a_pattern_is_bounded_and_compiled_by_the_engine_regex() {
        assert!(validate_rules(&[view(ViewOp::Regex, &"a".repeat(256))]).is_ok());
        assert!(validate_rules(&[view(ViewOp::Regex, &"a".repeat(257))]).is_err());
        assert!(validate_rules(&[view(ViewOp::Regex, r"(a)\1")]).is_err());
        assert!(validate_rules(&[view(ViewOp::Regex, "(?=a)")]).is_err());
        assert!(validate_rules(&[view(ViewOp::Regex, r"\p{L}+")]).is_ok());
        assert!(validate_rules(&[view(ViewOp::Eq, r"(a)\1")]).is_ok());
    }

    #[test]
    fn a_funnel_has_two_to_ten_steps() {
        let steps = |n: usize| vec![("p", "/"); n];
        assert!(validate_def(&def(&steps(1), None, None, None)).is_err());
        assert!(validate_def(&def(&steps(2), None, None, None)).is_ok());
        assert!(validate_def(&def(&steps(10), None, None, None)).is_ok());
        assert_eq!(
            validate_def(&def(&steps(11), None, None, None))
                .unwrap_err()
                .code(),
            "invalid_definition"
        );
    }

    #[test]
    fn the_window_is_forced_to_session_for_the_sessions_unit() {
        let steps = [("p", "/"), ("c", "Buy")];
        let (stored, _) = validate_def(&def(&steps, Some("sessions"), Some("7d"), None)).unwrap();
        assert_eq!(
            stored,
            serde_json::json!({"s": [["p", "/"], ["c", "Buy"]], "u": "sessions", "w": "session"})
        );
        let (stored, _) = validate_def(&def(&steps, Some("users"), Some("7d"), None)).unwrap();
        assert_eq!(stored["w"], "7d");
        let (stored, _) = validate_def(&def(&steps, None, None, None)).unwrap();
        assert_eq!(
            (&stored["u"], &stored["w"]),
            (&"sessions".into(), &"session".into())
        );
        assert!(validate_def(&def(&steps, Some("people"), None, None)).is_err());
        assert!(validate_def(&def(&steps, Some("users"), Some("2d"), None)).is_err());
    }

    #[test]
    fn the_breakdown_is_one_of_the_web_dimensions() {
        let steps = [("p", "/"), ("p", "/a")];
        for b in BREAKDOWNS {
            let (stored, _) = validate_def(&def(&steps, None, None, Some(b))).unwrap();
            assert_eq!(stored["b"], b);
        }
        assert!(validate_def(&def(&steps, None, None, Some("city"))).is_err());
    }

    #[test]
    fn step_keys_follow_their_kind() {
        let long = "a".repeat(1025);
        assert!(validate_def(&def(&[("p", "/"), ("p", &long)], None, None, None)).is_err());
        assert!(validate_def(&def(&[("p", "/"), ("c", "")], None, None, None)).is_err());
        assert!(validate_def(&def(&[("p", "/"), ("x", "a")], None, None, None)).is_err());
        assert!(validate_def(&def(&[("p", "/"), ("e", "short")], None, None, None)).is_err());
        let (_, ids) = validate_def(&def(
            &[("e", ID_B), ("p", "/"), ("e", ID_A), ("e", ID_B)],
            None,
            None,
            None,
        ))
        .unwrap();
        assert_eq!(ids, [ID_B, ID_A]);
    }

    #[test]
    fn ids_are_27_letters_or_digits() {
        assert!(validate_id(ID_A).is_ok());
        assert!(validate_id(&config::ider::uuid()).is_ok());
        assert!(validate_id(&ID_A[..26]).is_err());
        assert!(validate_id(&format!("{ID_A}x")).is_err());
        assert!(validate_id(&format!("{}-", &ID_A[..26])).is_err());
        assert_eq!(validate_id("").unwrap_err().code(), "invalid_id");
    }

    #[test]
    fn description_and_sql_are_bounded() {
        assert_eq!(validate_description(Some("")).unwrap(), None);
        assert!(validate_description(Some(&"d".repeat(500))).is_ok());
        assert!(validate_description(Some(&"d".repeat(501))).is_err());
        assert!(validate_sql("").is_err());
        assert!(validate_sql(&"s".repeat(MAX_SQL_BYTES)).is_ok());
        assert_eq!(
            validate_sql(&"s".repeat(MAX_SQL_BYTES + 1))
                .unwrap_err()
                .code(),
            "invalid_sql"
        );
    }

    #[test]
    fn app_is_one_to_256_units() {
        assert!(validate_app(None).is_err());
        assert!(validate_app(Some("")).is_err());
        assert_eq!(validate_app(Some("a/b")).unwrap(), "a/b");
        assert!(validate_app(Some(&"a".repeat(256))).is_ok());
        assert_eq!(
            validate_app(Some(&"a".repeat(257))).unwrap_err().code(),
            "invalid_app"
        );
    }

    #[test]
    fn bodies_reject_unknown_fields() {
        let with_event_ids = serde_json::json!({
            "name": "f", "def": {"s": [["p", "/"], ["p", "/a"]]}, "sql": "x", "eventIds": []
        });
        assert!(serde_json::from_value::<CreateFunnel>(with_event_ids).is_err());
        let rule_extra = serde_json::json!({"name": "e", "rules": [{"t": "view", "op": "eq", "value": "/", "x": 1}]});
        assert!(serde_json::from_value::<CreateNamedEvent>(rule_extra).is_err());
        let ok = serde_json::json!({"name": "e", "rules": [{"t": "action", "targets": ["a"], "onPage": "/p"}]});
        let parsed = serde_json::from_value::<CreateNamedEvent>(ok).unwrap();
        let rules = serde_json::to_value(&parsed.rules).unwrap();
        assert_eq!(
            (&rules[0]["t"], &rules[0]["targets"], &rules[0]["onPage"]),
            (&"action".into(), &serde_json::json!(["a"]), &"/p".into())
        );
    }

    const SESSION_FIELDS: [&str; 10] = [
        "user_agent_user_agent_family",
        "user_agent_os_family",
        "user_agent_device_family",
        "geo_info_country",
        "geo_info_city",
        "usr_id",
        "usr_email",
        "usr_anonymous_id",
        "env",
        "version",
    ];

    fn settings_body(sessions: serde_json::Value, pages: serde_json::Value) -> serde_json::Value {
        serde_json::json!({"bots": true, "sessions": sessions, "pages": pages, "version": 0})
    }

    fn parses_as_settings(body: serde_json::Value) -> bool {
        serde_json::from_value::<PutAppSettings>(body).is_ok()
    }

    fn fdef(def: serde_json::Value) -> FunnelDef {
        serde_json::from_value(def).unwrap()
    }

    /// Steps `/a`, `/b`, `/c` with the given exclusions.
    fn with_x(x: serde_json::Value) -> Result<(serde_json::Value, Vec<String>), RumPaError> {
        validate_def(&fdef(
            serde_json::json!({"s": [["p", "/a"], ["p", "/b"], ["p", "/c"]], "x": x}),
        ))
    }

    fn def_code(result: Result<(serde_json::Value, Vec<String>), RumPaError>) -> &'static str {
        result.map(|_| "ok").unwrap_or_else(|e| e.code())
    }

    fn rule_of(rule: serde_json::Value) -> Rule {
        serde_json::from_value(rule).unwrap()
    }

    fn rule_code(rule: serde_json::Value) -> &'static str {
        validate_rules(&[rule_of(rule)])
            .map(|_| "ok")
            .unwrap_or_else(|e| e.code())
    }

    #[test]
    fn p2_r1_settings_bodies_take_snake_case_fields_and_lowercase_ops() {
        let sessions: Vec<serde_json::Value> = SESSION_FIELDS
            .iter()
            .map(|f| serde_json::json!({"field": f, "op": "eq", "values": ["x"]}))
            .collect();
        assert!(parses_as_settings(settings_body(
            sessions.into(),
            serde_json::json!([])
        )));
        for op in ["eq", "in", "prefix", "suffix", "contains", "regex"] {
            let rule = serde_json::json!([{"field": "env", "op": op, "values": ["x"]}]);
            assert!(
                parses_as_settings(settings_body(rule, serde_json::json!([]))),
                "{op}"
            );
        }
        for op in ["eq", "prefix", "regex"] {
            let page = serde_json::json!([{"op": op, "value": "/login"}]);
            assert!(
                parses_as_settings(settings_body(serde_json::json!([]), page)),
                "{op}"
            );
        }
        for (sessions, pages) in [
            (
                serde_json::json!([{"field": "user_agent", "op": "eq", "values": ["x"]}]),
                serde_json::json!([]),
            ),
            (
                serde_json::json!([{"field": "env", "op": "Eq", "values": ["x"]}]),
                serde_json::json!([]),
            ),
            (
                serde_json::json!([{"field": "env", "op": "like", "values": ["x"]}]),
                serde_json::json!([]),
            ),
            (
                serde_json::json!([{"field": "env", "op": "eq", "values": ["x"], "x": 1}]),
                serde_json::json!([]),
            ),
            (
                serde_json::json!([]),
                serde_json::json!([{"op": "eq", "value": "/", "x": 1}]),
            ),
        ] {
            assert!(
                !parses_as_settings(settings_body(sessions.clone(), pages.clone())),
                "{sessions} {pages}"
            );
        }
        let mut extra = settings_body(serde_json::json!([]), serde_json::json!([]));
        extra["builtinBots"] = serde_json::json!({});
        assert!(!parses_as_settings(extra));
    }

    #[test]
    fn p2_r2_a_page_rule_refuses_the_param_and_ref_ops() {
        let page = |op: &str| serde_json::json!([{"op": op, "value": "x"}]);
        assert!(parses_as_settings(settings_body(
            serde_json::json!([]),
            page("eq")
        )));
        for op in ["param", "ref"] {
            assert!(
                !parses_as_settings(settings_body(serde_json::json!([]), page(op))),
                "{op}"
            );
        }
    }

    #[test]
    fn p2_r9_the_rules_hash_ignores_object_key_order() {
        let sent = serde_json::json!([{"field": "env", "op": "eq", "values": ["prod"]}]);
        let jsonb = serde_json::json!([{"op": "eq", "field": "env", "values": ["prod"]}]);
        assert_eq!(rules_hash(true, &sent), rules_hash(true, &jsonb));
    }

    #[test]
    fn p2_r12_funnel_bodies_take_a_rules_hash() {
        let create = serde_json::json!({
            "name": "f", "def": {"s": [["p", "/"], ["p", "/a"]]}, "sql": "x",
            "rules_hash": "0123456789abcdef"
        });
        serde_json::from_value::<CreateFunnel>(create.clone()).unwrap();
        let mut update = create;
        update["version"] = 1.into();
        serde_json::from_value::<UpdateFunnel>(update).unwrap();
    }

    #[test]
    fn p3_r1_a_step_takes_options_and_the_definition_takes_exclusions() {
        let def = fdef(serde_json::json!({
            "s": [["p", "/a", {"min": 1000, "fr": 1, "er": 1}], ["p", "/b"]],
            "x": [{"s": ["p", "/c"], "a": 1, "b": 2}]
        }));
        assert!(validate_def(&def).is_ok());
        for opts in [
            serde_json::json!({"mn": 1}),
            serde_json::json!({"min": 1, "x": 1}),
        ] {
            let def = serde_json::json!({"s": [["p", "/a", opts], ["p", "/b"]]});
            assert!(serde_json::from_value::<FunnelDef>(def).is_err());
        }
    }

    #[test]
    fn an_exclusion_inside_its_span_or_with_step_options_is_refused() {
        let inside = serde_json::json!([{"s": ["p", "/b"], "a": 1, "b": 3}]);
        assert_eq!(def_code(with_x(inside)), "invalid_definition");
        let with_opts = serde_json::json!([{"s": ["p", "/z", {"min": 1000}], "a": 1, "b": 2}]);
        assert_eq!(def_code(with_x(with_opts)), "invalid_definition");
        for ok in [
            serde_json::json!([{"s": ["p", "/b"], "a": 2, "b": 3}]),
            serde_json::json!([{"s": ["c", "/b"], "a": 1, "b": 3}]),
            serde_json::json!([{"s": ["p", "/a"], "a": 1, "b": 3}]),
        ] {
            assert_eq!(def_code(with_x(ok.clone())), "ok", "{ok}");
        }
    }

    #[test]
    fn p3_r2_at_most_five_exclusions() {
        let one = serde_json::json!({"s": ["p", "/z"], "a": 1, "b": 2});
        assert_eq!(
            def_code(with_x(serde_json::json!(vec![one.clone(); 5]))),
            "ok"
        );
        assert_eq!(
            def_code(with_x(serde_json::json!(vec![one; 6]))),
            "invalid_definition"
        );
    }

    #[test]
    fn p3_r2_an_exclusion_step_is_checked_like_a_step() {
        let long = "a".repeat(1025);
        for step in [
            serde_json::json!(["q", "/z"]),
            serde_json::json!(["p", ""]),
            serde_json::json!(["p", long]),
            serde_json::json!(["e", "short"]),
        ] {
            let x = serde_json::json!([{"s": step, "a": 1, "b": 2}]);
            assert_eq!(def_code(with_x(x)), "invalid_definition", "{step}");
        }
        let x = serde_json::json!([{"s": ["e", ID_A], "a": 1, "b": 2}]);
        assert_eq!(def_code(with_x(x)), "ok");
    }

    #[test]
    fn p3_r2_between_bounds_are_ordered_steps_of_the_funnel() {
        let between = |a: i64, b: i64| serde_json::json!([{"s": ["p", "/z"], "a": a, "b": b}]);
        for (a, b) in [(1, 2), (1, 3), (2, 3)] {
            assert_eq!(def_code(with_x(between(a, b))), "ok", "{a} {b}");
        }
        for (a, b) in [(0, 1), (2, 2), (2, 1), (2, 4)] {
            assert_eq!(
                def_code(with_x(between(a, b))),
                "invalid_definition",
                "{a} {b}"
            );
        }
    }

    #[test]
    fn p3_r2_an_exclusion_has_exactly_one_of_b_and_w() {
        let neither = serde_json::json!([{"s": ["p", "/z"], "a": 1}]);
        let both = serde_json::json!([{"s": ["p", "/z"], "a": 1, "b": 2, "w": 1000}]);
        assert_eq!(def_code(with_x(neither)), "invalid_definition");
        assert_eq!(def_code(with_x(both)), "invalid_definition");
    }

    #[test]
    fn p3_r2_a_within_window_is_one_ms_to_a_day() {
        let within = |w: i64| serde_json::json!([{"s": ["p", "/z"], "a": 1, "w": w}]);
        for w in [1, 86_400_000] {
            assert_eq!(def_code(with_x(within(w))), "ok", "{w}");
        }
        for w in [0, 86_400_001] {
            assert_eq!(def_code(with_x(within(w))), "invalid_definition", "{w}");
        }
    }

    #[test]
    fn p3_r2_time_on_page_is_zero_to_a_day() {
        let min = |m: i64| {
            validate_def(&fdef(
                serde_json::json!({"s": [["p", "/a", {"min": m}], ["p", "/b"]]}),
            ))
        };
        for m in [0, 86_400_000] {
            assert_eq!(def_code(min(m)), "ok", "{m}");
        }
        assert_eq!(def_code(min(86_400_001)), "invalid_definition");
    }

    #[test]
    fn p3_r2_a_within_exclusion_cannot_name_the_step_a_page() {
        let within = |page: &str| serde_json::json!([{"s": ["p", page], "a": 2, "w": 1000}]);
        assert_eq!(def_code(with_x(within("/b"))), "invalid_definition");
        assert_eq!(def_code(with_x(within("/z"))), "ok");
    }

    #[test]
    fn p3_r3_step_options_are_refused_on_non_page_steps() {
        let with_opts = |step: serde_json::Value| {
            validate_def(&fdef(serde_json::json!({"s": [["p", "/a"], step]})))
        };
        assert_eq!(
            def_code(with_opts(serde_json::json!(["p", "/b", {"min": 1}]))),
            "ok"
        );
        for step in [
            serde_json::json!(["c", "Buy", {"min": 1}]),
            serde_json::json!(["e", ID_A, {"fr": 1}]),
            serde_json::json!(["r", "Boom", {"er": 1}]),
        ] {
            assert_eq!(
                def_code(with_opts(step.clone())),
                "invalid_definition",
                "{step}"
            );
        }
    }

    #[test]
    fn p3_r4_an_exclusion_event_joins_the_event_ids() {
        let (_, ids) = with_x(serde_json::json!([{"s": ["e", ID_A], "a": 1, "b": 2}])).unwrap();
        assert_eq!(ids, [ID_A]);
        let (_, mut ids) = validate_def(&fdef(serde_json::json!({
            "s": [["e", ID_B], ["e", ID_A]],
            "x": [{"s": ["e", ID_A], "a": 1, "b": 2}, {"s": ["e", ID_B], "a": 1, "b": 2}]
        })))
        .unwrap();
        ids.sort();
        let mut expected = vec![ID_A, ID_B];
        expected.sort();
        assert_eq!(ids, expected);
    }

    #[test]
    fn p3_r5_the_stored_definition_keeps_exclusions_and_step_options() {
        let (stored, _) = validate_def(&fdef(serde_json::json!({
            "s": [["p", "/a", {"min": 1000, "fr": 1, "er": 1}], ["p", "/b"], ["p", "/c"]],
            "x": [{"s": ["p", "/z"], "a": 2, "b": 3}, {"s": ["p", "/y"], "a": 1, "w": 500}]
        })))
        .unwrap();
        let opts = &stored["s"][0][2];
        assert_eq!(
            (&opts["min"], &opts["fr"], &opts["er"]),
            (&1000.into(), &1.into(), &1.into()),
            "{stored}"
        );
        assert_eq!(stored["s"][1], serde_json::json!(["p", "/b"]), "{stored}");
        let x = &stored["x"];
        assert_eq!(
            (&x[0]["s"], &x[0]["a"], &x[0]["b"]),
            (&serde_json::json!(["p", "/z"]), &2.into(), &3.into()),
            "{stored}"
        );
        assert_eq!(
            (&x[1]["s"], &x[1]["a"], &x[1]["w"]),
            (&serde_json::json!(["p", "/y"]), &1.into(), &500.into()),
            "{stored}"
        );
    }

    #[test]
    fn p3_r6_an_error_step_is_accepted() {
        let def =
            fdef(serde_json::json!({"s": [["p", "/a"], ["r", "Failed to fetch billing info"]]}));
        assert_eq!(def_code(validate_def(&def)), "ok");
    }

    #[test]
    fn p3_r7_the_app_breakdown_is_accepted() {
        let def = fdef(serde_json::json!({"s": [["p", "/a"], ["p", "/b"]], "b": "app"}));
        let (stored, _) = validate_def(&def).unwrap();
        assert_eq!(stored["b"], "app");
    }

    #[test]
    fn p3_r8_a_param_rule_names_a_safe_parameter() {
        let param = |name: &str| serde_json::json!({"t": "view", "op": "param", "name": name});
        let (longest, too_long) = ("n".repeat(128), "n".repeat(129));
        for name in ["utm_source", "a.b-c_D9", longest.as_str()] {
            assert_eq!(rule_code(param(name)), "ok", "{name}");
        }
        assert_eq!(
            rule_code(
                serde_json::json!({"t": "view", "op": "param", "name": "utm_source", "value": "ads", "onPage": "/signup"})
            ),
            "ok"
        );
        assert_eq!(
            rule_code(serde_json::json!({"t": "view", "op": "param"})),
            "invalid_rules"
        );
        for name in [
            "",
            too_long.as_str(),
            "utm source",
            "a/b",
            "id_token",
            "access_token",
            "code",
            "token",
        ] {
            assert_eq!(rule_code(param(name)), "invalid_rules", "{name}");
        }
    }

    #[test]
    fn p3_r8_a_referrer_rule_names_a_host() {
        let referrer = |host: &str| serde_json::json!({"t": "view", "op": "ref", "value": host});
        for host in ["google.com", "news.ycombinator.com", "a-b.io"] {
            assert_eq!(rule_code(referrer(host)), "ok", "{host}");
        }
        assert_eq!(
            rule_code(
                serde_json::json!({"t": "view", "op": "ref", "value": "google.com", "onPage": "/"})
            ),
            "ok"
        );
        for host in ["", "Google.com", "https://google.com", "goo gle"] {
            assert_eq!(rule_code(referrer(host)), "invalid_rules", "{host}");
        }
    }

    #[test]
    fn p3_r9_a_click_rule_takes_in_prefix_contains_or_regex() {
        assert_eq!(
            rule_code(serde_json::json!({"t": "action", "targets": ["Buy"]})),
            "ok"
        );
        assert_eq!(
            rule_code(serde_json::json!({"t": "action", "op": "in", "targets": ["Buy"]})),
            "ok"
        );
        let matched = |op: &str| serde_json::json!({"t": "action", "op": op, "value": "Buy"});
        for op in ["prefix", "contains", "regex"] {
            assert_eq!(rule_code(matched(op)), "ok", "{op}");
        }
        for op in ["eq", "suffix"] {
            assert_eq!(rule_code(matched(op)), "invalid_rules", "{op}");
        }
    }

    #[test]
    fn p3_r10_an_error_rule_takes_eq_prefix_contains_or_regex() {
        let error = |op: &str| serde_json::json!({"t": "error", "op": op, "value": "Boom"});
        for op in ["eq", "prefix", "contains", "regex"] {
            assert_eq!(rule_code(error(op)), "ok", "{op}");
        }
        for op in ["in", "suffix"] {
            assert_eq!(rule_code(error(op)), "invalid_rules", "{op}");
        }
    }

    /// Steps `/a`, `/b` with the given filters.
    fn with_f(f: serde_json::Value) -> Result<(serde_json::Value, Vec<String>), RumPaError> {
        validate_def(&fdef(
            serde_json::json!({"s": [["p", "/a"], ["p", "/b"]], "f": f}),
        ))
    }

    /// Steps `/a` with the given view conditions, then `/b`.
    fn with_vc(vc: serde_json::Value) -> Result<(serde_json::Value, Vec<String>), RumPaError> {
        validate_def(&fdef(
            serde_json::json!({"s": [["p", "/a", {"vc": vc}], ["p", "/b"]]}),
        ))
    }

    #[test]
    fn p4_f_a_funnel_filter_is_stored_and_rejects_unknown_fields() {
        let filter =
            serde_json::json!({"field": "geo_info_country", "op": "in", "values": ["India"]});
        let (stored, _) = with_f(serde_json::json!([filter.clone()])).unwrap();
        assert_eq!(stored["f"], serde_json::json!([filter]), "{stored}");
        let (plain, _) = with_f(serde_json::Value::Null).unwrap();
        assert!(plain.get("f").is_none(), "{plain}");
        for bad in [
            serde_json::json!([{"field": "geo_info_country", "op": "in", "values": ["x"], "x": 1}]),
            serde_json::json!([{"field": 7, "op": "in", "values": ["x"]}]),
            serde_json::json!([{"field": "geo_info_country", "op": "like", "values": ["x"]}]),
        ] {
            let def = serde_json::json!({"s": [["p", "/a"], ["p", "/b"]], "f": bad});
            assert!(serde_json::from_value::<FunnelDef>(def).is_err(), "{bad}");
        }
    }

    #[test]
    fn p4_f_at_most_ten_filters_of_one_to_twenty_values() {
        let one = |n: usize| {
            let values: Vec<String> = (0..n).map(|i| format!("v{i}")).collect();
            serde_json::json!({"field": "usr_email", "op": "eq", "values": values})
        };
        assert_eq!(def_code(with_f(serde_json::json!(vec![one(1); 10]))), "ok");
        assert_eq!(def_code(with_f(serde_json::json!([one(20)]))), "ok");
        for f in [
            serde_json::json!(vec![one(1); 11]),
            serde_json::json!([one(0)]),
            serde_json::json!([one(21)]),
            serde_json::json!([{"field": "usr_email", "op": "eq", "values": [""]}]),
        ] {
            assert_eq!(def_code(with_f(f.clone())), "invalid_definition", "{f}");
        }
    }

    #[test]
    fn p4_f_env_and_version_are_refused() {
        for field in ["env", "version"] {
            let f = serde_json::json!([{"field": field, "op": "in", "values": ["prod"]}]);
            assert_eq!(def_code(with_f(f)), "invalid_definition", "{field}");
        }
        for field in SESSION_FIELDS
            .iter()
            .filter(|f| !matches!(**f, "env" | "version"))
        {
            let f = serde_json::json!([{"field": field, "op": "in", "values": ["x"]}]);
            assert_eq!(def_code(with_f(f)), "ok", "{field}");
        }
    }

    #[test]
    fn p4_f_a_field_is_any_stream_column_name() {
        let on = |field: &str| {
            def_code(with_f(
                serde_json::json!([{"field": field, "op": "in", "values": ["x"]}]),
            ))
        };
        for field in [
            "context_promo_variant",
            "usr_name",
            "resource_url",
            "view_loading_type",
            "type",
        ] {
            assert_eq!(on(field), "ok", "{field}");
        }
        for field in [
            "",
            "Context_plan",
            "context_plan-tier",
            "context_plan\"",
            "_all",
            "_timestamp",
            &"a".repeat(MAX_ATTRIBUTE_LENGTH + 1),
        ] {
            assert_eq!(on(field), "invalid_definition", "{field}");
        }
    }

    #[test]
    fn p4_f_not_is_stored_only_when_set() {
        let f = |not: bool| serde_json::json!([{"field": "context_plan", "op": "contains", "values": ["pro"], "not": not}]);
        let (negated, _) = with_f(f(true)).unwrap();
        assert_eq!(negated["f"][0]["not"], serde_json::json!(true), "{negated}");
        let (plain, _) = with_f(f(false)).unwrap();
        assert!(plain["f"][0].get("not").is_none(), "{plain}");
        let builtin = serde_json::json!([{"field": "usr_email", "op": "suffix", "values": ["@qa.io"], "not": true}]);
        let (stored, _) = with_f(builtin.clone()).unwrap();
        assert_eq!(stored["f"], builtin, "{stored}");
    }

    #[test]
    fn p4_f_a_regex_value_compiles_in_the_engine() {
        let regex =
            |v: &str| serde_json::json!([{"field": "usr_email", "op": "regex", "values": [v]}]);
        assert_eq!(def_code(with_f(regex("@acme\\.com$"))), "ok");
        assert_eq!(def_code(with_f(regex("(a"))), "invalid_definition");
        assert_eq!(
            def_code(with_f(regex(&"a".repeat(257)))),
            "invalid_definition"
        );
    }

    #[test]
    fn p4_vc_param_and_ref_conditions_ride_in_the_step() {
        let vc = serde_json::json!([
            {"t": "param", "key": "utm_source", "op": "eq", "values": ["ads", "mail"]},
            {"t": "ref", "op": "eq", "values": ["google.com"]}
        ]);
        let (stored, _) = with_vc(vc.clone()).unwrap();
        assert_eq!(stored["s"][0][2]["vc"], vc, "{stored}");
        for bad in [
            serde_json::json!([{"t": "load", "values": ["x"]}]),
            serde_json::json!([{"t": "param", "key": "a", "op": "eq", "values": ["x"], "x": 1}]),
            serde_json::json!([{"t": "ref", "key": "a", "op": "eq", "values": ["a.com"]}]),
            serde_json::json!([{"t": "param", "op": "eq", "values": ["x"]}]),
        ] {
            let def = serde_json::json!({"s": [["p", "/a", {"vc": bad}], ["p", "/b"]]});
            assert!(serde_json::from_value::<FunnelDef>(def).is_err(), "{bad}");
        }
    }

    #[test]
    fn p4_vc_limits_ops_and_page_steps_only() {
        let param = |key: &str, op: &str, values: serde_json::Value| serde_json::json!({"t": "param", "key": key, "op": op, "values": values});
        let ok = param("utm_source", "eq", serde_json::json!(["ads"]));
        assert_eq!(
            def_code(with_vc(serde_json::json!(vec![ok.clone(); 5]))),
            "ok"
        );
        let twenty: Vec<String> = (0..20).map(|i| format!("v{i}")).collect();
        assert_eq!(
            def_code(with_vc(serde_json::json!([param(
                "utm_source",
                "eq",
                twenty.into()
            )]))),
            "ok"
        );
        let too_many: Vec<String> = (0..21).map(|i| format!("v{i}")).collect();
        for vc in [
            serde_json::json!(vec![ok.clone(); 6]),
            serde_json::json!([]),
            serde_json::json!([param("utm_source", "eq", serde_json::json!([]))]),
            serde_json::json!([param("utm_source", "eq", too_many.into())]),
            serde_json::json!([param("utm_source", "prefix", serde_json::json!(["a"]))]),
            serde_json::json!([param("utm source", "eq", serde_json::json!(["a"]))]),
            serde_json::json!([{"t": "ref", "op": "eq", "values": ["Google.com"]}]),
            serde_json::json!([{"t": "ref", "op": "contains", "values": ["google.com"]}]),
        ] {
            assert_eq!(def_code(with_vc(vc.clone())), "invalid_definition", "{vc}");
        }
        let on_click = fdef(serde_json::json!({"s": [["c", "Buy", {"vc": [ok]}], ["p", "/b"]]}));
        assert_eq!(def_code(validate_def(&on_click)), "invalid_definition");
    }

    #[test]
    fn p4_vc_credential_parameters_are_refused() {
        for key in CREDENTIAL_PARAMS {
            let vc = serde_json::json!([{"t": "param", "key": key, "op": "eq", "values": ["x"]}]);
            assert_eq!(def_code(with_vc(vc)), "invalid_definition", "{key}");
        }
    }
}
