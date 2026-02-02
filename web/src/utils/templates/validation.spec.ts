import { describe, it, expect } from "vitest";
import {
  validateTemplateBody,
  getTemplateValidationErrorMessage,
  PLACEHOLDER_SYNTAX_DOCS,
  TEMPLATE_EXAMPLES,
} from "./validation";

describe("validateTemplateBody", () => {
  describe("Basic placeholder tests", () => {
    it("should validate simple number placeholder", () => {
      const result = validateTemplateBody('{"value": {bbb}}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"value": 0}');
    });

    it("should validate simple string placeholder", () => {
      const result = validateTemplateBody('{"label": "{aaa}"}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"label": "test"}');
    });

    it("should validate mixed placeholders from issue #8658", () => {
      const result = validateTemplateBody(
        '[{"__name__": "xxx", "__type__": "counter", "label": "{aaa}", "value": {bbb}}]'
      );
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe(
        '[{"__name__": "xxx", "__type__": "counter", "label": "test", "value": 0}]'
      );
    });
  });

  describe("Array placeholder tests (Greptile concerns)", () => {
    it("should validate array with single placeholder", () => {
      const result = validateTemplateBody("[{item}]");
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe("[0]");
    });

    it("should validate array with multiple placeholders", () => {
      const result = validateTemplateBody("[{item1}, {item2}, {item3}]");
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe("[0, 0, 0]");
    });

    it("should validate nested array with placeholder", () => {
      const result = validateTemplateBody('{"items": [{id}]}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"items": [0]}');
    });

    it("should validate complex nested array", () => {
      const result = validateTemplateBody(
        '{"data": [{"id": {id}, "name": "{name}"}]}'
      );
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe(
        '{"data": [{"id": 0, "name": "test"}]}'
      );
    });
  });

  describe("Nested object tests (Greptile concerns)", () => {
    it("should validate simple nested object", () => {
      const result = validateTemplateBody('{"outer": {"inner": {value}}}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"outer": {"inner": 0}}');
    });

    it("should validate deeply nested object", () => {
      const result = validateTemplateBody('{"a": {"b": {"c": {val}}}}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"a": {"b": {"c": 0}}}');
    });

    it("should validate multiple nested placeholders", () => {
      const result = validateTemplateBody(
        '{"level1": {"level2": {val1}, "level2b": {val2}}}'
      );
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"level1": {"level2": 0, "level2b": 0}}');
    });
  });

  describe("Special syntax tests", () => {
    it("should validate placeholder with colon (limit syntax)", () => {
      const result = validateTemplateBody('{"limit": {rows:10}}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"limit": 0}');
    });

    it("should validate placeholder with underscore", () => {
      const result = validateTemplateBody('{"value": {user_id}}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"value": 0}');
    });

    it("should validate placeholder with dot", () => {
      const result = validateTemplateBody('{"value": {user.name}}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"value": 0}');
    });
  });

  describe("Edge cases", () => {
    it("should reject single placeholder as entire JSON", () => {
      const result = validateTemplateBody("{items}");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("single placeholder");
    });

    it("should validate empty object", () => {
      const result = validateTemplateBody("{}");
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe("{}");
    });

    it("should validate empty array", () => {
      const result = validateTemplateBody("[]");
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe("[]");
    });

    it("should validate complex real-world template", () => {
      const template = `{
        "alerts": [
          {
            "name": "{alert_name}",
            "stream": "{stream_name}",
            "value": {alert_value},
            "threshold": {threshold},
            "unit": "{unit}",
            "triggered_at": {timestamp}
          }
        ]
      }`;
      const result = validateTemplateBody(template);
      expect(result.valid).toBe(true);
      expect(result.transformed).toContain('"name": "test"');
      expect(result.transformed).toContain('"value": 0');
    });
  });

  describe("Invalid JSON tests", () => {
    it("should reject JSON with missing closing brace", () => {
      const result = validateTemplateBody('{"value": {placeholder}');
      expect(result.valid).toBe(false);
    });

    it("should reject JSON with trailing comma", () => {
      const result = validateTemplateBody('{"value": {val},}');
      expect(result.valid).toBe(false);
    });

    it("should reject completely invalid input", () => {
      const result = validateTemplateBody("not json");
      expect(result.valid).toBe(false);
    });
  });

  describe("Placeholder in property names", () => {
    it("should keep placeholder in property name as string", () => {
      const result = validateTemplateBody('{"{key}": "value"}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"test": "value"}');
    });
  });

  describe("Boolean and null placeholders", () => {
    it("should validate boolean-like placeholder", () => {
      const result = validateTemplateBody('{"enabled": {is_enabled}}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"enabled": 0}');
    });

    it("should validate null-like placeholder", () => {
      const result = validateTemplateBody('{"data": {nullable_field}}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"data": 0}');
    });
  });

  describe("Whitespace handling", () => {
    it("should trim whitespace before validation", () => {
      const result = validateTemplateBody('  {"value": {test}}  ');
      expect(result.valid).toBe(true);
    });

    it("should handle placeholders with spaces around them", () => {
      const result = validateTemplateBody('{"value": { test }}');
      expect(result.valid).toBe(true);
      expect(result.transformed).toBe('{"value": 0}');
    });
  });
});

