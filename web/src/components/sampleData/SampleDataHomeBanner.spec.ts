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
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import SampleDataHomeBanner from "./SampleDataHomeBanner.vue";
import {
  SampleLoadRunningError,
  useSampleDataSession,
} from "@/composables/sampleData/useSampleDataSession";
import { loadSampleData, removeSampleData } from "@/utils/sampleData/loader";

const ORG = "test-org";

const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("@/utils/sampleData/loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/sampleData/loader")>()),
  loadSampleData: vi.fn(),
  removeSampleData: vi.fn(),
}));

vi.mock("@/composables/sampleData/useSampleDataPresence", async () => {
  const { computed } = await import("vue");
  return {
    useSampleDataPresence: () => ({
      ready: computed(() => true),
      hasSample: computed(() => true),
      hasRealData: computed(() => true),
    }),
  };
});

const ConfirmStub = defineComponent({
  props: { modelValue: Boolean, focusCancel: Boolean },
  emits: ["update:ok", "update:cancel"],
  setup:
    (props, { emit }) =>
    () =>
      props.modelValue ? h("button", { class: "ok", onClick: () => emit("update:ok") }) : null,
});

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: enLocale } });

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("SampleDataHomeBanner", () => {
  const session = useSampleDataSession();
  let wrapper: VueWrapper;

  const removeBtn = () => wrapper.find('[data-test="sample-data-cleanup-remove"]');
  const confirmRemove = async () => {
    await removeBtn().trigger("click");
    await wrapper.find(".ok").trigger("click");
    await flushPromises();
  };

  beforeEach(() => {
    localStorage.clear();
    toastMock.mockClear();
    vi.mocked(removeSampleData).mockReset().mockResolvedValue([]);
    wrapper = mount(SampleDataHomeBanner, {
      global: {
        plugins: [
          i18n,
          createStore({ state: { selectedOrganization: { identifier: ORG }, zoConfig: {} } }),
        ],
        stubs: { ConfirmDialog: ConfirmStub },
      },
    });
  });

  afterEach(() => wrapper.unmount());

  // Enter, Enter must not delete everything
  it("passes the parent's class to the banner root", () => {
    const w = mount(SampleDataHomeBanner, {
      attrs: { class: "mt-2.5" },
      global: {
        plugins: [
          i18n,
          createStore({ state: { selectedOrganization: { identifier: ORG }, zoConfig: {} } }),
        ],
        stubs: { ConfirmDialog: ConfirmStub },
      },
    });
    expect(w.get('[data-test="sample-data-cleanup-banner"]').classes()).toContain("mt-2.5");
    w.unmount();
  });

  it("removes in the progress dialog after the confirmation", async () => {
    await confirmRemove();
    expect(removeSampleData).toHaveBeenCalledWith(ORG, expect.any(Function));
    expect(session.removeDialogOpen.value).toBe(true);
    expect(toastMock).not.toHaveBeenCalled();
    session.closeRemoveDialog();
  });

  it("puts the focus on Cancel in the delete confirmation", () => {
    expect(wrapper.findComponent(ConfirmStub).props("focusCancel")).toBe(true);
  });

  it("disables Remove while a removal started anywhere runs", async () => {
    const removal = deferred<string[]>();
    vi.mocked(removeSampleData).mockReturnValue(removal.promise);
    const header = session.remove(ORG);
    await flushPromises();
    expect(removeBtn().attributes("disabled")).toBeDefined();
    removal.resolve([]);
    await header;
    await flushPromises();
    expect(removeBtn().attributes("disabled")).toBeUndefined();
  });

  it("ends failed in the dialog when Remove is confirmed while this org's load runs", async () => {
    const load = deferred<{ counts: object; failedSteps: string[] }>();
    vi.mocked(loadSampleData).mockReturnValue(load.promise as never);
    const loading = session.start(ORG);
    await flushPromises();
    await confirmRemove();
    expect(removeSampleData).not.toHaveBeenCalled();
    expect(session.removePhase.value).toBe("failed");
    expect(session.removeError.value).toBeInstanceOf(SampleLoadRunningError);
    session.closeRemoveDialog();
    load.resolve({ counts: { logs: 0, spans: 0, metrics: 0 }, failedSteps: [] });
    await loading;
  });
});
