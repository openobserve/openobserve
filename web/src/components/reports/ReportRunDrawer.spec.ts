// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { ReportRunHit } from "@/services/reports";
import ReportRunDrawer from "./ReportRunDrawer.vue";

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push: vi.fn() }),
}));

const run = (over: Partial<ReportRunHit> = {}): ReportRunHit => ({
  timestamp: 1_760_164_200_000_000,
  report_id: "r1",
  report_name: "Exec KPI digest",
  status: "error",
  is_cached: false,
  trigger_source: "scheduled",
  triggered_by: null,
  scheduled_for: 1_760_164_200_000_000,
  finished_at: 1_760_164_244_000_000,
  duration_ms: 41_000,
  is_partial: false,
  delay_in_secs: 3,
  time_in_queue_ms: 120,
  retries: 2,
  recipient_count: 4,
  delivery_attempted: null,
  attachment_type: "png",
  dashboard_count: 2,
  error: "report server 500: SMTP 550 mailbox unavailable",
  source_node: "alertmanager-1",
  scheduler_trace_id: "a9f3c21e",
  next_run_at: null,
  ...over,
});

const mountDrawer = (props: Record<string, unknown>) =>
  mount(ReportRunDrawer, {
    props: { open: true, ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: {
          props: ["title"],
          template:
            '<div data-test="drawer"><h2 data-test="drawer-title">{{ title }}</h2><slot /><slot name="footer" /></div>',
        },
      },
    },
  });

describe("ReportRunDrawer", () => {
  it("shows the full error and preserves unknown acceptance", () => {
    const w = mountDrawer({ run: run() });
    expect(w.text()).toContain("SMTP 550 mailbox unavailable");
    expect(w.find('[data-test="reports-reportrundrawer-outcome"]').text()).toContain(
      "Email acceptance is unknown",
    );
    expect(w.text()).toContain("Attempt 3");
  });

  it("says accepted, never delivered, for a sent run", () => {
    const w = mountDrawer({ run: run({ status: "succeeded", error: null }) });
    expect(w.find('[data-test="reports-reportrundrawer-outcome"]').text()).toBe(
      "Accepted by the mail server.",
    );
  });

  it("times the finish as an offset from the due time", () => {
    const w = mountDrawer({ run: run() });
    expect(w.text()).toContain("44 s later (render and send took 41 s)");
    expect(w.text()).toContain("3 s later");
  });

  it("offers Run now and Edit recipients, and no edit for a cache-only run", async () => {
    const w = mountDrawer({ run: run() });
    expect(w.find('[data-test="reports-reportrundrawer-edit-recipients"]').exists()).toBe(true);
    await w.find('[data-test="reports-reportrundrawer-run-now"]').trigger("click");
    expect(w.emitted("run-now")).toHaveLength(1);

    const cached = mountDrawer({ run: run({ is_cached: true, status: "succeeded" }) });
    expect(cached.find('[data-test="reports-reportrundrawer-edit-recipients"]').exists()).toBe(
      false,
    );
  });

  it("shows the recorded recipient count instead of current addresses", () => {
    const w = mountDrawer({
      run: run(),
      report: { timezone: "Asia/Kolkata", destinations: [{ email: "a@acme.io" }], dashboards: [] },
    });
    expect(w.text()).not.toContain("a@acme.io");
    expect(w.text()).toContain("4");
    expect(w.text()).toContain("(Asia/Kolkata)");
  });
  it.each<[boolean | null, string]>([
    [false, "Failed before sending email."],
    [true, "Email send attempt failed; acceptance by the mail server is unconfirmed."],
    [null, "Email acceptance is unknown. Check with a recipient before running again."],
  ])(
    "preserves delivery evidence %s after a timeout or send failure",
    (delivery_attempted, expected) => {
      const w = mountDrawer({ run: run({ delivery_attempted, error: "request timed out" }) });
      expect(w.find('[data-test="reports-reportrundrawer-outcome"]').text()).toBe(expected);
      expect(w.text()).not.toContain("nobody received");
    },
  );

  it.each([
    ["error", "Cache warming failed; completion is unconfirmed."],
    ["skipped", "Cache warming was skipped."],
    ["succeeded", "The dashboard cache was warmed. This report sends no email."],
  ])("checks the %s outcome before cache state", (status, expected) => {
    const w = mountDrawer({
      run: run({ is_cached: true, status: status as ReportRunHit["status"] }),
    });
    expect(w.find('[data-test="reports-reportrundrawer-outcome"]').text()).toBe(expected);
  });

  it("starts run times with the weekday name", () => {
    const w = mountDrawer({ run: run(), report: { timezone: "Asia/Kolkata" } });
    expect(w.find('[data-test="drawer-title"]').text()).toMatch(/^Run · [A-Z][a-z]{2} \d/);
    expect(w.find('[data-test="reports-reportrundrawer-scheduled-for"]').text()).toMatch(
      /^[A-Z][a-z]{2} \d/,
    );
  });

  it("labels the scheduled time as UTC when no report timezone is known", () => {
    const w = mountDrawer({ run: run() });
    expect(w.find('[data-test="reports-reportrundrawer-scheduled-for"]').text()).toBe(
      "Sat 11 Oct, 06:30 (UTC)",
    );
  });

  it("shows unknown recipients for retained legacy rows", () => {
    const w = mountDrawer({
      run: run({ recipient_count: null }),
      report: { destinations: [{ email: "current@example.com" }] },
    });
    expect(w.text()).toContain("Unknown");
    expect(w.text()).not.toContain("current@example.com");
  });
});
