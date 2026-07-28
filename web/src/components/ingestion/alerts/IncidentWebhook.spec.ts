import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import IncidentWebhook from "./IncidentWebhook.vue";

vi.mock("../../../utils/zincutils", () => ({
  getEndPoint: vi.fn(() => ({
    url: "https://test.example.com:5080",
    host: "test.example.com",
    port: "5080",
    protocol: "https",
    tls: true,
  })),
  getIngestionURL: vi.fn(() => "https://test.example.com:5080"),
  getImageURL: vi.fn(() => "mock-image-url"),
}));

vi.mock("@/components/CopyContent.vue", () => ({
  default: {
    name: "CopyContent",
    props: ["content"],
    template: "<div class='copy-content'>{{ content }}</div>",
  },
}));

vi.mock("@/components/ingestion/IngestionDocLink.vue", () => ({
  default: {
    name: "IngestionDocLink",
    props: ["href"],
    template: "<a :href='href'><slot /></a>",
  },
}));

describe("IncidentWebhook.vue", () => {
  let wrapper: any;
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
      },
    });

    wrapper = mount(IncidentWebhook, {
      global: {
        plugins: [store, i18n],
      },
      props: {
        currOrgIdentifier: "test-org",
        currUserEmail: "test@example.com",
      },
    });
  });

  it("renders", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("targets the incident ingest endpoint, not a stream ingest path", () => {
    // The whole point of this tab: alerts go to the correlation endpoint and
    // never land in a stream. A `/default/_json`-style URL here would be wrong.
    expect(wrapper.vm.firingContent).toContain(
      "https://test.example.com:5080/api/v2/test-org/alerts/incidents/ingest",
    );
    expect(wrapper.vm.firingContent).not.toContain("_json");
  });

  it("shows the fields correlation actually depends on", () => {
    const content = wrapper.vm.firingContent;
    expect(content).toContain('"source"');
    expect(content).toContain('"alert_name"');
    expect(content).toContain('"labels"');
  });

  it("shows a resolve example carrying the same alert identity", () => {
    // Resolve is matched on (source, alert_name) — an example missing either
    // would not actually resolve anything.
    const content = wrapper.vm.resolveContent;
    expect(content).toContain('"status": "resolved"');
    expect(content).toContain('"source": "alertmanager"');
    expect(content).toContain('"alert_name": "HighErrorRate"');
  });

  it("maps the Alertmanager payload rather than posting it raw", () => {
    // Alertmanager's native shape is rejected by this endpoint, so the example
    // must show a transform. A bare webhook_configs block would 400 at runtime.
    const content = wrapper.vm.alertmanagerContent;
    expect(content).toContain("alert_name:  .labels.alertname");
    expect(content).not.toContain("webhook_configs");
  });
});
