import { describe, it, expect } from "vitest";
import {
  isErrorOutcome,
  isFiringOutcome,
  isOkOutcome,
  outcomeBucket,
  outcomeLabel,
  shouldShowRunOutcome,
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
