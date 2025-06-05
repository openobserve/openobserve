export default {
  summary: {
    get: {
      streams: [
        {
          name: "quickstart1",
          storage_type: "disk",
          stream_type: "logs",
          stats: {
            doc_time_min: 1680695742353522,
            doc_time_max: 1680695754490493,
            doc_num: 30540,
            file_num: 1,
            storage_size: 55.92,
            compressed_size: 0.4,
          },
          settings: {
            partition_keys: {},
            full_text_search_keys: [],
            index_fields: [],
            bloom_filter_fields: [],
            defined_schema_fields: [],
            data_retention: 45,
          },
        },
      ],
      functions: [],
      alerts: [],
    },
  },
};
