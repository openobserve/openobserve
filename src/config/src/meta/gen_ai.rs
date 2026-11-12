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

//! Gen-AI telemetry configuration types.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

const MAX_AGENT_MAPPING_FIELDS: usize = 10;
const MAX_AGENT_MAPPING_FIELD_LEN: usize = 256;

// ---------------------------------------------------------------------------
// Built-in agent-discovery field lists — the SINGLE SOURCE OF TRUTH.
//
// Both the OTel span extractor (OSS `core/traces/otel/extractors/agent.rs`) and
// the Gen-AI agent registry (enterprise `agent_registry.rs`) reference these so
// the "known" fields are defined in exactly one place. Spec-canonical fields
// (`gen_ai.agent.name`, `gen_ai.agent.id`, `gen_ai.agent.version`,
// `deployment.environment.name`) are the always-tried standard tier and are NOT
// duplicated here — these are the framework/legacy fallbacks. The resolver tries
// each in raw, dot-flattened, and `service_`-prefixed resource forms.
// ---------------------------------------------------------------------------

/// Framework agent-name conventions: Google ADK (`gcp.vertex.agent.name`),
/// CrewAI (`crewai.task.agent`), OpenInference/generic (`agent.name`,
/// `llm.agent.name`).
pub const BUILTIN_AGENT_NAME_FIELDS: &[&str] = &[
    "agent.name",
    "llm.agent.name",
    "gcp.vertex.agent.name",
    "crewai.task.agent",
];

/// Framework agent-id conventions.
pub const BUILTIN_AGENT_ID_FIELDS: &[&str] =
    &["agent.id", "agent_id", "llm.agent.id", "llm.agent_id"];

/// Environment fallbacks. `deployment.environment.name` (current OTel semconv)
/// is the standard tier (tried by the resolver first, not listed here). These
/// built-ins cover the legacy OTel key plus the highest-frequency non-standard
/// conventions: bare `env`/`environment` (ad-hoc instrumentation) and
/// `k8s.namespace.name` (teams that use prod/staging namespaces AS the env).
pub const BUILTIN_ENV_FIELDS: &[&str] = &[
    "deployment.environment",
    "env",
    "environment",
    "k8s.namespace.name",
];

/// Version fallbacks. `gen_ai.agent.version` (agent-specific) is the standard
/// tier (tried first, not listed here). These built-ins cover the service-wide
/// OTel version plus common non-standard conventions: `app.version` and
/// `git.commit.sha` (git-SHA-as-version, i.e. deployment/canary tracking).
pub const BUILTIN_VERSION_FIELDS: &[&str] = &["service.version", "app.version", "git.commit.sha"];
const TARGET_AGENT_FIELDS: &[&str] = &[
    "target_agent_name",
    "target_agent_id",
    "attributes.target_agent_name",
    "attributes.target_agent_id",
    "attributes_target_agent_name",
    "attributes_target_agent_id",
];

/// Org-level fallback mapping for normalizing Gen-AI agent identity.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GenAiAgentMappingConfig {
    /// Incoming telemetry attribute names to use as fallbacks for `gen_ai.agent.name`.
    #[serde(default)]
    pub agent_name_fields: Vec<String>,

    /// Incoming telemetry attribute names to use as fallbacks for `gen_ai.agent.id`.
    #[serde(default)]
    pub agent_id_fields: Vec<String>,

    /// Incoming telemetry attribute names to use as fallbacks for the agent's environment.
    #[serde(default)]
    pub env_fields: Vec<String>,

    /// Incoming telemetry attribute names to use as fallbacks for the agent's version.
    #[serde(default)]
    pub version_fields: Vec<String>,

    /// Harness text hidden when reading sessions; read time only, so not part of `is_all_empty`.
    #[serde(default)]
    pub harness_patterns: Vec<HarnessPatternRule>,

    /// Where a session's short title comes from.
    #[serde(default)]
    pub session_title: SessionTitleMode,

    /// Attributes copied to `user.id`, `feature.name`, `tenant.id` at ingest if a span lacks them.
    #[serde(default)]
    pub attribution_fields: AttributionFields,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AttributionFields {
    #[serde(default)]
    pub user: Vec<String>,
    #[serde(default)]
    pub feature: Vec<String>,
    #[serde(default)]
    pub tenant: Vec<String>,
}

