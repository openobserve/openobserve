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
import {
  OPopoverStub,
  OTooltipStub,
  hoverAndWait,
  httpCredential,
} from "@/test/unit/helpers/workflowHttp";
import WorkflowHttpRotatePopover from "./WorkflowHttpRotatePopover.vue";

const t = (k: string, v?: Record<string, unknown>) => i18n.global.t(k, v ?? {});

const mountPopover = (props: Record<string, unknown> = {}) =>
  mount(WorkflowHttpRotatePopover, {
    props: {
      mode: "token",
      current: httpCredential(),
      disabled: false,
      pending: false,
      error: null,
      ...props,
    },
    global: { plugins: [i18n, store], stubs: { OPopover: OPopoverStub, OTooltip: OTooltipStub } },
  });

const byTest = (w: ReturnType<typeof mountPopover>, id: string) => w.find(`[data-test="${id}"]`);

describe("WorkflowHttpRotatePopover", () => {
  it("opens the blocked tooltip on hover over the whole Rotate button, not only its icon", async () => {
    const w = mount(WorkflowHttpRotatePopover, {
      props: {
        mode: "token",
        current: httpCredential(),
        disabled: true,
        pending: false,
        error: null,
      },
      global: { plugins: [i18n, store], stubs: { OPopover: OPopoverStub } },
      attachTo: document.body,
    });
    await hoverAndWait(byTest(w, "workflow-http-rotate").element);
    expect(document.body.textContent).toContain(t("workflow.http.rotateBlocked"));
    w.unmount();
  });

  it("defaults to 24 hours", async () => {
    const w = mountPopover();
    await byTest(w, "workflow-http-rotate").trigger("click");
    const popover = byTest(w, "workflow-http-rotate-popover");
    expect(popover.text()).toContain(t("workflow.http.rotateTitle"));
    expect(popover.text()).toContain("o2wh_4fK9…oI4k");
    expect(byTest(w, "workflow-http-rotate-consequence").text()).toContain("keep working until");
    await byTest(w, "workflow-http-rotate-confirm").trigger("click");
    expect(w.emitted("confirm")?.[0]).toEqual([86400]);
  });

  it("immediate shows the 401 consequence", async () => {
    const w = mountPopover();
    await byTest(w, "workflow-http-rotate").trigger("click");
    await w.findComponent({ name: "ORadioGroup" }).vm.$emit("update:modelValue", 0);
    expect(byTest(w, "workflow-http-rotate-consequence").text()).toBe(
      t("workflow.http.rotateConsequenceNow"),
    );
    await byTest(w, "workflow-http-rotate-confirm").trigger("click");
    expect(w.emitted("confirm")?.[0]).toEqual([0]);
  });

  it("offers the four overlap options", async () => {
    const w = mountPopover();
    await byTest(w, "workflow-http-rotate").trigger("click");
    for (const s of [0, 3600, 86400, 604800]) {
      expect(byTest(w, `workflow-http-rotate-overlap-${s}`).exists()).toBe(true);
    }
  });

  it("signed mode words it as a signing secret", async () => {
    const w = mountPopover({ mode: "signature" });
    await byTest(w, "workflow-http-rotate").trigger("click");
    expect(byTest(w, "workflow-http-rotate-popover").text()).toContain(
      t("workflow.http.rotateTitleSigned"),
    );
    expect(byTest(w, "workflow-http-rotate-confirm").text()).toBe(
      t("workflow.http.rotateConfirmSigned"),
    );
  });

  it("a blocked rotate is disabled with the tooltip", async () => {
    const w = mountPopover({ disabled: true });
    // focusable-unavailable keeps the reason reachable by keyboard, so the state is aria-disabled.
    expect(byTest(w, "workflow-http-rotate").attributes("aria-disabled")).toBe("true");
    expect(byTest(w, "workflow-http-rotate-blocked-tooltip").attributes("data-content")).toBe(
      t("workflow.http.rotateBlocked"),
    );
    await byTest(w, "workflow-http-rotate").trigger("click");
    expect(byTest(w, "workflow-http-rotate-popover").exists()).toBe(false);
    const signed = mountPopover({ disabled: true, mode: "signature" });
    expect(byTest(signed, "workflow-http-rotate-blocked-tooltip").attributes("data-content")).toBe(
      t("workflow.http.rotateBlockedSigned"),
    );
  });

  it("a never-used token says so in the lead", async () => {
    const w = mountPopover({ current: httpCredential({ last_used_at: null }) });
    await byTest(w, "workflow-http-rotate").trigger("click");
    expect(byTest(w, "workflow-http-rotate-popover").text()).toContain(
      t("workflow.http.rotateLeadUnused", { prefix: "o2wh_4fK9…oI4k" }),
    );
  });

  it("a failure shows inside the popover; cancel emits cancel", async () => {
    const w = mountPopover({ error: "nope" });
    await byTest(w, "workflow-http-rotate").trigger("click");
    expect(byTest(w, "workflow-http-rotate-error").text()).toBe(
      t("workflow.http.rotateFailed", { reason: "nope" }),
    );
    await byTest(w, "workflow-http-rotate-cancel").trigger("click");
    expect(w.emitted("cancel")).toHaveLength(1);
    expect(byTest(w, "workflow-http-rotate-popover").exists()).toBe(false);
  });
});
