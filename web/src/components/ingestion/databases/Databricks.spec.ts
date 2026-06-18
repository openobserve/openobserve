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
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { ref } from "vue";
import Databricks from "./Databricks.vue";
import databricksCard from "@/components/ingestion/setupCard/content/databricks";
import { getDataSourceCard } from "@/components/ingestion/setupCard/registry";

const mockEndpoint = ref({ url: "https://test.openobserve.ai", host: "h", port: 443, protocol: "https", tls: true });
vi.mock("@/composables/useIngestion", () => ({ default: vi.fn(() => ({ endpoint: mockEndpoint })) }));
vi.mock("@/components/ingestion/setupCard/SetupCardRenderer.vue", () => ({
  default: { name: "SetupCardRenderer", props: ["content", "subs", "logoUrl", "logoUrlDark"], template: '<div data-test="rich-card-stub" />' },
}));
const mockStore = createStore({ state: { selectedOrganization: { identifier: "test-org" }, userInfo: { email: "t@e.com" }, organizationData: { organizationPasscode: "pc" }, theme: "light" } });
const mockI18n = createI18n({ locale: "en", messages: { en: {} } });
const SUBS = { url: "https://test.openobserve.ai", org: "test-org", token: "dGVzdEB0b2tlbg==" };

describe("databricksCard builder", () => {
  it("builds a logs card posting to the org's logs endpoint", () => {
    const card = databricksCard(SUBS);
    expect(card.provider.name).toBe("Databricks");
    expect(card.provider.metaBadges).toEqual(["Logs"]);
    expect(card.detect).toMatchObject({ streamType: "logs", match: "keyword", streamName: "databricks" });
    expect(card.steps.map((s) => s.id)).toEqual(["notebook", "verify"]);
    const code = card.steps.find((s) => s.id === "notebook")!.code!;
    expect(code.raw).toContain(`${SUBS.url}/api/${SUBS.org}/databricks_logs/_json`);
    expect(code.raw).toContain(`Basic ${SUBS.token}`);
    expect(code.masked).not.toContain(SUBS.token);
  });
});
describe("Databricks.vue", () => {
  let wrapper: VueWrapper<any>;
  afterEach(() => { if (wrapper) wrapper.unmount(); });
  it("renders the shared card", () => {
    expect(getDataSourceCard("databricks", SUBS)?.provider.name).toBe("Databricks");
    wrapper = mount(Databricks, { global: { plugins: [mockStore, mockI18n] } });
    expect(wrapper.findComponent({ name: "SetupCardRenderer" }).exists()).toBe(true);
  });
});