impl AttributionFields {
    /// (standard attribute, its fallbacks) per dimension.
    pub fn targets(&self) -> [(&'static str, &[String]); 3] {
        [
            ("user.id", &self.user),
            ("feature.name", &self.feature),
            ("tenant.id", &self.tenant),
        ]
    }
}

/// Agent harness patterns: `tag <name>` hides `<name …>…</name>`, `regex <expr>` hides matches.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct HarnessPatternRule {
    pub agent: String,
    #[serde(default)]
    pub patterns: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionTitleMode {
    #[default]
    Off,
    /// The first request with harness text hidden, cut to a line. Costs nothing.
    FirstRequest,
}

const MAX_HARNESS_RULES: usize = 50;
const MAX_HARNESS_PATTERNS: usize = 20;
const MAX_HARNESS_PATTERN_LEN: usize = 300;
/// Texts one [`HarnessStripRequest`] may carry; the web client sends larger sets in batches.
pub const MAX_HARNESS_STRIP_TEXTS: usize = 500;

/// A compiled harness pattern and the label shown for what it hid (the tag name).
pub type CompiledHarnessPattern = (regex::Regex, String);

/// Compile validated patterns; invalid ones are skipped (save already rejects them).
pub fn compile_harness_patterns(patterns: &[String]) -> Vec<CompiledHarnessPattern> {
    patterns
        .iter()
        .filter_map(|p| parse_harness_pattern(p).ok())
        .collect()
}

/// Rejects patterns that can match empty text: they would hide nothing but still count as hidden.
fn check_harness_pattern(pattern: &str) -> Result<CompiledHarnessPattern, String> {
    if pattern.len() > MAX_HARNESS_PATTERN_LEN {
        return Err(format!(
            "harness pattern '{pattern}' cannot exceed {MAX_HARNESS_PATTERN_LEN} characters"
        ));
    }
    let compiled = parse_harness_pattern(pattern)?;
    if compiled.0.is_match("") {
        return Err(format!(
            "regex in '{pattern}' matches empty text; it must match at least one character"
        ));
    }
    Ok(compiled)
}

fn parse_harness_pattern(pattern: &str) -> Result<CompiledHarnessPattern, String> {
    // Save trims patterns, so `regex ` arrives as `regex`.
    match pattern.trim() {
        "tag" => return Err("tag pattern is empty".to_string()),
        "regex" => return Err("regex pattern is empty".to_string()),
        _ => {}
    }
    if let Some(tag) = pattern.strip_prefix("tag ") {
        let tag = tag.trim();
        if tag.is_empty() {
            return Err("tag pattern is empty".to_string());
        }
        if !tag
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':' | '.'))
        {
            return Err(format!("invalid tag name in '{pattern}'"));
        }
        let t = regex::escape(tag);
        let re = regex::Regex::new(&format!(r"(?s)<{t}\b[^>]*>.*?</{t}\s*>"))
            .map_err(|e| e.to_string())?;
        return Ok((re, tag.to_string()));
    }
    if let Some(expr) = pattern.strip_prefix("regex ") {
        let expr = expr.trim();
        if expr.is_empty() {
            return Err("regex pattern is empty".to_string());
        }
        let re =
            regex::Regex::new(expr).map_err(|e| format!("invalid regex in '{pattern}': {e}"))?;
        return Ok((re, "regex".to_string()));
    }
    Err(format!(
        "pattern '{pattern}' must start with 'tag ' or 'regex '"
    ))
}

