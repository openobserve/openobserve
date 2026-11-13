import { describe, expect, it } from "vitest";
import type { CompareResponse, VerdictSummary } from "@/services/service_versions";
import en from "@/locales/languages/en-US.json";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
import {
  compareState,
  leadingVerdict,
  noteKeys,
  verdictChanged,
  verdictCode,
  verdictSentence,
} from "./verdictText";
const verdict = (value: Partial<VerdictSummary>): VerdictSummary => ({
  verdict_key: "k",
  version_key: "vk",
  service: "compactor",
  where_key: "k8s:c1/c1",
  version: "v1.0.0",
  verdict: "ok",
  ...value,
});
function result(stored?: VerdictSummary, live?: VerdictSummary): CompareResponse {
  return {
    service: "compactor",
    where_key: "k8s:c1/c1",
    env: "prod",
    mode: "sequential",
    aliases_applied: [],
    notes: [],
    baseline_rule: "previous",
    arms: {
      a: { version: "v1.0.0", start_time: 1, end_time: 2 },
      b: { version: "v1.1.0", start_time: 0, end_time: 1 },
    },
    stored_verdict: stored ?? null,
    live_verdict: live ?? null,
  };
}
const rollback = { kind: "rollback", at: 5, from_version: "v1.1.0" };
describe("rollback outcomes", () => {
  it("maps the backend codes recovered, not_recovered and pending", () => {
    expect(verdictCode(verdict({ rollback_outcome: "recovered" }))).toBe("rollback_recovered");
    expect(verdictCode(verdict({ verdict: "watch", rollback_outcome: "not_recovered" }))).toBe(
      "rollback_still_worse",
    );
    expect(verdictCode(verdict({ verdict: "watch", rollback_outcome: "pending" }))).toBe("watch");
    expect(verdictCode(verdict({ rollback_outcome: null }))).toBe("ok");
  });
  it.each([
    ["recovered", "rollback_recovered"],
    ["not_recovered", "rollback_still_worse"],
  ] as const)("keeps a stored %s outcome when a sufficient live preview leads", (outcome, code) => {
    const stored = verdict({ verdict: "ok", rollback_outcome: outcome, deploy: rollback });
    const live = verdict({ verdict: "ok", rollback_outcome: "pending", headline: undefined });
    const leading = leadingVerdict(result(stored, live))!;
    expect(verdictCode(leading)).toBe(code);
    expect(leading.deploy?.kind).toBe("rollback");
  });
  it("keeps live metrics while carrying the stored lifecycle", () => {
    const stored = verdict({ verdict: "ok", rollback_outcome: "recovered" });
    const live = verdict({
      verdict: "ok",
      headline: { metric: "p95", new: 2, base: 3, lo: -2, hi: -1, ci_kind: "variance", unit: "us" },
    });
    expect(leadingVerdict(result(stored, live))?.headline?.new).toBe(2);
  });
  it("leaves a pending stored rollback to the live verdict", () => {
    const stored = verdict({ verdict: "insufficient", rollback_outcome: "pending" });
    const live = verdict({ verdict: "watch" });
    expect(verdictCode(leadingVerdict(result(stored, live))!)).toBe("watch");
  });
});
function translate(key: string, params: Record<string, unknown> = {}) {
  const text = key.split(".").reduce<unknown>((node, part) => (node as never)?.[part], en);
  return String(text ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
}
// The stored Regressed verdict a real producer wrote after a bad deploy, reshaped per case.
const produced = (value: Partial<VerdictSummary>): VerdictSummary => ({
  ...(structuredClone(producer.regressed.stored_verdict) as unknown as VerdictSummary),
  ...value,
});
describe("live check against the stored release verdict", () => {
  const regressed = () =>
    produced({ verdict: "regressed", reason_code: "regressed_significant", checks_done: 16 });
  it("keeps a stored Regressed over a live check still waiting for its debounce", () => {
    const live = produced({ verdict: "watch", reason_code: "debounce_pending", checks_done: 1 });
    const value = result(regressed(), live);
    expect(verdictCode(leadingVerdict(value)!)).toBe("regressed");
    expect(verdictChanged(value)).toBe(false);
  });
  it("never lets a single live check read better than the stored verdict", () => {
    const live = produced({ verdict: "ok", reason_code: "below_min_effect", checks_done: 1 });
    expect(verdictCode(leadingVerdict(result(regressed(), live))!)).toBe("regressed");
  });
  it("leads with a confirmed worse live verdict and marks the change", () => {
    const stored = produced({ verdict: "ok", reason_code: "below_min_effect" });
    const value = result(stored, regressed());
    expect(verdictCode(leadingVerdict(value)!)).toBe("regressed");
    expect(verdictChanged(value)).toBe(true);
  });
  it("does not call a pending live watch a change over a stored OK", () => {
    const stored = produced({ verdict: "ok", reason_code: "below_min_effect" });
    const live = produced({ verdict: "watch", reason_code: "debounce_pending" });
    expect(verdictChanged(result(stored, live))).toBe(false);
    expect(verdictCode(leadingVerdict(result(stored, live))!)).toBe("ok");
  });
});
describe("first version", () => {
  // The producer keeps Not enough data with no_previous_version, an all-null needs and no headline metric.
  const first = (value: Partial<VerdictSummary> = {}): VerdictSummary => ({
    ...(structuredClone(producer.first_version.stored_verdict) as unknown as VerdictSummary),
    ...value,
  });
  it("reads as First version, never Not enough data", () => {
    expect(first().needs).toEqual({ metric: null, have: null, need: null });
    expect(verdictCode(first())).toBe("first_version");
    expect(verdictSentence(first(), translate as never)).toBe("First version");
  });
  it("reads the same with a bare null needs", () => {
    expect(verdictSentence(first({ needs: null }), translate as never)).toBe("First version");
  });
  it("never calls a compare against a picked baseline a first version", () => {
    // A real manual compare: the live check names the picked baseline but was judged with no rule.
    const live = structuredClone(producer.manual_live.live_verdict) as unknown as VerdictSummary;
    expect(producer.manual_live.baseline_rule).toBe("manual");
    expect(live.baseline?.version).toBe("1.0");
    expect(verdictCode(live)).toBe("insufficient");
    expect(verdictSentence(live, translate as never)).not.toBe("First version");
  });
  it("maps known notes to copy and drops unknown ones", () => {
    expect(noteKeys(["no_previous_version", "baseline_unavailable", "something_new"])).toEqual([
      "serviceVersions.compare.notes.baselineUnavailable",
    ]);
  });
});
describe("an improvement under a worse verdict", () => {
  it("drops the headline numbers rather than print a fall as a regression", () => {
    const value = produced({
      verdict: "watch",
      reason_code: "not_significant_yet",
      signal: "traces",
      version: "v1.1.0-rc2",
      headline: {
        metric: "p95",
        new: 12000,
        base: 23000,
        lo: -12,
        hi: -10,
        ci_kind: "",
        unit: "us",
      },
    });
    expect(verdictSentence(value, translate as never)).toBe("Possible regression in v1.1.0-rc2.");
  });
});
describe("a compare against a picked baseline", () => {
  // A real stored Regressed, and the recorded manual compare's live check against the picked baseline.
  const picked = (live: Partial<VerdictSummary>) => {
    const value = result(
      produced({ verdict: "regressed", reason_code: "regressed_significant", checks_done: 16 }),
      {
        ...(structuredClone(producer.manual_live.live_verdict) as unknown as VerdictSummary),
        ...live,
      },
    );
    value.baseline_rule = producer.manual_live.baseline_rule;
    return value;
  };
  it("leads with its own one-shot verdict, even one milder than the stored verdict", () => {
    const value = picked({ verdict: "ok", reason_code: "below_min_effect" });
    expect(verdictCode(leadingVerdict(value)!)).toBe("ok");
  });
  it("never notes a change since the release verdict", () => {
    const value = picked({ verdict: "regressed", reason_code: "regressed_significant" });
    value.stored_verdict = produced({ verdict: "ok", reason_code: "below_min_effect" });
    expect(verdictCode(leadingVerdict(value)!)).toBe("regressed");
    expect(verdictChanged(value)).toBe(false);
  });
});
describe("a real picked-baseline compare", () => {
  it("leads with the one-shot Regressed the producer judged against the picked baseline", () => {
    const real = producer.manual_picked;
    const value = result(
      structuredClone(real.stored_verdict) as unknown as VerdictSummary,
      structuredClone(real.live_verdict) as unknown as VerdictSummary,
    );
    value.baseline_rule = real.baseline_rule;
    expect(real.baseline_rule).toBe("manual");
    expect(real.live_verdict.baseline?.rule).toBe("manual");
    expect(verdictCode(leadingVerdict(value)!)).toBe("regressed");
    expect(leadingVerdict(value)).toEqual(value.live_verdict);
    expect(verdictChanged(value)).toBe(false);
  });
});
describe("a picked baseline on a rollback deploy", () => {
  const deploy = { kind: "rollback", at: 1, from_version: "2.0" };
  const picked = (live: Partial<VerdictSummary>) => {
    const value = result(
      produced({ verdict: "ok", rollback_outcome: "recovered", deploy }),
      produced({ rollback_outcome: "pending", deploy, ...live }),
    );
    value.baseline_rule = "manual";
    return value;
  };
  it("never shows the stored recovered outcome against an insufficient picked baseline", () => {
    const value = picked({ verdict: "insufficient", reason_code: "not_enough_samples" });
    const leading = leadingVerdict(value)!;
    expect(verdictCode(leading)).toBe("insufficient");
    expect(verdictSentence(leading, translate as never)).not.toContain("Rolled back");
  });
  it("judges a sufficient picked baseline on its own windows, not the stored outcome", () => {
    const value = picked({ verdict: "ok", reason_code: "below_min_effect" });
    expect(verdictCode(leadingVerdict(value)!)).toBe("ok");
    expect(leadingVerdict(value)).toEqual(value.live_verdict);
  });
  it("still carries the stored outcome on the automatic rollback compare", () => {
    const value = picked({ verdict: "insufficient", reason_code: "not_enough_samples" });
    value.baseline_rule = "previous";
    expect(verdictCode(leadingVerdict(value)!)).toBe("rollback_recovered");
  });
});
describe("the catalog verdict chip and the compare drawer agree on every catalog state", () => {
  // The B5 chip reads the catalog row's newest_verdict; the drawer reads the compare for the same deploy.
  const stored: [string, Partial<VerdictSummary>][] = [
    ["ok", { verdict: "ok" }],
    ["watch", { verdict: "watch" }],
    ["regressed", { verdict: "regressed" }],
    ["insufficient", { verdict: "insufficient", reason_code: "not_enough_samples" }],
    ["not_serving", { verdict: "not_serving", reason_code: "traffic_drop" }],
    ["capped", { verdict: "capped" }],
    ["restricted", { verdict: "regressed", restricted: true }],
    ["first_version", { verdict: "insufficient", reason_code: "no_previous_version" }],
    ["rollback_recovered", { verdict: "ok", rollback_outcome: "recovered" }],
    ["rollback_still_worse", { verdict: "regressed", rollback_outcome: "not_recovered" }],
  ];
  it.each(stored)("%s", (state, value) => {
    const chip = verdict({ ...value, deploy_key: "d" });
    const compare = result(chip, chip);
    expect(verdictCode(chip)).toBe(state);
    expect(compareState(compare, { deployKind: "deploy" })).toBe(verdictCode(chip));
  });
  it("pre_existing", () => {
    const chip = verdict({ state: "pre_existing", verdict: undefined, deploy_key: "pre" });
    const live = verdict({
      verdict: "insufficient",
      state: "evaluating",
      reason_code: "no_previous_version",
    });
    const compare = result(undefined, live);
    compare.arms.b = { ...compare.arms.b, version: "" };
    expect(verdictCode(chip)).toBe("pre_existing");
    expect(verdictCode(leadingVerdict(compare)!)).toBe("first_version");
    expect(compareState(compare, { deployKind: "pre_existing" })).toBe("pre_existing");
  });
});
describe("a version seen before is never a First version", () => {
  const first = (value: Partial<VerdictSummary> = {}): VerdictSummary => ({
    ...(structuredClone(producer.first_version.stored_verdict) as unknown as VerdictSummary),
    ...value,
  });
  it("reads a redeploy without a baseline as Not enough data", () => {
    const redeploy = first({ deploy: { kind: "redeploy", at: 1, from_version: null } });
    expect(verdictCode(redeploy)).toBe("insufficient");
    expect(verdictSentence(redeploy, translate as never)).not.toBe("First version");
  });
});
describe("an OK verdict that names a real improvement", () => {
  // The producer's own improved reason on an error-rate headline, with a range clear of zero or across it.
  const improved = (lo: number, hi: number) =>
    verdict({
      reason_code: "improved",
      sample: { n_new: 2400, n_base: 2400, since: 1 },
      headline: {
        metric: "error_rate",
        new: 0,
        base: 0.2917,
        lo,
        hi,
        ci_kind: "variance",
        unit: "ratio",
      },
    });
  it("drops the no-real-change clause and keeps the request count", () => {
    expect(verdictSentence(improved(-0.311, -0.273), translate as never)).toBe(
      "OK · 2,400 requests",
    );
  });
  it("keeps the clause when the improvement is noise or the caller's Why line names none", () => {
    expect(verdictSentence(improved(-0.4, 0.1), translate as never)).toBe(
      "OK: no real change · 2,400 requests",
    );
    expect(verdictSentence(improved(-0.311, -0.273), translate as never, { improved: false })).toBe(
      "OK: no real change · 2,400 requests",
    );
  });
  it("follows the Why line beside it when the caller has one", () => {
    const plain = verdict({ sample: { n_new: 2400, n_base: 2400, since: 1 } });
    expect(verdictSentence(plain, translate as never, { improved: true })).toBe(
      "OK · 2,400 requests",
    );
  });
});
