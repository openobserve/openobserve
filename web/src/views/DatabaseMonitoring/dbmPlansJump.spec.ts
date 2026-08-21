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

/**
 * The drift callout's "View plans" jump, proved by RENDERING it.
 *
 * The callout at the top of the query detail page promotes the plan-drift
 * FINDING; the evidence stays in the plans section far below, so the action is
 * a scroll rather than a second rendering of the same table. When the plans
 * section became a `DbmSection` component, `ref="plansSection"` stopped holding
 * a DOM element and started holding a COMPONENT INSTANCE — so the handler had
 * to reach through `$el`, and whether `$el` is the section element (rather than
 * a comment node, as it would be for a multi-root component) became load-bearing
 * for a feature that fails SILENTLY: a jump that scrolls nothing looks exactly
 * like a jump nobody clicked.
 *
 * That was pinned only by a source scan, which cannot see any of it. These
 * tests render instead:
 *
 *  1. `DbmSection` is single-rooted, so a template ref on it yields `$el ===`
 *     the `<section>` element — the assumption the handler is built on.
 *  2. The handler, given that ref, calls `scrollIntoView` on that very element
 *     with the smooth/start options the page intends.
 *  3. It is a no-op — never a throw — before the section has mounted, because
 *     the callout renders above a section that may not exist yet.
 *
 * Mounting the whole `QueryDetailPage` is impractical here (it pulls the
 * router, the store, six services and a chart runtime; `dbmRequestGuard.spec.ts`
 * documents why this directory's specs stay out of it), so the coverage is
 * split: the component-level guarantee and the handler behaviour are proved
 * for real, and the one remaining link — that the page's callout button is
 * wired to this handler and the page's ref sits on the plans section — stays a
 * source assertion in `dbmPlansEmptyState.spec.ts`, which is the cheap half.
 */

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

import DbmSection from "@/components/dbm/DbmSection.vue";
import { raw } from "@/types/i18n";

/**
 * The page's handler, transcribed. It takes the ref rather than closing over a
 * module-level one so the behaviour can be driven directly.
 *
 * This is the shape `QueryDetailPage.vue`'s `scrollToPlans` has; the assertion
 * that the page still has it lives at the bottom of this file, so a page that
 * drifts from this copy fails here rather than passing against a stale twin.
 */
const scrollToPlans = (section: { $el?: unknown } | null) => {
  (section?.$el as HTMLElement | undefined)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
};

/** A page-shaped harness: a callout button above, the plans section below. */
const harness = (options: { renderSection?: boolean } = {}) => {
  const renderSection = options.renderSection ?? true;
  return defineComponent({
    setup() {
      const plansSection = ref<InstanceType<typeof DbmSection> | null>(null);
      return { plansSection, jump: () => scrollToPlans(plansSection.value) };
    },
    render() {
      return h("div", [
        h(
          "button",
          { "data-test": "dbm-detail-drift-view-plans", onClick: this.jump },
          "View plans",
        ),
        renderSection
          ? h(DbmSection, {
              ref: "plansSection",
              title: raw("Query plans"),
              "data-test": "dbm-detail-plans",
            })
          : null,
      ]);
    },
  });
};

describe("the drift callout's jump to the plans section", () => {
  /**
   * The assumption the whole handler rests on. A multi-root component's `$el`
   * is its leading anchor COMMENT node, which has no `scrollIntoView` — the
   * jump would silently do nothing. `DbmSection` is single-rooted, and this is
   * what keeps it that way.
   */
  it("resolves the DbmSection ref to the section element itself", () => {
    const wrapper = mount(harness());
    const instance = wrapper.vm.plansSection as unknown as { $el: HTMLElement };

    expect(instance).toBeTruthy();
    expect(instance.$el).toBeInstanceOf(HTMLElement);
    expect(instance.$el.tagName).toBe("SECTION");
    // And it is the SAME element the page's own `data-test` selector finds —
    // the jump lands on the card a reader is looking for, not a wrapper.
    expect(instance.$el).toBe(wrapper.get('[data-test="dbm-detail-plans"]').element);
    // The property the handler reaches for exists on the element interface.
    // (jsdom leaves `scrollIntoView` UNIMPLEMENTED — it is not on the
    // prototype at all — which is why the jump test below stubs it rather than
    // spying on a real one. In a browser this is the layout call itself; here
    // what can be proved is that the handler is aiming at a real Element and
    // not at the comment node a multi-root component would hand back.)
    expect(instance.$el.nodeType).toBe(Node.ELEMENT_NODE);
  });

  /**
   * The jump itself: clicking the callout scrolls the plans section into view,
   * smoothly and aligned to its top (so the heading is what lands under the
   * reader's eye, not the middle of a table).
   */
  it("scrolls the plans section into view when the callout is clicked", async () => {
    const wrapper = mount(harness());
    const section = wrapper.get('[data-test="dbm-detail-plans"]').element as HTMLElement;
    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;

    await wrapper.get('[data-test="dbm-detail-drift-view-plans"]').trigger("click");

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  /**
   * The callout renders above the section it points at, so a click that lands
   * before the section mounts must be a no-op rather than a thrown error taking
   * the page's error boundary with it.
   */
  it("does nothing, and throws nothing, when the section is not mounted", async () => {
    const wrapper = mount(harness({ renderSection: false }));
    expect(wrapper.find('[data-test="dbm-detail-plans"]').exists()).toBe(false);

    await expect(
      wrapper.get('[data-test="dbm-detail-drift-view-plans"]').trigger("click"),
    ).resolves.not.toThrow();
  });

  /**
   * The handler above is a transcription, which is only worth anything while it
   * matches the page. This is the guard: the page must still reach through
   * `$el` with the same options, and its ref must still sit on the plans
   * section. If the page changes how it jumps, this fails and the transcription
   * gets updated rather than quietly diverging.
   */
  it("matches the handler the page actually ships", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const page = readFileSync(resolve(__dirname, "./QueryDetailPage.vue"), "utf8");

    const start = page.indexOf("const scrollToPlans");
    expect(start, "the page must still have a scrollToPlans handler").toBeGreaterThan(-1);
    const handler = page.slice(start, page.indexOf("};", start) + 2);
    // Guard: prove the slice is the handler body, not an empty tail.
    expect(handler.length).toBeGreaterThan(60);

    expect(handler).toContain("plansSection.value?.$el");
    expect(handler).toContain("scrollIntoView");
    expect(handler).toContain('behavior: "smooth"');
    expect(handler).toContain('block: "start"');
    // The ref must sit on the plans section, or the jump lands on the wrong card.
    expect(page).toMatch(/ref="plansSection"[\s\S]{0,400}dbm-detail-plans/);
  });
});
