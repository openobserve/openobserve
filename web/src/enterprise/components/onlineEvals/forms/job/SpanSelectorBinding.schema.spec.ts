import { describe, expect, it } from "vitest";
import { makeSpanSelectorSchema } from "./SpanSelectorBinding.schema";

const t = (key: string) => key;
const schema = makeSpanSelectorSchema(t, {
  defaultFieldCount: 8,
  isDuplicateName: (name, id) => name === "duplicate" && id !== "existing",
});
const validForm = {
  id: "selector-1",
  name: "selector",
  fieldMode: "default" as const,
  fields: [],
  maximumSpans: 5,
  filterReady: true,
  filterGroup: { filterType: "group", logicalOperator: "AND", conditions: [] },
};

describe("makeSpanSelectorSchema", () => {
  it("rejects duplicate names and incomplete filters", () => {
    expect(schema.safeParse({ ...validForm, name: "duplicate" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...validForm, filterReady: false }).success).toBe(
      false,
    );
  });

  it("requires fields for custom schemas", () => {
    expect(
      schema.safeParse({ ...validForm, fieldMode: "custom", fields: [] })
        .success,
    ).toBe(false);
  });

  it("enforces the output budget", () => {
    expect(schema.safeParse({ ...validForm, maximumSpans: 6 }).success).toBe(
      false,
    );
    expect(schema.safeParse(validForm).success).toBe(true);
  });
});
