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

// Renderer-level tests for the two supplementary-section behaviours: the
// collapsed `extras.advanced` block, and the step-note jump links that open it.
// Driven by a synthetic content fixture so these stay independent of any one
// data source's copy.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";
import SetupCardRenderer from "./SetupCardRenderer.vue";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";
import type { RichCardContent } from "./types";

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: vi.fn() }),
}));

const store = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "t@e.com" },
    organizationData: { organizationPasscode: "pc" },
    theme: "light",
  },
});
const i18n = createI18n({ locale: "en", messages: { en: {} } });
const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div/>" } }],
});
const SUBS = { url: "https://o2.example.com", org: "test-org", token: "tok" };

const CONTENT: RichCardContent = {
  provider: { name: "Demo", tagline: "A demo card.", logo: "", tone: "#000" },
  steps: [
    {
      id: "install",
      title: "Install",
      description: "Run it.",
      chip: { kind: "terminal", label: "Terminal" },
      completeOn: "copy",
      code: { lang: "bash", raw: "echo hi" },
      note: "Prefer the long way? Go to [Manual Setup](#advanced).",
    },
    {
      id: "verify",
      title: "Verify",
      description: "Check it.",
      completeOn: "detect",
      detectionAnchor: true,
    },
  ],
  detect: { streamType: "logs", streamName: "default", filter: "a IS NOT NULL" },
  extras: {
    advanced: {
      label: "Manual Setup",
      description: "The step-by-step path.",
      code: { lang: "bash", raw: "echo manual-path" },
    },
    troubleshooting: [{ q: "It broke", a: "Turn it off and on." }],
  },
};

const mountCard = (content: RichCardContent = CONTENT) =>
  mount(SetupCardRenderer, {
    props: { content, subs: SUBS },
    global: { plugins: [store, i18n, router] },
    attachTo: document.body,
  });

describe("SetupCardRenderer — advanced section", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the advanced accordion collapsed, as its own panel", () => {
    wrapper = mountCard();
    const acc = wrapper.find('[data-test="ai-advanced-accordion"]');
    expect(acc.exists()).toBe(true);
    expect(acc.text()).toContain("Manual Setup");
    // .acc-item carries the border/background so it reads as a real section
    // rather than stray text at the bottom of a long card.
    expect(acc.classes()).toContain("acc-item");
    // Collapsed → Radix leaves the body unmounted entirely.
    expect(wrapper.find('[data-test="ai-advanced-code"]').exists()).toBe(false);
  });

  it("uses icons registered in OIcon, never the material-font fallback", () => {
    // An unregistered name silently degrades to a ligature span, which renders
    // the raw word next to the label. Guard every accordion icon we pass.
    for (const name of ["settings", "layers", "help-outline"]) {
      expect(name in iconRegistry).toBe(true);
    }
    wrapper = mountCard();
    const acc = wrapper.find('[data-test="ai-advanced-accordion"]');
    expect(acc.find("svg").exists()).toBe(true);
    expect(acc.find(".material-icons-outlined").exists()).toBe(false);
  });

  it("omits the accordion entirely when no advanced content is given", () => {
    wrapper = mountCard({ ...CONTENT, extras: { troubleshooting: [] } });
    expect(wrapper.find('[data-test="ai-advanced-accordion"]').exists()).toBe(
      false,
    );
  });
});

describe("SetupCardRenderer — footer doc links", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders every docLink as a real anchor beside the primary doc", () => {
    wrapper = mountCard({
      ...CONTENT,
      docUrl: "https://example.com/main",
      docLinks: [
        { label: "Second Guide", url: "https://example.com/second" },
        { label: "Third Guide", url: "https://example.com/third" },
      ],
    });
    const hrefs = wrapper
      .findAll(".pv-foot a")
      .map((a) => a.attributes("href"));
    expect(hrefs).toEqual([
      "https://example.com/main",
      "https://example.com/second",
      "https://example.com/third",
    ]);
    expect(wrapper.find('[data-test="ai-doc-link-second-guide"]').text()).toBe(
      "Second Guide →",
    );
  });

  it("renders only the primary link when there are no docLinks", () => {
    wrapper = mountCard({ ...CONTENT, docUrl: "https://example.com/main" });
    expect(wrapper.findAll(".pv-foot a")).toHaveLength(1);
  });

  it("refuses unsafe doc link hrefs", () => {
    wrapper = mountCard({
      ...CONTENT,
      docLinks: [{ label: "Evil", url: "javascript:alert(1)" }],
    });
    const evil = wrapper.find('[data-test="ai-doc-link-evil"]');
    expect(evil.attributes("href")).toBe("#");
  });
});

describe("SetupCardRenderer — step-note jump links", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders [label](#advanced) as an anchor without leaking markdown", () => {
    wrapper = mountCard();
    const note = wrapper.find(".step-note");
    expect(note.text()).not.toContain("](#advanced)");
    expect(note.text()).not.toContain("[Manual Setup]");

    const link = wrapper.find("a.note-jump");
    expect(link.exists()).toBe(true);
    expect(link.text()).toBe("Manual Setup");
    expect(link.attributes("data-jump")).toBe("advanced");
  });

  it("opens and scrolls to the advanced section on click", async () => {
    wrapper = mountCard();
    const scrollSpy = vi.fn();
    (Element.prototype as any).scrollIntoView = scrollSpy;

    await wrapper.find("a.note-jump").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const code = wrapper.find('[data-test="ai-advanced-code"]');
    expect(code.exists()).toBe(true);
    expect(code.text()).toContain("echo manual-path");
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("leaves ordinary notes untouched", () => {
    const plain: RichCardContent = {
      ...CONTENT,
      steps: [{ ...CONTENT.steps[0], note: "Just a plain note." }, CONTENT.steps[1]],
    };
    wrapper = mountCard(plain);
    expect(wrapper.find(".step-note").text()).toContain("Just a plain note.");
    expect(wrapper.find("a.note-jump").exists()).toBe(false);
  });

  it("does not turn arbitrary link targets into anchors", () => {
    // Only the fixed #advanced / #troubleshooting alternation is linkified, so
    // authored content cannot inject a URL through a note.
    const evil: RichCardContent = {
      ...CONTENT,
      steps: [
        {
          ...CONTENT.steps[0],
          note: "See [click me](javascript:alert(1)) and [x](#nope).",
        },
        CONTENT.steps[1],
      ],
    };
    wrapper = mountCard(evil);
    const html = wrapper.find(".step-note").html();
    // Neither target is linkified, so no anchor is produced at all...
    expect(wrapper.find("a.note-jump").exists()).toBe(false);
    expect(wrapper.find(".step-note a").exists()).toBe(false);
    // ...and the payload survives only as inert escaped text, never an href.
    expect(html).not.toContain('href="javascript:');
    expect(wrapper.find(".step-note").text()).toContain("javascript:alert(1)");
  });
});
