import { afterEach, describe, expect, it } from "vitest";
import { computed } from "vue";
import store from "@/stores";
import en from "@/locales/languages/en-US.json";
import type { TranslateFn } from "@/types/i18n";
import {
  changeRoundsToZero,
  compareTitle,
  detailGapText,
  formatDeployClock,
  formatDeployTime,
  baselineSource,
  baselineSourceLabel,
  buildLabel,
  isNoiseChange,
  noVerdictRule,
  sameBuild,
  noVerdictText,
  trackingNotStarted,
} from "./serviceVersionsCopy";
function translate(key: string, params: Record<string, unknown> = {}) {
  const text = key.split(".").reduce<unknown>((node, part) => (node as never)?.[part], en);
  return String(text ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
}
const t = translate as unknown as TranslateFn;
describe("deploy time formatter", () => {
  const at = (iso: string) => new Date(iso).getTime() * 1000;
  it("omits the year for this year and shows it for another", () => {
    const now = new Date("2026-11-01T12:00:00").getTime();
    expect(formatDeployTime(at("2026-10-30T09:05:00"), now)).not.toContain("2026");
    expect(formatDeployTime(at("2025-10-30T09:05:00"), now)).toContain("2025");
  });
  it("reads in the app's timezone when one is given, and survives an unknown zone", () => {
    const stamp = at("2026-10-30T23:30:00Z");
    expect(formatDeployTime(stamp, Date.parse("2026-11-01"), "UTC")).toMatch(/30/);
    expect(formatDeployTime(stamp, Date.parse("2026-11-01"), "Asia/Kolkata")).toMatch(/31/);
    expect(formatDeployTime(stamp, Date.parse("2026-11-01"), "Not/AZone")).not.toBe("");
  });
});
describe("deploy times on the app's 24-hour clock", () => {
  const evening = new Date("2026-11-01T23:27:40Z").getTime() * 1000;
  it("prints 23:27, never 11:27 PM, in stamps and clock times", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(formatDeployTime(evening, now, "UTC")).toContain("23:27");
    expect(formatDeployTime(evening, now, "UTC")).not.toMatch(/PM/);
    expect(formatDeployClock(evening, false, "UTC")).toBe("23:27");
    expect(formatDeployClock(evening, true, "UTC")).toBe("23:27:40");
  });
});
describe("compare drawer header", () => {
  it("reads baseline then compared version for every kind, with one suffix", () => {
    expect(compareTitle({ baseline: "1.0", compared: "2.0", kind: "deploy" }, t)).toEqual({
      baseline: "1.0",
      compared: "2.0",
      suffix: "",
    });
    expect(compareTitle({ baseline: "2.0", compared: "1.0", kind: "rollback" }, t).suffix).toBe(
      "· rollback",
    );
    expect(compareTitle({ baseline: "1.0", compared: "3.0", notServing: true }, t).suffix).toBe(
      "· not serving",
    );
  });
  it("names a rollback over not serving, and leaves a first version without a baseline", () => {
    const both = { baseline: "2.0", compared: "1.0", kind: "rollback", notServing: true };
    expect(compareTitle(both, t).suffix).toBe("· rollback");
    expect(compareTitle({ compared: "1.0" }, t)).toEqual({
      baseline: "",
      compared: "1.0",
      suffix: "",
    });
  });
});
describe("no-verdict sentence", () => {
  const now = new Date("2026-11-01T12:00:00").getTime() * 1000;
  const hour = 3600e6;
  it("says warming up while warm-up runs", () => {
    const text = noVerdictText({ epoch: now - hour, warmup_ends_at: now + hour }, t, now);
    expect(text).toMatch(/^Deploy tracking is warming up\./);
    expect(text).not.toContain("Running before");
  });
  it("is one sentence for the org banner and a version once warm-up ended", () => {
    const tracking = { epoch: now - 2 * hour, warmup_ends_at: now - hour };
    expect(noVerdictText(tracking, t, now)).toBe(
      `Running before deploy tracking started (${formatDeployTime(now - 2 * hour)}); verdicts start with the next deploy`,
    );
    expect(noVerdictText(undefined, t, now)).toBe(
      "Running before deploy tracking started; verdicts start with the next deploy",
    );
  });
  it("says warming up without a time while tracking has no epoch", () => {
    const sentence = "Deploy tracking is warming up. Deploy verdicts start with your next deploy.";
    expect(noVerdictText({ epoch: null, warmup_ends_at: null }, t, now)).toBe(sentence);
    expect(noVerdictText(undefined, t, now, false)).toBe(sentence);
    expect(trackingNotStarted(undefined)).toBe(false);
    expect(trackingNotStarted(null)).toBe(false);
  });
});
describe("deploy times follow the user's timezone setting", () => {
  const saved = store.state.timezone;
  afterEach(() => {
    store.commit("setTimezone", saved);
  });
  // 23:30 UTC on 30 Oct is 31 Oct 13:30 in Kiritimati (UTC+14) and 30 Oct 12:30 in Pago Pago (UTC-11); the test browser runs in UTC.
  const stamp = Date.parse("2026-10-30T23:30:00Z") * 1000;
  const now = Date.parse("2026-11-01T00:00:00Z");
  it("prints stamps and clocks in the zone the user picked, not the browser's", () => {
    store.commit("setTimezone", "Pacific/Kiritimati");
    expect(formatDeployTime(stamp, now)).toBe(formatDeployTime(stamp, now, "Pacific/Kiritimati"));
    expect(formatDeployTime(stamp, now)).toMatch(/31/);
    expect(formatDeployClock(stamp)).toMatch(/13.30|01.30/);
    store.commit("setTimezone", "Pacific/Pago_Pago");
    expect(formatDeployTime(stamp, now)).toMatch(/30/);
    expect(formatDeployClock(stamp)).toMatch(/12.30/);
  });
  it("re-renders a stamp when the setting changes", () => {
    store.commit("setTimezone", "Pacific/Kiritimati");
    const shown = computed(() => formatDeployTime(stamp, now));
    expect(shown.value).toMatch(/31/);
    store.commit("setTimezone", "Pacific/Pago_Pago");
    expect(shown.value).toMatch(/30/);
  });
  it("words the warm-up time of the no-verdict sentence in that zone too", () => {
    store.commit("setTimezone", "Pacific/Kiritimati");
    const text = noVerdictText({ epoch: stamp - 3600e6, warmup_ends_at: stamp }, t, stamp - 60e6);
    expect(text).toContain(formatDeployTime(stamp, Date.now(), "Pacific/Kiritimati"));
  });
});
describe("detail gap sentence", () => {
  it("words endpoints, pages and error types with one sentence", () => {
    expect(detailGapText("endpoint", "both", t)).toBe(
      "Endpoint detail doesn't cover both windows, so New and Gone aren't marked",
    );
    expect(detailGapText("page", "this", t)).toBe(
      "Page detail doesn't cover this window, so New and Gone aren't marked",
    );
    expect(detailGapText("error", "both", t)).toBe(
      "Error detail doesn't cover both windows, so New and Gone aren't marked",
    );
  });
});
describe("warm-up end time", () => {
  const now = new Date("2026-11-01T12:00:00").getTime() * 1000;
  const hour = 3600e6;
  it("names the warm-up end as soon as the org has an epoch, even before the scope starts", () => {
    const warming = { epoch: now - hour, warmup_ends_at: now + hour };
    expect(noVerdictText(warming, t, now, false)).toBe(
      `Deploy tracking is warming up. Deploy verdicts start with your next deploy after ${formatDeployTime(now + hour)}.`,
    );
    const ended = { epoch: now - 2 * hour, warmup_ends_at: now - hour };
    expect(noVerdictText(ended, t, now, true)).toContain("Running before deploy tracking");
  });
  it("names the warm-up end only while it is ahead; a passed end on a scope not tracked yet reads time-less", () => {
    const ended = { epoch: now - 2 * hour, warmup_ends_at: now - hour };
    expect(noVerdictText(ended, t, now, false)).toBe(
      "Deploy tracking is warming up. Deploy verdicts start with your next deploy.",
    );
    expect(noVerdictText(ended, t, now - 2 * hour, false)).toContain(formatDeployTime(now - hour));
    expect(noVerdictRule(ended, t, now, false)).toBe("deploy tracking is warming up");
  });
  it("words a picker rule in the same state as the sentence", () => {
    expect(noVerdictRule({ epoch: null, warmup_ends_at: null }, t, now)).toBe(
      "deploy tracking is warming up",
    );
    expect(noVerdictRule({ epoch: now - hour, warmup_ends_at: now + hour }, t, now, true)).toBe(
      "deploy tracking is warming up",
    );
    expect(noVerdictRule({ epoch: now - 2 * hour, warmup_ends_at: now - hour }, t, now, true)).toBe(
      "running before deploy tracking started",
    );
  });
});
describe("one noise judgement", () => {
  it("calls a change noise when its range crosses zero, it is zero, or it prints as zero", () => {
    expect(isNoiseChange("error_rate", { delta: 0.0001, lo: 0.00005, hi: 0.0002, b: 0 })).toBe(
      true,
    );
    expect(isNoiseChange("error_rate", { delta: 0.002, lo: 0.001, hi: 0.003, b: 0.01 })).toBe(
      false,
    );
    expect(isNoiseChange("error_rate", { delta: 0.002, lo: -0.001, hi: 0.003 })).toBe(true);
    expect(isNoiseChange("error_rate", { delta: 0.002, straddles_zero: false })).toBe(false);
    expect(isNoiseChange("p95", { delta: 10, lo: 5, hi: 15, b: 1_000_000 })).toBe(true);
    expect(isNoiseChange("p95", { delta: 10_000, lo: 5_000, hi: 15_000, b: 100_000 })).toBe(false);
    expect(changeRoundsToZero("cls_p75", 0.0004)).toBe(true);
    expect(changeRoundsToZero("cls_p75", 0.002)).toBe(false);
    expect(changeRoundsToZero("p95", 10, null)).toBe(false);
  });
});
describe("one build and its baseline source", () => {
  it("matches a build by its text and image, a missing image only another missing one", () => {
    expect(
      sameBuild({ version: "2.4.0", image: "1f08369" }, { version: "2.4.0", image: "1f08369" }),
    ).toBe(true);
    expect(
      sameBuild({ version: "2.4.0", image: "1f08369" }, { version: "2.4.0", image: "8ebf1f7" }),
    ).toBe(false);
    expect(sameBuild({ version: "2.4.0", image: null }, { version: "2.4.0", image: "" })).toBe(
      true,
    );
    expect(sameBuild({ version: "2.4.0" }, { version: "2.4.0", image: "1f08369" })).toBe(false);
    expect(sameBuild({ version: "2.4.0" }, { version: "2.4.1" })).toBe(false);
  });
  it("names a picked baseline as picked, the scope's last good build as last good, else automatic", () => {
    const good = { version: "1.0", image: "1f08369" };
    expect(baselineSource("manual", good, good)).toBe("picked");
    expect(baselineSource("previous", good, good)).toBe("last_good");
    expect(baselineSource("canary", good, { version: "0.9", image: "1f08369" })).toBe("automatic");
    expect(baselineSource(undefined, good, undefined)).toBe("automatic");
    expect(baselineSource("previous", { version: "1.0" }, { version: "1.0", image: null })).toBe(
      "last_good",
    );
  });
  it("never names another build of the last good version text as last good", () => {
    const good = { version: "2.4.0", image: "8ebf1f7" };
    expect(baselineSource("previous", { version: "2.4.0", image: "1f08369" }, good)).toBe(
      "automatic",
    );
    expect(baselineSource("previous", { version: "2.4.0", image: null }, good)).toBe("automatic");
  });
  it("words every source in the one baseline tag", () => {
    expect(baselineSourceLabel("picked", t)).toBe("baseline · picked");
    expect(baselineSourceLabel("automatic", t)).toBe("baseline · automatic");
    expect(baselineSourceLabel("last_good", t)).toBe("baseline · last good");
  });
});
describe("a build named next to another build", () => {
  it("names the image only when the two builds share the version text", () => {
    const rebuilt = { version: "2.4.0", image: "f167103" };
    expect(buildLabel(rebuilt, { version: "2.4.0", image: "1f08369" }, t)).toBe(
      "2.4.0 · img f167103",
    );
    expect(buildLabel(rebuilt, { version: "2.3.9", image: "1f08369" }, t)).toBe("2.4.0");
    expect(buildLabel(rebuilt, rebuilt, t)).toBe("2.4.0");
    expect(buildLabel(rebuilt, undefined, t)).toBe("2.4.0");
  });
});
