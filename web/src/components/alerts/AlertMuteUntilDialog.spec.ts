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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import AlertMuteUntilDialog from "./AlertMuteUntilDialog.vue";

const extend = vi.fn();
vi.mock("@/composables/alerts/useAlertActions", () => ({
  useAlertActions: () => ({ extend }),
}));

const HOUR = 3_600_000_000;

const mountDialog = async () => {
  const wrapper = mount(AlertMuteUntilDialog, {
    props: {
      open: false,
      target: { alertId: "a1", name: "cpu-high", folderId: "ops" },
      downtime: { id: "d1", ends_at: Date.now() * 1000 + 2 * HOUR, version: 3 },
    },
    global: { plugins: [store, i18n] },
    attachTo: document.body,
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
};

const submit = async () => {
  document.body
    .querySelector<HTMLElement>('[data-test="alerts-alertmuteuntildialog"]')!
    .querySelector<HTMLButtonElement>('[data-test="o-dialog-primary-btn"]')!
    .click();
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
};

describe("AlertMuteUntilDialog", () => {
  beforeEach(() => extend.mockReset());

  it("closes on ok", async () => {
    extend.mockResolvedValue("ok");
    const wrapper = await mountDialog();
    await submit();
    expect(extend).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("done")).toHaveLength(1);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(wrapper.emitted("settled")).toBeUndefined();
    wrapper.unmount();
  });

  it("closes on conflict and lets its screen refresh, since its version is stale", async () => {
    extend.mockResolvedValue("conflict");
    const wrapper = await mountDialog();
    await submit();
    expect(extend).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("done")).toBeUndefined();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(wrapper.emitted("settled")).toHaveLength(1);
    wrapper.unmount();
  });

  it("stays open on failed with no refresh, since no answer came", async () => {
    extend.mockResolvedValue("failed");
    const wrapper = await mountDialog();
    await submit();
    expect(extend).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("done")).toBeUndefined();
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(wrapper.emitted("settled")).toBeUndefined();
    wrapper.unmount();
  });
});
