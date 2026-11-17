// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { VerdictSummary } from "@/services/service_versions";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
import VerdictChip from "./VerdictChip.vue";
// A real stored verdict, reshaped as the rollback outcomes the catalog row shows.
const verdict = (value: Partial<VerdictSummary>) =>
  ({
    ...(structuredClone(producer.regressed.stored_verdict) as unknown as VerdictSummary),
    ...value,
  }) as VerdictSummary;
const tag = { name: "OTag", props: ["value", "icon", "dot"], template: "<span />" };
function iconOf(value: VerdictSummary, clickable = true) {
  return mount(VerdictChip, {
    props: { verdict: value, clickable },
    global: { stubs: { OTag: tag, OTooltip: true } },
  })
    .findComponent({ name: "OTag" })
    .props("icon");
}
describe("verdict chip icon", () => {
  it("shows the undo glyph on both rollback outcomes, clickable or not", () => {
    for (const outcome of ["recovered", "not_recovered"] as const) {
      expect(iconOf(verdict({ verdict: "ok", rollback_outcome: outcome }))).toBe("undo");
      expect(iconOf(verdict({ verdict: "ok", rollback_outcome: outcome }), false)).toBe("undo");
    }
  });
  it("leaves every other verdict on its own badge icon", () => {
    expect(iconOf(verdict({ verdict: "regressed" }))).toBeUndefined();
    expect(iconOf(verdict({ verdict: "ok", rollback_outcome: "pending" }))).toBeUndefined();
  });
});
