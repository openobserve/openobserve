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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

import DbmToolbarNote from "./DbmToolbarNote.vue";

const mountNote = (props: Record<string, unknown> = {}) =>
  mount(DbmToolbarNote, { props: { text: raw("Sampled on a schedule"), ...props } });

describe("DbmToolbarNote", () => {
  it("shows the short form and keeps the full text for the tooltip", () => {
    const wrapper = mountNote({ detail: raw("Sampled every 10 seconds, idle sessions dropped.") });
    expect(wrapper.find('[data-test="dbm-toolbar-note-text"]').text()).toBe(
      "Sampled on a schedule",
    );
    expect(wrapper.findComponent(OTooltip).props("content")).toBe(
      "Sampled every 10 seconds, idle sessions dropped.",
    );
  });

  it("falls back to the short form as its own tooltip", () => {
    expect(mountNote().findComponent(OTooltip).props("content")).toBe("Sampled on a schedule");
  });

  it("collapses to its icon below xl so the filter chips keep their room", () => {
    expect(mountNote().find('[data-test="dbm-toolbar-note-text"]').classes()).toContain(
      "max-xl:hidden",
    );
  });

  it("renders only the icon when compact, keeping the text for the tooltip", () => {
    const wrapper = mountNote({ compact: true });
    expect(wrapper.find('[data-test="dbm-toolbar-note-text"]').exists()).toBe(false);
    expect(wrapper.findComponent(OTooltip).props("content")).toBe("Sampled on a schedule");
  });

  it.each([
    ["neutral", "info-outline", "text-text-secondary"],
    ["warning", "warning-amber", "text-status-warning-text"],
    ["error", "error-outline", "text-status-error-text"],
  ])("renders the %s tone with its own icon and colour", (tone, icon, colour) => {
    const wrapper = mountNote({ tone });
    expect(wrapper.findComponent(OIcon).props("name")).toBe(icon);
    expect(wrapper.classes()).toContain(colour);
  });

  it("takes an icon override", () => {
    expect(mountNote({ icon: "check-circle" }).findComponent(OIcon).props("name")).toBe(
      "check-circle",
    );
  });
});
