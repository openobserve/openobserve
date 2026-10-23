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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowRunHttpOutcome from "./WorkflowRunHttpOutcome.vue";

const mountOutcome = (props: Record<string, unknown>) =>
  mount(WorkflowRunHttpOutcome, {
    props: {
      status: "failed",
      reason: null,
      receivedAt: 1000,
      failedStep: null,
      error: null,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        OTimeCell: {
          name: "OTimeCell",
          props: ["value", "unit", "mode", "format"],
          template: "<time />",
        },
        OButton: {
          name: "OButton",
          emits: ["click"],
          template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
        },
      },
    },
  });

describe("WorkflowRunHttpOutcome", () => {
  it("names the failing step and its error, and opens that step", async () => {
    const w = mountOutcome({
      failedStep: { id: "fn-1", label: "Build rollback request", isFunction: false },
      error: "boom",
    });
    const line = w.find('[data-test="workflow-run-error"]');
    expect(line.text()).toContain("This run failed at Build rollback request: boom");
    await w.find('[data-test="workflow-run-error-open-step"]').trigger("click");
    expect(w.emitted("open-step")?.[0]).toEqual(["fn-1"]);
    expect(w.find('[data-test="workflow-run-http-guard-hint"]').exists()).toBe(false);
  });

  it("shows the guard hint when the failing step is a Function", () => {
    const w = mountOutcome({
      failedStep: { id: "fn-1", label: "Build rollback request", isFunction: true },
      error: "FunctionNode JS error: TypeError",
    });
    const hint = w.find('[data-test="workflow-run-http-guard-hint"]');
    expect(hint.text()).toBe(
      "HTTP runs carry the request, not alert fields. If this step reads meta.alert_*, guard it with a Condition: meta.trigger_source is empty.",
    );
  });

  it("never-executed run shows the expired banner and the stored chip", () => {
    const w = mountOutcome({ status: "expired", reason: "expired" });
    const tag = w.findComponent({ name: "OTag" });
    expect(tag.props("type")).toBe("hookRunStatus");
    expect(tag.props("value")).toBe("expired");
    expect(w.find('[data-test="workflow-run-expired-banner"]').text()).toContain(
      "This request waited more than 1 hour in the queue and was never run.",
    );
    expect(w.find('[data-test="workflow-run-error"]').exists()).toBe(false);
  });

  it("dates the received request like the run chip", () => {
    const w = mountOutcome({ status: "expired", reason: "expired" });
    expect(w.findComponent({ name: "OTimeCell" }).props("format")).toBe("MMM d, yyyy HH:mm");
  });

  it("worker-lost run shows the error banner telling the user to check destinations", () => {
    const w = mountOutcome({ status: "failed", reason: "worker_lost" });
    expect(w.find('[data-test="workflow-run-worker-lost-banner"]').text()).toContain(
      "The worker running this request stopped.",
    );
  });

  it("renders nothing for a successful run", () => {
    const w = mountOutcome({ status: "succeeded" });
    expect(w.find('[data-test="workflow-run-error"]').exists()).toBe(false);
    expect(w.find('[data-test="workflow-run-never-ran"]').exists()).toBe(false);
  });
});
