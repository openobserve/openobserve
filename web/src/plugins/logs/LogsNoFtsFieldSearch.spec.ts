// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import LogsNoFtsFieldSearch from "./LogsNoFtsFieldSearch.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { fieldSearchPredicate, type NoFtsFieldValues } from "./LogsNoFtsFieldSearch.schema";

const streams = [
  {
    name: "nofts",
    schema: [
      { name: "message", type: "Utf8" },
      { name: "count", type: "Int64" },
      { name: "enabled", type: "Boolean" },
      { name: "ratio", type: "Float64" },
      { name: "payload", type: "Struct" },
      { name: "tiny", type: "UInt8" },
    ],
  },
];
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function setup(options = {}) {
  const wrapper = mount(LogsNoFtsFieldSearch, {
    attachTo: document.body,
    props: { streams, selectedStreams: ["nofts"], term: "timeout", ...options },
    global: { plugins: [i18n] },
  });
  wrappers.push(wrapper);
  return wrapper;
}

const values = (overrides: Partial<NoFtsFieldValues> = {}): NoFtsFieldValues => ({
  stream: "nofts",
  field: "message",
  match: "contains",
  value: "timeout",
  ...overrides,
});

describe("no-FTS field recovery", () => {
  it.each([
    [
      { value: "O'Reilly" },
      "(message IS NOT NULL AND str_match_ignore_case(message, 'o''reilly'))",
    ],
    [{ value: "Ошибка" }, "(message IS NOT NULL AND str_match_ignore_case(message, 'ошибка'))"],
    [{ value: "--debug" }, "(message IS NOT NULL AND str_match_ignore_case(message, '--debug'))"],
    [{ field: "count", match: "equals", value: "9007199254740993" }, "count = 9007199254740993"],
    [{ field: "enabled", match: "equals", value: "TRUE" }, "enabled = true"],
    [{ field: "ratio", match: "equals", value: "1.25" }, "ratio = 1.25"],
    [{ match: "equals", value: "'literal'" }, "message = '''literal'''"],
  ] as [Partial<NoFtsFieldValues>, string][])(
    "submits exactly the previewed predicate %j",
    async (input, expected) => {
      const wrapper = setup();
      const form = wrapper.findComponent(OForm).vm.form;
      for (const [key, value] of Object.entries(values(input))) form.setFieldValue(key, value);
      await flushPromises();
      expect(wrapper.get('[data-test="logs-no-fts-preview"]').text()).toBe(expected);
      expect(wrapper.emitted("submit")).toBeUndefined();
      await wrapper.get("form").trigger("submit");
      await flushPromises();
      await vi.waitFor(() =>
        expect(wrapper.emitted("submit")).toEqual([[{ ...values(input), predicate: expected }]]),
      );
    },
  );

  it.each([
    { field: "absent" },
    { value: "" },
    { field: "count", match: "equals", value: "no" },
    { field: "enabled", match: "equals", value: "1" },
    { field: "count", value: "5" },
    { field: "payload" },
    { field: "tiny", match: "equals", value: "256" },
    { field: "count", match: "equals", value: "9223372036854775808" },
    { field: "ratio", match: "equals", value: "Infinity" },
  ] as Partial<NoFtsFieldValues>[])("rejects invalid input %j", (input) => {
    expect(fieldSearchPredicate(values(input), streams)).toBeNull();
  });

  it("announces required fields on invalid submit without emitting", async () => {
    const wrapper = setup();
    const form = wrapper.findComponent(OForm).vm.form;
    form.setFieldValue("field", "");
    form.setFieldValue("value", "");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Choose a field to search.");
    expect(wrapper.text()).toContain("Enter a value to search.");
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("defaults numeric-only schemas to Equals and explains the no-fields fallback", () => {
    const wrapper = setup({
      streams: [{ name: "nofts", schema: [{ name: "count", type: "Int64" }] }],
      term: "42",
    });
    expect(wrapper.get('[data-test="logs-no-fts-preview"]').text()).toBe("count = 42");
    const empty = setup({ streams: [{ name: "nofts", schema: [] }] });
    expect(empty.text()).toContain("This stream has no fields available for a field search.");
    expect(
      empty.get('[data-test="logs-no-fts-run-field-btn"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("switches schema and names all deselections before submitting", async () => {
    const wrapper = setup({
      streams: [...streams, { name: "other", schema: [{ name: "code", type: "Int64" }] }],
      selectedStreams: ["nofts", "other", "fts"],
    });
    const form = wrapper.findComponent(OForm).vm.form;
    form.setFieldValue("stream", "other");
    await flushPromises();
    expect(form.state.values.field).toBe("code");
    expect(form.state.values.match).toBe("equals");
    expect(wrapper.text()).toContain("Search other only; nofts, fts will be deselected.");
    expect(wrapper.emitted("submit")).toBeUndefined();
    await wrapper.get('[aria-label="Close field search"]').trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });
});
