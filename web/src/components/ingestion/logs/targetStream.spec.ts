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

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h, type Component } from "vue";
import i18n from "@/locales";
import FluentBit from "./FluentBit.vue";
import Vector from "./Vector.vue";
import FileBeat from "./FileBeat.vue";
import Fluentd from "./Fluentd.vue";
import LogstashDatasource from "./LogstashDatasource.vue";
import SyslogNg from "./SyslogNg.vue";
import KinesisFirehose from "./KinesisFirehose.vue";
import LoongCollector from "./LoongCollector.vue";
import SplunkHec from "./SplunkHec.vue";

const ORG = "acme-prod";

const IngestionContentStub = defineComponent({
  name: "IngestionContent",
  props: ["targetStream", "signal", "guideName", "docUrl", "snippetKind"],
  setup:
    (_props, { slots }) =>
    () =>
      h("div", slots.default?.()),
});
const SnippetStub = defineComponent({
  props: ["content", "code"],
  setup: (props) => () => h("pre", { class: "snippet-stub" }, props.content ?? props.code),
});

const makeStore = () =>
  createStore({
    state: {
      API_ENDPOINT: "http://localhost:5080",
      selectedOrganization: { identifier: ORG, name: ORG },
      userInfo: { email: "you@acme.io" },
      zoConfig: { ingestion_url: "", version: "", build_type: "opensource" },
      organizationData: { organizationPasscode: "x", orgTokens: [] },
    },
  });

// The server's format_stream_name: every run of other characters becomes one underscore.
const landedStream = (name: string) => name.replace(/[^a-zA-Z0-9_:]+/g, "_");

const GUIDES: Array<[string, Component, RegExp, number]> = [
  ["FluentBit", FluentBit, /\/api\/acme-prod\/([^/\s]+)\/_json/g, 1],
  ["Vector", Vector, /\/api\/acme-prod\/([^/\s]+)\/_json/g, 1],
  ["FileBeat", FileBeat, /index: "([^"]+)"/g, 1],
  ["Fluentd", Fluentd, /\/api\/acme-prod\/([^/\s]+)\/_json/g, 1],
  ["LogstashDatasource", LogstashDatasource, /\/api\/acme-prod\/([^/\s]+)\/_json/g, 1],
  ["SyslogNg", SyslogNg, /stream\("([^"]+)"\)/g, 1],
  ["KinesisFirehose", KinesisFirehose, /\/aws\/acme-prod\/([^/\s]+)\/_kinesis_firehose/g, 1],
  ["LoongCollector", LoongCollector, /\/api\/acme-prod\/([^/\s]+)\/_json/g, 1],
  ["SplunkHec", SplunkHec, /"index":\s*"([^"]+)"/g, 2],
];

describe("log shipper guides watch the stream their snippet writes to", () => {
  it.each(GUIDES)("%s writes every example to the bar's target", async (_n, guide, re, count) => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/tokens", name: "ingestionTokens", component: { template: "<div />" } },
        { path: "/:any(.*)*", name: "guide", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    const store = makeStore();
    const wrapper = mount(guide, {
      props: { currOrgIdentifier: ORG, currUserEmail: "you@acme.io" },
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: {
          IngestionContent: IngestionContentStub,
          CredentialCodeBlock: SnippetStub,
          OCodeBlock: SnippetStub,
          IngestionDocLink: true,
        },
      },
    });
    await flushPromises();
    const snippets = wrapper.findAll(".snippet-stub").map((s) => s.text());
    const ingesting = snippets.filter((s) => s.match(re));
    const written = ingesting.flatMap((s) => [...s.matchAll(re)].map((m) => landedStream(m[1])));
    expect(ingesting).toHaveLength(count);
    const target = wrapper.findComponent(IngestionContentStub).props("targetStream");
    expect(written).toEqual(written.map(() => target));
    wrapper.unmount();
  });
});
