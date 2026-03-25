// Copyright 2025 OpenObserve Inc.
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

import { describe, it, expect, beforeEach } from "vitest";
import { createStore } from "vuex";
import streamsModule from "@/stores/streams";

describe("streams store", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      modules: {
        streams: streamsModule,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------
  describe("initial state", () => {
    it("should initialise logs as null", () => {
      expect(store.state.streams.logs).toBeNull();
    });

    it("should initialise metrics as null", () => {
      expect(store.state.streams.metrics).toBeNull();
    });

    it("should initialise traces as null", () => {
      expect(store.state.streams.traces).toBeNull();
    });

    it("should initialise enrichment_tables as null", () => {
      expect(store.state.streams.enrichment_tables).toBeNull();
    });

    it("should initialise index as null", () => {
      expect(store.state.streams.index).toBeNull();
    });

    it("should initialise metadata as null", () => {
      expect(store.state.streams.metadata).toBeNull();
    });

    it("should initialise streamsIndexMapping as an empty object", () => {
      expect(store.state.streams.streamsIndexMapping).toEqual({});
    });

    it("should initialise areAllStreamsFetched as false", () => {
      expect(store.state.streams.areAllStreamsFetched).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  describe("mutations", () => {
    const sampleStreams = [
      { name: "stream-a", type: "logs" },
      { name: "stream-b", type: "logs" },
    ];

    describe("updateLogs", () => {
      it("should update the logs stream list", () => {
        store.commit("streams/updateLogs", sampleStreams);
        expect(store.state.streams.logs).toEqual(sampleStreams);
      });

      it("should overwrite the previous logs value", () => {
        store.commit("streams/updateLogs", [{ name: "old" }]);
        store.commit("streams/updateLogs", sampleStreams);
        expect(store.state.streams.logs).toEqual(sampleStreams);
      });

      it("should accept null to clear logs", () => {
        store.commit("streams/updateLogs", sampleStreams);
        store.commit("streams/updateLogs", null);
        expect(store.state.streams.logs).toBeNull();
      });
    });

    describe("updateMetrics", () => {
      it("should update the metrics stream list", () => {
        const payload = [{ name: "metrics-stream" }];
        store.commit("streams/updateMetrics", payload);
        expect(store.state.streams.metrics).toEqual(payload);
      });

      it("should not affect the logs state", () => {
        store.commit("streams/updateLogs", sampleStreams);
        store.commit("streams/updateMetrics", [{ name: "m1" }]);
        expect(store.state.streams.logs).toEqual(sampleStreams);
      });
    });

    describe("updateTraces", () => {
      it("should update the traces stream list", () => {
        const payload = [{ name: "traces-stream" }];
        store.commit("streams/updateTraces", payload);
        expect(store.state.streams.traces).toEqual(payload);
      });
    });

    describe("updateEnrichmentTables", () => {
      it("should update the enrichment_tables stream list", () => {
        const payload = [{ name: "lookup-table" }];
        store.commit("streams/updateEnrichmentTables", payload);
        expect(store.state.streams.enrichment_tables).toEqual(payload);
      });
    });

    describe("updateIndex", () => {
      it("should update the index stream list", () => {
        const payload = [{ name: "idx-stream" }];
        store.commit("streams/updateIndex", payload);
        expect(store.state.streams.index).toEqual(payload);
      });
    });

    describe("updateMetadata", () => {
      it("should update the metadata stream list", () => {
        const payload = [{ name: "meta-stream" }];
        store.commit("streams/updateMetadata", payload);
        expect(store.state.streams.metadata).toEqual(payload);
      });
    });

    describe("updateStreamIndexMapping", () => {
      it("should update the streamsIndexMapping", () => {
        const mapping = { stream1: ["field1", "field2"] };
        store.commit("streams/updateStreamIndexMapping", mapping);
        expect(store.state.streams.streamsIndexMapping).toEqual(mapping);
      });

      it("should overwrite the previous mapping", () => {
        store.commit("streams/updateStreamIndexMapping", { old: ["a"] });
        const newMapping = { new: ["b", "c"] };
        store.commit("streams/updateStreamIndexMapping", newMapping);
        expect(store.state.streams.streamsIndexMapping).toEqual(newMapping);
      });
    });

    describe("updateStreamsFetched", () => {
      it("should set areAllStreamsFetched to true", () => {
        store.commit("streams/updateStreamsFetched", true);
        expect(store.state.streams.areAllStreamsFetched).toBe(true);
      });

      it("should set areAllStreamsFetched to false", () => {
        store.commit("streams/updateStreamsFetched", true);
        store.commit("streams/updateStreamsFetched", false);
        expect(store.state.streams.areAllStreamsFetched).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------
  describe("getters", () => {
    const logsData = [{ name: "log-stream" }];
    const metricsData = [{ name: "metric-stream" }];
    const tracesData = [{ name: "trace-stream" }];
    const enrichmentData = [{ name: "enrich-table" }];
    const indexData = [{ name: "index-stream" }];
    const metadataData = [{ name: "meta-stream" }];

    describe("getAllStreams", () => {
      it("should return an object with all six stream-type keys", () => {
        const result = store.getters["streams/getAllStreams"];
        expect(result).toHaveProperty("logs");
        expect(result).toHaveProperty("metrics");
        expect(result).toHaveProperty("traces");
        expect(result).toHaveProperty("enrichment_tables");
        expect(result).toHaveProperty("index");
        expect(result).toHaveProperty("metadata");
      });

      it("should return the correct values after populating each stream type", () => {
        store.commit("streams/updateLogs", logsData);
        store.commit("streams/updateMetrics", metricsData);
        store.commit("streams/updateTraces", tracesData);
        store.commit("streams/updateEnrichmentTables", enrichmentData);
        store.commit("streams/updateIndex", indexData);
        store.commit("streams/updateMetadata", metadataData);

        const result = store.getters["streams/getAllStreams"];
        expect(result.logs).toEqual(logsData);
        expect(result.metrics).toEqual(metricsData);
        expect(result.traces).toEqual(tracesData);
        expect(result.enrichment_tables).toEqual(enrichmentData);
        expect(result.index).toEqual(indexData);
        expect(result.metadata).toEqual(metadataData);
      });

      it("should return nulls for unpopulated stream types", () => {
        const result = store.getters["streams/getAllStreams"];
        expect(result.logs).toBeNull();
        expect(result.metrics).toBeNull();
      });
    });

    describe("getStreamIndexMapping", () => {
      it("should return the initial empty mapping", () => {
        expect(store.getters["streams/getStreamIndexMapping"]).toEqual({});
      });

      it("should return the updated mapping after a mutation", () => {
        const mapping = { myStream: ["fieldA", "fieldB"] };
        store.commit("streams/updateStreamIndexMapping", mapping);
        expect(store.getters["streams/getStreamIndexMapping"]).toEqual(mapping);
      });
    });

    describe("areAllStreamsFetched", () => {
      it("should return false in the initial state", () => {
        expect(store.getters["streams/areAllStreamsFetched"]).toBe(false);
      });

      it("should return true after updateStreamsFetched(true)", () => {
        store.commit("streams/updateStreamsFetched", true);
        expect(store.getters["streams/areAllStreamsFetched"]).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  describe("actions", () => {
    describe("setLogsStreams", () => {
      it("should commit updateLogs with the payload", async () => {
        const data = [{ name: "logs-1" }];
        await store.dispatch("streams/setLogsStreams", data);
        expect(store.state.streams.logs).toEqual(data);
      });
    });

    describe("setMetricsStreams", () => {
      it("should commit updateMetrics with the payload", async () => {
        const data = [{ name: "metrics-1" }];
        await store.dispatch("streams/setMetricsStreams", data);
        expect(store.state.streams.metrics).toEqual(data);
      });
    });

    describe("setTracesStreams", () => {
      it("should commit updateTraces with the payload", async () => {
        const data = [{ name: "traces-1" }];
        await store.dispatch("streams/setTracesStreams", data);
        expect(store.state.streams.traces).toEqual(data);
      });
    });

    describe("setEnrichmentTablesStreams", () => {
      it("should commit updateEnrichmentTables with the payload", async () => {
        const data = [{ name: "enrich-1" }];
        await store.dispatch("streams/setEnrichmentTablesStreams", data);
        expect(store.state.streams.enrichment_tables).toEqual(data);
      });
    });

    describe("setIndexStreams", () => {
      it("should commit updateIndex with the payload", async () => {
        const data = [{ name: "index-1" }];
        await store.dispatch("streams/setIndexStreams", data);
        expect(store.state.streams.index).toEqual(data);
      });
    });

    describe("setMetadataStreams", () => {
      it("should commit updateMetadata with the payload", async () => {
        const data = [{ name: "meta-1" }];
        await store.dispatch("streams/setMetadataStreams", data);
        expect(store.state.streams.metadata).toEqual(data);
      });
    });

    describe("setStreams", () => {
      it("should dispatch updateLogs when streamType is 'logs'", async () => {
        const streams = [{ name: "log-stream" }];
        await store.dispatch("streams/setStreams", {
          streamType: "logs",
          streams,
        });
        expect(store.state.streams.logs).toEqual(streams);
      });

      it("should dispatch updateMetrics when streamType is 'metrics'", async () => {
        const streams = [{ name: "metric-stream" }];
        await store.dispatch("streams/setStreams", {
          streamType: "metrics",
          streams,
        });
        expect(store.state.streams.metrics).toEqual(streams);
      });

      it("should dispatch updateTraces when streamType is 'traces'", async () => {
        const streams = [{ name: "trace-stream" }];
        await store.dispatch("streams/setStreams", {
          streamType: "traces",
          streams,
        });
        expect(store.state.streams.traces).toEqual(streams);
      });

      it("should dispatch updateEnrichmentTables when streamType is 'enrichment_tables'", async () => {
        const streams = [{ name: "lookup" }];
        await store.dispatch("streams/setStreams", {
          streamType: "enrichment_tables",
          streams,
        });
        expect(store.state.streams.enrichment_tables).toEqual(streams);
      });

      it("should dispatch updateIndex when streamType is 'index'", async () => {
        const streams = [{ name: "idx" }];
        await store.dispatch("streams/setStreams", {
          streamType: "index",
          streams,
        });
        expect(store.state.streams.index).toEqual(streams);
      });

      it("should dispatch updateMetadata when streamType is 'metadata'", async () => {
        const streams = [{ name: "meta" }];
        await store.dispatch("streams/setStreams", {
          streamType: "metadata",
          streams,
        });
        expect(store.state.streams.metadata).toEqual(streams);
      });

      it("should not mutate any state for an unknown streamType", async () => {
        await store.dispatch("streams/setStreams", {
          streamType: "unknown_type",
          streams: [{ name: "x" }],
        });
        // All known types should remain null
        expect(store.state.streams.logs).toBeNull();
        expect(store.state.streams.metrics).toBeNull();
        expect(store.state.streams.traces).toBeNull();
        expect(store.state.streams.enrichment_tables).toBeNull();
        expect(store.state.streams.index).toBeNull();
        expect(store.state.streams.metadata).toBeNull();
      });

      it("should only update the targeted stream type and leave others unchanged", async () => {
        await store.dispatch("streams/setLogsStreams", [{ name: "log-a" }]);
        await store.dispatch("streams/setStreams", {
          streamType: "metrics",
          streams: [{ name: "metric-b" }],
        });
        expect(store.state.streams.logs).toEqual([{ name: "log-a" }]);
        expect(store.state.streams.metrics).toEqual([{ name: "metric-b" }]);
        expect(store.state.streams.traces).toBeNull();
      });
    });

    describe("setStreamIndexMapping", () => {
      it("should commit updateStreamIndexMapping with the payload", async () => {
        const mapping = { stream1: ["f1", "f2"] };
        await store.dispatch("streams/setStreamIndexMapping", mapping);
        expect(store.state.streams.streamsIndexMapping).toEqual(mapping);
      });
    });

    describe("setStreamsFetched", () => {
      it("should commit updateStreamsFetched with true", async () => {
        await store.dispatch("streams/setStreamsFetched", true);
        expect(store.state.streams.areAllStreamsFetched).toBe(true);
      });

      it("should commit updateStreamsFetched with false", async () => {
        await store.dispatch("streams/setStreamsFetched", true);
        await store.dispatch("streams/setStreamsFetched", false);
        expect(store.state.streams.areAllStreamsFetched).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Module configuration
  // ---------------------------------------------------------------------------
  describe("module configuration", () => {
    it("should be namespaced", () => {
      expect(streamsModule.namespaced).toBe(true);
    });
  });
});