describe("getTemplateValidationErrorMessage", () => {
  it("should return user-friendly error message", () => {
    const message = getTemplateValidationErrorMessage();
    expect(message).toContain("Please enter valid JSON");
    expect(message).toContain("Placeholders");
    expect(message).toContain("{value}");
    expect(message).toContain('"{name}"');
  });
});

describe("PLACEHOLDER_SYNTAX_DOCS", () => {
  it("should have documentation for numeric placeholders", () => {
    expect(PLACEHOLDER_SYNTAX_DOCS.numeric).toBeDefined();
    expect(PLACEHOLDER_SYNTAX_DOCS.numeric.syntax).toBe("{placeholder}");
  });

  it("should have documentation for string placeholders", () => {
    expect(PLACEHOLDER_SYNTAX_DOCS.string).toBeDefined();
    expect(PLACEHOLDER_SYNTAX_DOCS.string.syntax).toBe('"{placeholder}"');
  });

  it("should have documentation for special syntax", () => {
    expect(PLACEHOLDER_SYNTAX_DOCS.special).toBeDefined();
    expect(PLACEHOLDER_SYNTAX_DOCS.special.example).toContain("rows:10");
  });

  it("should have documentation for arrays", () => {
    expect(PLACEHOLDER_SYNTAX_DOCS.arrays).toBeDefined();
    expect(PLACEHOLDER_SYNTAX_DOCS.arrays.syntax).toContain("[{item}");
  });

  it("should have documentation for nested structures", () => {
    expect(PLACEHOLDER_SYNTAX_DOCS.nested).toBeDefined();
    expect(PLACEHOLDER_SYNTAX_DOCS.nested.example).toContain("metrics");
  });
});

describe("TEMPLATE_EXAMPLES", () => {
  it("should have valid example templates", () => {
    expect(TEMPLATE_EXAMPLES.length).toBeGreaterThan(0);

    TEMPLATE_EXAMPLES.forEach((example) => {
      expect(example.name).toBeDefined();
      expect(example.template).toBeDefined();
      expect(example.description).toBeDefined();

      // Each example should be valid
      const result = validateTemplateBody(example.template);
      expect(result.valid).toBe(true);
    });
  });

  it("should have simple alert example", () => {
    const simpleAlert = TEMPLATE_EXAMPLES.find(
      (e) => e.name === "Simple Alert"
    );
    expect(simpleAlert).toBeDefined();
    expect(simpleAlert?.template).toContain("{alert_name}");
  });

  it("should have metrics array example", () => {
    const metricsArray = TEMPLATE_EXAMPLES.find(
      (e) => e.name === "Metrics Array"
    );
    expect(metricsArray).toBeDefined();
    expect(metricsArray?.template).toContain("__name__");
  });

  it("should have complex nested example", () => {
    const complexNested = TEMPLATE_EXAMPLES.find(
      (e) => e.name === "Complex Nested"
    );
    expect(complexNested).toBeDefined();
    expect(complexNested?.template).toContain("metrics");
  });
});