/**
 * Template validation utilities for alert templates
 *
 * Supports JSON templates with placeholder syntax:
 * - {placeholder} for numeric values
 * - "{placeholder}" for string values
 * - Special syntax like {rows:10} is supported
 */

/**
 * Validates a template body containing JSON with placeholders
 *
 * @param body - The template body string to validate
 * @returns Object with validation result and details
 *
 * @example
 * // Valid examples:
 * validateTemplateBody('{"value": {count}}') // number placeholder
 * validateTemplateBody('{"name": "{user}"}') // string placeholder
 * validateTemplateBody('[{item1}, {item2}]') // array with placeholders
 *
 * // Invalid examples:
 * validateTemplateBody('{placeholder}') // single placeholder as entire JSON
 * validateTemplateBody('{"value": }') // invalid JSON syntax
 */
export function validateTemplateBody(body: string): {
  valid: boolean;
  transformed?: string;
  error?: string;
} {
  try {
    // Replace template placeholders with valid JSON values for validation
    // This allows templates like {bbb} (number) and "{aaa}" (string) to be valid
    let testBody = body.trim();

    // Check if the entire body is just a single placeholder (invalid)
    // A valid placeholder has the format {identifier} where identifier contains only
    // alphanumeric characters, underscores, dots, or colons (no quotes, brackets, or commas)
    if (/^\{[a-zA-Z0-9_.:]+\}$/.test(testBody)) {
      return {
        valid: false,
        error: "A single placeholder cannot be the entire JSON body"
      };
    }

    // Step 1: Replace quoted placeholders first: "{placeholder}" -> "test"
    testBody = testBody.replace(/"\{([^}]+)\}"/g, '"test"');

    // Step 2: Iteratively replace bare placeholders (simple identifiers only)
    // This handles nested structures correctly by replacing innermost placeholders first
    // Match {placeholder} where placeholder doesn't contain JSON structure characters
    // Allows colons for limit syntax like {rows:10} or {var:5}
    let previousBody;
    let iterations = 0;
    const maxIterations = 20;

    do {
      previousBody = testBody;
      // Replace {placeholder} where placeholder is alphanumeric/underscore/dot/colon
      // but NOT containing quotes, braces, brackets, or commas
      testBody = testBody.replace(/\{([^{}"'[\],]+)\}/g, "0");
      iterations++;
    } while (previousBody !== testBody && iterations < maxIterations);

    // Attempt to parse the transformed JSON
    JSON.parse(testBody);

    return {
      valid: true,
      transformed: testBody
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid JSON format"
    };
  }
}

/**
 * Get a user-friendly error message for template validation
 */
export function getTemplateValidationErrorMessage(): string {
  return "Please enter valid JSON in template body. Placeholders like {value} for numbers and \"{name}\" for strings are supported.";
}

/**
 * Supported placeholder syntax documentation
 */
export const PLACEHOLDER_SYNTAX_DOCS = {
  numeric: {
    syntax: '{placeholder}',
    example: '{"count": {total}}',
    description: 'Use bare placeholders for numeric values'
  },
  string: {
    syntax: '"{placeholder}"',
    example: '{"name": "{username}"}',
    description: 'Use quoted placeholders for string values'
  },
  special: {
    syntax: '{placeholder:value}',
    example: '{"limit": {rows:10}}',
    description: 'Colon syntax supported for special cases'
  },
  arrays: {
    syntax: '[{item}, ...]',
    example: '[{item1}, {item2}]',
    description: 'Placeholders can be used in arrays'
  },
  nested: {
    syntax: '{"outer": {"inner": {value}}}',
    example: '{"data": {"metrics": {count}}}',
    description: 'Placeholders work in nested structures'
  }
};

/**
 * Example templates for documentation
 */
export const TEMPLATE_EXAMPLES = [
  {
    name: 'Simple Alert',
    template: `{
  "alert": "{alert_name}",
  "value": {alert_value},
  "threshold": {threshold}
}`,
    description: 'Basic alert with mixed placeholder types'
  },
  {
    name: 'Metrics Array',
    template: `[
  {
    "__name__": "metric_name",
    "__type__": "counter",
    "label": "{label}",
    "value": {value}
  }
]`,
    description: 'Array of metrics with placeholders'
  },
  {
    name: 'Complex Nested',
    template: `{
  "alerts": [
    {
      "name": "{alert_name}",
      "stream": "{stream_name}",
      "metrics": {
        "value": {alert_value},
        "threshold": {threshold}
      }
    }
  ]
}`,
    description: 'Complex nested structure with multiple placeholders'
  }
];