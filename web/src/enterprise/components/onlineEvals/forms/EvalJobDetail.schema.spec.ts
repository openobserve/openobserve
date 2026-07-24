import { describe, expect, it } from "vitest";
import { makeManualEvalSchema } from "./EvalJobDetail.schema";

const t = (key: string) => key;
const schema = makeManualEvalSchema(t);
const validForm = {
  targetId: "target-1",
  spanId: "",
  traceId: "",
  sessionId: "",
  reason: "",
  variablesJson: "{}",
};

describe("makeManualEvalSchema", () => {
  it("requires a target id", () => {
    expect(schema.safeParse({ ...validForm, targetId: " " }).success).toBe(false);
  });

  it("accepts only JSON objects for variables", () => {
    expect(schema.safeParse({ ...validForm, variablesJson: "[]" }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, variablesJson: "not-json" }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, variablesJson: '{"key":"value"}' }).success).toBe(true);
  });
});
