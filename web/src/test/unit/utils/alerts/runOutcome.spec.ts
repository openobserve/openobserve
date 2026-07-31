import { describe, it, expect } from "vitest";
import {
  isErrorOutcome,
  isFiringOutcome,
  isOkOutcome,
  outcomeBucket,
  outcomeLabel,
  shouldShowRunOutcome,
  levelRank,
  isFiringLevel,
  mostSevereLevel,
  shouldShowLevel,
  levelLabel,
  conditionSummary,
} from "@/utils/alerts/runOutcome";

describe("runOutcome classification", () => {
  describe("current backend vocabulary (RunOutcome)", () => {
    it("treats firing as firing", () => {
      expect(isFiringOutcome("firing")).toBe(true);
      expect(outcomeBucket("firing")).toBe("firing");
    });

    // The whole reason notify_failed exists: the condition matched and only
    // delivery failed. Excluding it undercounts firings whenever a destination
    // is down.
    it("counts notify_failed as firing", () => {
      expect(isFiringOutcome("notify_failed")).toBe(true);
      expect(outcomeBucket("notify_failed")).toBe("firing");
    });

    it("treats normal and succeeded as ok", () => {
      expect(isOkOutcome("normal")).toBe(true);
      expect(isOkOutcome("succeeded")).toBe(true);
      expect(outcomeBucket("normal")).toBe("ok");
    });

    // An evaluation that errored did NOT fire. Grouping it with firing (as the
    // old timeline did) overstates how often the alert triggered.
    it("gives error its own bucket, matching RunOutcome::Error", () => {
      expect(isFiringOutcome("error")).toBe(false);
      expect(isOkOutcome("error")).toBe(false);
      expect(isErrorOutcome("error")).toBe(true);
      expect(outcomeBucket("error")).toBe("error");
      // `failed` is the legacy spelling of the same outcome.
      expect(outcomeBucket("failed")).toBe("error");
    });

    // notify_failed is NOT an error: the condition matched, only delivery failed.
    it("does not confuse notify_failed with error", () => {
      expect(isErrorOutcome("notify_failed")).toBe(false);
      expect(outcomeBucket("notify_failed")).toBe("firing");
    });

    it("treats skipped as neither", () => {
      expect(outcomeBucket("skipped")).toBe("other");
    });
  });

  describe("legacy vocabulary (pre-rename history rows)", () => {
    // `completed` meant "the alert fired" for condition-bearing modules.
    it("treats completed as firing", () => {
      expect(isFiringOutcome("completed")).toBe(true);
      expect(isOkOutcome("completed")).toBe(false);
    });

    it("treats condition_not_satisfied as ok", () => {
      expect(isOkOutcome("condition_not_satisfied")).toBe(true);
      expect(isFiringOutcome("condition_not_satisfied")).toBe(false);
    });

    it("treats ok/success as ok and anomaly as firing", () => {
      expect(isOkOutcome("ok")).toBe(true);
      expect(isOkOutcome("success")).toBe(true);
      expect(isFiringOutcome("anomaly")).toBe(true);
    });
  });

  describe("normalisation", () => {
    it("is case- and separator-insensitive", () => {
      expect(isFiringOutcome("FIRING")).toBe(true);
      expect(isFiringOutcome("Notify Failed")).toBe(true);
      expect(isFiringOutcome("notify-failed")).toBe(true);
      expect(isOkOutcome("Condition Not Satisfied")).toBe(true);
      expect(isOkOutcome("conditionNotSatisfied")).toBe(true);
    });

    it("handles null/undefined/empty without throwing", () => {
      for (const v of [null, undefined, ""]) {
        expect(isFiringOutcome(v)).toBe(false);
        expect(isOkOutcome(v)).toBe(false);
        expect(outcomeBucket(v)).toBe("other");
      }
    });

    it("treats unknown values as other", () => {
      expect(outcomeBucket("banana")).toBe("other");
    });
  });

  describe("outcomeLabel", () => {
    it("uses the supplied firing/ok wording", () => {
      expect(outcomeLabel("firing")).toBe("Firing");
      expect(outcomeLabel("normal")).toBe("Ok");
      expect(outcomeLabel("completed", "Triggered", "Healthy")).toBe("Triggered");
      expect(outcomeLabel("normal", "Triggered", "Healthy")).toBe("Healthy");
    });

    it("labels skipped and unknown readably", () => {
      expect(outcomeLabel("skipped")).toBe("Skipped");
      expect(outcomeLabel("error")).toBe("Error");
      expect(outcomeLabel("error", "Firing", "Ok", "Broken")).toBe("Broken");
      expect(outcomeLabel("some_other_thing")).toBe("some other thing");
      expect(outcomeLabel("")).toBe("Unknown");
    });
  });

  describe("shouldShowRunOutcome", () => {
    // A disabled alert freezes its last outcome. Rendering it would advertise
    // "Firing" forever on an alert that is not even running.
    it("hides the badge for disabled alerts", () => {
      expect(shouldShowRunOutcome(false, "firing")).toBe(false);
    });

    it("hides the badge when the alert has never run", () => {
      expect(shouldShowRunOutcome(true, null)).toBe(false);
      expect(shouldShowRunOutcome(true, undefined)).toBe(false);
    });

    it("shows the badge for an enabled alert with an outcome", () => {
      expect(shouldShowRunOutcome(true, "firing")).toBe(true);
      expect(shouldShowRunOutcome(true, "normal")).toBe(true);
    });
  });
});

