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

//! Completion-window defaults, guard rails, and per-scope trace/session
//! configuration for online eval jobs. A target completes once its observed
//! ingest-time silence reaches the idle window, or unconditionally once
//! `max_age` elapses from first ingest.

use std::sync::OnceLock;

use config::meta::pipeline::components::ConditionParams;
use serde::{Deserialize, Serialize};

/// Any positive idle window is sound: readiness fires only once the observed
/// ingest-time silence reaches the window, so a window shorter than one
/// scheduler pass just gets its firing quantized to the next pass. The floor
/// only rejects nonsensical (zero/negative) values; a window smaller than
/// real gaps inside a trace splits it into resumed cycles, which is the
/// user's own cost/latency tradeoff.
pub const MIN_COMPLETION_IDLE_WINDOW_SECS: i64 = 1;
pub const DEFAULT_TRACE_IDLE_WINDOW_SECS: i64 = 30;
pub const DEFAULT_TRACE_MAX_AGE_SECS: i64 = 30 * 60;
/// Sessions span user think-time between traces, so their idle window is far
/// wider than a trace's.
pub const DEFAULT_SESSION_IDLE_WINDOW_SECS: i64 = 30 * 60;
pub const DEFAULT_SESSION_MAX_AGE_SECS: i64 = 4 * 60 * 60;

/// Per-scope guard rails for completion windows, applied identically to
/// job-supplied values and env-override defaults. `max_age` bounds how long a
/// pending target can occupy scheduler memory, how far the committed
/// watermark may lag, and how much ingest time a restart has to rescan — so
/// it gets a hard ceiling rather than trusting the operator.
pub struct CompletionWindowLimits {
    pub max_idle_window_secs: i64,
    pub max_max_age_secs: i64,
    idle_error: &'static str,
    max_age_error: &'static str,
}

pub const TRACE_COMPLETION_LIMITS: CompletionWindowLimits = CompletionWindowLimits {
    max_idle_window_secs: 30 * 60,
    max_max_age_secs: 2 * 60 * 60,
    idle_error: "Trace idle window cannot exceed 30 minutes",
    max_age_error: "Trace max age cannot exceed 2 hours",
};

pub const SESSION_COMPLETION_LIMITS: CompletionWindowLimits = CompletionWindowLimits {
    max_idle_window_secs: 4 * 60 * 60,
    max_max_age_secs: 24 * 60 * 60,
    idle_error: "Session idle window cannot exceed 4 hours",
    max_age_error: "Session max age cannot exceed 24 hours",
};

/// Deployment-wide completion-window defaults, applied whenever an eval job
/// does not set its own values (no trace/session config at all, or a config
/// missing the field).
struct CompletionWindowDefaults {
    trace_idle_secs: i64,
    trace_max_age_secs: i64,
    session_idle_secs: i64,
    session_max_age_secs: i64,
}

static COMPLETION_WINDOW_DEFAULTS: OnceLock<CompletionWindowDefaults> = OnceLock::new();

/// Install deployment-wide completion-window defaults from configuration
/// (the enterprise `LlmEvaluationConfig` `O2_EVAL_TRACE_IDLE_TIMEOUT_SECS`,
/// `O2_EVAL_TRACE_MAX_AGE_SECS`, `O2_EVAL_SESSION_IDLE_TIMEOUT_SECS` and
/// `O2_EVAL_SESSION_MAX_AGE_SECS` values). Called once during startup wiring;
/// values go through the same validation as job-supplied windows and fall
/// back to the built-in constants (with a warning) when invalid. When never
/// called — OSS builds, unit tests — the constants apply as-is.
pub fn init_completion_window_defaults(
    trace_idle_secs: i64,
    trace_max_age_secs: i64,
    session_idle_secs: i64,
    session_max_age_secs: i64,
) {
    let (trace_idle_secs, trace_max_age_secs) = resolve_window_defaults(
        "trace",
        trace_idle_secs,
        trace_max_age_secs,
        DEFAULT_TRACE_IDLE_WINDOW_SECS,
        DEFAULT_TRACE_MAX_AGE_SECS,
        &TRACE_COMPLETION_LIMITS,
    );
    let (session_idle_secs, session_max_age_secs) = resolve_window_defaults(
        "session",
        session_idle_secs,
        session_max_age_secs,
        DEFAULT_SESSION_IDLE_WINDOW_SECS,
        DEFAULT_SESSION_MAX_AGE_SECS,
        &SESSION_COMPLETION_LIMITS,
    );
    let defaults = CompletionWindowDefaults {
        trace_idle_secs,
        trace_max_age_secs,
        session_idle_secs,
        session_max_age_secs,
    };
    if COMPLETION_WINDOW_DEFAULTS.set(defaults).is_err() {
        log::warn!(
            "online eval completion-window defaults were already in use before initialization; keeping the earlier values"
        );
    }
}

