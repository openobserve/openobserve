// Copyright 2023 OpenObserve Inc.
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

export default {
  stream_list: {
    list: [
      {
        name: "k8s_json",
        storage_type: "s3",
        stream_type: "logs",
        schema: [
          {
            name: "_timestamp",
            type: "Int64",
          },
          {
            name: "kubernetes.annotations.kubectl.kubernetes.io/default-container",
            type: "Utf8",
          },
          {
            name: "kubernetes.annotations.kubernetes.io/psp",
            type: "Utf8",
          },
          {
            name: "kubernetes.container_hash",
            type: "Utf8",
          },
          {
            name: "kubernetes.container_image",
            type: "Utf8",
          },
          {
            name: "kubernetes.container_name",
            type: "Utf8",
          },
          {
            name: "kubernetes.docker_id",
            type: "Utf8",
          },
          {
            name: "kubernetes.host",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.app.kubernetes.io/component",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.app.kubernetes.io/instance",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.app.kubernetes.io/managed-by",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.app.kubernetes.io/name",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.app.kubernetes.io/part-of",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.app.kubernetes.io/version",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.controller-revision-hash",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.operator.prometheus.io/name",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.operator.prometheus.io/shard",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.prometheus",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.statefulset.kubernetes.io/pod-name",
            type: "Utf8",
          },
          {
            name: "kubernetes.namespace_name",
            type: "Utf8",
          },
          {
            name: "kubernetes.pod_id",
            type: "Utf8",
          },
          {
            name: "kubernetes.pod_name",
            type: "Utf8",
          },
          {
            name: "log",
            type: "Utf8",
          },
          {
            name: "stream",
            type: "Utf8",
          },
          {
            name: "code",
            type: "Int64",
          },
          {
            name: "kubernetes.labels.app",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.pod-template-hash",
            type: "Utf8",
          },
          {
            name: "level",
            type: "Utf8",
          },
          {
            name: "message",
            type: "Utf8",
          },
          {
            name: "method",
            type: "Utf8",
          },
          {
            name: "took",
            type: "Int64",
          },
          {
            name: "kubernetes.labels.name",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.role",
            type: "Utf8",
          },
          {
            name: "kubernetes.annotations.prometheus.io/path",
            type: "Utf8",
          },
          {
            name: "kubernetes.annotations.prometheus.io/port",
            type: "Utf8",
          },
          {
            name: "kubernetes.annotations.prometheus.io/scrape",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.component",
            type: "Utf8",
          },
          {
            name: "kubernetes.labels.deploy",
            type: "Utf8",
          },
        ],
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
          index_fields: [],
          bloom_filter_fields: [],
          defined_schema_fields: [],
          data_retention: 45,
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
      index_fields: [],
      bloom_filter_fields: [],
      defined_schema_fields: [],
      data_retention: 45,
    },
  },
};
