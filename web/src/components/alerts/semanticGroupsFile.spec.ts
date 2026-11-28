// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { createSemanticGroupsFileValidator } from "./semanticGroupsFile";
import type { TranslateFn } from "@/types/i18n";

const t = ((key: string) => key) as unknown as TranslateFn;
const validate = createSemanticGroupsFileValidator(t);
const file = (text: string) => new File([text], "groups.json", { type: "application/json" });

describe("createSemanticGroupsFileValidator", () => {
  it("takes a list of groups, or a single group", async () => {
    const group = { id: "host", display: "Host", fields: ["host"] };
    expect(await validate(file(JSON.stringify([group])))).toBeNull();
    expect(await validate(file(JSON.stringify(group)))).toBeNull();
  });

  it("refuses text that is not JSON", async () => {
    expect(await validate(file("{ not json"))).toBe("components.file.invalidJson");
  });

  it("refuses valid JSON that is not a semantic group", async () => {
    expect(await validate(file(JSON.stringify([{ id: "host" }])))).toBe(
      "alerts.import.invalidSemanticGroupFormat",
    );
  });
});
