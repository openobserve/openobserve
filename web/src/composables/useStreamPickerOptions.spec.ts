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
  INTERNAL_GROUP_HIDE,
  INTERNAL_GROUP_SHOW,
  buildStreamPickerOptions,
  internalGroupHeader,
  useStreamPickerOptions,
  type InternalGroupText,
  type PickerStream,
  type StreamPickerInput,
  type StreamPickerOption,
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

const TEXT: InternalGroupText = {
  label: raw("Internal streams"),
  hidden: (count) => raw(`${count} hidden`),
  match: (count) => raw(`${count} match`),
  hide: raw("Hide"),
  show: raw("Show"),
  hideAriaLabel: raw("Hide internal streams"),
  showAriaLabel: raw("Show internal streams"),
};

const build = (overrides: Partial<StreamPickerInput> = {}) =>
  buildStreamPickerOptions({
    streams: STREAMS,
    keep: new Set(),
    hide: false,
    search: "",
    text: TEXT,
    ...overrides,
  });

const labels = (options: StreamPickerOption[]) =>
  options.map((o) =>
    o.header ? `# ${o.label} · ${o.headerCount ?? ""} [${o.headerAction}]` : o.label,
  );

describe("internalGroupHeader", () => {
  it("offers Hide over the listed group, counting every internal stream", () => {
    expect(internalGroupHeader("shown", 3, TEXT)).toEqual({
      label: "Internal streams",
      value: INTERNAL_GROUP_HIDE,
      header: true,
      headerCount: "3",
      headerAction: "Hide",
      headerActionAriaLabel: "Hide internal streams",
    });
  });

  it("offers Show on the collapsed group, counting the hidden streams", () => {
    expect(internalGroupHeader("hidden", 2, TEXT)).toEqual({
      label: "Internal streams",
      value: INTERNAL_GROUP_SHOW,
      header: true,
      headerCount: "2 hidden",
      headerAction: "Show",
      headerActionAriaLabel: "Show internal streams",
    });
  });

  it("keeps a search-match header listed while the search runs", () => {
    const header = internalGroupHeader("match", 2, TEXT);
    expect(header.headerCount).toBe("2 match");
    expect(header.keepOnSearch).toBe(true);
    expect(internalGroupHeader("hidden", 2, TEXT).keepOnSearch).toBeUndefined();
  });

  it("drops the count from a collapsed group that hides nothing", () => {
    expect(internalGroupHeader("hidden", 0, TEXT).headerCount).toBeUndefined();
  });
});

