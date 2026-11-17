// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import NoVersionState from "./NoVersionState.vue";
const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copy }));
const stubs = {
  OEmptyState: { template: '<div><slot name="illustration"/><slot name="extra"/></div>' },
  OButton: { emits: ["click"], template: "<button @click=\"$emit('click')\"><slot/></button>" },
  OTag: true,
  OIcon: true,
  ServiceEnvChip: { props: ["identity", "service"], template: "<span data-test='env-chip' />" },
  ServiceScopeChip: {
    props: ["facet", "value"],
    template: "<span data-test='where-chip'>{{ value }}</span>",
  },
};
beforeEach(() => copy.mockClear());
describe("no-version setup", () => {
  it("copies the snippet through the app's clipboard helper with its success message", async () => {
    const wrapper = mount(NoVersionState, { props: { service: "cart-api" }, global: { stubs } });
    await wrapper.get('[data-test="svcver-copy-snippet"]').trigger("click");
    await flushPromises();
    expect(copy).toHaveBeenCalledOnce();
    const [text, , options] = copy.mock.calls[0] as unknown as [
      string,
      unknown,
      { successMessage: string },
    ];
    expect(text).toContain("OTEL_RESOURCE_ATTRIBUTES=service.version=");
    expect(options.successMessage).toBe("Snippet copied");
  });
  it("leaves no unhandled rejection when the clipboard refuses", async () => {
    copy.mockResolvedValueOnce(false);
    const wrapper = mount(NoVersionState, { props: { service: "cart-api" }, global: { stubs } });
    await wrapper.get('[data-test="svcver-copy-sdk"]').trigger("click");
    await flushPromises();
    expect(copy).toHaveBeenCalledOnce();
  });
  it("shows the env and where chips a versioned panel shows, only when they exist", () => {
    const bare = mount(NoVersionState, { props: { service: "cart-api" }, global: { stubs } });
    expect(bare.find('[data-test="svcver-no-version-header"]').exists()).toBe(false);
    const wrapper = mount(NoVersionState, {
      props: {
        service: "cart-api",
        identity: { where_key: "k8s:walk/shop", env: "walk", env_source: "attr" },
        where: "k8s:walk/shop",
        whereLabel: "walk · shop",
      },
      global: { stubs },
    });
    const header = wrapper.get('[data-test="svcver-no-version-header"]');
    expect(header.text()).toContain("cart-api");
    expect(header.find('[data-test="env-chip"]').exists()).toBe(true);
    expect(header.get('[data-test="where-chip"]').text()).toBe("walk · shop");
  });
});
