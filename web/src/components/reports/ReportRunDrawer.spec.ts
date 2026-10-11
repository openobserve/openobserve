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
          template: '<div data-test="drawer"><slot /><slot name="footer" /></div>',
        },
      },
    },
  });

describe("ReportRunDrawer", () => {
  it("shows the full error and says nobody received a rejected send", () => {
    const w = mountDrawer({ run: run() });
    expect(w.text()).toContain("SMTP 550 mailbox unavailable");
    expect(w.find('[data-test="reports-reportrundrawer-outcome"]').text()).toContain(
      "Not accepted by the mail server",
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

  it("lists the report's recipients when the page has the report", () => {
    const w = mountDrawer({
      run: run(),
      report: { timezone: "Asia/Kolkata", destinations: [{ email: "a@acme.io" }], dashboards: [] },
    });
    expect(w.text()).toContain("a@acme.io");
    expect(w.text()).toContain("(Asia/Kolkata)");
  });
});
