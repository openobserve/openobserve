// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the CreateReport Zod schema — restores the Quasar BEFORE
// validation baseline (the :rules from
// complete-quasar-validation-inventory-BEFORE.md §5) as Zod constraints, with the
// conditional rules (cron / custom / !cached / scheduleLater timezone + date/time)
// in superRefine.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
} from "@/utils/zincutils";
import { makeCreateReportSchema } from "./CreateReport.schema";

// Deterministic mocks for the resource-name + cron helpers (the schema imports
// these from zincutils; control them per-test for the cron branches).
vi.mock("@/utils/zincutils", () => ({
  isValidResourceName: (val: string) => /^[^:#?&%'"\/\s]+$/.test(val),
  getCronIntervalDifferenceInSeconds: vi.fn(() => 3600),
  isAboveMinRefreshInterval: vi.fn(() => true),
}));

const t = (key: string) =>
  key === "common.nameRequired" ? "Name is required" : key;

const schema = makeCreateReportSchema(t, { min_auto_refresh_interval: 5 });

// A fully-valid base record: frequency "once", schedule "now", not cached.
const base = () => ({
  name: "my-report",
  description: "",
  isCachedReport: false,
  imagePreview: false,
  dashboards: [
    {
      folder: "folder-1",
      dashboard: "dash-1",
      tabs: "tab-1",
      report_type: "pdf",
      email_attachment_type: "standard",
      attachmentWidth: "",
      attachmentHeight: "",
      timerange: { type: "relative", period: "30m", from: 0, to: 0 },
    },
  ],
  frequencyType: "once",
  cron: "",
  customInterval: 1,
  customPeriod: "days",
  selectedTimeTab: "scheduleNow",
  timezone: "",
  date: "",
  time: "",
  title: "My Report",
  emails: "user@example.com",
  message: "",
});

// Return the set of error paths (joined with ".") for a given input.
const errorPaths = (input: any): string[] => {
  const res = schema.safeParse(input);
  if (res.success) return [];
  return res.error.issues.map((i) => i.path.join("."));
};

// Build a record with the (single) dashboard row overridden.
const withDash = (dashOverrides: Record<string, unknown>) => ({
  ...base(),
  dashboards: [{ ...base().dashboards[0], ...dashOverrides }],
});

describe("CreateReport.schema", () => {
  beforeEach(() => {
    vi.mocked(getCronIntervalDifferenceInSeconds).mockReturnValue(3600);
    vi.mocked(isAboveMinRefreshInterval).mockReturnValue(true);
  });

  it("accepts a fully valid base record", () => {
    expect(schema.safeParse(base()).success).toBe(true);
  });

  // ── name: required + resource-name characters ──────────────────────────────
  describe("name", () => {
    it("requires a non-empty name", () => {
      expect(errorPaths({ ...base(), name: "" })).toContain("name");
      expect(errorPaths({ ...base(), name: "   " })).toContain("name");
    });

    it("rejects invalid resource characters", () => {
      expect(errorPaths({ ...base(), name: "bad name?" })).toContain("name");
      expect(errorPaths({ ...base(), name: "a:b" })).toContain("name");
      // Parity: no silent trim — a padded name hits the resource-name rule.
      expect(errorPaths({ ...base(), name: " padded " })).toContain("name");
    });

    it("accepts a clean resource name", () => {
      expect(errorPaths({ ...base(), name: "valid_report-1" })).not.toContain(
        "name",
      );
    });
  });

  // ── dashboard folder / dashboard / tabs: required (field-array row) ────────
  describe("dashboards[0] folder / dashboard / tabs (required)", () => {
    it("requires the folder", () => {
      expect(errorPaths(withDash({ folder: "" }))).toContain(
        "dashboards.0.folder",
      );
    });

    it("requires the dashboard", () => {
      expect(errorPaths(withDash({ dashboard: "" }))).toContain(
        "dashboards.0.dashboard",
      );
    });

    it("requires the tab", () => {
      expect(errorPaths(withDash({ tabs: "" }))).toContain(
        "dashboards.0.tabs",
      );
    });

    it("requires at least one dashboard row", () => {
      expect(errorPaths({ ...base(), dashboards: [] })).toContain("dashboards");
    });
  });

  // ── timerange: relative needs a period; absolute needs from + to ───────────
  describe("dashboards[0].timerange", () => {
    it("requires a period for relative time ranges", () => {
      expect(
        errorPaths(
          withDash({ timerange: { type: "relative", period: "", from: 0, to: 0 } }),
        ),
      ).toContain("dashboards.0.timerange");
    });

    it("requires from + to for absolute time ranges", () => {
      expect(
        errorPaths(
          withDash({ timerange: { type: "absolute", period: "", from: 0, to: 0 } }),
        ),
      ).toContain("dashboards.0.timerange");
    });

    it("accepts a valid absolute time range", () => {
      expect(
        errorPaths(
          withDash({
            timerange: { type: "absolute", period: "", from: 100, to: 200 },
          }),
        ),
      ).not.toContain("dashboards.0.timerange");
    });
  });

  // ── cron: required + valid + 6-field + min-interval (cron mode only) ───────
  describe("cron (frequencyType === 'cron')", () => {
    const cronBase = () => ({
      ...base(),
      frequencyType: "cron",
      cron: "0 0 12 * * ?",
      timezone: "UTC",
    });

    it("requires a cron expression in cron mode", () => {
      expect(errorPaths({ ...cronBase(), cron: "" })).toContain("cron");
    });

    it("accepts a valid 6-field cron", () => {
      expect(errorPaths(cronBase())).not.toContain("cron");
    });

    it("rejects an unparseable cron expression", () => {
      vi.mocked(getCronIntervalDifferenceInSeconds).mockImplementationOnce(
        () => {
          throw new Error("Invalid cron expression");
        },
      );
      expect(errorPaths({ ...cronBase(), cron: "not-a-cron" })).toContain(
        "cron",
      );
    });

    it("rejects a cron without exactly 6 fields", () => {
      // 5 fields — the mock still returns a number, so the field-count rule fires.
      expect(errorPaths({ ...cronBase(), cron: "0 12 * * *" })).toContain(
        "cron",
      );
    });

    it("rejects a cron below the minimum refresh interval", () => {
      vi.mocked(isAboveMinRefreshInterval).mockReturnValue(false);
      expect(errorPaths(cronBase())).toContain("cron");
    });

    it("does NOT require cron when not in cron mode", () => {
      expect(errorPaths({ ...base(), frequencyType: "once", cron: "" })).not.toContain(
        "cron",
      );
    });
  });

  // ── custom interval + period: required only when frequency is "custom" ─────
  describe("custom interval + period (frequencyType === 'custom')", () => {
    const customBase = () => ({
      ...base(),
      frequencyType: "custom",
      customInterval: 5,
      customPeriod: "days",
    });

    it("requires the interval in custom mode", () => {
      expect(errorPaths({ ...customBase(), customInterval: 0 })).toContain(
        "customInterval",
      );
    });

    it("requires the period in custom mode", () => {
      expect(errorPaths({ ...customBase(), customPeriod: "" })).toContain(
        "customPeriod",
      );
    });

    it("accepts a valid custom interval + period", () => {
      const paths = errorPaths(customBase());
      expect(paths).not.toContain("customInterval");
      expect(paths).not.toContain("customPeriod");
    });

    it("does NOT require interval/period when not custom", () => {
      const paths = errorPaths({
        ...base(),
        frequencyType: "once",
        customInterval: 0,
        customPeriod: "",
      });
      expect(paths).not.toContain("customInterval");
      expect(paths).not.toContain("customPeriod");
    });
  });

  // ── timezone: required on Schedule Later AND in cron mode ──────────────────
  // Both surface an enabled, required timezone select the user must fill (cron
  // runs its schedule in that timezone; saveReport honors the picked value). The
  // hidden "Schedule Now" mode auto-fills the browser timezone at save instead.
  describe("timezone", () => {
    it("is required in cron mode", () => {
      expect(
        errorPaths({
          ...base(),
          frequencyType: "cron",
          cron: "0 0 12 * * ?",
          timezone: "",
        }),
      ).toContain("timezone");
    });

    it("is required when scheduling for later", () => {
      expect(
        errorPaths({
          ...base(),
          selectedTimeTab: "scheduleLater",
          date: "2025-01-01",
          time: "10:00",
          timezone: "",
        }),
      ).toContain("timezone");
    });

    it("is NOT required for non-cron schedule-now", () => {
      expect(
        errorPaths({ ...base(), selectedTimeTab: "scheduleNow", timezone: "" }),
      ).not.toContain("timezone");
    });
  });

  // ── date + time: required + well-formed in non-cron scheduleLater ──────────
  // ODate/OTime emit ISO YYYY-MM-DD / HH:MM (or "" when empty). On the non-cron
  // Schedule Later tab both are required + format-checked; cron / Schedule Now
  // set them programmatically at save, so they are NOT validated there.
  describe("date + time (scheduleLater, non-cron)", () => {
    const laterBase = () => ({
      ...base(),
      selectedTimeTab: "scheduleLater",
      date: "2025-01-31",
      time: "09:30",
      timezone: "UTC",
    });

    it("accepts a valid ISO date + HH:MM time", () => {
      const paths = errorPaths(laterBase());
      expect(paths).not.toContain("date");
      expect(paths).not.toContain("time");
    });

    it("rejects a malformed or empty date", () => {
      // DD-MM-YYYY (old free-typed format) is now invalid — the live control is ISO.
      expect(errorPaths({ ...laterBase(), date: "31-01-2025" })).toContain(
        "date",
      );
      expect(errorPaths({ ...laterBase(), date: "" })).toContain("date");
    });

    it("rejects a malformed or empty time", () => {
      expect(errorPaths({ ...laterBase(), time: "9am" })).toContain("time");
      expect(errorPaths({ ...laterBase(), time: "" })).toContain("time");
    });

    it("does NOT validate date/time for schedule-now", () => {
      const paths = errorPaths({
        ...base(),
        selectedTimeTab: "scheduleNow",
        date: "",
        time: "",
      });
      expect(paths).not.toContain("date");
      expect(paths).not.toContain("time");
    });

    it("does NOT validate date/time in cron mode (set programmatically at save)", () => {
      const paths = errorPaths({
        ...base(),
        selectedTimeTab: "scheduleLater",
        frequencyType: "cron",
        cron: "0 0 12 * * ?",
        timezone: "UTC",
        date: "",
        time: "",
      });
      expect(paths).not.toContain("date");
      expect(paths).not.toContain("time");
    });
  });

  // ── title + emails: required only when NOT a cached report ─────────────────
  describe("title + emails (when !cached)", () => {
    it("requires a non-empty title", () => {
      expect(errorPaths({ ...base(), title: "" })).toContain("title");
      expect(errorPaths({ ...base(), title: "   " })).toContain("title");
    });

    it("requires a valid email list", () => {
      expect(errorPaths({ ...base(), emails: "" })).toContain("emails");
      expect(errorPaths({ ...base(), emails: "not-an-email" })).toContain(
        "emails",
      );
    });

    it("accepts multiple emails separated by , or ;", () => {
      expect(
        errorPaths({ ...base(), emails: "a@b.com, c@d.com; e@f.com" }),
      ).not.toContain("emails");
    });

    it("does NOT require title/emails for a cached report", () => {
      const paths = errorPaths({
        ...base(),
        isCachedReport: true,
        title: "",
        emails: "",
      });
      expect(paths).not.toContain("title");
      expect(paths).not.toContain("emails");
    });
  });
});