fn completion_window_defaults() -> &'static CompletionWindowDefaults {
    COMPLETION_WINDOW_DEFAULTS.get_or_init(|| CompletionWindowDefaults {
        trace_idle_secs: DEFAULT_TRACE_IDLE_WINDOW_SECS,
        trace_max_age_secs: DEFAULT_TRACE_MAX_AGE_SECS,
        session_idle_secs: DEFAULT_SESSION_IDLE_WINDOW_SECS,
        session_max_age_secs: DEFAULT_SESSION_MAX_AGE_SECS,
    })
}

fn resolve_window_defaults(
    scope: &str,
    idle_secs: i64,
    max_age_secs: i64,
    default_idle_secs: i64,
    default_max_age_secs: i64,
    limits: &CompletionWindowLimits,
) -> (i64, i64) {
    match validate_completion_window(idle_secs, max_age_secs, limits) {
        Ok(()) => (idle_secs, max_age_secs),
        Err(error) => {
            log::warn!(
                "ignoring configured {scope} completion-window defaults (idle={idle_secs}s, max_age={max_age_secs}s): {error}; using built-in defaults idle={default_idle_secs}s, max_age={default_max_age_secs}s"
            );
            (default_idle_secs, default_max_age_secs)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TraceEvalConfig {
    pub idle_window_secs: i64,
    pub max_age_secs: i64,
    pub end_signal: Option<serde_json::Value>,
}

impl Default for TraceEvalConfig {
    fn default() -> Self {
        let defaults = completion_window_defaults();
        Self {
            idle_window_secs: defaults.trace_idle_secs,
            max_age_secs: defaults.trace_max_age_secs,
            end_signal: None,
        }
    }
}

impl TraceEvalConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        validate_completion_window(
            self.idle_window_secs,
            self.max_age_secs,
            &TRACE_COMPLETION_LIMITS,
        )?;
        validate_end_signal(self.end_signal.as_ref())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionEvalConfig {
    pub idle_window_secs: i64,
    pub max_age_secs: i64,
    pub end_signal: Option<serde_json::Value>,
}

impl Default for SessionEvalConfig {
    fn default() -> Self {
        let defaults = completion_window_defaults();
        Self {
            idle_window_secs: defaults.session_idle_secs,
            max_age_secs: defaults.session_max_age_secs,
            end_signal: None,
        }
    }
}

impl SessionEvalConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        validate_completion_window(
            self.idle_window_secs,
            self.max_age_secs,
            &SESSION_COMPLETION_LIMITS,
        )?;
        validate_end_signal(self.end_signal.as_ref())
    }
}

fn validate_end_signal(end_signal: Option<&serde_json::Value>) -> Result<(), &'static str> {
    let Some(end_signal) = end_signal else {
        return Ok(());
    };

    let condition = serde_json::from_value::<ConditionParams>(end_signal.clone())
        .map_err(|_| "End signal must be a valid condition")?;

    match condition {
        ConditionParams::V1 { conditions } if conditions.has_conditions() => Ok(()),
        ConditionParams::V2 { conditions } if conditions.validate().is_ok() => Ok(()),
        _ => Err("End signal must contain at least one condition"),
    }
}

