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

use infra::table::rum_pa::{FunnelRow, MAX_NAME_KEY_CHARS, MAX_PER_APP, NamedEventRow, name_fits};
use serde::{Deserialize, Serialize};
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
const WINDOWS: [&str; 4] = ["session", "1h", "1d", "7d"];
const BREAKDOWNS: [&str; 6] = ["browser", "os", "device", "country", "version", "env"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ViewOp {
    Eq,
    Prefix,
    Regex,
}

/// One way a named event matches: a page view, or a click on one of `targets`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "t", rename_all = "lowercase", deny_unknown_fields)]
pub enum Rule {
    View {
        op: ViewOp,
        value: String,
    },
    Action {
        targets: Vec<String>,
        #[serde(rename = "onPage", default, skip_serializing_if = "Option::is_none")]
        on_page: Option<String>,
    },
}

/// A funnel as the web's `funnelParam` writes it: steps `[kind, key]`, unit, window, breakdown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FunnelDef {
    #[schema(value_type = Vec<Vec<String>>)]
    pub s: Vec<(String, String)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub u: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub b: Option<String>,
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
}

impl From<FunnelRow> for SavedFunnel {
    fn from(row: FunnelRow) -> Self {
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

/// The stored row a `version_conflict` returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(untagged)]
pub enum Current {
    Event(NamedEvent),
    Funnel(SavedFunnel),
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

/// The definition as stored, plus the distinct named-event ids its steps use, in step order.
pub fn validate_def(def: &FunnelDef) -> Result<(serde_json::Value, Vec<String>), RumPaError> {
    if def.s.len() < MIN_FUNNEL_STEPS || def.s.len() > MAX_FUNNEL_STEPS {
        return Err(invalid_def(format!(
            "a funnel has {MIN_FUNNEL_STEPS} to {MAX_FUNNEL_STEPS} steps"
        )));
    }
    let mut event_ids: Vec<String> = Vec::new();
    for (kind, key) in &def.s {
        match kind.as_str() {
            "p" | "c" if is_key(key) => {}
            "e" if is_id(key) => {
                if !event_ids.contains(key) {
                    event_ids.push(key.clone());
                }
            }
            "p" | "c" | "e" => return Err(invalid_def(format!("invalid {kind} step key"))),
            _ => return Err(invalid_def(format!("unknown step kind {kind:?}"))),
        }
    }
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

fn validate_rule(rule: &Rule) -> Result<(), RumPaError> {
    match rule {
        Rule::View { op, value } => {
            if !is_key(value) {
                return Err(invalid_rules(format!(
                    "a view value is 1 to {MAX_KEY_LENGTH} characters"
                )));
            }
            if *op == ViewOp::Regex {
                if utf16_len(value) > MAX_REGEX_LENGTH {
                    return Err(invalid_rules(format!(
                        "a pattern is at most {MAX_REGEX_LENGTH} characters"
                    )));
                }
                regex::Regex::new(value)
                    .map_err(|e| invalid_rules(format!("invalid pattern: {e}")))?;
            }
            Ok(())
        }
        Rule::Action { targets, on_page } => {
            if targets.is_empty() || targets.len() > MAX_TARGETS {
                return Err(invalid_rules(format!("1 to {MAX_TARGETS} click targets")));
            }
            if !targets.iter().all(|t| is_key(t)) {
                return Err(invalid_rules(format!(
                    "a click target is 1 to {MAX_KEY_LENGTH} characters"
                )));
            }
            if on_page.as_deref().is_some_and(|p| !is_key(p)) {
                return Err(invalid_rules(format!(
                    "onPage is 1 to {MAX_KEY_LENGTH} characters"
                )));
            }
            Ok(())
        }
    }
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
        Rule::View {
            op,
            value: value.to_string(),
        }
    }

    fn action(targets: usize, on_page: Option<String>) -> Rule {
        Rule::Action {
            targets: (0..targets).map(|i| format!("t{i}")).collect(),
            on_page,
        }
    }

    fn def(steps: &[(&str, &str)], u: Option<&str>, w: Option<&str>, b: Option<&str>) -> FunnelDef {
        FunnelDef {
            s: steps
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            u: u.map(str::to_string),
            w: w.map(str::to_string),
            b: b.map(str::to_string),
        }
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
        let target = |t: &str| Rule::Action {
            targets: vec![t.to_string()],
            on_page: None,
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
        assert_eq!(
            parsed.rules,
            [Rule::Action {
                targets: vec!["a".into()],
                on_page: Some("/p".into())
            }]
        );
    }
}
