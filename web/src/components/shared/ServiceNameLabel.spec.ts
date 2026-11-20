// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ServiceNameLabel from "./ServiceNameLabel.vue";
import { labelRows } from "./ServiceNameLabel.fixtures";
import { serviceLabelProps, serviceRefFrom } from "@/types/serviceRef";

const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ push }),
}));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "org" } } }),
}));

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  push.mockReset();
});
const ids = (w: VueWrapper) =>
  w
    .findAll("[data-test]")
    .map((node) => node.attributes("data-test"))
    .filter((id) => id?.startsWith("svcver-"));
function render(row: (typeof labelRows)[keyof typeof labelRows], extra: object = {}) {
  wrapper = mount(ServiceNameLabel, {
    props: { ...serviceLabelProps(row), ...extra },
    attachTo: document.body,
  });
  return wrapper;
}

describe("ServiceNameLabel", () => {
  it("shows the trace name alone when it only differs in case", () => {
    const w = render(labelRows.sameName);
    expect(w.get('[data-test="svcver-service-name"]').text()).toContain("CheckoutService");
    expect(w.attributes("data-display-source")).toBe("trace");
    expect(ids(w)).not.toContain("svcver-service-name-detected");
    expect(ids(w)).not.toContain("svcver-service-name-ambiguity");
  });

  it("adds a detected-as line with the key when the names differ", () => {
    const w = render(labelRows.differs);
    expect(w.text()).toContain(labelRows.differs.display_name);
    expect(w.get('[data-test="svcver-service-name-detected"]').text()).toBe(
      `detected as ${labelRows.differs.service_name}`,
    );
  });

  it("renders an ambiguous detection in mono with a sorted candidates popover", async () => {
    const w = render(labelRows.ambiguous, { canReview: true });
    expect(ids(w)).not.toContain("svcver-service-name-detected");
    expect(w.find(".font-mono").text()).toBe("openobserve");
    const chip = w.get('[data-test="svcver-service-name-ambiguity"]');
    expect(chip.text()).toBe("covers 3 trace services");
    await chip.trigger("click");
    await flushPromises();
    const list = document.body.querySelector('[data-test="svcver-service-name-candidates"]');
    expect(list?.textContent).toContain("openobserve covers 3 trace services");
    const names = [...(list?.querySelectorAll(".font-mono") ?? [])].map((n) => n.textContent);
    expect(names).toEqual([...labelRows.ambiguous.display_candidates].sort());
    expect(list?.textContent).toContain("Correlation keeps matching on openobserve.");
    (
      document.body.querySelector('[data-test="svcver-service-name-review-link"]') as HTMLElement
    ).click();
    expect(push).toHaveBeenCalledWith({
      name: "correlationSettings",
      params: { tab: "services" },
      query: { org_identifier: "org", view: "name-review" },
    });
  });

  it("hides the review link without alias write access", async () => {
    const w = render(labelRows.ambiguous);
    await w.get('[data-test="svcver-service-name-ambiguity"]').trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="svcver-service-name-candidates"]')).not.toBe(
      null,
    );
    expect(document.body.querySelector('[data-test="svcver-service-name-review-link"]')).toBe(null);
  });

  it("appends the collision qualifier to the name", () => {
    const w = render(labelRows.qualified);
    expect(w.get('[data-test="svcver-service-name-qualifier"]').text()).toBe("· pentest");
    expect(w.find('[data-test="svcver-service-name-detected"]').exists()).toBe(true);
    expect(serviceRefFrom(labelRows.qualified)).toEqual({
      key: "pentest-openobserve-alertquerier",
      display: "querier · pentest",
    });
  });

  it("keeps a detection-only name in mono without a detected line", () => {
    const w = render(labelRows.detectedOnly);
    expect(w.find(".font-mono").text()).toBe("nats");
    expect(ids(w)).toEqual(["svcver-service-name"]);
  });

  it("marks an SDK placeholder name", () => {
    const w = render(labelRows.placeholder);
    expect(w.get('[data-test="svcver-service-name-placeholder"]').text()).toBe(
      "Placeholder name sent by the SDK",
    );
  });

  it("says no service name was sent for the ingest default, never that the SDK sent it", () => {
    const w = render({ service_name: "default", display_name: "default", display_source: "trace" });
    expect(w.get('[data-test="svcver-service-name-placeholder"]').text()).toBe(
      "No service name was sent",
    );
  });

  it("falls back to the key with no hover when the backend sends no display fields", () => {
    const w = render(labelRows.noDisplay);
    expect(w.text()).toBe(labelRows.noDisplay.service_name);
    expect(w.attributes("data-display-source")).toBe("none");
    expect(w.find(".font-mono").exists()).toBe(false);
    expect(ids(w)).toEqual(["svcver-service-name"]);
    expect(serviceRefFrom(labelRows.noDisplay)).toEqual({
      key: labelRows.noDisplay.service_name,
      display: labelRows.noDisplay.service_name,
    });
  });
});
