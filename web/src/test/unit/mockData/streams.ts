export default {
  stream_list: {
    list: [
      {
        name: "k8s_json",
        storage_type: "s3",
        stream_type: "logs",
        stats: {
          doc_time_min: 1678448628630259,
          doc_time_max: 1678448628652947,
          doc_num: 400,
          file_num: 1,
          storage_size: 0.74,
          compressed_size: 0.03,
        },
        settings: {
          partition_keys: {},
          full_text_search_keys: [],
        },
      },
    ],
  },
  stream_details: {
    name: "k8s_json",
    storage_type: "s3",
    stream_type: "logs",
    stats: {
      doc_time_min: 1678448628630259,
      doc_time_max: 1678448628652947,
      doc_num: 400,
      file_num: 1,
      storage_size: 0.74,
      compressed_size: 0.03,
    },
    schema: [
      {
        name: "_timestamp",
        type: "Int64",
      },
      {
        name: "kubernetes.container_hash",
        type: "Utf8",
      },
      {
        name: "log",
        type: "Utf8",
      },
      {
        name: "message",
        type: "Utf8",
      },
    ],
    settings: {
      partition_keys: {},
      full_text_search_keys: [],
    },
  },
};
