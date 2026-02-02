export default {
    namespaced: true,
    state: {
      logs: null,
      metrics: null,
      traces: null,
      enrichment_tables: null,
      index: null,
      metadata: null,
      streamsIndexMapping: {},
      areAllStreamsFetched: false,
    },
    getters: {
      getAllStreams(state: any) {
        return {
          logs: state.logs,
          metrics: state.metrics,
          traces: state.traces,
          enrichment_tables: state.enrichment_tables,
          index: state.index,
          metadata: state.metadata,
        };
      },
      getStream(state: any, streamType: string) {
        return state[streamType];
      },
      getStreamIndexMapping(state: any) {
        return state.streamsIndexMapping;
      },
      areAllStreamsFetched(state: any) {
        return state.areAllStreamsFetched;
      },
    },
    mutations: {
      updateLogs(state: any, logs: any) {
        state.logs = logs;
      },
      updateMetrics(state: any, metrics: any) {
        state.metrics = metrics;
      },
      updateTraces(state: any, traces: any) {
        state.traces = traces;
      },
      updateEnrichmentTables(state: any, enrichmentTables: any) {
        state.enrichment_tables = enrichmentTables;
      },
      updateIndex(state: any, index: any) {
        state.index = index;
      },
      updateMetadata(state: any, metadata: any) {
        state.metadata = metadata;
      },
      updateStreams(state: any, streams: any) {
        state.streams = streams;
      },
      updateStreamIndexMapping(state: any, streamIndexMapping: any) {
        state.streamsIndexMapping = streamIndexMapping;
      },
      updateStreamsFetched(state: any, areAllStreamsFetched: any) {
        state.areAllStreamsFetched = areAllStreamsFetched;
      },
    },
    actions: {
      setLogsStreams(context: any, logs: any) {
        context.commit('updateLogs', logs);
      },
      setMetricsStreams(context: any, metrics: any) {
        context.commit('updateMetrics', metrics);
      },
      setTracesStreams(context: any, traces: any) {
        context.commit('updateTraces', traces);
      },
      setEnrichmentTablesStreams(context: any, enrichmentTables: any) {
        context.commit('updateEnrichmentTables', enrichmentTables);
      },
      setIndexStreams(context: any, index: any) {
        context.commit('updateIndex', index);
      },
      setMetadataStreams(context: any, metadata: any) {
        context.commit('updateMetadata', metadata);
      },
      setStreams(context: any, payload: any) {
        if (payload.streamType === 'logs') {
          context.commit('updateLogs', payload.streams);
        } else if (payload.streamType === 'metrics') {
          context.commit('updateMetrics', payload.streams);
        } else if (payload.streamType === 'traces') {
          context.commit('updateTraces', payload.streams);
        } else if (payload.streamType === 'enrichment_tables') {
          context.commit('updateEnrichmentTables', payload.streams);
        } else if (payload.streamType === 'index') {
          context.commit('updateIndex', payload.streams);
        } else if (payload.streamType === 'metadata') {
          context.commit('updateMetadata', payload.streams);
        }
      },
      setStreamIndexMapping(context: any, streamIndexMapping: any) {
        context.commit('updateStreamIndexMapping', streamIndexMapping);
      },
      setStreamsFetched(context: any, areAllStreamsFetched: any) {
        context.commit('updateStreamsFetched', areAllStreamsFetched);
      },
    },
  };
  