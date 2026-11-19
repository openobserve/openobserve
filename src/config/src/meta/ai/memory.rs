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

//! AI memory: scopes, settings, authors, edits and the pure rules every writer shares.

use std::{fmt, str::FromStr, sync::LazyLock};

use regex::Regex;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const ORG_DEFAULT_MAX_BYTES: i64 = 16 * 1024;
pub const TOOLSET_DEFAULT_MAX_BYTES: i64 = 4 * 1024;
pub const USER_DEFAULT_MAX_BYTES: i64 = 2 * 1024;
pub const SHARED_MAX_BYTES_LIMIT: i64 = 256 * 1024;
pub const USER_MAX_BYTES_LIMIT: i64 = 16 * 1024;
pub const PROMPT_BUDGET_BYTES: i64 = 24 * 1024;
/// o2-ai's `memory_secret_patterns.json`, copied unchanged, so both sides refuse the same text.
const SECRET_PATTERNS_JSON: &str = include_str!("memory_secret_patterns.json");

/// Credential shapes no memory may hold, by name.
static SECRET_RES: LazyLock<Vec<(String, Regex)>> = LazyLock::new(|| {
    #[derive(Deserialize)]
    struct Pattern {
        name: String,
        pattern: String,
    }
    // The file is a constant covered by a test, so it parses and every pattern compiles.
    let patterns: Vec<Pattern> =
        serde_json::from_str(SECRET_PATTERNS_JSON).expect("valid secret pattern file");
    patterns
        .into_iter()
        .map(|p| {
            (
                p.name,
                Regex::new(&p.pattern).expect("valid secret pattern"),
            )
        })
        .collect()
});

static SUPPRESSION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:ignore[sd]?|mute[sd]?|suppress(?:es|ed)?|silence[sd]?|disregard|(?:do not|don't|never) (?:alert|page|investigate|look into|escalate))\b",
    )
    .expect("valid suppression pattern")
});

static ABSENCE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:no|not|never|none|without|absent|missing|doesn't|isn't|aren't|hasn't|haven't)\b",
    )
    .expect("valid absence pattern")
});

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum MemoryScope {
    Org,
    Toolset,
    User,
}

impl MemoryScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Org => "org",
            Self::Toolset => "toolset",
            Self::User => "user",
        }
    }

    pub fn default_max_bytes(self) -> i64 {
        match self {
            Self::Org => ORG_DEFAULT_MAX_BYTES,
            Self::Toolset => TOOLSET_DEFAULT_MAX_BYTES,
            Self::User => USER_DEFAULT_MAX_BYTES,
        }
    }

    pub fn max_bytes_limit(self) -> i64 {
        match self {
            Self::Org | Self::Toolset => SHARED_MAX_BYTES_LIMIT,
            Self::User => USER_MAX_BYTES_LIMIT,
        }
    }

    /// The size cap in force; a user memory's `setting` is the org row's `user_max_bytes`.
    pub fn effective_max_bytes(self, setting: Option<i64>) -> i64 {
        setting.unwrap_or(self.default_max_bytes())
    }
}

impl fmt::Display for MemoryScope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for MemoryScope {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "org" => Ok(Self::Org),
            "toolset" => Ok(Self::Toolset),
            "user" => Ok(Self::User),
            other => Err(format!("unknown memory scope '{other}'")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum RevisionState {
    Applied,
    Pending,
    Discarded,
}

impl RevisionState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Applied => "applied",
            Self::Pending => "pending",
            Self::Discarded => "discarded",
        }
    }
}

impl FromStr for RevisionState {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "applied" => Ok(Self::Applied),
            "pending" => Ok(Self::Pending),
            "discarded" => Ok(Self::Discarded),
            other => Err(format!("unknown revision state '{other}'")),
        }
    }
}

/// `review`, `auto` and `off` apply to org and toolset memory; `on` and `off` to user memory.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AgentMemoryWrites {
    Review,
    Auto,
    Off,
    On,
}

impl AgentMemoryWrites {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Review => "review",
            Self::Auto => "auto",
            Self::Off => "off",
            Self::On => "on",
        }
    }

    fn allowed_for(self, scope: MemoryScope) -> bool {
        match scope {
            MemoryScope::Org | MemoryScope::Toolset => {
                matches!(self, Self::Review | Self::Auto | Self::Off)
            }
            MemoryScope::User => matches!(self, Self::On | Self::Off),
        }
    }
}

