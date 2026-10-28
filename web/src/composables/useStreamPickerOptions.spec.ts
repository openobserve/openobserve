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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import streamsMock from "@/test/unit/mockData/streams";
import {
  buildStreamPickerOptions,
  useStreamPickerOptions,
  type PickerStream,
  type StreamPickerInput,
} from "@/composables/useStreamPickerOptions";

const base = streamsMock.stream_list.list[0];
const stream = (name: string, isInternal = false): PickerStream => ({
  ...base,
  name,
  ...(isInternal ? { is_internal: true } : {}),
});

const STREAMS: PickerStream[] = [
  stream("_rumdata", true),
  stream("default"),
  stream("_anomalies", true),
  stream("k8s_events"),
  stream("_rumlog", true),
  stream("nginx_access"),
];

const HEADER = raw("Internal streams");

const build = (overrides: Partial<StreamPickerInput> = {}) =>
  buildStreamPickerOptions({
    streams: STREAMS,
    keep: new Set(),
    hide: false,
    search: "",
    headerLabel: HEADER,
    ...overrides,
  });

const labels = (options: { label: string; header?: boolean }[]) =>
  options.map((o) => (o.header ? `# ${o.label}` : o.label));

describe("buildStreamPickerOptions", () => {
  it("lists user streams first, then a header and the internal streams, each in input order", () => {
    expect(labels(build().options)).toEqual([
      "default",
      "k8s_events",
      "nginx_access",
      "# Internal streams",
      "_rumdata",
      "_anomalies",
      "_rumlog",
    ]);
  });

  it("marks only the group label as a header option with no value", () => {
    const headers = build().options.filter((o) => o.header);
    expect(headers).toEqual([{ label: "Internal streams", header: true }]);
  });

  it("treats a stream without the field as a user stream", () => {
    const { options } = build({ streams: [{ name: "legacy" }] });
    expect(labels(options)).toEqual(["legacy"]);
  });

  it("emits no header when there are no internal streams", () => {
    const { options, hiddenCount } = build({
      streams: [stream("default"), stream("k8s_events")],
    });
    expect(options.some((o) => o.header)).toBe(false);
    expect(hiddenCount).toBe(0);
  });

  it("emits no header when every internal stream is hidden", () => {
    const { options, hiddenCount } = build({ hide: true });
    expect(labels(options)).toEqual(["default", "k8s_events", "nginx_access"]);
    expect(hiddenCount).toBe(3);
  });

  it("keeps a selected internal stream under the header and leaves it out of the hidden count", () => {
    const { options, hiddenCount } = build({ hide: true, keep: new Set(["_rumlog"]) });
    expect(labels(options)).toEqual([
      "default",
      "k8s_events",
      "nginx_access",
      "# Internal streams",
      "_rumlog",
    ]);
    expect(hiddenCount).toBe(2);
  });

  it("ignores kept names when the hide setting is off", () => {
    const { options, hiddenCount } = build({ keep: new Set(["_rumlog"]) });
    expect(options).toHaveLength(7);
    expect(hiddenCount).toBe(0);
  });

  it("counts hidden streams matching the search text, case-insensitively", () => {
    expect(build({ hide: true, search: " RUM " }).searchHiddenMatchCount).toBe(2);
    expect(build({ hide: true, search: "anom" }).searchHiddenMatchCount).toBe(1);
    expect(build({ hide: true, search: "nginx" }).searchHiddenMatchCount).toBe(0);
  });

  it("does not count search matches while internal streams are shown or the search is empty", () => {
    expect(build({ search: "rum" }).searchHiddenMatchCount).toBe(0);
    expect(build({ hide: true, search: "  " }).searchHiddenMatchCount).toBe(0);
  });

  it("does not count a kept stream as a hidden search match", () => {
    const result = build({ hide: true, search: "rum", keep: new Set(["_rumdata"]) });
    expect(result.searchHiddenMatchCount).toBe(1);
  });

  it("reports an org whose streams are all internal and hidden", () => {
    const internalOnly = STREAMS.filter((s) => s.is_internal);
    expect(build({ streams: internalOnly, hide: true }).onlyInternalHidden).toBe(true);
    expect(build({ streams: internalOnly }).onlyInternalHidden).toBe(false);
    expect(
      build({ streams: internalOnly, hide: true, keep: new Set(["_rumdata"]) }).onlyInternalHidden,
    ).toBe(false);
    expect(build({ hide: true }).onlyInternalHidden).toBe(false);
    expect(build({ streams: [], hide: true }).onlyInternalHidden).toBe(false);
  });
});

describe("useStreamPickerOptions", () => {
  const streams = ref<PickerStream[]>(STREAMS);
  const selected = ref<string[]>([]);
  const open = ref(false);
  const search = ref("");
  let picker!: ReturnType<typeof useStreamPickerOptions>;
  let wrapper: ReturnType<typeof mount> | undefined;

  const visible = () => labels(picker.options.value);

  beforeEach(() => {
    localStorage.clear();
    streams.value = STREAMS;
    selected.value = [];
    open.value = false;
    search.value = "";
    const store = createStore({
      state: {
        userInfo: { email: "picker@example.com" },
        selectedOrganization: { identifier: "picker-org" },
      },
    });
    const Host = defineComponent({
      setup() {
        picker = useStreamPickerOptions({ streams, selected, open, search });
        return () => h("div");
      },
    });
    wrapper = mount(Host, { global: { plugins: [store, i18n] } });
    picker.hideInternalStreams.value = false;
  });

  afterEach(() => {
    wrapper?.unmount();
    localStorage.clear();
  });

  it("labels the internal group from the locale", () => {
    expect(visible()).toContain("# Internal streams");
  });

  it("follows the shared hide setting", async () => {
    picker.hideInternalStreams.value = true;
    await nextTick();
    expect(visible()).toEqual(["default", "k8s_events", "nginx_access"]);
    expect(picker.hiddenCount.value).toBe(3);
  });

  it("keeps a stream deselected while the popover is open until it closes", async () => {
    picker.hideInternalStreams.value = true;
    selected.value = ["_rumdata", "default"];
    await nextTick();
    open.value = true;
    await nextTick();

    selected.value = ["default"];
    await nextTick();
    expect(visible()).toContain("_rumdata");
    expect(picker.hiddenCount.value).toBe(2);

    open.value = false;
    await nextTick();
    expect(visible()).not.toContain("_rumdata");
    expect(picker.hiddenCount.value).toBe(3);
  });

  it("still applies the switch while the popover is open", async () => {
    open.value = true;
    await nextTick();
    picker.hideInternalStreams.value = true;
    await nextTick();
    expect(visible()).not.toContain("# Internal streams");
  });

  it("exposes the hidden search-match count and the internal-only state", async () => {
    picker.hideInternalStreams.value = true;
    search.value = "rum";
    await nextTick();
    expect(picker.searchHiddenMatchCount.value).toBe(2);

    streams.value = STREAMS.filter((s) => s.is_internal);
    await nextTick();
    expect(picker.onlyInternalHidden.value).toBe(true);
  });

  it("showInternalStreams turns the shared setting off", async () => {
    picker.hideInternalStreams.value = true;
    picker.showInternalStreams();
    await nextTick();
    expect(picker.hideInternalStreams.value).toBe(false);
    expect(localStorage.getItem("o2:hideInternalStreams:picker@example.com:picker-org")).toBe(
      "false",
    );
  });
});