/// What hiding harness text left of one message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct HarnessStripped {
    pub text: String,
    /// Blocks hidden.
    pub hidden: usize,
    /// Set when the message was nothing but harness text: what hid it.
    pub only: Option<String>,
}

/// An agent's patterns and messages to hide them in, shared so results match Sessions list.
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
pub struct HarnessStripRequest {
    #[serde(default)]
    pub patterns: Vec<String>,
    #[serde(default)]
    pub texts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct HarnessStripResponse {
    /// One per text, in request order.
    pub results: Vec<HarnessStripped>,
}

impl HarnessStripRequest {
    /// Rejects patterns save would reject, so a draft fails here as it would on save.
    pub fn strip(&self) -> Result<HarnessStripResponse, String> {
        let patterns: Vec<&str> = self
            .patterns
            .iter()
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
            .collect();
        if patterns.len() > MAX_HARNESS_PATTERNS {
            return Err(format!(
                "harness patterns cannot exceed {MAX_HARNESS_PATTERNS}"
            ));
        }
        if self.texts.len() > MAX_HARNESS_STRIP_TEXTS {
            return Err(format!("texts cannot exceed {MAX_HARNESS_STRIP_TEXTS}"));
        }
        let compiled = patterns
            .into_iter()
            .map(check_harness_pattern)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(HarnessStripResponse {
            results: self
                .texts
                .iter()
                .map(|t| strip_harness(t, &compiled))
                .collect(),
        })
    }
}

pub fn strip_harness(text: &str, patterns: &[CompiledHarnessPattern]) -> HarnessStripped {
    let mut out = text.to_string();
    let mut hidden = 0;
    let mut first = None;
    for (re, label) in patterns {
        // Empty matches remove nothing, so they are not blocks hidden.
        let n = re.find_iter(&out).filter(|m| !m.is_empty()).count();
        if n > 0 {
            hidden += n;
            first.get_or_insert_with(|| label.clone());
            out = re.replace_all(&out, "").into_owned();
        }
    }
    let text = out.trim().to_string();
    let only = if text.is_empty() && hidden > 0 {
        first
    } else {
        None
    };
    HarnessStripped { text, hidden, only }
}

impl GenAiAgentMappingConfig {
    /// True when every configured fallback list is empty — i.e. the org has no
    /// meaningful custom mapping. Used to decide precedence (a saved-but-empty
    /// org config falls through to fetched/embedded defaults), mirroring how
    /// semantic field groups treat `!groups.is_empty()`.
    pub fn is_all_empty(&self) -> bool {
        self.agent_name_fields.is_empty()
            && self.agent_id_fields.is_empty()
            && self.env_fields.is_empty()
            && self.version_fields.is_empty()
    }

