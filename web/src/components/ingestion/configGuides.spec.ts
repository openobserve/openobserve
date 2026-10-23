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
import { defineComponent, h, type Component } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import FileBeat from "./logs/FileBeat.vue";
import FluentBit from "./logs/FluentBit.vue";
import Fluentd from "./logs/Fluentd.vue";
import LogstashDatasource from "./logs/LogstashDatasource.vue";
import LoongCollector from "./logs/LoongCollector.vue";
import SyslogNg from "./logs/SyslogNg.vue";
import Vector from "./logs/Vector.vue";
import Curl from "./logs/Curl.vue";
import CategrafConfig from "./metrics/CategrafConfig.vue";
import NightingaleConfig from "./metrics/NightingaleConfig.vue";
import PrometheusConfig from "./metrics/PrometheusConfig.vue";
import TelegrafConfig from "./metrics/TelegrafConfig.vue";
import MetricsOtelCollector from "./metrics/OtelCollector.vue";
import VMagentConfig from "./metrics/VMagentConfig.vue";
import ProfilesOtelCollector from "./profiles/OtelCollector.vue";
import CouchDB from "./databases/CouchDB.vue";
import Elasticsearch from "./databases/Elasticsearch.vue";
import SAPHana from "./databases/SAPHana.vue";

const IngestionContentStub = defineComponent({
  name: "IngestionContent",
  props: ["snippetKind", "configTool", "copySnippet", "targetStream", "signal", "guideName"],
  setup:
    (_props, { slots }) =>
    () =>
      h("div", slots.default?.()),
});

const mountGuide = async (guide: Component) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:any(.*)*", name: "guide", component: { template: "<div />" } }],
  });
  await router.push("/");
  const wrapper = mount(guide, {
    props: { currOrgIdentifier: "default", currUserEmail: "you@acme.io" },
    global: {
      plugins: [i18n, store, router],
      stubs: {
        IngestionContent: IngestionContentStub,
        CredentialCodeBlock: true,
        IngestionDocLink: true,
      },
    },
  });
  await flushPromises();
  return wrapper.findComponent(IngestionContentStub).props();
};

const OTEL = "OpenTelemetry Collector";

describe("ingestion guides mark a config snippet and name its tool", () => {
  it.each([
    ["Filebeat", FileBeat, "Filebeat"],
    ["Fluent Bit", FluentBit, "Fluent Bit"],
    ["Fluentd", Fluentd, "Fluentd"],
    ["Logstash", LogstashDatasource, "Logstash"],
    ["LoongCollector", LoongCollector, "LoongCollector"],
    ["syslog-ng", SyslogNg, "syslog-ng"],
    ["Vector", Vector, "Vector"],
    ["Categraf", CategrafConfig, "Categraf"],
    ["Nightingale", NightingaleConfig, "Nightingale"],
    ["Prometheus", PrometheusConfig, "Prometheus"],
    ["Telegraf", TelegrafConfig, "Telegraf"],
    ["CouchDB", CouchDB, OTEL],
    ["Elasticsearch", Elasticsearch, OTEL],
    ["SAP HANA", SAPHana, OTEL],
  ] as const)("%s", async (_name, guide, tool) => {
    expect(await mountGuide(guide)).toMatchObject({ snippetKind: "config", configTool: tool });
  });

  it.each([
    ["metrics OpenTelemetry Collector", MetricsOtelCollector],
    ["profiles OpenTelemetry Collector", ProfilesOtelCollector],
  ] as const)("%s re-copies its first config, not a later block", async (_name, guide) => {
    expect(await mountGuide(guide)).toMatchObject({
      snippetKind: "config",
      configTool: OTEL,
      copySnippet: "first",
    });
  });

  it.each([
    ["curl", Curl],
    ["vmagent", VMagentConfig],
  ] as const)("%s stays a command", async (_name, guide) => {
    expect((await mountGuide(guide)).snippetKind ?? "command").toBe("command");
  });
});