describe("buildStreamPickerOptions", () => {
  it("lists user streams first, then the Hide header and the internal streams, each in input order", () => {
    expect(labels(build().options)).toEqual([
      "default",
      "k8s_events",
      "nginx_access",
      "# Internal streams · 3 [Hide]",
      "_rumdata",
      "_anomalies",
      "_rumlog",
    ]);
  });

  it("treats a stream without the field as a user stream", () => {
    const { options } = build({ streams: [{ name: "legacy" }] });
    expect(labels(options)).toEqual(["legacy"]);
  });

  it("emits no header when there are no internal streams, shown or hidden", () => {
    const streams = [stream("default"), stream("k8s_events")];
    expect(build({ streams }).options.some((o) => o.header)).toBe(false);
    expect(build({ streams, hide: true }).options.some((o) => o.header)).toBe(false);
  });

  it("collapses every hidden internal stream into one Show row", () => {
    const { options, hiddenCount } = build({ hide: true });
    expect(labels(options)).toEqual([
      "default",
      "k8s_events",
      "nginx_access",
      "# Internal streams · 3 hidden [Show]",
    ]);
    expect(hiddenCount).toBe(3);
  });

  it("keeps a selected internal stream under the collapsed row and leaves it out of the count", () => {
    const { options, hiddenCount } = build({ hide: true, keep: new Set(["_rumlog"]) });
    expect(labels(options)).toEqual([
      "default",
      "k8s_events",
      "nginx_access",
      "# Internal streams · 2 hidden [Show]",
      "_rumlog",
    ]);
    expect(hiddenCount).toBe(2);
  });

  it("ignores kept names when the hide setting is off", () => {
    const { options, hiddenCount } = build({ keep: new Set(["_rumlog"]) });
    expect(options).toHaveLength(7);
    expect(hiddenCount).toBe(0);
  });

  it("turns the collapsed row into a match count when hidden streams match the search, case-insensitively", () => {
    const header = (search: string, keep = new Set<string>()) =>
      build({ hide: true, search, keep }).options.find((o) => o.header);
    expect(header(" RUM ")).toMatchObject({ headerCount: "2 match", keepOnSearch: true });
    expect(header("anom")?.headerCount).toBe("1 match");
    expect(header("rum", new Set(["_rumdata"]))?.headerCount).toBe("1 match");
  });

  it("leaves the hidden count on a row the search does not keep when no hidden stream matches", () => {
    const header = build({ hide: true, search: "nginx" }).options.find((o) => o.header);
    expect(header?.headerCount).toBe("3 hidden");
    expect(header?.keepOnSearch).toBeUndefined();
    expect(build({ hide: true, search: "  " }).options.find((o) => o.header)?.headerCount).toBe(
      "3 hidden",
    );
  });

  it("never lists a hidden stream, even when the search matches it", () => {
    const { options } = build({ hide: true, search: "rum" });
    expect(options.some((o) => !o.header && o.label.startsWith("_"))).toBe(false);
  });

  it("gives an org whose streams are all internal and hidden just the collapsed row", () => {
    const internalOnly = STREAMS.filter((s) => s.is_internal);
    expect(labels(build({ streams: internalOnly, hide: true }).options)).toEqual([
      "# Internal streams · 3 hidden [Show]",
    ]);
    expect(build({ streams: [], hide: true }).options).toEqual([]);
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

  it("labels the internal group header from the locale", () => {
    expect(visible()).toContain("# Internal streams · 3 [Hide]");
  });

  it("follows the shared hide setting", async () => {
    picker.hideInternalStreams.value = true;
    await nextTick();
    expect(visible()).toEqual([
      "default",
      "k8s_events",
      "nginx_access",
      "# Internal streams · 3 hidden [Show]",
    ]);
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

  it("hides and shows the group from its header action and persists the choice", async () => {
    const storageKey = "o2:hideInternalStreams:picker@example.com:picker-org";
    open.value = true;
    await nextTick();
    picker.onHeaderAction(picker.options.value.find((o) => o.header)!);
    await nextTick();
    expect(picker.hideInternalStreams.value).toBe(true);
    expect(localStorage.getItem(storageKey)).toBe("true");
    expect(visible()).toContain("# Internal streams · 3 hidden [Show]");
    expect(picker.announcement.value).toBe("Internal streams hidden");

    picker.onHeaderAction(picker.options.value.find((o) => o.header)!);
    await nextTick();
    expect(picker.hideInternalStreams.value).toBe(false);
    expect(localStorage.getItem(storageKey)).toBe("false");
    expect(picker.announcement.value).toBe("Internal streams shown");
  });

  it("ignores header actions from other headers", async () => {
    picker.onHeaderAction({ value: "__header__Other" });
    picker.onHeaderAction({});
    await nextTick();
    expect(picker.hideInternalStreams.value).toBe(false);
    expect(picker.announcement.value).toBe("");
  });

  it("counts hidden streams that match the search text", async () => {
    picker.hideInternalStreams.value = true;
    search.value = "rum";
    await nextTick();
    expect(visible()).toContain("# Internal streams · 2 match [Show]");
  });

  it("builds the quick-pick header in the same words", () => {
    expect(picker.internalHeader("hidden", 3)).toMatchObject({
      label: "Internal streams",
      headerCount: "3 hidden",
      headerAction: "Show",
      headerActionAriaLabel: "Show internal streams",
    });
  });
});
