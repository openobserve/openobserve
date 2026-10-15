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

import { describe, it, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import store from "@/test/unit/helpers/store";
import OForm from "@/lib/forms/Form/OForm.vue";
import { defaultDowntimeValues } from "@/utils/downtimes/downtimeForm";
import DowntimeScheduleFields from "./DowntimeScheduleFields.vue";

const mountFields = async (timezone: string) => {
  const Host = defineComponent({
    components: { OForm, DowntimeScheduleFields },
    setup: () => ({ defaultValues: defaultDowntimeValues(Date.now(), timezone) }),
    template: `<OForm :default-values="defaultValues"><DowntimeScheduleFields /></OForm>`,
  });
  const wrapper = mount(Host, { global: { plugins: [store] } });
  await flushPromises();
  return wrapper;
};

describe("DowntimeScheduleFields", () => {
  it("shows the next window once for a stored legacy UTC alias", async () => {
    const wrapper = await mountFields("Etc/UTC");
    const text = wrapper.text();
    expect(text).toMatch(/Next window: [^(]*\. A window can cross midnight\./);
    wrapper.unmount();
  });

  it("adds the UTC time for any other zone", async () => {
    const wrapper = await mountFields("Asia/Tokyo");
    expect(wrapper.text()).toMatch(/Next window: .*\(.*\)\. A window can cross midnight\./);
    wrapper.unmount();
  });
});
