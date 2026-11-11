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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

vi.mock("@/lib/overlay/Dialog/ODialog.vue", () => ({
  default: {
    name: "ODialog",
    props: ["open", "title", "primaryButtonLabel", "primaryButtonDisabled"],
    template: `<div v-if="open" class="o-dialog-stub"><h2>{{ title }}</h2><span data-test="primary" :data-disabled="String(!!primaryButtonDisabled)">{{ primaryButtonLabel }}</span><slot /></div>`,
  },
}));

import SecurityCaseCloseDialog from "./SecurityCaseCloseDialog.vue";

let wrapper: VueWrapper | null = null;

const HIGH = [
  { id: "c-p1", title: "Password spray then success", priority: "P1", entity: "185.220.101.47" },
];

const mountDialog = (props: Record<string, unknown> = {}) => {
  const close = vi.fn().mockResolvedValue(true);
  wrapper = mount(SecurityCaseCloseDialog, { props: { open: true, close, ...props } });
  return { w: wrapper, close };
};

const fill = async (w: VueWrapper, verdict: string, reason: string) => {
  w.findAllComponents({ name: "OSelect" })[0].vm.$emit("update:modelValue", verdict);
  await w.find('[data-test="security-case-close-reason-field"]').setValue(reason);
  await flushPromises();
};

const submit = async (w: VueWrapper) => {
  await w.find("form").trigger("submit");
  await flushPromises();
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("SecurityCaseCloseDialog", () => {
  it("lists the P1/P2 cases in a bulk selection and leaves them out by default", async () => {
    const { w, close } = mountDialog({ count: 3, high: HIGH });
    expect(w.find('[data-test="security-case-close-high"]').text()).toContain(
      "Password spray then success",
    );
    expect(w.find('[data-test="security-case-close-high"]').text()).toContain("185.220.101.47");
    expect(w.find("h2").text()).toBe("Close 3 cases");
    expect(w.find('[data-test="primary"]').text()).toBe("Close 2 cases");
    await fill(w, "false_positive", "Office NAT");
    await submit(w);
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(close).toHaveBeenCalledWith({
      verdict: "false_positive",
      reason: "Office NAT",
      suppressMinutes: 0,
      includeHigh: false,
    });
  });

  it("closes the P1/P2 cases too once the analyst ticks them in", async () => {
    const { w, close } = mountDialog({ count: 3, high: HIGH });
    await w
      .find('[data-test="security-case-close-include-high"] button[role="checkbox"]')
      .trigger("click");
    await flushPromises();
    expect(w.find("h2").text()).toBe("Close 3 cases");
    expect(w.find('[data-test="primary"]').text()).toBe("Close 3 cases");
    await fill(w, "true_positive", "Confirmed");
    await submit(w);
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(close.mock.calls[0][0]).toMatchObject({ includeHigh: true });
  });

  it("starts on benign with a 24 hour suppression for close-and-suppress", async () => {
    const { w, close } = mountDialog({ suppressPreset: true });
    expect(w.find('[data-test="security-case-close-suppress"]').exists()).toBe(true);
    expect(w.find('[data-test="primary"]').text()).toBe("Close and suppress");
    await w.find('[data-test="security-case-close-reason-field"]').setValue("Nightly CI job");
    await submit(w);
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(close).toHaveBeenCalledWith({
      verdict: "benign",
      reason: "Nightly CI job",
      suppressMinutes: 1440,
      includeHigh: false,
    });
  });

  it("offers suppression only for a benign verdict", async () => {
    const { w } = mountDialog();
    expect(w.find('[data-test="security-case-close-suppress"]').exists()).toBe(false);
    await fill(w, "benign", "x");
    expect(w.find('[data-test="security-case-close-suppress"]').exists()).toBe(true);
  });

  it("shows each case's outcome after a bulk close", () => {
    const { w } = mountDialog({
      count: 2,
      results: [
        { ...HIGH[0], outcome: "skipped" },
        { id: "c-p3", title: "GCP key", priority: "P3", entity: "ci@acme", outcome: "updated" },
      ],
    });
    expect(w.find("form").exists()).toBe(false);
    expect(w.find('[data-test="security-case-close-results-summary"]').text()).toBe(
      "1 closed, 1 left open, 0 failed",
    );
    expect(w.find('[data-test="security-case-close-result-c-p1"]').text()).toContain(
      "Left open: high priority",
    );
    expect(w.find('[data-test="security-case-close-result-c-p3"]').attributes("data-outcome")).toBe(
      "updated",
    );
  });

  it("names the selection, not zero, when only P1/P2 cases are selected", () => {
    const { w } = mountDialog({ count: 1, high: HIGH });
    expect(w.find("h2").text()).toBe("Close 1 case");
    expect(w.find('[data-test="primary"]').text()).toBe("Close 1 case");
    expect(w.find('[data-test="primary"]').attributes("data-disabled")).toBe("true");
  });

  it("offers no suppression for a case that names no entity, and says why", async () => {
    const { w, close } = mountDialog({ suppressPreset: true, noEntity: 1 });
    expect(w.find('[data-test="security-case-close-suppress"]').exists()).toBe(false);
    expect(w.find('[data-test="security-case-close-no-entity"]').text()).toContain(
      "names no host, user or address",
    );
    expect(w.find('[data-test="primary"]').text()).not.toBe("Close and suppress");
    await w.find('[data-test="security-case-close-reason-field"]').setValue("Office NAT");
    await submit(w);
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(close.mock.calls[0][0]).toMatchObject({ verdict: "benign", suppressMinutes: 0 });
  });

  it("keeps suppression when only some selected cases lack an entity, and names them", async () => {
    const { w } = mountDialog({ count: 3, noEntity: 1, suppressPreset: true });
    expect(w.find('[data-test="security-case-close-suppress"]').exists()).toBe(true);
    expect(w.text()).toContain("1 selected case names no host, user or address");
  });

  it("shows a failed suppression's message in full", () => {
    const long =
      "Suppressing similar needs a host, user or address on the case; this case names none of them, so nothing was suppressed";
    const { w } = mountDialog({
      count: 1,
      results: [{ ...HIGH[0], outcome: "updated", error: long }],
    });
    const message = w.find('[data-test="security-case-close-result-message"]');
    expect(message.text()).toContain(long);
    expect(message.classes()).toContain("break-words");
  });
});
