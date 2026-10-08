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

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import FunnelQuickStarts from "./FunnelQuickStarts.vue";

const stubs = { StepPicker: { template: "<div />" } };

describe("FunnelQuickStarts", () => {
  let wrapper: VueWrapper | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const mountWith = (props: Record<string, unknown>) =>
    (wrapper = mount(FunnelQuickStarts, {
      props: { entries: [], entriesLoading: false, recent: [], events: [], ...props },
      global: { plugins: [i18n], stubs },
    }));

  it("counts a single entry session in the singular", () => {
    mountWith({ entries: [{ key: "/a", sessions: 1 }] });
    expect(wrapper!.find('[data-test="rum-analytics-funnel-entry-start-0"]').text()).toContain(
      "1 session",
    );
    expect(wrapper!.text()).not.toContain("1 sessions");
  });

  it("shows no entry-page heading when there are no entry pages to start from", () => {
    mountWith({});
    expect(wrapper!.text()).not.toContain("Start from a top entry page");
  });

  it("says when the entry pages could not be read, and retries on request", async () => {
    mountWith({ entriesFailed: true });
    expect(wrapper!.find('[data-test="rum-analytics-funnel-entries-failed"]').exists()).toBe(true);
    await wrapper!.find('[data-test="rum-analytics-funnel-entries-retry-btn"]').trigger("click");
    expect(wrapper!.emitted("retry")).toHaveLength(1);
  });
});
