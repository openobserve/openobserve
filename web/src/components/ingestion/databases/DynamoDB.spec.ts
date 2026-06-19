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
import DynamoDB from "./DynamoDB.vue";
import dynamodbCard from "@/components/ingestion/setupCard/content/dynamodb";
import { getDataSourceCard } from "@/components/ingestion/setupCard/registry";

const mockEndpoint = ref({ url: "https://test.openobserve.ai", host: "h", port: 443, protocol: "https", tls: true });
vi.mock("@/composables/useIngestion", () => ({ default: vi.fn(() => ({ endpoint: mockEndpoint })) }));
vi.mock("@/components/ingestion/setupCard/SetupCardRenderer.vue", () => ({
  default: { name: "SetupCardRenderer", props: ["content", "subs", "logoUrl", "logoUrlDark"], template: '<div data-test="rich-card-stub" />' },
}));
const mockStore = createStore({ state: { selectedOrganization: { identifier: "test-org" }, userInfo: { email: "t@e.com" }, organizationData: { organizationPasscode: "pc" }, theme: "light" } });
const mockI18n = createI18n({ locale: "en", messages: { en: {} } });
const SUBS = { url: "https://test.openobserve.ai", org: "test-org", token: "dGVzdEB0b2tlbg==" };

describe("dynamodbCard builder", () => {
  it("builds a Firehose logs card with the OO endpoint + token", () => {
    const card = dynamodbCard(SUBS);
    expect(card.provider.name).toBe("DynamoDB");
    expect(card.provider.metaBadges).toEqual(["Logs"]);
    expect(card.detect).toMatchObject({ streamType: "logs", match: "keyword", streamName: "dynamodb" });
    expect(card.steps.map((s) => s.id)).toEqual(["firehose-endpoint", "pipeline", "verify"]);
    const code = card.steps.find((s) => s.id === "firehose-endpoint")!.code!;
    expect(code.raw).toContain(`${SUBS.url}/aws/${SUBS.org}/dynamodb/_kinesis_firehose`);
    expect(code.raw).toContain(`Basic ${SUBS.token}`);
  });
});
describe("DynamoDB.vue", () => {
  let wrapper: VueWrapper<any>;
  afterEach(() => { if (wrapper) wrapper.unmount(); });
  it("renders the shared card", () => {
    expect(getDataSourceCard("dynamoDB", SUBS)?.provider.name).toBe("DynamoDB");
    wrapper = mount(DynamoDB, { global: { plugins: [mockStore, mockI18n] } });
    expect(wrapper.findComponent({ name: "SetupCardRenderer" }).exists()).toBe(true);
  });
});
