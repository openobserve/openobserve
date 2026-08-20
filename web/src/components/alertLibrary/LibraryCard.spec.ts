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

  it("labels only the exception, and recedes rather than shouting", () => {
    const wrapper = mountCard({ ready: false });
    const chip = wrapper.find('[data-test="alert-library-card-needs-data"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("Needs data");
    // Neutral chip: an alert that cannot run is inert, not urgent.
    expect(chip.html()).not.toMatch(/error|warning/);
    // And the card itself is the thing that fades.
    const root = wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]');
    expect(root.classes().join(" ")).toMatch(/border-dashed/);
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