describe("alert level classification", () => {
  it("ranks severity, not storage id", () => {
    // no_data persists as 3 but must rank BELOW warning.
    expect(levelRank("ok")).toBe(0);
    expect(levelRank("no_data")).toBe(1);
    expect(levelRank("warning")).toBe(2);
    expect(levelRank("critical")).toBe(3);
    expect(levelRank("no_data")).toBeLessThan(levelRank("warning"));
  });

  it("treats unknown levels as unrecognised", () => {
    expect(levelRank("banana")).toBe(-1);
    expect(levelRank(null)).toBe(-1);
    expect(levelRank(undefined)).toBe(-1);
  });

  it("counts warning and critical as firing levels", () => {
    expect(isFiringLevel("critical")).toBe(true);
    expect(isFiringLevel("warning")).toBe(true);
    expect(isFiringLevel("ok")).toBe(false);
    // no_data notifies only under an explicit policy — not firing by itself.
    expect(isFiringLevel("no_data")).toBe(false);
  });

  it("picks the most severe level for a rollup", () => {
    expect(mostSevereLevel(["ok", "warning", "critical"])).toBe("critical");
    expect(mostSevereLevel(["ok", "no_data"])).toBe("no_data");
    expect(mostSevereLevel(["ok"])).toBe("ok");
    expect(mostSevereLevel([])).toBeNull();
    expect(mostSevereLevel(["banana", "nonsense"])).toBeNull();
  });

  it("hides the level badge for disabled or never-classified alerts", () => {
    // A disabled alert freezes its level; showing it would advertise
    // "Critical" forever on something that is not running.
    expect(shouldShowLevel(false, "critical")).toBe(false);
    expect(shouldShowLevel(true, null)).toBe(false);
    expect(shouldShowLevel(true, "banana")).toBe(false);
    expect(shouldShowLevel(true, "critical")).toBe(true);
  });

  it("labels levels readably", () => {
    expect(levelLabel("critical")).toBe("Critical");
    expect(levelLabel("no_data")).toBe("No Data");
    expect(levelLabel("")).toBe("Unknown");
  });
});

// T-10: the history "Condition" column reads standalone.
describe("conditionSummary", () => {
  it("full context renders 'actual operator threshold'", () => {
    expect(
      conditionSummary({ actual_value: 112, threshold_value: 100, threshold_operator: ">=" }),
    ).toBe("112 >= 100");
  });

  it("normal rows have no matched threshold — actual value alone", () => {
    expect(conditionSummary({ actual_value: 42, threshold_operator: ">=" })).toBe("42");
  });

  it("pre-change rows (no actual value) render an em dash", () => {
    expect(conditionSummary({})).toBe("—");
    expect(conditionSummary({ threshold_value: 100, threshold_operator: ">=" })).toBe("—");
  });

  it("zero is a real observation, not an empty value", () => {
    expect(conditionSummary({ actual_value: 0, threshold_value: 5, threshold_operator: "<" })).toBe(
      "0 < 5",
    );
  });

  // §7.5: a capped SingleQuery count is a lower bound, never shown as exact.
  it("renders a ≥ prefix when the backend flags a capped count", () => {
    expect(
      conditionSummary({
        actual_value: 101,
        threshold_value: 100,
        threshold_operator: ">=",
        value_is_lower_bound: true,
      }),
    ).toBe("≥101 >= 100");
    // absent or false = exact, no prefix
    expect(
      conditionSummary({
        actual_value: 101,
        threshold_value: 100,
        threshold_operator: ">=",
        value_is_lower_bound: false,
      }),
    ).toBe("101 >= 100");
  });
});
