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
import K8sListHeader from "./K8sListHeader.vue";

let wrapper: VueWrapper<any>;

const mountHeader = (props: Record<string, unknown>) => {
  wrapper = mount(K8sListHeader, {
    props: { title: raw("Map"), count: 41, total: 41, countLabel: raw("41 pods"), ...props },
    global: { plugins: [i18n] },
  });
  return wrapper;
};

const count = () => wrapper.find('[data-test="k8s2-list-count"]').text().replace(/\s+/g, " ");

afterEach(() => wrapper?.unmount());

describe("K8sListHeader count suffix and filtered flag (AC 80)", () => {
  const SUFFIX = raw("labels seen on 39 of 41");

  it("shows Filtered when only the caller says so, and the suffix after the count", () => {
    mountHeader({ count: 2, filtered: true, countSuffix: SUFFIX });
    expect(count()).toBe("Filtered: 2 / 41 · labels seen on 39 of 41");
  });

  it("puts the suffix after the unfiltered count label too", () => {
    mountHeader({ countSuffix: SUFFIX });
    expect(count()).toBe("41 pods · labels seen on 39 of 41");
  });

  it("gives the title and count their own full row on phones", () => {
    mountHeader({});
    const heading = wrapper.find('[data-test="k8s2-list-heading"]');
    expect(heading.classes()).toContain("max-md:w-full");
    expect(heading.find('[data-test="k8s2-list-title"]').exists()).toBe(true);
    expect(heading.find('[data-test="k8s2-list-count"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="k8s2-list-header"]').classes()).toContain("flex-wrap");
  });

  it("shows no suffix and no Filtered by default", () => {
    mountHeader({});
    expect(count()).toBe("41 pods");
  });
});
