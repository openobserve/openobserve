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
    expect(mountCard().find('[data-test="alert-library-card-query-type"]').text()).toBe("PROMQL");
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

  it("opens the drawer on click — the card IS the affordance, there is no button", () => {
    const wrapper = mountCard();
    wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it.each(["enter", "space"])("opens on %s, so the grid is reachable without a mouse", (key) => {
    const wrapper = mountCard();
    wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').trigger(`keydown.${key}`);
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("names what it opens, since the card is a control with no visible label", () => {
    const root = mountCard().find('[data-test="alert-library-card-k8s/pod-oom-killed"]');
    expect(root.attributes("role")).toBe("button");
    expect(root.attributes("tabindex")).toBe("0");
    expect(root.attributes("aria-label")).toContain("Pod OOM Killed");
  });

  it("survives an entry with no description", () => {
    const wrapper = mountCard({ entry: { ...entry, description: "" } });
    expect(wrapper.text()).toContain("Pod OOM Killed");
  });
});
