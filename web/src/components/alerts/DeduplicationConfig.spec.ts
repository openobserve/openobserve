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

import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

import DeduplicationConfig from "@/components/alerts/DeduplicationConfig.vue";

const makeModelValue = (overrides: Record<string, any> = {}) => ({
  enabled: true,
  fingerprint_fields: [] as string[],
  time_window_minutes: undefined as number | undefined,
  ...overrides,
});

const availableFields = [
  { label: "Host", value: "host" },
  { label: "Service", value: "service" },
  { label: "Level", value: "level" },
];

async function mountComp(props: Record<string, any> = {}) {
  return mount(DeduplicationConfig, {
    props: {
      modelValue: makeModelValue(),
      availableFields,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        AlertsContainer: {
          template: '<div data-test="alerts-container-stub"><slot /></div>',
          props: ["name", "isExpanded", "label", "subLabel", "icon", "iconClass"],
          emits: ["update:is-expanded"],
        },
      },
    },
  });
}

describe("DeduplicationConfig - rendering", () => {
  it("renders the component without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("isExpanded defaults to true", async () => {
    const w = await mountComp();
    expect((w.vm as any).isExpanded).toBe(true);
  });

  it("renders the expanded content when isExpanded is true", async () => {
    const w = await mountComp();
    expect(w.html()).toContain("deduplication-config");
  });
});

describe("DeduplicationConfig - localConfig initialization", () => {
  it("initializes fingerprint_fields from modelValue", async () => {
    const w = await mountComp({
      modelValue: makeModelValue({ fingerprint_fields: ["host", "service"] }),
    });
    expect((w.vm as any).localConfig.fingerprint_fields).toEqual(["host", "service"]);
  });

  it("initializes time_window_minutes from modelValue", async () => {
    const w = await mountComp({
      modelValue: makeModelValue({ time_window_minutes: 30 }),
    });
    expect((w.vm as any).localConfig.time_window_minutes).toBe(30);
  });

  it("defaults time_window_minutes to undefined when not provided", async () => {
    const w = await mountComp({
      modelValue: makeModelValue({ time_window_minutes: undefined }),
    });
    expect((w.vm as any).localConfig.time_window_minutes).toBeUndefined();
  });

  it("always sets enabled to true", async () => {
    const w = await mountComp({
      modelValue: makeModelValue({ enabled: false }),
    });
    expect((w.vm as any).localConfig.enabled).toBe(true);
  });
});

describe("DeduplicationConfig - emitUpdate", () => {
  it("emits update:modelValue when emitUpdate is called", async () => {
    const w = await mountComp();
    (w.vm as any).emitUpdate();
    expect(w.emitted("update:modelValue")).toBeTruthy();
  });

  it("emitted payload always has enabled=true", async () => {
    const w = await mountComp();
    (w.vm as any).emitUpdate();
    const payload = (w.emitted("update:modelValue") as any[][])[0][0];
    expect(payload.enabled).toBe(true);
  });

  it("emitted payload includes current fingerprint_fields", async () => {
    const w = await mountComp({
      modelValue: makeModelValue({ fingerprint_fields: ["host"] }),
    });
    (w.vm as any).emitUpdate();
    const payload = (w.emitted("update:modelValue") as any[][])[0][0];
    expect(payload.fingerprint_fields).toEqual(["host"]);
  });

  it("emitted payload includes sanitized time_window_minutes", async () => {
    const w = await mountComp();
    (w.vm as any).localConfig.time_window_minutes = 15;
    (w.vm as any).emitUpdate();
    const payload = (w.emitted("update:modelValue") as any[][])[0][0];
    expect(payload.time_window_minutes).toBe(15);
  });

  it("emitted payload has undefined grouping", async () => {
    const w = await mountComp();
    (w.vm as any).emitUpdate();
    const payload = (w.emitted("update:modelValue") as any[][])[0][0];
    expect(payload.grouping).toBeUndefined();
  });
});

describe("DeduplicationConfig - sanitizeTimeWindow", () => {
  it("returns undefined for null", async () => {
    const w = await mountComp();
    expect((w.vm as any).sanitizeTimeWindow(null)).toBeUndefined();
  });

  it("returns undefined for empty string", async () => {
    const w = await mountComp();
    expect((w.vm as any).sanitizeTimeWindow("")).toBeUndefined();
  });

  it("returns undefined for NaN string", async () => {
    const w = await mountComp();
    expect((w.vm as any).sanitizeTimeWindow("abc")).toBeUndefined();
  });

  it("returns number for valid string", async () => {
    const w = await mountComp();
    expect((w.vm as any).sanitizeTimeWindow("30")).toBe(30);
  });

  it("returns number for valid number", async () => {
    const w = await mountComp();
    expect((w.vm as any).sanitizeTimeWindow(45)).toBe(45);
  });

  it("returns undefined for NaN number", async () => {
    const w = await mountComp();
    expect((w.vm as any).sanitizeTimeWindow(NaN)).toBeUndefined();
  });
});

describe("DeduplicationConfig - watcher", () => {
  it("syncs localConfig fingerprint_fields when modelValue changes", async () => {
    const w = await mountComp();
    await w.setProps({
      modelValue: makeModelValue({ fingerprint_fields: ["level"] }),
    });
    await flushPromises();
    expect((w.vm as any).localConfig.fingerprint_fields).toEqual(["level"]);
  });

  it("syncs localConfig time_window_minutes when modelValue changes", async () => {
    const w = await mountComp();
    await w.setProps({
      modelValue: makeModelValue({ time_window_minutes: 60 }),
    });
    await flushPromises();
    expect((w.vm as any).localConfig.time_window_minutes).toBe(60);
  });

  it("keeps enabled true when new modelValue has enabled=false", async () => {
    const w = await mountComp();
    await w.setProps({
      modelValue: makeModelValue({ enabled: false }),
    });
    await flushPromises();
    expect((w.vm as any).localConfig.enabled).toBe(true);
  });
});
