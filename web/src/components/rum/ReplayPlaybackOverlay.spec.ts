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
import ReplayPlaybackOverlay from "@/components/rum/ReplayPlaybackOverlay.vue";
import i18n from "@/locales";

describe("ReplayPlaybackOverlay multi-tab hint", () => {
  it("explains a longer load when other tabs moved the start", () => {
    const wrapper = mount(ReplayPlaybackOverlay, {
      props: { state: "waiting", pendingSeekMs: 60000, multiTabHint: true },
      global: { plugins: [i18n] },
    });
    expect(wrapper.find('[data-test="replay-overlay-multi-tab-hint"]').exists()).toBe(true);
  });
});
