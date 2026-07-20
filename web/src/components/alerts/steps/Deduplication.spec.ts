// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Behavior spec for the Deduplication step. The step is a DESCENDANT of the
// ONE AddAlert <OForm>: an ancestor form provides FORM_CONTEXT_KEY, the fields
// bind `deduplication.*` by nested `name=` into it, and flushDedup writes the
// DERIVED `enabled` + SANITIZED `time_window_minutes` back into the parent
// form (Rule ④ payload parity — getAlertPayload reads the raw form values).

import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { z } from "zod";
import Deduplication from "./Deduplication.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { deduplicationSchema } from "@/components/alerts/AddAlert.schema";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const globalCfg = { global: { plugins: [i18n, store] } };

// ── DESCENDANT host (binds into an ancestor OForm — the app wiring) ─────────

function makeDescendantHost(dedupDefaults: Record<string, any> = {}) {
  return defineComponent({
    components: { OForm, Deduplication },
    setup() {
      const schema = z.looseObject({
        deduplication: deduplicationSchema.optional(),
      });
      const defaultValues = {
        deduplication: {
          enabled: false,
          fingerprint_fields: [] as string[],
          time_window_minutes: undefined as number | undefined,
          ...dedupDefaults,
        },
      };
      return { schema, defaultValues };
    },
    template: `
      <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
        <Deduplication :deduplication="defaultValues.deduplication" :columns="['field1','field2','field3']" />
      </OForm>
    `,
  });
}

function mountDescendant(dedupDefaults: Record<string, any> = {}) {
  return mount(makeDescendantHost(dedupDefaults), globalCfg);
}

const hostForm = (host: any) =>
  (host.findComponent({ name: "OForm" }).vm as any).form;

/** flushDedup runs on a microtask after field.handleChange — settle both. */
const settle = async () => {
  await flushPromises();
  await nextTick();
  await flushPromises();
};

describe("Deduplication — descendant (binds into ancestor OForm) mode", () => {
  it("does NOT render its own <OForm>", () => {
    const host = mountDescendant();
    expect(host.findAllComponents({ name: "OForm" }).length).toBe(1);
    expect(host.findComponent(Deduplication).exists()).toBe(true);
  });

  it("preserves data-tests", () => {
    const host = mountDescendant();
    expect(
      host.find('[data-test="alert-dedup-fingerprint-fields"]').exists(),
    ).toBe(true);
    expect(host.find('[data-test="alert-dedup-time-window"]').exists()).toBe(
      true,
    );
  });

  it("selecting fields writes fingerprint_fields + derived enabled into the PARENT form", async () => {
    const host = mountDescendant();
    const parentForm = hostForm(host);

    host
      .findComponent('[data-test="alert-dedup-fingerprint-fields"]')
      .vm.$emit("update:model-value", ["field1"]);
    await settle();

    expect(parentForm.state.values.deduplication.fingerprint_fields).toEqual([
      "field1",
    ]);
    expect(parentForm.state.values.deduplication.enabled).toBe(true);
    // descendant mode is form-owned → no emit
    expect(
      host.findComponent(Deduplication).emitted("update:deduplication"),
    ).toBeFalsy();
  });

  it("clearing all fields derives enabled=false in the PARENT form", async () => {
    const host = mountDescendant({
      enabled: true,
      fingerprint_fields: ["field1"],
    });
    const parentForm = hostForm(host);

    host
      .findComponent('[data-test="alert-dedup-fingerprint-fields"]')
      .vm.$emit("update:model-value", []);
    await settle();

    expect(parentForm.state.values.deduplication.fingerprint_fields).toEqual(
      [],
    );
    expect(parentForm.state.values.deduplication.enabled).toBe(false);
  });

  it("@create adds the custom value to the PARENT form (duplicate ignored)", async () => {
    const host = mountDescendant();
    const parentForm = hostForm(host);

    host
      .findComponent('[data-test="alert-dedup-fingerprint-fields"]')
      .vm.$emit("create", "customField");
    await settle();

    expect(parentForm.state.values.deduplication.fingerprint_fields).toEqual([
      "customField",
    ]);
    expect(parentForm.state.values.deduplication.enabled).toBe(true);

    // duplicate create is ignored
    host
      .findComponent('[data-test="alert-dedup-fingerprint-fields"]')
      .vm.$emit("create", "customField");
    await settle();
    expect(parentForm.state.values.deduplication.fingerprint_fields).toEqual([
      "customField",
    ]);
  });

  it("time_window is sanitized to a number in the PARENT form (payload parity)", async () => {
    const host = mountDescendant();
    const parentForm = hostForm(host);

    await host
      .find('[data-test="alert-dedup-time-window"] input')
      .setValue("20");
    // sanitize runs on a microtask after field.handleChange
    await settle();

    expect(parentForm.state.values.deduplication.time_window_minutes).toBe(20);
    expect(
      typeof parentForm.state.values.deduplication.time_window_minutes,
    ).toBe("number");
  });

  it("an empty time_window is sanitized to undefined in the PARENT form", async () => {
    const host = mountDescendant({ time_window_minutes: 10 });
    const parentForm = hostForm(host);

    await host
      .find('[data-test="alert-dedup-time-window"] input')
      .setValue("");
    await settle();

    expect(
      parentForm.state.values.deduplication.time_window_minutes,
    ).toBeUndefined();
  });
});