impl FromStr for AgentMemoryWrites {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "review" => Ok(Self::Review),
            "auto" => Ok(Self::Auto),
            "off" => Ok(Self::Off),
            "on" => Ok(Self::On),
            other => Err(format!("unknown agent_memory_writes '{other}'")),
        }
    }
}

/// Settings stored on a memory row; `None` keeps the stored value on update and means the default.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MemorySettings {
    pub agent_memory_writes: Option<AgentMemoryWrites>,
    pub max_bytes: Option<i64>,
    pub user_max_bytes: Option<i64>,
}

impl MemorySettings {
    pub fn is_empty(&self) -> bool {
        self.agent_memory_writes.is_none()
            && self.max_bytes.is_none()
            && self.user_max_bytes.is_none()
    }

    /// Caps range from the scope's default to its maximum; a user memory's cap is set on the org
    /// row.
    pub fn validate(&self, scope: MemoryScope) -> Result<(), String> {
        if let Some(writes) = self.agent_memory_writes
            && !writes.allowed_for(scope)
        {
            return Err(format!(
                "agent_memory_writes '{}' is not allowed for {scope} memory",
                writes.as_str()
            ));
        }
        if scope == MemoryScope::User && self.max_bytes.is_some() {
            return Err("the user memory cap is user_max_bytes on the org memory".to_string());
        }
        if scope != MemoryScope::Org && self.user_max_bytes.is_some() {
            return Err("user_max_bytes can only be set on the org memory".to_string());
        }
        check_cap("max_bytes", self.max_bytes, scope)?;
        check_cap("user_max_bytes", self.user_max_bytes, MemoryScope::User)
    }
}

/// Who made a change: `user:<users.id>`, `agent:<session_id>/<turn_id>` or `system`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Author {
    User(String),
    Agent { session_id: String, turn_id: String },
    System,
}

impl Author {
    pub fn is_agent(&self) -> bool {
        matches!(self, Self::Agent { .. })
    }
}

impl fmt::Display for Author {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::User(id) => write!(f, "user:{id}"),
            Self::Agent {
                session_id,
                turn_id,
            } => write!(f, "agent:{session_id}/{turn_id}"),
            Self::System => f.write_str("system"),
        }
    }
}

