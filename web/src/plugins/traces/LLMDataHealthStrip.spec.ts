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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import type { DataHealthCheck, DataHealthModelUsage } from "@/services/gen-ai-data-health.service";
import LLMDataHealthStrip from "./LLMDataHealthStrip.vue";

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { query: {} } } }),
}));

const ODrawerStub = { name: "ODrawer", template: "<div><slot /></div>" };

function mountStrip(models: DataHealthModelUsage[], totals: Partial<DataHealthCheck> = {}) {
  const store = createStore({ state: { selectedOrganization: { identifier: "test-org" } } });
  return mount(LLMDataHealthStrip, {
    props: {
      health: {
        checked_at: 0,
        checks: [
          { id: "unpriced_models", status: "warning", affected: 12, total: 40, models, ...totals },
        ],
      },
      stream: "default",
      samples: null,
    },
    global: { provide: { store }, mocks: { $store: store }, stubs: { ODrawer: ODrawerStub } },
  });
}

const cardText = (w: VueWrapper) =>
  w.find('[data-test="llm-data-health-card-unpriced_models"]').text();

describe("LLMDataHealthStrip unpriced models detail", () => {
  let wrapper: VueWrapper;

  afterEach(() => wrapper?.unmount());

  it("uses the singular form for one unpriced model", () => {
    wrapper = mountStrip([{ model: "acme", spans: 12, tokens: 1000 }]);
    expect(cardText(wrapper)).toContain("1 model ·");
  });

  it("uses the plural form for several unpriced models", () => {
    wrapper = mountStrip([
      { model: "acme", spans: 6, tokens: 500 },
      { model: "beta", spans: 6, tokens: 500 },
    ]);
    expect(cardText(wrapper)).toContain("2 models ·");
  });

  it("counts every unpriced model and token, not just the listed top 20", () => {
    const listed = Array.from({ length: 20 }, (_, i) => ({
      model: `model-${i}`,
      spans: 1,
      tokens: 10,
    }));
    wrapper = mountStrip(listed, {
      model_count: 25,
      unpriced_tokens: 5000,
      models_truncated: true,
    });
    expect(wrapper.find('[data-test="llm-data-health-chip-unpriced_models"]').text()).toContain(
      "· 25",
    );
    expect(cardText(wrapper)).toContain("25 models ·");
    expect(cardText(wrapper)).toContain("5.0K tokens");
    expect(wrapper.find('[data-test="llm-data-health-unpriced-truncated"]').text()).toBe(
      "Top 20 of 25 by tokens",
    );
  });

  it("shows no truncation note when every model is listed", () => {
    wrapper = mountStrip([{ model: "acme", spans: 12, tokens: 1000 }], {
      model_count: 1,
      unpriced_tokens: 1000,
      models_truncated: false,
    });
    expect(wrapper.find('[data-test="llm-data-health-unpriced-truncated"]').exists()).toBe(false);
  });
});
