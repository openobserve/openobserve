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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import securityCases from "@/services/securityCases";
import { okResponse } from "@/views/Security/__fixtures__/securityFixtures";

const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/securityCases", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securityCases")>());
});
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: (...args: unknown[]) => toastMock(...args),
}));
vi.mock("@/lib/overlay/Dialog/ODialog.vue", () => ({
  default: {
    name: "ODialog",
    props: ["open", "primaryButtonDisabled"],
    template: `<div v-if="open" class="o-dialog-stub"><slot /></div>`,
  },
}));

import SecurityCaseSettingsDialog from "./SecurityCaseSettingsDialog.vue";

let wrapper: VueWrapper | null = null;

const mountDialog = async () => {
  wrapper = mount(SecurityCaseSettingsDialog, {
    props: { open: true },
    global: { provide: { store }, plugins: [store, withQueryClient()] },
  });
  await flushPromises();
  return wrapper;
};

const input = (w: VueWrapper, test: string) => w.find(`[data-test="${test}"] input`);

const submit = async (w: VueWrapper) => {
  await w.find("form").trigger("submit");
  await flushPromises();
};

const serverError = (message: string) =>
  Object.assign(new Error(message), { response: { status: 400, data: { message } } });

beforeEach(() => {
  vi.mocked(securityCases.getSettings).mockResolvedValue(
    okResponse({ auto_close_days: 7, group_window_minutes: 1440 }) as never,
  );
  vi.mocked(securityCases.updateSettings).mockImplementation(
    async (_org, settings) => okResponse(settings) as never,
  );
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityCaseSettingsDialog", () => {
  it("shows the org's current settings", async () => {
    const w = await mountDialog();
    expect((input(w, "security-case-settings-auto-close").element as HTMLInputElement).value).toBe(
      "7",
    );
    expect(
      (input(w, "security-case-settings-group-window").element as HTMLInputElement).value,
    ).toBe("1440");
  });

  it("saves numbers and closes", async () => {
    const w = await mountDialog();
    await input(w, "security-case-settings-auto-close").setValue("30");
    await input(w, "security-case-settings-group-window").setValue("60");
    await submit(w);
    await vi.waitFor(() => expect(w.emitted("update:open")?.at(-1)).toEqual([false]));
    expect(securityCases.updateSettings).toHaveBeenCalledWith(expect.any(String), {
      auto_close_days: 30,
      group_window_minutes: 60,
    });
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("refuses values the server would refuse", async () => {
    const w = await mountDialog();
    await input(w, "security-case-settings-auto-close").setValue("400");
    await input(w, "security-case-settings-group-window").setValue("1.5");
    await submit(w);
    await vi.waitFor(() => expect(w.text()).toContain("Enter a value from 0 to 365"));
    expect(w.text()).toContain("Enter a whole number");
    expect(securityCases.updateSettings).not.toHaveBeenCalled();
  });

  it("does not read an emptied field as 0", async () => {
    const w = await mountDialog();
    await input(w, "security-case-settings-auto-close").setValue("");
    await submit(w);
    await vi.waitFor(() => expect(w.text()).toContain("Enter a whole number"));
    expect(securityCases.updateSettings).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and shows the server's message when saving fails", async () => {
    vi.mocked(securityCases.updateSettings).mockRejectedValue(
      serverError("auto_close_days must be at most 365"),
    );
    const w = await mountDialog();
    await submit(w);
    await vi.waitFor(() =>
      expect(w.find('[data-test="security-case-settings-save-error"]').text()).toContain(
        "auto_close_days must be at most 365",
      ),
    );
    expect(w.emitted("update:open")).toBeUndefined();
  });

  it("explains a failed load instead of showing a blank form", async () => {
    vi.mocked(securityCases.getSettings).mockRejectedValue(serverError("Security is not licensed"));
    const w = await mountDialog();
    expect(w.find('[data-test="security-case-settings-load-error"]').text()).toContain(
      "Security is not licensed",
    );
    expect(w.find("form").exists()).toBe(false);
  });
});
