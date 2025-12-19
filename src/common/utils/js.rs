// Copyright 2025 OpenObserve Inc.
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

use config::utils::json;
use rquickjs::{Context, Runtime};

thread_local! {
    /// Thread-local JS runtime - each thread gets its own runtime
    /// This pattern matches the VRL runtime approach and ensures thread safety
    static JS_RUNTIME: Runtime = Runtime::new().expect("Failed to create JS runtime");
    static JS_CONTEXT: Context = JS_RUNTIME.with(|rt| {
        Context::full(rt).expect("Failed to create JS context")
    });
}

/// Compiled JS function configuration
#[derive(Clone, Debug)]
pub struct JSRuntimeConfig {
    pub function: String,
    pub params: Vec<String>,
}

/// Initialize a new JS runtime for the current thread
/// This is called automatically via thread_local!, but can be used to verify runtime
pub fn init_js_runtime() -> Result<(), String> {
    JS_CONTEXT.with(|_ctx| Ok(()))
}

/// Compile and validate a JS function
/// Similar to compile_vrl_function but for JavaScript
pub fn compile_js_function(func: &str, _org_id: &str) -> Result<JSRuntimeConfig, std::io::Error> {
    // Basic validation: function must not be empty
    if func.trim().is_empty() {
        return Err(std::io::Error::other("JavaScript function cannot be empty"));
    }

    // Security: Block dangerous functions
    let dangerous_patterns = ["eval(", "Function(", "import("];
    for pattern in dangerous_patterns.iter() {
        if func.contains(pattern) {
            return Err(std::io::Error::other(format!(
                "JavaScript function contains forbidden pattern: {}",
                pattern
            )));
        }
    }

    // Strip #ResultArray# marker for compilation validation
    // The marker is invalid JS syntax (# is not a comment in JS)
    // We keep it in storage but remove it for compilation check
    let func_for_compilation = strip_result_array_marker(func);

    // Try to compile the function to check syntax
    JS_CONTEXT.with(|ctx| {
        ctx.with(|ctx| {
            // Create a test wrapper to validate the function syntax
            // We simulate what will happen during execution
            let test_code = format!(
                r#"
                (function() {{
                    const row = {{}};
                    try {{
                        {}
                        return true;
                    }} catch(e) {{
                        throw new Error("Syntax error: " + e.message);
                    }}
                }})();
                "#,
                func_for_compilation
            );

            ctx.eval::<bool, _>(test_code)
                .map_err(|e| std::io::Error::other(format!("JS syntax error: {}", e)))?;

            // Extract parameter names (simple heuristic)
            // TODO: Parse function signature properly
            let params = vec!["row".to_string()];

            Ok(JSRuntimeConfig {
                function: func.to_string(), // Store original with marker
                params,
            })
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

/// Apply a JS function to transform data
/// Similar to apply_vrl_fn but for JavaScript
/// Returns (transformed_value, optional_error)
pub fn apply_js_fn(
    js_config: &JSRuntimeConfig,
    row: json::Value,
    org_id: &str,
    stream_name: &[String],
) -> (json::Value, Option<String>) {
    JS_CONTEXT.with(|ctx| {
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

            // Create execution wrapper that parses input and stringifies output
            let exec_code = format!(
                r#"
                (function() {{
                    const row = JSON.parse(inputJson);
                    {}
                    return JSON.stringify(row);
                }})();
                "#,
                func_for_execution
            );

            // Execute the function
            match ctx.eval::<String, _>(exec_code) {
                Ok(result_json) => {
                    // Parse the result back to JSON Value
                    match serde_json::from_str::<json::Value>(&result_json) {
                        Ok(result) => (result, None),
                        Err(e) => (
                            row.clone(),
                            Some(format!("Failed to parse JS output: {}", e)),
                        ),
                    }
                }
                Err(e) => {
                    let error_msg = format!("JS execution error: {}", e);
                    log::error!("{}/{:?} {}", org_id, stream_name, error_msg);
                    (row, Some(error_msg))
                }
            }
        })
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
    fn test_compile_js_function_with_undefined_var() {
        // Undefined variables should be caught during compilation
        let func = r#"
            row.field = undefined_variable;
        "#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_err());
    }

    #[test]
    fn test_compile_js_with_result_array_marker() {
        // #ResultArray# marker should not cause compilation error
        let func = r#"#ResultArray#
row.transformed = true;
row.type = "result_array";"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_ok());

        // Verify original function is preserved in config
        let config = result.unwrap();
        assert!(config.function.contains("#ResultArray#"));
    }

    #[test]
    fn test_compile_js_with_result_array_skip_vrl() {
        // #ResultArray#SkipVRL# marker should not cause compilation error
        let func = r#"#ResultArray#SkipVRL#
row.transformed = true;"#;
        let result = compile_js_function(func, "test_org");
        assert!(result.is_ok());

        let config = result.unwrap();
        assert!(config.function.contains("#ResultArray#SkipVRL#"));
    }

    #[test]
    fn test_apply_js_with_result_array_marker() {
        // Function with #ResultArray# should execute correctly
        let func = r#"#ResultArray#
row.processed = true;
row.value = 42;"#;
        let config = compile_js_function(func, "test_org").unwrap();
        let input = json!({"original": "test"});
        let (output, error) = apply_js_fn(&config, input, "test_org", &["test_stream".to_string()]);

        assert!(error.is_none());
        assert_eq!(output["original"], "test");
        assert_eq!(output["processed"], true);
        assert_eq!(output["value"], 42);
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

    // Note: Runtime error testing is complex because QuickJS validates during compilation
    // Real runtime errors will be caught and logged appropriately in production use
}
