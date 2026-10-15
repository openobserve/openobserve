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

import { afterEach, describe, expect, it } from "vitest";
import { h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import TracesNoDataState from "./TracesNoDataState.vue";

let wrapper: VueWrapper;

const mountState = (props: Record<string, unknown> = {}, withStatus = false) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  const store = createStore({
    state: { selectedOrganization: { identifier: "acme-prod" }, theme: "light" },
  });
  wrapper = mount(TracesNoDataState, {
    props: { aiEnabled: true, ...props },
    slots: withStatus
      ? { status: () => h("span", { "data-test": "status-line" }, "Waiting for your first traces") }
      : {},
    global: { plugins: [i18n, store, router] },
  });
  return wrapper;
};
const html = () => wrapper.html();
const shellProps = () => wrapper.findComponent(OEmptyState).vm.$.vnode.props ?? {};

afterEach(() => {
  wrapper?.unmount();
});

describe("TracesNoDataState", () => {
  it("renders today's hero by default: trace illustration, title, description and cards", () => {
    mountState();
    expect(shellProps()).toMatchObject({ size: "hero", illustration: "trace" });
    expect(Object.keys(shellProps())).not.toContain("backdrop");
    expect(wrapper.find("h2").text()).toBe("Start sending traces to OpenObserve");
    expect(wrapper.text()).toContain("No trace streams found in this organization yet");
    expect(wrapper.find('[data-test="traces-no-data-another-way"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="traces-no-data-otlp-card"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="traces-no-data-kubernetes-btn"]').exists()).toBe(true);
  });

  it("puts a status line between the description and the cards (e2)", () => {
    mountState({}, true);
    const at = (needle: string) => html().indexOf(needle);
    expect(at("No trace streams found in this organization yet")).toBeGreaterThan(-1);
    expect(at('data-test="status-line"')).toBeGreaterThan(
      at("No trace streams found in this organization yet"),
    );
    expect(at('data-test="status-line"')).toBeLessThan(at('data-test="traces-no-data-otlp-card"'));
    expect(wrapper.find("h2").text()).toBe("Start sending traces to OpenObserve");
  });

  it("keeps only the cards and chips under an Or start another way caption below the panel (e1)", () => {
    mountState({ alternativesOnly: true });
    expect(shellProps()).toMatchObject({ size: "block", backdrop: false });
    expect(shellProps().illustration).toBeUndefined();
    expect(wrapper.find('[data-test="traces-no-data-another-way"]').text()).toBe(
      "Or start another way",
    );
    expect(wrapper.text()).not.toContain("Start sending traces to OpenObserve");
    expect(wrapper.text()).not.toContain("No trace streams found in this organization yet");
    expect(wrapper.find('[data-test="traces-no-data-otlp-card"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="traces-no-data-kubernetes-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="traces-no-data-ask-ai-btn"]').exists()).toBe(true);
  });
});
