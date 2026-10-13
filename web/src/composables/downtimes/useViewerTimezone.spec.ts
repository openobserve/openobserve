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
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createStore } from "vuex";
import { formatWindowTime } from "@/utils/downtimes/schedule";
import { browserTimezone } from "@/utils/timezoneAliases";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import MutedChip from "@/components/alerts/downtimes/MutedChip.vue";
import { useViewerTimezone } from "./useViewerTimezone";
import { useQuickMute } from "./useQuickMute";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// The app's chosen zone, picked to differ from any CI machine's local zone.
const VIEWER_ZONE = "Pacific/Chatham";
const NOW = Date.parse("2026-09-17T14:10:00Z");

const storeWith = (timezone: unknown) =>
  createStore({
    state: {
      timezone,
      selectedOrganization: { identifier: "acme" },
      zoConfig: { downtimes_enabled: true },
    },
  });

const zoneFor = (timezone: unknown) => {
  let zone = "";
  mount(
    defineComponent({
      setup() {
        zone = useViewerTimezone().value;
        return () => h("div");
      },
    }),
    { global: { plugins: [storeWith(timezone)] } },
  );
  return zone;
};

describe("useViewerTimezone", () => {
  afterEach(() => vi.useRealTimers());

  it("reads the zone the app shows times in, under its canonical name", () => {
    expect(zoneFor(VIEWER_ZONE)).toBe(VIEWER_ZONE);
    expect(zoneFor("Asia/Calcutta")).toBe("Asia/Kolkata");
  });

  it("falls back to the browser zone when the app has none or an unknown one", () => {
    expect(zoneFor("")).toBe(browserTimezone());
    expect(zoneFor("Not/AZone")).toBe(browserTimezone());
  });

  it("gives the muted chip and the quick mute the same zone for one instant", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const endsAt = (NOW + 3_600_000) * 1000;
    const store = storeWith(VIEWER_ZONE);

    const chip = mount(MutedChip, {
      props: { downtime: { id: "d1", name: "INC-231", ends_at: endsAt } },
      global: { plugins: [store] },
    });
    const tooltip = String(chip.findComponent(OTooltip).props("content"));
    expect(tooltip).toContain(formatWindowTime(endsAt, VIEWER_ZONE));

    let muteZone = "";
    mount(
      defineComponent({
        setup() {
          muteZone = useQuickMute().timezone.value;
          return () => h("div");
        },
      }),
      { global: { plugins: [store] } },
    );
    expect(muteZone).toBe(VIEWER_ZONE);
  });
});
