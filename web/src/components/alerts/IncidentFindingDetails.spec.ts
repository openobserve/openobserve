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
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import { formatToReadable } from "@/utils/date";
import IncidentFindingDetails from "./IncidentFindingDetails.vue";

const facts = (startedAt: number | null) => ({
  what: raw("Stopped sending data"),
  streamType: "logs",
  streamName: "checkout",
  startedAt,
});

const mountWith = (value: ReturnType<typeof facts> | null) =>
  mount(IncidentFindingDetails, {
    props: { facts: value },
    global: { plugins: [i18n] },
  });

const text = (wrapper: ReturnType<typeof mountWith>, id: string) =>
  wrapper.find(`[data-test="${id}"]`).text();

describe("IncidentFindingDetails", () => {
  it("shows what happened, the stream and when it started, then the neutral note", () => {
    const wrapper = mountWith(facts(1762300000000000));
    expect(text(wrapper, "incident-finding-what")).toBe("Stopped sending data");
    expect(text(wrapper, "incident-finding-stream-type")).toBe("Logs");
    expect(text(wrapper, "incident-finding-stream-name")).toBe("checkout");
    expect(text(wrapper, "incident-finding-started")).toBe(formatToReadable(1762300000000000));
    expect(text(wrapper, "incident-finding-note")).toBe(
      "AutoObserve opened this incident from a stream finding, so there is no alert rule to show.",
    );
    expect(wrapper.find('[data-test="incident-finding-note"]').classes()).toEqual([
      "text-text-secondary",
      "text-xs",
    ]);
  });

  it("an unknown start reads as no value", () => {
    expect(text(mountWith(facts(null)), "incident-finding-started")).toBe("—");
  });

  it("unreadable facts show only the note", () => {
    const wrapper = mountWith(null);
    expect(wrapper.text()).toBe(
      "AutoObserve opened this incident from a stream finding. Its stream details are not available.",
    );
  });
});
