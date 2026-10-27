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

import { describe, it, expect, vi, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetRail from "./FleetRail.vue";
import FleetMoveDialog from "./FleetMoveDialog.vue";
import { apiFleet } from "./fleet.fixtures";
import { toFleetRow } from "./useFleetApi";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: {
    createFleet: vi.fn(),
    renameFleet: vi.fn(),
    deleteFleet: vi.fn(),
    listFleets: vi.fn(),
    moveCollectors: vi.fn(),
  },
}));

const rows = [
  toFleetRow(apiFleet()),
  toFleetRow(
    apiFleet({
      id: "f1",
      name: "edge",
      state: {
        desired: null,
        stable: { config: "edge", version: 4 },
        rollout: { id: "r1", status: "halted" },
        collectors: 7,
        online: 7,
        at_desired: 0,
      },
    }),
  ),
];

const DropdownStub = { template: "<div><slot name='trigger' /><slot /></div>" };
const DropdownItemStub = {
  inheritAttrs: false,
  props: ["variant", "iconLeft"],
  emits: ["select"],
  template: `<button :data-test="$attrs['data-test']" @click="$emit('select')"><slot /></button>`,
};

const org = () => store.state.selectedOrganization.identifier;

describe("FleetRail", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  function mountRail(activeId = "default") {
    return mount(FleetRail, {
      props: { rows, activeId },
      global: {
        plugins: [i18n, store],
        stubs: { ODropdown: DropdownStub, ODropdownItem: DropdownItemStub },
      },
    });
  }

  it("lists the fleets with their collector counts and a dot for a halted rollout", () => {
    wrapper = mountRail();
    expect(wrapper.find('[data-test="fleet-rail-item-f1"]').text()).toContain("edge");
    expect(wrapper.find('[data-test="fleet-rail-item-f1"]').text()).toContain("7");
    expect(wrapper.find('[data-test="fleet-rail-rollout-f1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-rail-rollout-default"]').exists()).toBe(false);
  });

  it("offers no rename or delete on the default fleet", () => {
    wrapper = mountRail();
    expect(wrapper.find('[data-test="fleet-rail-delete-default"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-rail-delete-f1"]').exists()).toBe(true);
  });

  it("creates a fleet through fleet/fleets and selects it", async () => {
    vi.mocked(fleet.createFleet).mockResolvedValue({ data: { id: "f9", name: "new" } } as any);
    wrapper = mountRail();
    (wrapper.vm as unknown as { create: () => void }).create();
    await flushPromises();
    const dialog = wrapper.findComponent({ name: "FleetNameDialog" });
    expect(dialog.props("open")).toBe(true);
    expect(await dialog.props("save")("new")).toBe(true);
    expect(fleet.createFleet).toHaveBeenCalledWith(org(), "new");
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["f9"]);
  });

  it("renames a fleet", async () => {
    vi.mocked(fleet.renameFleet).mockResolvedValue({ data: {} } as any);
    wrapper = mountRail();
    await wrapper.find('[data-test="fleet-rail-rename-f1"]').trigger("click");
    const dialog = wrapper.findComponent({ name: "FleetNameDialog" });
    expect(dialog.props("initial")).toBe("edge");
    await dialog.props("save")("edge-2");
    expect(fleet.renameFleet).toHaveBeenCalledWith(org(), "f1", "edge-2");
  });

  it("deletes only after the name is typed, warning about its collectors", async () => {
    vi.mocked(fleet.deleteFleet).mockResolvedValue({ status: 204 } as any);
    wrapper = mountRail("f1");
    await wrapper.find('[data-test="fleet-rail-delete-f1"]').trigger("click");
    const confirm = wrapper.findComponent({ name: "ConfirmDialog" });
    expect(confirm.props("confirmText")).toBe("edge");
    expect(confirm.props("message")).toContain("7 collectors");
    confirm.vm.$emit("update:ok");
    await flushPromises();
    expect(fleet.deleteFleet).toHaveBeenCalledWith(org(), "f1");
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["default"]);
  });

  it("shows the server's reason when a write is refused", async () => {
    vi.mocked(fleet.createFleet).mockRejectedValue({
      response: { status: 409, data: { message: "fleet edge exists" } },
    });
    wrapper = mountRail();
    (wrapper.vm as unknown as { create: () => void }).create();
    await flushPromises();
    expect(await wrapper.findComponent({ name: "FleetNameDialog" }).props("save")("edge")).toBe(
      false,
    );
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "fleet edge exists" }),
    );
  });
});

describe("FleetMoveDialog", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  const DialogStub = {
    name: "ODialog",
    props: ["open", "title", "primaryButtonDisabled"],
    emits: ["click:primary"],
    template: `<div v-if="open"><span data-test="title">{{ title }}</span><slot /></div>`,
  };

  async function mountMove(ids: string[], source = "default") {
    vi.mocked(fleet.listFleets).mockResolvedValue({
      data: {
        items: [
          apiFleet(),
          apiFleet({
            id: "f1",
            name: "edge",
            state: {
              desired: null,
              stable: { config: "edge", version: 4 },
              rollout: null,
              collectors: 0,
              online: 0,
              at_desired: 0,
            },
          }),
        ],
      },
    } as any);
    const w = mount(FleetMoveDialog, {
      props: { open: true, collectorIds: ids, sourceFleetId: source },
      global: { plugins: [i18n, store], stubs: { ODialog: DialogStub } },
    });
    await flushPromises();
    return w;
  }

  it("leaves the source out and says the collectors get the destination's stable version", async () => {
    wrapper = await mountMove(["c1", "c2"]);
    const select = wrapper.findComponent({ name: "OSelect" });
    expect(select.props("options").map((o: { value: string }) => o.value)).toEqual(["f1"]);
    select.vm.$emit("update:modelValue", "f1");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-move-dialog-effect"]').text()).toContain(
      "edge's stable version, edge v4, at once",
    );
  });

  it("moves in one request and reports the count", async () => {
    vi.mocked(fleet.moveCollectors).mockResolvedValue({ data: { moved: 2 } } as any);
    wrapper = await mountMove(["c1", "c2"]);
    wrapper.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", "f1");
    await flushPromises();
    wrapper.findComponent(DialogStub).vm.$emit("click:primary");
    await flushPromises();
    expect(fleet.moveCollectors).toHaveBeenCalledWith(org(), ["c1", "c2"], "f1");
    expect(wrapper.emitted("moved")).toHaveLength(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "Moved 2 collectors" }),
    );
  });

  it("refuses more than a thousand collectors at once", async () => {
    wrapper = await mountMove(Array.from({ length: 1001 }, (_, i) => `c${i}`));
    wrapper.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", "f1");
    await flushPromises();
    expect(wrapper.findComponent(DialogStub).props("primaryButtonDisabled")).toBe(true);
    expect(wrapper.find('[data-test="fleet-move-dialog-too-many"]').exists()).toBe(true);
  });
});
