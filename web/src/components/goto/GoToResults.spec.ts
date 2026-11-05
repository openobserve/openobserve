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
import { nextTick } from "vue";

import i18n from "@/locales";
import { raw } from "@/types/i18n";
import type { GoToMatch } from "@/composables/goto/types";

import GoToResults from "./GoToResults.vue";

const page = (id: string, exact = false): GoToMatch => ({
  id: `page:${id}`,
  kind: "page",
  label: raw(id),
  route: { path: `/${id}` },
  exact,
});
const ask: GoToMatch = { id: "ask", kind: "ask", label: raw("Ask: logs"), exact: false };

describe("GoToResults", () => {
  let wrapper: VueWrapper<any> | undefined;

  const mountResults = (matches: GoToMatch[], query = "logs") => {
    wrapper = mount(GoToResults, {
      props: { matches, query, listboxId: "lb" },
      global: { plugins: [i18n] },
    });
    return wrapper;
  };
  const key = (name: string) => {
    const event = new KeyboardEvent("keydown", { key: name, cancelable: true });
    const handled = wrapper!.vm.onKeydown(event);
    return { handled, prevented: event.defaultPrevented };
  };
  const selected = () => (wrapper!.emitted("select") ?? []).map(([m]) => (m as GoToMatch).id);

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("highlights nothing on open unless a match is exact", async () => {
    mountResults([page("Logs explorer"), page("Pipelines"), ask]);
    await nextTick();
    expect(wrapper!.vm.activeDescendant).toBeUndefined();
    expect(wrapper!.findAll('[aria-selected="true"]')).toHaveLength(0);
    await wrapper!.setProps({ matches: [page("Logs explorer"), page("Logs", true), ask] });
    expect(wrapper!.vm.activeDescendant).toBe("lb-option-1");
    expect(wrapper!.find("#lb-option-1").attributes("aria-selected")).toBe("true");
  });

  it("highlights a match that becomes exact while the IDs stay the same", async () => {
    mountResults([page("Logs"), ask], "log");
    expect(wrapper!.vm.activeDescendant).toBeUndefined();
    await wrapper!.setProps({ matches: [page("Logs", true), ask], query: "logs" });
    expect(wrapper!.vm.activeDescendant).toBe("lb-option-0");
    key("Enter");
    expect(selected()).toEqual(["page:Logs"]);
  });

  it("keeps the arrowed row while the matches and query do not change", async () => {
    mountResults([page("Logs", true), page("Logs patterns"), ask]);
    key("ArrowDown");
    await nextTick();
    await wrapper!.setProps({ matches: [page("Logs", true), page("Logs patterns"), ask] });
    expect(wrapper!.vm.activeDescendant).toBe("lb-option-1");
  });

  it("keeps the arrowed row when late matches arrive for the same query", async () => {
    mountResults([page("Logs explorer"), page("Pipelines"), ask]);
    key("ArrowDown");
    key("ArrowDown");
    await nextTick();
    await wrapper!.setProps({
      matches: [page("Alert logs"), page("Logs explorer"), page("Pipelines"), ask],
    });
    expect(wrapper!.vm.activeDescendant).toBe("lb-option-2");
    key("Enter");
    expect(selected()).toEqual(["page:Pipelines"]);
  });

  it("drops the arrowed row when the query changes", async () => {
    mountResults([page("Logs explorer"), page("Pipelines"), ask]);
    key("ArrowDown");
    await nextTick();
    await wrapper!.setProps({
      matches: [page("Logs explorer"), page("Pipelines"), ask],
      query: "pi",
    });
    expect(wrapper!.vm.activeDescendant).toBeUndefined();
    key("Enter");
    expect(selected()).toEqual(["ask"]);
  });

  it("does not change what Enter opens when the pointer hovers a row", async () => {
    mountResults([page("Logs explorer"), page("Pipelines"), ask]);
    await wrapper!.find("#lb-option-1").trigger("mouseenter");
    expect(wrapper!.vm.activeDescendant).toBeUndefined();
    key("Enter");
    expect(selected()).toEqual(["ask"]);
  });

  it("scrolls the arrowed row into view", async () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      wrapper = mount(GoToResults, {
        props: {
          matches: [page("Logs explorer"), page("Pipelines"), ask],
          query: "logs",
          listboxId: "lb",
        },
        global: { plugins: [i18n] },
        attachTo: document.body,
      });
      key("ArrowUp");
      await nextTick();
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(document.getElementById("lb-option-2"));
      expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("asks on Enter when the user has not arrowed onto a match", () => {
    mountResults([page("Logs explorer"), ask]);
    expect(key("Enter")).toEqual({ handled: true, prevented: true });
    expect(selected()).toEqual(["ask"]);
  });

  it("opens the match the user arrowed onto", async () => {
    mountResults([page("Logs explorer"), page("Pipelines"), ask]);
    key("ArrowDown");
    key("ArrowDown");
    await nextTick();
    expect(wrapper!.vm.activeDescendant).toBe("lb-option-1");
    key("Enter");
    expect(selected()).toEqual(["page:Pipelines"]);
  });

  it("wraps Up from no highlight to the last row", async () => {
    mountResults([page("Logs explorer"), ask]);
    key("ArrowUp");
    await nextTick();
    expect(wrapper!.vm.activeDescendant).toBe("lb-option-1");
  });

  it("highlights the first match without AI, so Enter opens it", () => {
    mountResults([page("Logs explorer"), page("Pipelines")]);
    expect(wrapper!.vm.activeDescendant).toBe("lb-option-0");
    key("Enter");
    expect(selected()).toEqual(["page:Logs explorer"]);
  });

  it("lets Enter through when there is nothing to open", () => {
    mountResults([]);
    expect(key("Enter")).toEqual({ handled: false, prevented: false });
  });

  it("closes on Escape", () => {
    mountResults([page("Logs"), ask]);
    key("Escape");
    expect(wrapper!.emitted("close")).toHaveLength(1);
  });

  it("renders a listbox of options with group headers and the Ask row last", () => {
    mountResults([
      page("Logs"),
      {
        id: "alert:a1",
        kind: "alert",
        label: raw("Disk"),
        secondary: raw("default"),
        exact: false,
      },
      ask,
    ]);
    expect(wrapper!.find('[role="listbox"]').attributes("id")).toBe("lb");
    expect(wrapper!.findAll('[role="option"]').map((o) => o.attributes("data-kind"))).toEqual([
      "page",
      "alert",
      "ask",
    ]);
    expect(wrapper!.find('[data-test="go-to-results-group-pages"]').text()).toBe("Pages");
    expect(wrapper!.find('[data-test="go-to-results-group-alerts"]').text()).toBe("Alerts");
  });

  it("says no pages match while still offering Ask", () => {
    mountResults([ask]);
    expect(wrapper!.find('[data-test="go-to-results-empty"]').text()).toBe("No pages match");
    expect(wrapper!.findAll('[role="option"]')).toHaveLength(1);
  });

  it("selects on click", async () => {
    mountResults([page("Logs"), ask]);
    await wrapper!.find("#lb-option-0").trigger("click");
    expect(selected()).toEqual(["page:Logs"]);
  });
});
