import { afterEach, describe, expect, it } from "vitest";
import store from "@/stores";
import { ago, clockTime, dateTime } from "./ServiceVersionsTab.format";
import { formatDeployClock, formatDeployTime } from "@/utils/serviceVersionsCopy";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";

describe("version table times", () => {
  // A real producer's deploy time, so the table and the drawer print the same stamp for it.
  const at = producer.regressed.stored_verdict.deploy.at;
  it("prints first and last seen in the one deploy-time format the drawer uses", () => {
    expect(dateTime(at, at / 1000)).toBe(formatDeployTime(at, at / 1000));
  });
  it("prints a same-day deploy as a clock time and an older one with its date", () => {
    expect(clockTime(at, at / 1000 + 60_000)).toBe(formatDeployClock(at));
    expect(clockTime(at, at / 1000 + 3 * 86_400_000)).toBe(
      formatDeployTime(at, at / 1000 + 3 * 86_400_000),
    );
  });
});
describe("stopped versions", () => {
  it("says how long ago a version stopped in the short form the Versions tab draws", () => {
    const now = Date.parse("2026-11-10T10:00:00Z");
    expect(ago((now - 3_600_000) * 1000, "en", now)).toBe("1h ago");
    expect(ago((now - 26 * 60_000) * 1000, "en", now)).toBe("26m ago");
  });
});
describe("version table in the user's timezone", () => {
  const saved = store.state.timezone;
  afterEach(() => {
    store.commit("setTimezone", saved);
  });
  it("calls a deploy same-day by the user's zone, not the browser's", () => {
    // 23:30 UTC on 31 Oct and 10:00 UTC on 1 Nov are both 1 Nov in Kolkata (UTC+5:30) but two days in UTC.
    const at = Date.parse("2026-10-31T23:30:00Z") * 1000;
    const now = Date.parse("2026-11-01T10:00:00Z");
    store.commit("setTimezone", "Asia/Kolkata");
    expect(clockTime(at, now)).toBe(formatDeployClock(at, false, "Asia/Kolkata"));
    expect(clockTime(at, now)).toMatch(/05.00/);
    expect(dateTime(at, now)).toBe(formatDeployTime(at, now, "Asia/Kolkata"));
    store.commit("setTimezone", "UTC");
    expect(clockTime(at, now)).toBe(formatDeployTime(at, now, "UTC"));
  });
});
