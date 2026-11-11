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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, h } from "vue";

import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import stream from "@/services/stream";
import { streamKeys } from "@/services/stream.querykeys";
import store from "@/test/unit/helpers/store";

import { useSetupTarget } from "./useSetupTarget";

const ORG = "org1";
const CLOUD = config.isCloud;
const noStreams = () =>
  vi.spyOn(stream, "nameList").mockResolvedValue({ data: { list: [] } } as never);

/** Mounts the composable and hands back its target. */
function setup() {
  let target!: ReturnType<typeof useSetupTarget>["target"];
  const wrapper = mount(
    defineComponent({
      setup() {
        ({ target } = useSetupTarget(ORG));
        return () => h("div");
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }], store] } },
  );
  return { target, wrapper };
}

describe("useSetupTarget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
    config.isCloud = CLOUD;
  });

  // a re-read of the lists must not flip a card clicked mid-read
  it("on cloud, keeps the onboarding target while a re-read is in flight, then follows its answer", async () => {
    config.isCloud = "true";
    queryClient.clear();
    noStreams();
    const { target, wrapper } = setup();
    const opens = () => target("logs", "curl").name;
    await flushPromises();
    expect(opens()).toBe("onboarding");

    let answer!: (v: unknown) => void;
    vi.spyOn(stream, "nameList").mockReturnValue(new Promise((r) => (answer = r)) as never);
    void queryClient.invalidateQueries({
      queryKey: streamKeys.hasDataProbe(ORG, "logs"),
      exact: true,
    });
    await flushPromises();
    expect(queryClient.isFetching()).toBe(1);
    expect(opens()).toBe("onboarding");

    answer({ data: { list: [{ name: "default", stream_type: "logs", stats: { doc_num: 1 } }] } });
    await flushPromises();
    expect(opens()).toBe("curl");
    wrapper.unmount();
  });

  it.each([["the sample-data flow is on", { sample_data_onboarding_enabled: true }]])(
    "on cloud, keeps the guide's route when %s",
    async (_, flags) => {
      config.isCloud = "true";
      queryClient.clear();
      noStreams();
      const before = store.state.zoConfig;
      store.state.zoConfig = { ...before, ...flags };
      const { target, wrapper } = setup();
      await flushPromises();
      expect(target("logs", "curl")).toEqual({
        name: "curl",
        query: { org_identifier: ORG },
      });
      store.state.zoConfig = before;
      wrapper.unmount();
    },
  );
});
