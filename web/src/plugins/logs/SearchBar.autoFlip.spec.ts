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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";

const sentRequests = vi.hoisted(() => [] as any[]);

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any) => {
      sentRequests.push(JSON.parse(JSON.stringify(payload.queryReq)));
      return Promise.resolve();
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

// The grid's own producer and transport, so the assertion is on what Run sends.
const GridRunner = defineComponent({
  template: "<div />",
  setup() {
    const { getDataThroughStream } = useSearchStream((key: string) => key as any);
    const autoRun = useLogsAutoRun();
    const run = () => {
      const generation = autoRun.engine.newGeneration({
        lane: "grid",
        kind: "explicit",
        reason: "run",
        op: "full",
        signature: autoRun.readSignature(),
      });
      getDataThroughStream(false, generation.id);
    };
    return { run };
  },
});

// Drives the real updateQueryValue: filter text flips to SQL mode only when it reads as a statement.
describe("SearchBar — SQL auto-flip (item 1, spec 6.4)", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    wrapper.vm.searchObj.meta.sqlMode = false;
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    wrapper.vm.searchObj.data.query = "";
    wrapper.vm.searchObj.data.filterErrMsg = "";
    wrapper.vm.searchObj.data.stream.selectedStream = [];
    wrapper.vm.searchObj.data.streamResults = {
      list: [
        { name: "logs", schema: [{ name: "message" }, { name: "level" }] },
        { name: "s", schema: [{ name: "body" }] },
      ],
    };
  });

  afterEach(() => {
    wrapper.vm.searchObj.meta.sqlMode = false;
    wrapper.vm.searchObj.loadingStream = false;
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("keeps text that merely contains select and from in filter mode", () => {
    wrapper.vm.updateQueryValue("selected from cache");
    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(false);
  });

  it("keeps a sentence-shaped select in filter mode", () => {
    wrapper.vm.updateQueryValue("select messages from cache");
    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(false);
    wrapper.vm.updateQueryValue("select nothing from logs");
    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(false);
  });

  it("flips for statements, as today", () => {
    wrapper.vm.updateQueryValue('SELECT * FROM "logs"');
    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(true);
  });

  it("flips for a projected field, an expression and a leading comment", () => {
    for (const sql of [
      'select message from "logs"',
      'SELECT _timestamp + 1 AS t FROM "logs"',
      '-- note\nSELECT 1 FROM "logs"',
    ]) {
      // The previous flip selects the stream, and updateQueryValue ignores edits while that loads.
      wrapper.vm.searchObj.loadingStream = false;
      wrapper.vm.searchObj.meta.sqlMode = false;
      wrapper.vm.updateQueryValue(sql);
      expect(wrapper.vm.searchObj.meta.sqlMode, sql).toBe(true);
    }
  });

  it("still flips SQL on an unknown stream so the missing stream is reported", () => {
    wrapper.vm.updateQueryValue('SELECT * FROM "does_not_exist"');
    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(true);
    expect(wrapper.vm.searchObj.data.filterErrMsg).toBe('Stream "does_not_exist" does not exist');
  });

  describe("the request Run sends", () => {
    const runGrid = () => {
      const runner = mount(GridRunner, {
        global: { provide: { store }, plugins: [i18n, router] },
      });
      sentRequests.length = 0;
      (runner.vm as any).run();
      runner.unmount();
      return sentRequests.map((req) => req.query.sql);
    };

    beforeEach(() => {
      wrapper.vm.searchObj.data.stream.selectedStream = ["s"];
      wrapper.vm.searchObj.data.stream.streamLists = [{ label: "s", value: "s" }];
    });

    it("flips a CTE whose outer projection is not a field of the stream and sends it as SQL", () => {
      const cte = 'WITH q AS (SELECT body AS message FROM "s") SELECT message FROM q';
      wrapper.vm.updateQueryValue(cte);
      expect(wrapper.vm.searchObj.meta.sqlMode).toBe(true);

      expect(runGrid()).toEqual([cte]);
    });

    it("keeps select messages from cache a filter, so it is sent inside the stream's WHERE", () => {
      wrapper.vm.updateQueryValue("select messages from cache");
      expect(wrapper.vm.searchObj.meta.sqlMode).toBe(false);

      expect(runGrid()).toEqual(['select * from "s"  WHERE select messages from cache']);
    });
  });
});
