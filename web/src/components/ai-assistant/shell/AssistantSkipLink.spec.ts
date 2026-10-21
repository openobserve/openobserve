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

import { fakeAssistant, fakeRouter } from "../__tests__/fakeAssistant";
import AssistantSkipLink, { skipTarget } from "./AssistantSkipLink.vue";
import { closeLockedPanel, openLockedPanel } from "./lockedPanel";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantHistory: () => fake.current.history,
}));

async function setup(path = "/logs") {
  fake.current = fakeAssistant();
  const router = fakeRouter();
  await router.push(path);
  const wrapper = mount(AssistantSkipLink, {
    global: { plugins: [router] },
    attachTo: document.body,
  });
  return { wrapper, store: fake.current.store };
}

function sidebarRoot(inner = "") {
  const root = document.createElement("aside");
  root.setAttribute("data-assistant-root", "");
  root.dataset.placement = "sidebar";
  root.tabIndex = -1;
  root.innerHTML = inner;
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  closeLockedPanel();
});

describe("AssistantSkipLink", () => {
  it("renders only while the sidebar is open, and not on the full view", async () => {
    const { wrapper, store } = await setup();
    expect(wrapper.find('[data-test="assistant-skip-link"]').exists()).toBe(false);
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-skip-link"]').text()).toBe("Skip to O2 Assistant");
    expect(
      wrapper.get('[data-test="assistant-skip-link"]').element.parentElement?.className,
    ).toContain("sr-only");
  });

  it("also renders for the locked sidebar", async () => {
    const { wrapper } = await setup();
    openLockedPanel(null);
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-skip-link"]').exists()).toBe(true);
  });

  it("jumps to the composer, else the gate's action, else the sidebar root", async () => {
    const plain = sidebarRoot();
    expect(skipTarget()).toBe(plain);
    plain.innerHTML = '<div data-test="assistant-gate-state"><button>Ask</button></div>';
    expect(skipTarget()?.textContent).toBe("Ask");
    plain.innerHTML += "<textarea data-assistant-composer></textarea>";
    expect(skipTarget()?.tagName).toBe("TEXTAREA");
    const { wrapper, store } = await setup();
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await flushPromises();
    await wrapper.get('[data-test="assistant-skip-link"]').trigger("click");
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });
});
