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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { intentSchemaKey, type IntentStream } from "@/utils/alerts/intents";
import {
  buildIntentChoices,
  pickSuggestions,
  visibleIntents,
} from "@/utils/alerts/startSuggestions";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/composables/alerts/useAlertSuggestions", () => ({
  useSuggestionBacktest: () => ({ run: mocks.run }),
}));

import AlertSuggestionCard from "@/components/alerts/AlertSuggestionCard.vue";

const NOW = Date.now();
const app: IntentStream = {
  name: "app",
  stream_type: "logs",
  stats: { doc_num: 900, doc_time_max: (NOW - 60_000) * 1000 },
};
const [suggestion] = pickSuggestions(
  buildIntentChoices(
    visibleIntents(false),
    [app],
    { [intentSchemaKey(app)]: [{ name: "level", type: "Utf8" }] },
    NOW,
  ),
);

const mountCard = () =>
  mount(AlertSuggestionCard, {
    props: { suggestion },
    global: { plugins: [i18n, store] },
  });

let observer: ReturnType<typeof installFakeIntersectionObserver>;

beforeEach(() => {
  mocks.run.mockReset();
  observer = installFakeIntersectionObserver({ autoVisible: true });
});

afterEach(() => observer.restore());

describe("AlertSuggestionCard", () => {
  it("names the intent and the stream it fits", async () => {
    mocks.run.mockResolvedValue(null);
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.text()).toContain("Errors increase in app");
  });

  it.each([
    [{ state: "tested", episodes: 4 }, "Would have fired 4 times yesterday."],
    [{ state: "tested", episodes: 0 }, "Wouldn't have fired yesterday."],
    [{ state: "untested" }, "Not tested: not enough history."],
    [{ state: "failed" }, "Couldn't check history."],
  ])("says what yesterday's back-test found (%o)", async (result, copy) => {
    mocks.run.mockResolvedValue(result);
    const wrapper = mountCard();
    await flushPromises();
    expect(mocks.run).toHaveBeenCalledWith(suggestion);
    expect(wrapper.text()).toContain(copy);
  });

  it("waits until it scrolls into view before back-testing", async () => {
    observer.restore();
    observer = installFakeIntersectionObserver();
    mocks.run.mockResolvedValue({ state: "tested", episodes: 1 });
    const wrapper = mountCard();
    await flushPromises();
    expect(mocks.run).not.toHaveBeenCalled();
    observer.setVisible(wrapper.element, true);
    await flushPromises();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("emits its prefill when picked", async () => {
    mocks.run.mockResolvedValue(null);
    const wrapper = mountCard();
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("choose")?.[0]).toEqual([suggestion.prefill]);
  });
});
