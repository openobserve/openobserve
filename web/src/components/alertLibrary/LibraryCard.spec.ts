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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import LibraryCard from "./LibraryCard.vue";
import i18n from "@/locales";
import type { AlertLibraryEntry } from "@/types/alertLibrary";

const entry: AlertLibraryEntry = {
  id: "k8s/pod-oom-killed",
  name: "pod-oom-killed",
  pack: "k8s",
  category: "pod",
  title: "Pod OOM Killed",
  severity: "critical",
  description: "A container in the pod was terminated by the kernel OOM killer.",
  stream: "kube_pod_container_status_last_terminated_reason",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["kube_pod_container_status_last_terminated_reason"],
  path: "packs/k8s/alerts/pod/pod-oom-killed.json",
  content_hash: "abc123",
};

const mountCard = (props: Record<string, unknown> = {}) =>
  mount(LibraryCard, {
    props: { entry, ready: true, ...props },
    global: { plugins: [i18n] },
  });

describe("LibraryCard", () => {
  it("shows the title, the description and the stream it reads", () => {
    const text = mountCard().text();
    expect(text).toContain("Pod OOM Killed");
    expect(text).toContain("terminated by the kernel OOM killer");
    expect(text).toContain("kube_pod_container_status_last_terminated_reason");
  });

  it("labels the severity", () => {
    expect(mountCard().find('[data-test="alert-library-card-severity"]').text()).toBe("Critical");
  });

  it("shows warning severity in the badge group's amber, matching its P3 install", () => {
    const wrapper = mountCard({ entry: { ...entry, severity: "warning" } });
    const badge = wrapper.find('[data-test="alert-library-card-severity"]');
    expect(badge.text()).toBe("Warning");
    expect(badge.html()).toContain("amber");
  });

  it("shows the query language as a quiet neutral chip", () => {
    expect(mountCard().find('[data-test="alert-library-card-query-type"]').text()).toBe("PromQL");
  });

  it("carries NO ready label — it would describe almost every card and signal nothing", () => {
    expect(mountCard().find('[data-test="alert-library-card-needs-data"]').exists()).toBe(false);
    expect(mountCard().text()).not.toContain("Ready");
  });

  it("names the missing stream, so the card says WHY it differs", () => {
    // The whole point of the treatment: a reader must not have to infer the
    // cause from a border style. The stream that is absent is stated on the
    // card, and the tooltip explains the consequence.
    const wrapper = mountCard({ ready: false });
    const note = wrapper.find('[data-test="alert-library-card-needs-data"]');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain("Not ingested");
    expect(note.text()).toContain("kube_pod_container_status_last_terminated_reason");
    expect(note.attributes("title")).toContain("would never fire");
  });

  it("marks the state in a tone that each theme can wear", () => {
    // Warning and not error: an alert with no data is not broken, it is waiting.
    //
    // The chip uses warning-QUIET, whose tokens differ by theme, because 959 of
    // 1242 alerts are not ingested on a typical org. Light wears the amber wash
    // at a dozen per screen; dark, where the same ramp is full-chroma against
    // near-black, turns the chip neutral and lets the icon carry the colour.
    const wrapper = mountCard({ ready: false });
    const note = wrapper.find('[data-test="alert-library-card-needs-data"]');
    const mark = wrapper.find('[data-test="alert-library-card-needs-data-mark"]');

    expect(note.classes().join(" ")).toMatch(/badge-warning-quiet/);
    // Never the filled variant: that one is identical in both themes.
    expect(note.classes().join(" ")).not.toMatch(/badge-warning-soft-bg/);
    expect(note.html()).not.toMatch(/badge-error/);
    // The icon stays amber in BOTH themes, so dark keeps a colour cue.
    expect(mark.classes().join(" ")).toMatch(/badge-warning/);
  });

  it("shapes the note like the query-language chip beside it", () => {
    // The user asked for the two to read as the same kind of thing — one chip
    // says what language it speaks, the other says what it is missing — so the
    // note must not drift into its own bespoke treatment.
    const wrapper = mountCard({ ready: false });
    const shapeOf = (test: string) =>
      wrapper
        .find(`[data-test="${test}"]`)
        .classes()
        .filter((c) => c.startsWith("rounded-") || c.startsWith("px-") || c.startsWith("text-3xs"))
        .sort();
    const shape = shapeOf("alert-library-card-needs-data");
    expect(shape.length).toBeGreaterThan(0); // else the comparison is vacuous
    expect(shape).toEqual(shapeOf("alert-library-card-query-type"));
  });

  it("drops the dashed border — it only meant anything next to a solid one", () => {
    // The border was the original complaint: dashed vs solid is invisible until
    // you happen to see both, so a pack where every stream is missing looked
    // arbitrarily different from one where none were. The chip carries it now.
    const dashed = (ready: boolean) =>
      mountCard({ ready })
        .find('[data-test="alert-library-card-k8s/pod-oom-killed"]')
        .classes()
        .join(" ");
    expect(dashed(false)).not.toMatch(/border-dashed/);
    expect(dashed(false)).toBe(dashed(true));
  });

  it("gives the note its own row, so a long stream name is not truncated away", () => {
    // Stream names run to 40+ characters. Sharing the footer row with the
    // query-language tag left roughly a word's worth of space, so the string
    // the message exists to name would ellipsis into nothing.
    const wrapper = mountCard({ ready: false });
    const note = wrapper.find('[data-test="alert-library-card-needs-data"]').element;
    const tag = wrapper.find('[data-test="alert-library-card-query-type"]').element;
    // Not flex siblings: the note is on a line the tag does not share.
    expect(note.parentElement).not.toBe(tag.parentElement);
  });

  it("does not dim the card, so its description stays readable", () => {
    // The old opacity-65 faded the description people need in order to judge
    // the alert, and overstated the state — an unavailable alert can still be
    // read, previewed and installed.
    const root = mountCard({ ready: false }).find(
      '[data-test="alert-library-card-k8s/pod-oom-killed"]',
    );
    expect(root.classes().join(" ")).not.toMatch(/opacity-/);
  });

  it("shows the stream as plain provenance when it is available", () => {
    const wrapper = mountCard({ ready: true });
    expect(wrapper.find('[data-test="alert-library-card-needs-data"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("kube_pod_container_status_last_terminated_reason");
  });

  it("keeps a stable data-test keyed on the library id", () => {
    expect(mountCard().find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(
      true,
    );
  });

  it("opens the drawer when the card body is clicked", () => {
    // Kept as a mouse convenience once the card stopped being a button itself:
    // everything it offers is also reachable from a real control inside it.
    const wrapper = mountCard();
    wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("opens the drawer from the title button — once, not twice", () => {
    // The title sits inside the card's own click handler. Without stopping
    // propagation a single click opens the drawer twice.
    const wrapper = mountCard();
    wrapper.find('[data-test="alert-library-card-title-k8s/pod-oom-killed"]').trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("makes the TITLE the control, so a checkbox can live beside it", () => {
    // The card used to be the affordance. A card with two actions cannot be:
    // a control nested inside role="button" is invalid for keyboard and AT.
    const wrapper = mountCard();
    const root = wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]');
    expect(root.attributes("role")).toBeUndefined();
    expect(root.attributes("tabindex")).toBeUndefined();
    expect(root.attributes("aria-label")).toBeUndefined();

    const title = wrapper.find('[data-test="alert-library-card-title-k8s/pod-oom-killed"]');
    expect(title.element.tagName).toBe("BUTTON");
    expect(title.text()).toContain("Pod OOM Killed");
  });

  it("keeps the pointer cursor on the card, which is still clickable", () => {
    const root = mountCard().find('[data-test="alert-library-card-k8s/pod-oom-killed"]');
    expect(root.classes()).toContain("cursor-pointer");
  });

  it("moves the focus ring to the title, where focus can actually land", () => {
    const wrapper = mountCard();
    const ringed = (test: string) =>
      wrapper
        .find(`[data-test="${test}"]`)
        .classes()
        .some((c) => c.startsWith("focus-visible:ring"));
    expect(ringed("alert-library-card-title-k8s/pod-oom-killed")).toBe(true);
    expect(ringed("alert-library-card-k8s/pod-oom-killed")).toBe(false);
  });

  // ── selection ────────────────────────────────────────────────────────────

  it("renders a selection checkbox, always — not on hover", () => {
    // Hover-reveal leaves a touch user with no way to START a selection from a
    // card, and a hidden control cannot take the focus that would reveal it.
    // Both mechanisms §7.2a rejects are ruled out: display and opacity.
    const wrapper = mountCard();
    const box = wrapper.find('[data-test="alert-library-select-k8s/pod-oom-killed"]');
    expect(box.exists()).toBe(true);
    expect(box.attributes("hidden")).toBeUndefined();
    // Read off the CARD, not the checkbox's own root: the reveal would live on
    // a wrapper the checkbox knows nothing about.
    const html = wrapper.html();
    expect(html).not.toMatch(/opacity-0/);
    expect(html).not.toMatch(/group-hover:/);
  });

  it("no longer opens the drawer from the card's own key handlers", () => {
    // The root is not a control any more. A leftover handler there would put an
    // action on a non-interactive element, which nothing in web/ lints for.
    const wrapper = mountCard();
    const root = wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]');
    root.trigger("keydown.enter");
    root.trigger("keydown.space");
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  it("opens from the title on Enter and Space, because it is a real button", () => {
    // Native button semantics: asserted through the element, not a handler, so
    // this stays true however the click is wired.
    const title = mountCard().find('[data-test="alert-library-card-title-k8s/pod-oom-killed"]');
    expect(title.element.tagName).toBe("BUTTON");
    expect((title.element as HTMLButtonElement).type).toBe("button");
    expect(title.attributes("disabled")).toBeUndefined();
  });

  it("puts the checkbox before the title, so tab order reads left to right", () => {
    const wrapper = mountCard();
    const stops = wrapper
      .findAll('[data-test^="alert-library-card-title-"], [role="checkbox"]')
      .map((node) => (node.attributes("role") === "checkbox" ? "checkbox" : "title"));
    expect(stops).toEqual(["checkbox", "title"]);
  });

  it("names the checkbox, which has no visible label of its own", () => {
    const wrapper = mountCard();
    const box = wrapper.find('[data-test="alert-library-select-k8s/pod-oom-killed"]');
    expect(box.find('[role="checkbox"]').attributes("aria-label")).toContain("Pod OOM Killed");
  });

  it("emits update:selected from the checkbox and does NOT open the drawer", () => {
    const wrapper = mountCard();
    wrapper
      .find('[data-test="alert-library-select-k8s/pod-oom-killed"]')
      .find('[role="checkbox"]')
      .trigger("click");
    expect(wrapper.emitted("update:selected")).toEqual([[true]]);
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  it("unticks from the checkbox when it is already selected", () => {
    const wrapper = mountCard({ selected: true });
    wrapper
      .find('[data-test="alert-library-select-k8s/pod-oom-killed"]')
      .find('[role="checkbox"]')
      .trigger("click");
    expect(wrapper.emitted("update:selected")).toEqual([[false]]);
  });

  it("marks a selected card, so the ring is not the only cue", () => {
    const test = '[data-test="alert-library-card-k8s/pod-oom-killed"]';
    expect(mountCard({ selected: true }).find(test).attributes("data-selected")).toBe("true");
    expect(mountCard().find(test).attributes("data-selected")).toBe("false");
  });

  it("drops the default border rules when selected, rather than layering over them", () => {
    // `hover:border-border-strong` outranks a plain `border-accent`, so leaving
    // the resting rules in place makes a selected card lose its accent on hover.
    const classes = (selected: boolean) =>
      mountCard({ selected }).find('[data-test="alert-library-card-k8s/pod-oom-killed"]').classes();

    expect(classes(true)).toContain("border-accent");
    expect(classes(true)).not.toContain("border-border-default");
    expect(classes(true)).not.toContain("hover:border-border-strong");
    expect(classes(false)).toContain("border-border-default");
    expect(classes(false)).toContain("hover:border-border-strong");
  });

  it("names the title button by its own text, so the heading is not renamed", () => {
    // An aria-label on the only child of the <h3> becomes the HEADING's name,
    // so screen-reader heading navigation reads "Open Pod OOM Killed".
    const title = mountCard().find('[data-test="alert-library-card-title-k8s/pod-oom-killed"]');
    expect(title.attributes("aria-label")).toBeUndefined();
    expect(title.text()).toBe("Pod OOM Killed");
  });

  it("defaults to unselected, so the gallery owns the state", () => {
    const box = mountCard().find('[data-test="alert-library-select-k8s/pod-oom-killed"]');
    expect(box.find('[role="checkbox"]').attributes("aria-checked")).toBe("false");
  });

  it("survives an entry with no description", () => {
    const wrapper = mountCard({ entry: { ...entry, description: "" } });
    expect(wrapper.text()).toContain("Pod OOM Killed");
  });
});