impl FromStr for Author {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s == "system" {
            return Ok(Self::System);
        }
        if let Some(id) = s.strip_prefix("user:")
            && !id.is_empty()
        {
            return Ok(Self::User(id.to_string()));
        }
        match s
            .strip_prefix("agent:")
            .and_then(|rest| rest.split_once('/'))
        {
            Some((session_id, turn_id)) if !session_id.is_empty() && !turn_id.is_empty() => {
                Ok(Self::Agent {
                    session_id: session_id.to_string(),
                    turn_id: turn_id.to_string(),
                })
            }
            _ => Err(format!("unknown memory author '{s}'")),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum MemoryEdit {
    Add { section: String, text: String },
    Replace { old: String, new: String },
    Remove { old: String },
}

/// A cited source of an edit; `call_ref` is `"user"` for the turn's chat message.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Evidence {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub call_ref: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
}

/// One memory as it travels with a turn to o2-ai; `not_loaded` blocks carry no content.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryBlock {
    pub content: String,
    pub rev: i64,
    pub writable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op_id: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub not_loaded: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum EditError {
    #[error("edit {index}: the text in `old` is not in the memory")]
    NoMatch { index: usize },
    #[error("edit {index}: the text in `old` is in the memory more than once")]
    MultipleMatches { index: usize },
    #[error("edit {index}: `section`, `text` and `old` must not be empty")]
    Empty { index: usize },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ContentError {
    #[error("the memory would be {size_bytes} bytes, over its {max_bytes} byte cap")]
    TooLarge { size_bytes: i64, max_bytes: i64 },
    #[error("the text looks like a secret ({pattern}); memory may not hold credentials")]
    LooksLikeSecret { pattern: &'static str },
}

/// Why a pending edit may need a closer look from the memory admin who reviews it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EditFlag {
    /// The edit says something is absent ("has no traces"), which a wrong edit can hide.
    StatesAbsence,
    /// The edit tells the agent to ignore, mute or not investigate something.
    SuppressionText,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteMode {
    Apply,
    Hold,
    Refuse,
}

/// 24 KiB plus what each raised cap adds over its scope's default; `caps` are the stored settings.
pub fn prompt_budget(caps: &[(MemoryScope, Option<i64>)]) -> i64 {
    let raised: i64 = caps
        .iter()
        .map(|(scope, cap)| (scope.effective_max_bytes(*cap) - scope.default_max_bytes()).max(0))
        .sum();
    PROMPT_BUDGET_BYTES + raised
}

/// How many of `sizes` (toolset memories, newest-updated first) fit after `fixed` bytes; the
/// first one that does not fit ends the list.
pub fn loaded_within_budget(budget: i64, fixed: i64, sizes: &[i64]) -> usize {
    let mut used = fixed;
    for (loaded, size) in sizes.iter().enumerate() {
        if used + size > budget {
            return loaded;
        }
        used += size;
    }
    sizes.len()
}

/// Applies every edit in order to `content`, or none of them.
pub fn apply_edits(content: &str, edits: &[MemoryEdit]) -> Result<String, EditError> {
    let mut out = content.to_string();
    for (index, edit) in edits.iter().enumerate() {
        out = match edit {
            MemoryEdit::Add { section, text } => {
                if section.trim().is_empty() || text.trim().is_empty() {
                    return Err(EditError::Empty { index });
                }
                add_to_section(&out, section.trim(), text.trim_end_matches('\n'))
            }
            MemoryEdit::Replace { old, new } => replace_once(&out, old, new, index)?,
            MemoryEdit::Remove { old } => replace_once(&out, old, "", index)?,
        };
    }
    Ok(out)
}

/// `max_bytes` is the row's setting (the org row's `user_max_bytes` for user memory).
pub fn validate_content(
    scope: MemoryScope,
    content: &str,
    max_bytes: Option<i64>,
) -> Result<(), ContentError> {
    let max_bytes = scope.effective_max_bytes(max_bytes);
    let size_bytes = content.len() as i64;
    if size_bytes > max_bytes {
        return Err(ContentError::TooLarge {
            size_bytes,
            max_bytes,
        });
    }
    match secret_pattern(content) {
        Some(pattern) => Err(ContentError::LooksLikeSecret { pattern }),
        None => Ok(()),
    }
}

/// The name of the first secret pattern `text` matches.
pub fn secret_pattern(text: &str) -> Option<&'static str> {
    SECRET_RES
        .iter()
        .find(|(_, re)| re.is_match(text))
        .map(|(name, _)| name.as_str())
}

/// The flags of the text an edit adds; removing text raises none.
pub fn edit_flags(edits: &[MemoryEdit]) -> Vec<EditFlag> {
    let mut flags = Vec::new();
    for edit in edits {
        // An add may also write a new `## <section>` heading, so the section counts as added text.
        let added = match edit {
            MemoryEdit::Add { section, text } => format!("{section}\n{text}"),
            MemoryEdit::Replace { new, .. } => new.clone(),
            MemoryEdit::Remove { .. } => continue,
        };
        for (flag, re) in [
            (EditFlag::StatesAbsence, &*ABSENCE_RE),
            (EditFlag::SuppressionText, &*SUPPRESSION_RE),
        ] {
            if !flags.contains(&flag) && re.is_match(&added) {
                flags.push(flag);
            }
        }
    }
    flags
}

/// The toolset setting falls back to the org's; `org_setting` is ignored for other scopes.
pub fn effective_agent_writes(
    scope: MemoryScope,
    setting: Option<AgentMemoryWrites>,
    org_setting: Option<AgentMemoryWrites>,
) -> AgentMemoryWrites {
    match scope {
        MemoryScope::Org => setting.unwrap_or(AgentMemoryWrites::Review),
        MemoryScope::Toolset => setting.or(org_setting).unwrap_or(AgentMemoryWrites::Review),
        MemoryScope::User => setting.unwrap_or(AgentMemoryWrites::On),
    }
}

/// Whether a write applies now, waits for a memory admin, or is refused.
pub fn write_mode(
    scope: MemoryScope,
    author: &Author,
    is_memory_admin: bool,
    effective_agent_writes: AgentMemoryWrites,
) -> WriteMode {
    use AgentMemoryWrites::{Auto, Off, On, Review};
    match (scope, author) {
        (_, Author::System) | (MemoryScope::User, Author::User(_)) => WriteMode::Apply,
        (MemoryScope::User, Author::Agent { .. }) => match effective_agent_writes {
            Off => WriteMode::Refuse,
            On | Review | Auto => WriteMode::Apply,
        },
        (MemoryScope::Org | MemoryScope::Toolset, Author::User(_)) if is_memory_admin => {
            WriteMode::Apply
        }
        (MemoryScope::Org | MemoryScope::Toolset, Author::User(_)) => WriteMode::Hold,
        // `on` is not a shared-memory setting, so it gets the default's review.
        (MemoryScope::Org | MemoryScope::Toolset, Author::Agent { .. }) => {
            match effective_agent_writes {
                Auto => WriteMode::Apply,
                Review | On => WriteMode::Hold,
                Off => WriteMode::Refuse,
            }
        }
    }
}

fn check_cap(field: &str, value: Option<i64>, scope: MemoryScope) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    let (min, max) = (scope.default_max_bytes(), scope.max_bytes_limit());
    if (min..=max).contains(&value) {
        return Ok(());
    }
    Err(format!("{field} must be between {min} and {max} bytes"))
}

/// Only `#` and `##` headings end a `##` section; deeper headings belong to it.
fn is_section_boundary(line: &str) -> bool {
    line.starts_with("# ") || line.starts_with("## ")
}

fn add_to_section(content: &str, section: &str, text: &str) -> String {
    let heading = format!("## {section}");
    let lines: Vec<&str> = content.lines().collect();
    let Some(start) = lines.iter().position(|l| l.trim_end() == heading) else {
        let mut out = content.trim_end().to_string();
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&format!("{heading}\n{text}\n"));
        return out;
    };
    let end = lines[start + 1..]
        .iter()
        .position(|l| is_section_boundary(l))
        .map_or(lines.len(), |i| start + 1 + i);
    // The heading itself is non-blank, so the search always finds a line.
    let last = (start..end)
        .rev()
        .find(|&i| !lines[i].trim().is_empty())
        .unwrap_or(start);
    let mut out: Vec<&str> = lines[..=last].to_vec();
    out.push(text);
    out.extend_from_slice(&lines[last + 1..]);
    let mut joined = out.join("\n");
    if content.ends_with('\n') || last + 1 == lines.len() {
        joined.push('\n');
    }
    joined
}

