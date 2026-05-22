import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import store from "@/test/unit/helpers/store";

import AddUpdateOrganization from "@/components/iam/organizations/AddUpdateOrganization.vue";

vi.mock("@/services/organizations", () => ({
  default: {
    create: vi.fn(async (data: any) => ({
      status: 200,
      data: { data: { id: "1", name: data.name, identifier: "org-1" } },
    })),
    rename_organization: vi.fn(async (_id: any, name: string) => ({
      status: 200,
      data: { data: { id: "1", name, identifier: "org-1" } },
    })),
  },
}));

const orgService = (await import("@/services/organizations")).default;

// toast() is used for all user-facing feedback (loading, error, success).
// The module-level mock returns a dummy dismiss function so calls never throw.
const toastDismiss = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => toastDismiss),
  toastRecords: [],
  useToast: vi.fn(),
}));
import { toast } from "@/lib/feedback/Toast/useToast";

// ODrawer stub: keeps slot content queryable, surfaces open state and
// proxies the migration emit so the parent's @update:open wiring is exercised.
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "width",
    "showClose",
    "persistent",
    "size",
    "title",
    "subTitle",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div data-test-stub="o-drawer" :data-open="open" :data-title="title">
      <div data-test-stub="o-drawer-header"><slot name="header" /></div>
      <div data-test-stub="o-drawer-body"><slot /></div>
      <div data-test-stub="o-drawer-footer"><slot name="footer" /></div>
    </div>
  `,
};

// OButton stub: passes through the data-test attr so existing selectors keep
// working, and forwards click events for assertion-friendly interaction.
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "loading", "type"],
  emits: ["click"],
  template: `<button
      data-test-stub="o-button"
      :data-test="$attrs['data-test']"
      :disabled="disabled"
      :type="type"
      @click="$emit('click', $event)"><slot /></button>`,
  inheritAttrs: false,
};

const mountComp = (props: Record<string, any> = {}): VueWrapper<any> =>
  mount(AddUpdateOrganization, {
    global: {
      plugins: [i18n, router, store],
      stubs: {
        ODrawer: ODrawerStub,
        OButton: OButtonStub,
      },
    },
    props: { open: true, modelValue: { id: "", name: "" }, ...props },
  });

describe("AddUpdateOrganization", () => {
  beforeEach(() => {
    // Restore service mocks to their default implementations, then
    // clear all call history (including toast / toastDismiss) so each
    // test starts from a clean slate.
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("renders create organization title when not updating", () => {
    const wrapper = mountComp();
    const drawer = wrapper.find('[data-test-stub="o-drawer"]');
    expect(drawer.exists()).toBe(true);
    expect(drawer.attributes("data-title")).toBe("New organization");
  });

  it("renders update organization title when beingUpdated", () => {
    const wrapper = mountComp({ modelValue: { id: "123", name: "Acme" } });
    const drawer = wrapper.find('[data-test-stub="o-drawer"]');
    expect(drawer.attributes("data-title")).toBe("Update organization");
    expect(wrapper.vm.beingUpdated).toBe(true);
  });

  it("forwards drawer update:open to parent", async () => {
    const wrapper = mountComp();
    await wrapper
      .findComponent({ name: "ODrawer" })
      .vm.$emit("update:open", false);
    expect(wrapper.emitted("update:open")).toBeTruthy();
    expect(wrapper.emitted("update:open")![0]).toEqual([false]);
  });

  it("cancel button emits update:open false (replaces router.replace cancel)", async () => {
    const wrapper = mountComp();
    await wrapper.findComponent({ name: "ODrawer" }).vm.$emit("click:secondary");
    expect(wrapper.emitted("update:open")).toBeTruthy();
    expect(wrapper.emitted("update:open")![0]).toEqual([false]);
  });

  it("disables save when name is empty (no proPlanRequired)", async () => {
    const wrapper = mountComp();
    await flushPromises();
    expect(
      wrapper.findComponent({ name: "ODrawer" }).props("primaryButtonDisabled"),
    ).toBe(true);
  });

  it("trims name on submit and calls organizations.create, success path resets form, emits updated and update:open false", async () => {
    const wrapper = mountComp();

    // OInput renders data-test on its outer wrapper div, not the native input.
    // Reach inside OInput to set the value on the actual <input> element.
    const nameInput = wrapper.find('[data-test="org-name"] input');
    await nameInput.setValue("  My Org  ");

    // onSubmit is wired to ODrawer's @click:primary, not a <form> submit.
    await wrapper
      .findComponent({ name: "ODrawer" })
      .vm.$emit("click:primary");
    await flushPromises();

    expect(orgService.create).toHaveBeenCalledWith({ name: "My Org" });
    // Loading toast shown, then dismissed on success.
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "loading" }),
    );
    expect(toastDismiss).toHaveBeenCalled();
    expect(wrapper.emitted("updated")).toBeTruthy();
    expect(wrapper.emitted("update:open")).toBeTruthy();
    expect(wrapper.emitted("update:open")![0]).toEqual([false]);
  });

  it("when create returns non-200, sets pro plan required flow and navigates to subscribe", async () => {
    vi.spyOn(orgService, "create").mockResolvedValueOnce({
      status: 402,
      data: {
        message: "Need Pro",
        identifier: "org-new",
        data: { identifier: "org-new" },
      },
    } as any);

    const pushSpy = vi.spyOn(router, "push");
    const wrapper = mountComp();

    // OInput: reach inside to the native <input>
    const nameInput = wrapper.find('[data-test="org-name"] input');
    await nameInput.setValue("Test Org");

    // Trigger via ODrawer @click:primary (replaces the old <form> submit)
    await wrapper
      .findComponent({ name: "ODrawer" })
      .vm.$emit("click:primary");
    await flushPromises();

    expect(wrapper.vm.proPlanRequired).toBe(true);
    expect(wrapper.vm.proPlanMsg).toBe("Need Pro");
    expect(wrapper.vm.newOrgIdentifier).toBe("org-new");
    expect(pushSpy).toHaveBeenCalledWith({
      name: "organizations",
      query: expect.objectContaining({ action: "subscribe" }),
    });
  });

  it("handles create rejection and shows error toast", async () => {
    vi.spyOn(orgService, "create").mockRejectedValueOnce({
      response: { data: { message: "Organization creation failed." } },
    });

    const wrapper = mountComp();

    // OInput: reach inside to the native <input>
    const nameInput = wrapper.find('[data-test="org-name"] input');
    await nameInput.setValue("Err Org");

    // Trigger via ODrawer @click:primary
    await wrapper
      .findComponent({ name: "ODrawer" })
      .vm.$emit("click:primary");
    await flushPromises();

    // Component uses toast() (not Quasar $q.notify). Error variant equals "error".
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
    // The loading toast is also dismissed in the catch handler.
    expect(toastDismiss).toHaveBeenCalled();
  });

  it("completeSubscriptionProcess navigates to billing plans with newOrgIdentifier", async () => {
    const wrapper = mountComp();
    wrapper.vm.newOrgIdentifier = "org-123";
    const pushSpy = vi.spyOn(router, "push");

    wrapper.vm.completeSubscriptionProcess();
    expect(pushSpy).toHaveBeenCalledWith(
      "/billings/plans?org_identifier=org-123",
    );
  });
});
