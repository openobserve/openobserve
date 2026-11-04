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
import { raw } from "@/types/i18n";
import { withoutCovered } from "@/components/access/surfaceDenials";
import { requestDenials } from "@/composables/useAccessStore";
import OverviewSectionError from "./OverviewSectionError.vue";

const forbidden = (url?: string) =>
  Object.assign(new Error("forbidden"), {
    response: { status: 403 },
    config: url ? { method: "get", url } : undefined,
  });
const serverError = () => Object.assign(new Error("boom"), { response: { status: 500 } });

describe("OverviewSectionError", () => {
  let wrapper: VueWrapper | undefined;

  const mountSection = (error: unknown, denied = true) =>
    (wrapper = mount(OverviewSectionError, {
      props: { section: "anomalies", title: raw("Active anomalies"), forbidden: denied, error },
      global: { plugins: [i18n] },
    }));

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("shows the no-access lock, not load-error with Retry, when the section answered 403", () => {
    mountSection(forbidden("/api/default/anomaly_detection"));

    expect(wrapper!.find('[data-test="overview-anomalies-no-access"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="access-lock-icon"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="overview-anomalies-load-error"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="overview-anomalies-load-error-retry-btn"]').exists()).toBe(
      false,
    );
    expect(wrapper!.text()).not.toContain("Something went wrong");
  });

  it("names the refused resource and permission from the failed request", () => {
    mountSection(forbidden("/api/v2/default/alerts/incidents"));

    expect(wrapper!.text()).toContain("Active anomalies");
    expect(wrapper!.text()).toContain("You can't view incidents");
    expect(wrapper!.text()).toContain("missing the List permission on Incidents");
  });

  it("shows the general no-access wording when the 403 carries no request", () => {
    mountSection(Object.assign(new Error("forbidden"), { status: 403 }));

    expect(wrapper!.find('[data-test="overview-anomalies-no-access"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="access-lock-icon"]').exists()).toBe(true);
    expect(wrapper!.text()).toContain("You don't have access");
    expect(wrapper!.text()).not.toContain("You can't");
    expect(wrapper!.text()).not.toContain("missing the");
  });

  it("covers the chip entry of a refused request whose resource has no friendly name", () => {
    const error = forbidden("/api/default/domain_management");
    const [entry] = requestDenials(error);
    expect(entry.resource.key).toBe("_unnamed/domain_management");
    expect(withoutCovered([entry])).toHaveLength(1);

    mountSection(error);

    expect(wrapper!.find('[data-test="overview-anomalies-no-access"]').exists()).toBe(true);
    expect(withoutCovered([entry])).toHaveLength(0);
  });

  it("keeps load-error with Retry for a failure other than 403", async () => {
    mountSection(serverError(), false);

    expect(wrapper!.find('[data-test="overview-anomalies-load-error"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="overview-anomalies-no-access"]').exists()).toBe(false);
    await wrapper!.find('[data-test="overview-anomalies-load-error-retry-btn"]').trigger("click");
    expect(wrapper!.emitted("retry")).toHaveLength(1);
  });
});