fn replace_once(content: &str, old: &str, new: &str, index: usize) -> Result<String, EditError> {
    if old.is_empty() {
        return Err(EditError::Empty { index });
    }
    let Some(at) = content.find(old) else {
        return Err(EditError::NoMatch { index });
    };
    // Searching again from the next character also catches an overlapping second match.
    let next = at + content[at..].chars().next().map_or(1, char::len_utf8);
    if content[next..].contains(old) {
        return Err(EditError::MultipleMatches { index });
    }
    Ok(format!(
        "{}{new}{}",
        &content[..at],
        &content[at + old.len()..]
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add(section: &str, text: &str) -> MemoryEdit {
        MemoryEdit::Add {
            section: section.to_string(),
            text: text.to_string(),
        }
    }

    fn replace(old: &str, new: &str) -> MemoryEdit {
        MemoryEdit::Replace {
            old: old.to_string(),
            new: new.to_string(),
        }
    }

    fn remove(old: &str) -> MemoryEdit {
        MemoryEdit::Remove {
            old: old.to_string(),
        }
    }

    const DOC: &str = "## Queries\n- one\n\n## Quirks\n- q\n";

    #[test]
    fn add_appends_after_the_last_non_blank_line_of_its_section() {
        assert_eq!(
            apply_edits(DOC, &[add("Queries", "- two")]).unwrap(),
            "## Queries\n- one\n- two\n\n## Quirks\n- q\n"
        );
        assert_eq!(
            apply_edits(DOC, &[add("Quirks", "- r")]).unwrap(),
            "## Queries\n- one\n\n## Quirks\n- q\n- r\n"
        );
        let nested = "## Queries\n### Datadog\n- a\n## Next\n";
        assert_eq!(
            apply_edits(nested, &[add("Queries", "- b")]).unwrap(),
            "## Queries\n### Datadog\n- a\n- b\n## Next\n"
        );
    }

    #[test]
    fn add_creates_a_missing_section_at_the_end() {
        assert_eq!(
            apply_edits(DOC, &[add("Owners", "- web")]).unwrap(),
            "## Queries\n- one\n\n## Quirks\n- q\n\n## Owners\n- web\n"
        );
        assert_eq!(
            apply_edits("", &[add("Owners", "- web")]).unwrap(),
            "## Owners\n- web\n"
        );
    }

    #[test]
    fn replace_and_remove_change_text_that_occurs_exactly_once() {
        assert_eq!(
            apply_edits(DOC, &[replace("- one", "- uno")]).unwrap(),
            "## Queries\n- uno\n\n## Quirks\n- q\n"
        );
        assert_eq!(
            apply_edits(DOC, &[remove("- q\n")]).unwrap(),
            "## Queries\n- one\n\n## Quirks\n"
        );
    }

    #[test]
    fn replace_needs_exactly_one_match() {
        assert_eq!(
            apply_edits(DOC, &[replace("- none", "x")]),
            Err(EditError::NoMatch { index: 0 })
        );
        assert_eq!(
            apply_edits(DOC, &[replace("## Qu", "x")]),
            Err(EditError::MultipleMatches { index: 0 })
        );
        assert_eq!(
            apply_edits("aaa", &[remove("aa")]),
            Err(EditError::MultipleMatches { index: 0 })
        );
        assert_eq!(
            apply_edits(DOC, &[remove("")]),
            Err(EditError::Empty { index: 0 })
        );
        assert_eq!(
            apply_edits(DOC, &[add(" ", "x")]),
            Err(EditError::Empty { index: 0 })
        );
    }

    #[test]
    fn edits_apply_all_together_or_not_at_all() {
        assert_eq!(
            apply_edits(DOC, &[add("Queries", "- two"), replace("- two", "- 2")]).unwrap(),
            "## Queries\n- one\n- 2\n\n## Quirks\n- q\n"
        );
        assert_eq!(
            apply_edits(DOC, &[replace("- one", "- uno"), remove("- missing")]),
            Err(EditError::NoMatch { index: 1 })
        );
    }

    #[test]
    fn content_over_the_cap_is_refused() {
        let at_cap = "x".repeat(USER_DEFAULT_MAX_BYTES as usize);
        assert!(validate_content(MemoryScope::User, &at_cap, None).is_ok());
        assert_eq!(
            validate_content(MemoryScope::User, &format!("{at_cap}x"), None),
            Err(ContentError::TooLarge {
                size_bytes: USER_DEFAULT_MAX_BYTES + 1,
                max_bytes: USER_DEFAULT_MAX_BYTES
            })
        );
        assert!(validate_content(MemoryScope::User, &format!("{at_cap}x"), Some(4096)).is_ok());
    }

    #[test]
    fn write_mode_follows_scope_author_role_and_setting() {
        use AgentMemoryWrites::{Auto, Off, On, Review};
        use MemoryScope::{Org, Toolset, User};
        use WriteMode::{Apply, Hold, Refuse};
        let person = Author::User("u1".to_string());
        let agent = Author::Agent {
            session_id: "s".to_string(),
            turn_id: "t".to_string(),
        };
        let cases = [
            (User, &person, false, Off, Apply),
            (User, &agent, false, On, Apply),
            (User, &agent, false, Off, Refuse),
            (Org, &person, true, Off, Apply),
            (Org, &person, false, Auto, Hold),
            (Toolset, &person, false, Review, Hold),
            (Org, &agent, true, Auto, Apply),
            (Toolset, &agent, false, Review, Hold),
            (Org, &agent, true, Off, Refuse),
            (Org, &agent, false, On, Hold),
            (Org, &Author::System, false, Off, Apply),
            (User, &Author::System, false, Off, Apply),
        ];
        for (scope, author, admin, writes, expected) in cases {
            assert_eq!(
                write_mode(scope, author, admin, writes),
                expected,
                "{scope} {author} admin={admin} {writes:?}"
            );
        }
    }

    #[test]
    fn toolset_writes_inherit_the_org_setting_and_each_scope_has_its_default() {
        use AgentMemoryWrites::{Auto, Off, On, Review};
        assert_eq!(effective_agent_writes(MemoryScope::Org, None, None), Review);
        assert_eq!(
            effective_agent_writes(MemoryScope::Toolset, None, Some(Auto)),
            Auto
        );
        assert_eq!(
            effective_agent_writes(MemoryScope::Toolset, Some(Off), Some(Auto)),
            Off
        );
        assert_eq!(
            effective_agent_writes(MemoryScope::Toolset, None, None),
            Review
        );
        assert_eq!(
            effective_agent_writes(MemoryScope::User, None, Some(Off)),
            On
        );
    }

    #[test]
    fn settings_are_checked_against_the_scope() {
        let ok = |s: MemorySettings, scope| s.validate(scope).is_ok();
        let writes = |w| MemorySettings {
            agent_memory_writes: Some(w),
            ..Default::default()
        };
        let cap = |max_bytes, user_max_bytes| MemorySettings {
            max_bytes,
            user_max_bytes,
            ..Default::default()
        };
        assert!(ok(writes(AgentMemoryWrites::Auto), MemoryScope::Toolset));
        assert!(!ok(writes(AgentMemoryWrites::On), MemoryScope::Org));
        assert!(!ok(writes(AgentMemoryWrites::Review), MemoryScope::User));
        assert!(ok(
            cap(Some(SHARED_MAX_BYTES_LIMIT), Some(USER_MAX_BYTES_LIMIT)),
            MemoryScope::Org
        ));
        assert!(!ok(
            cap(Some(SHARED_MAX_BYTES_LIMIT + 1), None),
            MemoryScope::Org
        ));
        assert!(!ok(
            cap(Some(ORG_DEFAULT_MAX_BYTES - 1), None),
            MemoryScope::Org
        ));
        assert!(ok(
            cap(Some(TOOLSET_DEFAULT_MAX_BYTES), None),
            MemoryScope::Toolset
        ));
        assert!(!ok(
            cap(None, Some(USER_DEFAULT_MAX_BYTES)),
            MemoryScope::Toolset
        ));
        assert!(!ok(
            cap(Some(USER_DEFAULT_MAX_BYTES), None),
            MemoryScope::User
        ));
        assert!(!ok(
            cap(None, Some(USER_MAX_BYTES_LIMIT + 1)),
            MemoryScope::Org
        ));
    }

    #[test]
    fn the_prompt_budget_grows_by_what_raised_caps_add() {
        use MemoryScope::{Org, Toolset, User};
        assert_eq!(prompt_budget(&[]), PROMPT_BUDGET_BYTES);
        assert_eq!(
            prompt_budget(&[(Org, None), (Toolset, None), (User, None)]),
            PROMPT_BUDGET_BYTES
        );
        let raised = [
            (Org, Some(ORG_DEFAULT_MAX_BYTES + 1000)),
            (Toolset, Some(TOOLSET_DEFAULT_MAX_BYTES + 500)),
            (User, Some(USER_DEFAULT_MAX_BYTES + 24)),
        ];
        assert_eq!(prompt_budget(&raised), PROMPT_BUDGET_BYTES + 1524);
    }

    #[test]
    fn toolset_memories_load_newest_first_until_one_does_not_fit() {
        assert_eq!(loaded_within_budget(100, 40, &[30, 31, 0]), 1);
        assert_eq!(loaded_within_budget(100, 40, &[30, 20, 5]), 3);
        assert_eq!(loaded_within_budget(100, 40, &[61, 1]), 0);
        assert_eq!(loaded_within_budget(100, 120, &[0]), 0);
        assert_eq!(loaded_within_budget(100, 0, &[]), 0);
    }

    #[test]
    fn a_memory_block_skips_unset_fields_on_the_wire() {
        let block = MemoryBlock {
            rev: 2,
            writable: true,
            ..Default::default()
        };
        assert_eq!(
            serde_json::to_value(&block).unwrap(),
            serde_json::json!({"content": "", "rev": 2, "writable": true})
        );
        let skipped = MemoryBlock {
            not_loaded: true,
            ..Default::default()
        };
        assert_eq!(serde_json::to_value(&skipped).unwrap()["not_loaded"], true);
    }

    #[test]
    fn credential_shaped_text_is_refused_for_every_writer() {
        assert_eq!(
            SECRET_RES.len(),
            12,
            "every pattern of the shared file compiles"
        );
        let token = format!("ghp_{}", "a".repeat(36));
        let cases = [
            ("key AKIAABCDEFGHIJKLMNOP here", Some("AWS access key")),
            (token.as_str(), Some("GitHub token")),
            ("xoxb-1234567890-abcdef", Some("Slack token")),
            ("-----BEGIN RSA PRIVATE KEY-----", Some("private key")),
            (
                "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2Q",
                Some("JWT"),
            ),
            (
                "https://bob:hunter2@db.example.com",
                Some("credentials in a URL"),
            ),
            (
                "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
                Some("bearer or Api-Token credential"),
            ),
            (
                "api_key: 0123456789abcdef0123",
                Some("key, token or password value"),
            ),
            ("Use `service:<name> status:error` for error rate", None),
            (
                "tokens are rotated weekly; password policy is 90 days",
                None,
            ),
        ];
        for (text, expected) in cases {
            assert_eq!(secret_pattern(text), expected, "{text}");
        }
        assert_eq!(
            validate_content(MemoryScope::Org, "AKIAABCDEFGHIJKLMNOP", None),
            Err(ContentError::LooksLikeSecret {
                pattern: "AWS access key"
            })
        );
    }

    #[test]
    fn added_text_is_flagged_for_absence_and_suppression() {
        assert_eq!(
            edit_flags(&[add("S", "payments has no O2 traces")]),
            [EditFlag::StatesAbsence]
        );
        assert_eq!(
            edit_flags(&[replace("x", "Ignore 5xx alerts from checkout")]),
            [EditFlag::SuppressionText]
        );
        assert_eq!(
            edit_flags(&[
                add("S", "do not investigate disk alerts"),
                add("S", "never paged")
            ]),
            [EditFlag::StatesAbsence, EditFlag::SuppressionText]
        );
        assert!(
            edit_flags(&[
                add("S", "checkout calls payments (http)"),
                remove("not here")
            ])
            .is_empty()
        );
        assert_eq!(
            edit_flags(&[add("Do not investigate checkout alerts", "- owned by web")]),
            [EditFlag::StatesAbsence, EditFlag::SuppressionText],
            "a pending add whose new heading carries the suppression"
        );
        assert_eq!(
            serde_json::to_string(&[EditFlag::StatesAbsence, EditFlag::SuppressionText]).unwrap(),
            r#"["states_absence","suppression_text"]"#
        );
    }

    #[test]
    fn authors_round_trip_through_their_stored_form() {
        for (author, stored) in [
            (Author::User("2abc".to_string()), "user:2abc"),
            (
                Author::Agent {
                    session_id: "s1".to_string(),
                    turn_id: "t1".to_string(),
                },
                "agent:s1/t1",
            ),
            (Author::System, "system"),
        ] {
            assert_eq!(author.to_string(), stored);
            assert_eq!(stored.parse::<Author>().unwrap(), author);
        }
        for bad in ["user:", "agent:s1", "agent:/t", "bot:x", ""] {
            assert!(bad.parse::<Author>().is_err(), "{bad}");
        }
    }

    #[test]
    fn edits_and_evidence_use_the_wire_shape() {
        let edits: Vec<MemoryEdit> = serde_json::from_str(
            r#"[{"op":"add","section":"S","text":"t"},{"op":"replace","old":"a","new":"b"},{"op":"remove","old":"c"}]"#,
        )
        .unwrap();
        assert_eq!(edits, vec![add("S", "t"), replace("a", "b"), remove("c")]);
        let evidence: Evidence = serde_json::from_str(r#"{"call_ref":"user"}"#).unwrap();
        assert_eq!(
            serde_json::to_string(&evidence).unwrap(),
            r#"{"call_ref":"user"}"#
        );
    }
}
