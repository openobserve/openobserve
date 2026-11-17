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
import ODate from "@/lib/forms/Date/ODate.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
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

describe("DowntimeScheduleFields, a moved start", () => {
  const mountOnce = async () => {
    const values = defaultDowntimeValues(Date.parse("2026-11-12T10:00:00Z"), "UTC");
    values.schedule = {
      ...values.schedule,
      start_date: "2026-11-12",
      start_time: "02:00",
      end_date: "2026-11-12",
      end_time: "03:00",
    };
    const Host = defineComponent({
      components: { OForm, DowntimeScheduleFields },
      setup: () => ({ defaultValues: values }),
      template: `<OForm :default-values="defaultValues"><DowntimeScheduleFields /></OForm>`,
    });
    const wrapper = mount(Host, { global: { plugins: [store] } });
    await flushPromises();
    const api = (wrapper.findComponent(OForm).vm as unknown as { form: any }).form;
    return { wrapper, api };
  };

  // The user's pick, as the date or time control emits it.
  const pick = async (wrapper: ReturnType<typeof mount>, name: string, value: string) => {
    const control = [...wrapper.findAllComponents(ODate), ...wrapper.findAllComponents(OTime)].find(
      (c) => c.props("name") === name,
    );
    expect(control).toBeTruthy();
    control!.vm.$emit("update:modelValue", value);
    await flushPromises();
  };

  it("moves the end by the same amount, so the window keeps its length", async () => {
    const { wrapper, api } = await mountOnce();
    await pick(wrapper, "schedule.start_date", "2026-11-22");
    expect(api.state.values.schedule.start_date).toBe("2026-11-22");
    expect(api.state.values.schedule.end_date).toBe("2026-11-22");
    expect(api.state.values.schedule.end_time).toBe("03:00");
    await pick(wrapper, "schedule.start_time", "23:30");
    expect(api.state.values.schedule.end_date).toBe("2026-11-23");
    expect(api.state.values.schedule.end_time).toBe("00:30");
    wrapper.unmount();
  });

  it("keeps the loaded end on a reset that changes only the start", async () => {
    const { wrapper, api } = await mountOnce();
    api.reset({
      ...api.state.values,
      schedule: { ...api.state.values.schedule, start_time: "01:00" },
    });
    await flushPromises();
    expect(api.state.values.schedule.start_time).toBe("01:00");
    expect(api.state.values.schedule.end_date).toBe("2026-11-12");
    expect(api.state.values.schedule.end_time).toBe("03:00");
    wrapper.unmount();
  });

  it("does not move the start when only the end changes, nor anything on a reset", async () => {
    const { wrapper, api } = await mountOnce();
    api.setFieldValue("schedule.end_time", "05:00");
    await flushPromises();
    expect(api.state.values.schedule.start_date).toBe("2026-11-12");
    expect(api.state.values.schedule.start_time).toBe("02:00");
    const loaded = {
      ...api.state.values,
      schedule: {
        ...api.state.values.schedule,
        start_date: "2026-12-01",
        end_date: "2026-12-03",
      },
    };
    api.reset(loaded);
    await flushPromises();
    expect(api.state.values.schedule.end_date).toBe("2026-12-03");
    wrapper.unmount();
  });
});

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