fn validate_completion_window(
    idle_window_secs: i64,
    max_age_secs: i64,
    limits: &CompletionWindowLimits,
) -> Result<(), &'static str> {
    if idle_window_secs < MIN_COMPLETION_IDLE_WINDOW_SECS {
        return Err("Completion idle window must be at least 1 second");
    }
    if max_age_secs <= 0 {
        return Err("Completion max age must be greater than zero");
    }
    if idle_window_secs > max_age_secs {
        return Err("Completion idle window cannot exceed max age");
    }
    if idle_window_secs > limits.max_idle_window_secs {
        return Err(limits.idle_error);
    }
    if max_age_secs > limits.max_max_age_secs {
        return Err(limits.max_age_error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_window_defaults_apply_when_valid() {
        assert_eq!(
            resolve_window_defaults("trace", 300, 900, 30, 1800, &TRACE_COMPLETION_LIMITS),
            (300, 900)
        );
    }

    #[test]
    fn configured_window_defaults_above_the_caps_fall_back() {
        // A 1-hour trace idle window is far beyond trace scale.
        assert_eq!(
            resolve_window_defaults(
                "trace",
                60 * 60,
                2 * 60 * 60,
                30,
                1800,
                &TRACE_COMPLETION_LIMITS
            ),
            (30, 1800)
        );
        // A 10-day session would pin scheduler memory and the committed
        // watermark for 10 days.
        assert_eq!(
            resolve_window_defaults(
                "session",
                1800,
                10 * 24 * 60 * 60,
                1800,
                14_400,
                &SESSION_COMPLETION_LIMITS
            ),
            (1800, 14_400)
        );
    }

    #[test]
    fn invalid_configured_window_defaults_fall_back() {
        // Zero/negative idle is nonsensical.
        assert_eq!(
            resolve_window_defaults("trace", 0, 1800, 30, 1800, &TRACE_COMPLETION_LIMITS),
            (30, 1800)
        );
        // Idle exceeding max age.
        assert_eq!(
            resolve_window_defaults(
                "session",
                600,
                300,
                1800,
                14_400,
                &SESSION_COMPLETION_LIMITS
            ),
            (1800, 14_400)
        );
    }

    #[test]
    fn completion_windows_reject_values_above_the_scope_caps() {
        // A 1-hour trace idle window is far beyond trace scale.
        let trace = TraceEvalConfig {
            idle_window_secs: 60 * 60,
            max_age_secs: 2 * 60 * 60,
            end_signal: None,
        };
        assert_eq!(
            trace.validate(),
            Err("Trace idle window cannot exceed 30 minutes")
        );

        let trace = TraceEvalConfig {
            idle_window_secs: 60,
            max_age_secs: 3 * 60 * 60,
            end_signal: None,
        };
        assert_eq!(trace.validate(), Err("Trace max age cannot exceed 2 hours"));

        // A 10-day session would pin scheduler memory and the committed
        // watermark for 10 days.
        let session = SessionEvalConfig {
            idle_window_secs: 30 * 60,
            max_age_secs: 10 * 24 * 60 * 60,
            end_signal: None,
        };
        assert_eq!(
            session.validate(),
            Err("Session max age cannot exceed 24 hours")
        );

        let session = SessionEvalConfig {
            idle_window_secs: 5 * 60 * 60,
            max_age_secs: 24 * 60 * 60,
            end_signal: None,
        };
        assert_eq!(
            session.validate(),
            Err("Session idle window cannot exceed 4 hours")
        );
    }

    #[test]
    fn test_completion_config_rejects_a_non_positive_idle_window() {
        let below_minimum = TraceEvalConfig {
            idle_window_secs: MIN_COMPLETION_IDLE_WINDOW_SECS - 1,
            ..TraceEvalConfig::default()
        };
        assert_eq!(
            below_minimum.validate(),
            Err("Completion idle window must be at least 1 second")
        );

        // Sub-poll-interval windows are valid; the scheduler just quantizes
        // their firing to its next scan pass.
        let sub_pass_window = TraceEvalConfig {
            idle_window_secs: 10,
            ..TraceEvalConfig::default()
        };
        assert!(sub_pass_window.validate().is_ok());
    }

    #[test]
    fn test_completion_config_rejects_invalid_or_empty_end_signal() {
        let invalid = TraceEvalConfig {
            end_signal: Some(serde_json::json!({"field": "status"})),
            ..TraceEvalConfig::default()
        };
        assert_eq!(
            invalid.validate(),
            Err("End signal must be a valid condition")
        );

        let empty = SessionEvalConfig {
            end_signal: Some(serde_json::json!({
                "version": 2,
                "conditions": {
                    "filterType": "group",
                    "logicalOperator": "AND",
                    "conditions": []
                }
            })),
            ..SessionEvalConfig::default()
        };
        assert_eq!(
            empty.validate(),
            Err("End signal must contain at least one condition")
        );
    }
}