    /// Trim configured field names on save and validate the public API contract.
    pub fn normalize_and_validate(mut self) -> Result<Self, String> {
        self.agent_name_fields = normalize_fields(self.agent_name_fields);
        self.agent_id_fields = normalize_fields(self.agent_id_fields);

        validate_fields(
            "agent_name_fields",
            &self.agent_name_fields,
            "gen_ai.agent.name",
        )?;
        validate_fields("agent_id_fields", &self.agent_id_fields, "gen_ai.agent.id")?;

        self.env_fields = normalize_fields(self.env_fields);
        self.version_fields = normalize_fields(self.version_fields);

        validate_fields(
            "env_fields",
            &self.env_fields,
            "deployment.environment.name",
        )?;
        validate_fields(
            "version_fields",
            &self.version_fields,
            "gen_ai.agent.version",
        )?;

        self.harness_patterns = normalize_harness_rules(self.harness_patterns)?;

        let a = &mut self.attribution_fields;
        a.user = normalize_fields(std::mem::take(&mut a.user));
        a.feature = normalize_fields(std::mem::take(&mut a.feature));
        a.tenant = normalize_fields(std::mem::take(&mut a.tenant));
        validate_fields("attribution_fields.user", &a.user, "user.id")?;
        validate_fields("attribution_fields.feature", &a.feature, "feature.name")?;
        validate_fields("attribution_fields.tenant", &a.tenant, "tenant.id")?;

        Ok(self)
    }
}

fn normalize_fields(fields: Vec<String>) -> Vec<String> {
    fields
        .into_iter()
        .map(|field| field.trim().to_string())
        .collect()
}

fn normalize_harness_rules(
    rules: Vec<HarnessPatternRule>,
) -> Result<Vec<HarnessPatternRule>, String> {
    let rules: Vec<HarnessPatternRule> = rules
        .into_iter()
        .map(|r| HarnessPatternRule {
            agent: r.agent.trim().to_string(),
            patterns: r
                .patterns
                .into_iter()
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect(),
        })
        .filter(|r| !r.agent.is_empty() && !r.patterns.is_empty())
        .collect();
    if rules.len() > MAX_HARNESS_RULES {
        return Err(format!(
            "harness_patterns cannot exceed {MAX_HARNESS_RULES} agents"
        ));
    }
    let mut agents = HashSet::new();
    for rule in &rules {
        if !agents.insert(rule.agent.as_str()) {
            return Err(format!(
                "harness_patterns contains duplicate agent '{}'",
                rule.agent
            ));
        }
        if rule.patterns.len() > MAX_HARNESS_PATTERNS {
            return Err(format!(
                "harness patterns for '{}' cannot exceed {MAX_HARNESS_PATTERNS}",
                rule.agent
            ));
        }
        for p in &rule.patterns {
            check_harness_pattern(p)?;
        }
    }
    Ok(rules)
}

fn validate_fields(label: &str, fields: &[String], redundant_target: &str) -> Result<(), String> {
    if fields.len() > MAX_AGENT_MAPPING_FIELDS {
        return Err(format!(
            "{label} cannot exceed {MAX_AGENT_MAPPING_FIELDS} fields"
        ));
    }

    let mut seen = HashSet::new();
    for field in fields {
        if field.is_empty() {
            return Err(format!("{label} field names cannot be empty"));
        }
        if field.len() > MAX_AGENT_MAPPING_FIELD_LEN {
            return Err(format!(
                "{label} field '{field}' cannot exceed {MAX_AGENT_MAPPING_FIELD_LEN} characters"
            ));
        }
        if !is_safe_mapping_field(field) {
            return Err(format!(
                "{label} field '{field}' contains invalid characters"
            ));
        }
        if field == redundant_target {
            return Err(format!(
                "{label} must not include redundant target field '{field}'"
            ));
        }
        if TARGET_AGENT_FIELDS.contains(&field.as_str()) {
            return Err(format!(
                "{label} must not include target-agent field '{field}'"
            ));
        }
        if !seen.insert(field.as_str()) {
            return Err(format!("{label} contains duplicate field '{field}'"));
        }
    }

    Ok(())
}

fn is_safe_mapping_field(field: &str) -> bool {
    let Some(first) = field.chars().next() else {
        return false;
    };

    (first.is_ascii_alphabetic() || first == '_')
        && field
            .chars()
            .skip(1)
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_harness_hides_tag_blocks_and_says_what_it_hid() {
        let patterns =
            compile_harness_patterns(&["tag system-reminder".to_string(), "tag job".to_string()]);
        let text = "<system-reminder>\nctx\n</system-reminder>\nFix the durations.";
        let out = strip_harness(text, &patterns);
        assert_eq!(out.text, "Fix the durations.");
        assert_eq!(out.hidden, 1);
        assert_eq!(out.only, None);

        let only = strip_harness("<job id=\"7\">nightly</job>", &patterns);
        assert_eq!(only.text, "");
        assert_eq!(only.only.as_deref(), Some("job"));
        assert_eq!(strip_harness("plain", &patterns).hidden, 0);
    }

    #[test]
    fn attribution_fields_validate_like_the_identity_fields() {
        let config = GenAiAgentMappingConfig {
            attribution_fields: AttributionFields {
                tenant: vec![" customer.org ".to_string()],
                ..Default::default()
            },
            ..Default::default()
        };
        let ok = config.normalize_and_validate().unwrap();
        assert_eq!(ok.attribution_fields.tenant, vec!["customer.org"]);
        let redundant = GenAiAgentMappingConfig {
            attribution_fields: AttributionFields {
                user: vec!["user.id".to_string()],
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(redundant.normalize_and_validate().is_err());
    }

    #[test]
    fn harness_rules_validate_on_save() {
        let config = |p: &str| GenAiAgentMappingConfig {
            harness_patterns: vec![HarnessPatternRule {
                agent: " omp ".to_string(),
                patterns: vec![p.to_string(), "  ".to_string()],
            }],
            ..Default::default()
        };
        let ok = config("regex ^Caveat:.*$")
            .normalize_and_validate()
            .unwrap();
        assert_eq!(ok.harness_patterns[0].agent, "omp");
        assert_eq!(ok.harness_patterns[0].patterns, vec!["regex ^Caveat:.*$"]);
        assert!(ok.is_all_empty(), "harness patterns are read-time only");
        assert!(config("glob *").normalize_and_validate().is_err());
        assert!(config("tag <bad>").normalize_and_validate().is_err());
        let err = config("regex (?<").normalize_and_validate().unwrap_err();
        assert!(err.contains("invalid regex in 'regex (?<'"), "{err}");
    }

    // A regex that can match empty text would count blocks it never hid.
    #[test]
    fn harness_patterns_that_match_empty_text_hide_and_count_nothing() {
        let patterns = compile_harness_patterns(&["regex x*".to_string()]);
        let none = strip_harness("abc", &patterns);
        assert_eq!(
            (none.text.as_str(), none.hidden, none.only),
            ("abc", 0, None)
        );
        let some = strip_harness("axxbx", &patterns);
        assert_eq!((some.text.as_str(), some.hidden), ("ab", 2));

        let config = |p: &str| GenAiAgentMappingConfig {
            harness_patterns: vec![HarnessPatternRule {
                agent: "omp".to_string(),
                patterns: vec![p.to_string()],
            }],
            ..Default::default()
        };
        for p in ["regex x*", "regex ^", "regex (?m)$"] {
            let err = config(p).normalize_and_validate().unwrap_err();
            assert!(err.contains("matches empty text"), "{p}: {err}");
            let err = HarnessStripRequest {
                patterns: vec![p.to_string()],
                texts: vec!["abc".to_string()],
            }
            .strip()
            .unwrap_err();
            assert!(err.contains("matches empty text"), "{p}: {err}");
        }
        assert!(config("regex x+").normalize_and_validate().is_ok());
    }

    // An empty expression says so, not that the prefix is missing.
    #[test]
    fn harness_pattern_with_an_empty_expression_says_it_is_empty() {
        let save = |p: &str| {
            GenAiAgentMappingConfig {
                harness_patterns: vec![HarnessPatternRule {
                    agent: "omp".to_string(),
                    patterns: vec![p.to_string()],
                }],
                ..Default::default()
            }
            .normalize_and_validate()
            .unwrap_err()
        };
        assert_eq!(save("regex "), "regex pattern is empty");
        assert_eq!(save("regex"), "regex pattern is empty");
        assert_eq!(save("tag  "), "tag pattern is empty");
        let strip = |p: &str| {
            HarnessStripRequest {
                patterns: vec![p.to_string()],
                texts: vec!["x".to_string()],
            }
            .strip()
            .unwrap_err()
        };
        assert_eq!(strip("regex   "), "regex pattern is empty");
        assert_eq!(strip("tag "), "tag pattern is empty");
        assert_eq!(
            parse_harness_pattern("regex   ").unwrap_err(),
            "regex pattern is empty"
        );
    }

    // Two rules for one agent made the list and Session Detail hide different text.
    #[test]
    fn harness_rules_refuse_a_duplicate_agent() {
        let rule = |agent: &str, patterns: &[&str]| HarnessPatternRule {
            agent: agent.to_string(),
            patterns: patterns.iter().map(|p| p.to_string()).collect(),
        };
        let config = |rules: Vec<HarnessPatternRule>| GenAiAgentMappingConfig {
            harness_patterns: rules,
            ..Default::default()
        };
        let err = config(vec![rule("omp", &["tag a"]), rule(" omp ", &["tag b"])])
            .normalize_and_validate()
            .unwrap_err();
        assert_eq!(err, "harness_patterns contains duplicate agent 'omp'");
        // A rule with no patterns is dropped on save, so it is no duplicate.
        let ok = config(vec![rule("omp", &["tag a"]), rule("omp", &[" "])])
            .normalize_and_validate()
            .unwrap();
        assert_eq!(ok.harness_patterns, vec![rule("omp", &["tag a"])]);
        assert!(
            config(vec![rule("omp", &["tag a"]), rule("task", &["tag a"])])
                .normalize_and_validate()
                .is_ok()
        );
    }

    #[test]
    fn strip_request_runs_rust_regex_syntax() {
        let request = |patterns: &[&str], texts: &[&str]| HarnessStripRequest {
            patterns: patterns.iter().map(|p| p.to_string()).collect(),
            texts: texts.iter().map(|t| t.to_string()).collect(),
        };
        // Inline flags, which a browser RegExp rejects.
        let out = request(
            &["regex (?s)<env>.*?</env>", " ", "regex (?i)^caveat:[^\\n]*"],
            &[
                "<env>\nos: linux\n</env>\nFix the build.",
                "CAVEAT: generated\nreal ask",
                "<env>a</env><env>b</env>",
                "plain",
            ],
        )
        .strip()
        .unwrap();
        let texts: Vec<_> = out.results.iter().map(|r| r.text.as_str()).collect();
        assert_eq!(texts, ["Fix the build.", "real ask", "", "plain"]);
        let hidden: Vec<_> = out.results.iter().map(|r| r.hidden).collect();
        assert_eq!(hidden, [1, 1, 2, 0]);
        assert_eq!(out.results[2].only.as_deref(), Some("regex"));

        let err = request(&["regex ("], &["x"]).strip().unwrap_err();
        assert!(err.starts_with("invalid regex in 'regex ('"), "{err}");
        assert!(request(&["glob *"], &["x"]).strip().is_err());
        let too_many = vec![String::new(); MAX_HARNESS_STRIP_TEXTS + 1];
        assert!(
            HarnessStripRequest {
                patterns: vec!["tag job".to_string()],
                texts: too_many,
            }
            .strip()
            .is_err()
        );
    }

    #[test]
    fn test_is_all_empty() {
        assert!(GenAiAgentMappingConfig::default().is_all_empty());
        assert!(
            !GenAiAgentMappingConfig {
                agent_name_fields: vec!["x".to_string()],
                ..Default::default()
            }
            .is_all_empty()
        );
        assert!(
            !GenAiAgentMappingConfig {
                version_fields: vec!["v".to_string()],
                ..Default::default()
            }
            .is_all_empty()
        );
    }

    #[test]
    fn test_builtin_field_consts_present() {
        assert!(BUILTIN_AGENT_NAME_FIELDS.contains(&"gcp.vertex.agent.name"));
        assert!(BUILTIN_AGENT_NAME_FIELDS.contains(&"crewai.task.agent"));
        assert!(BUILTIN_AGENT_ID_FIELDS.contains(&"llm.agent.id"));
        assert!(BUILTIN_ENV_FIELDS.contains(&"deployment.environment"));
        // Broadened built-in env coverage: bare env keys + k8s namespace.
        assert!(BUILTIN_ENV_FIELDS.contains(&"env"));
        assert!(BUILTIN_ENV_FIELDS.contains(&"environment"));
        assert!(BUILTIN_ENV_FIELDS.contains(&"k8s.namespace.name"));
        assert!(BUILTIN_VERSION_FIELDS.contains(&"service.version"));
        // Broadened built-in version coverage: app version + git SHA.
        assert!(BUILTIN_VERSION_FIELDS.contains(&"app.version"));
        assert!(BUILTIN_VERSION_FIELDS.contains(&"git.commit.sha"));
    }

    #[test]
    fn test_agent_mapping_normalizes_env_and_version_fields() {
        let config = GenAiAgentMappingConfig {
            agent_name_fields: vec![],
            agent_id_fields: vec![],
            env_fields: vec!["  custom.env  ".to_string()],
            version_fields: vec!["app.build\t".to_string()],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap();

        assert_eq!(config.env_fields, vec!["custom.env"]);
        assert_eq!(config.version_fields, vec!["app.build"]);
    }

    #[test]
    fn test_agent_mapping_rejects_redundant_env_version_targets() {
        let err = GenAiAgentMappingConfig {
            env_fields: vec!["deployment.environment.name".to_string()],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap_err();
        assert!(err.contains("redundant target"));
    }

    #[test]
    fn test_agent_mapping_normalizes_field_names() {
        let config = GenAiAgentMappingConfig {
            agent_name_fields: vec!["  agent.name  ".to_string()],
            agent_id_fields: vec!["agent.id\t".to_string()],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap();

        assert_eq!(config.agent_name_fields, vec!["agent.name"]);
        assert_eq!(config.agent_id_fields, vec!["agent.id"]);
    }

    #[test]
    fn test_agent_mapping_rejects_duplicate_within_same_list() {
        let err = GenAiAgentMappingConfig {
            agent_name_fields: vec!["agent".to_string(), "agent".to_string()],
            agent_id_fields: vec![],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap_err();

        assert!(err.contains("duplicate"));
    }

    #[test]
    fn test_agent_mapping_rejects_empty_field_names() {
        let err = GenAiAgentMappingConfig {
            agent_name_fields: vec!["   ".to_string()],
            agent_id_fields: vec![],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap_err();

        assert!(err.contains("empty"));
    }

    #[test]
    fn test_agent_mapping_rejects_unsafe_field_names() {
        let err = GenAiAgentMappingConfig {
            agent_name_fields: vec!["agent.name;DROP".to_string()],
            agent_id_fields: vec![],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap_err();

        assert!(err.contains("invalid characters"));
    }

    #[test]
    fn test_agent_mapping_allows_same_field_in_both_lists() {
        let config = GenAiAgentMappingConfig {
            agent_name_fields: vec!["agent".to_string()],
            agent_id_fields: vec!["agent".to_string()],
            ..Default::default()
        };

        assert!(config.normalize_and_validate().is_ok());
    }

    #[test]
    fn test_agent_mapping_rejects_redundant_target_fields() {
        let err = GenAiAgentMappingConfig {
            agent_name_fields: vec!["gen_ai.agent.name".to_string()],
            agent_id_fields: vec![],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap_err();

        assert!(err.contains("redundant target"));
    }

    #[test]
    fn test_agent_mapping_rejects_target_agent_fields() {
        for field in TARGET_AGENT_FIELDS {
            let err = GenAiAgentMappingConfig {
                agent_name_fields: vec![field.to_string()],
                agent_id_fields: vec![],
                ..Default::default()
            }
            .normalize_and_validate()
            .unwrap_err();

            assert!(err.contains("target-agent"));
        }
    }
}
