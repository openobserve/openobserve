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
  search: {
    took: 75,
    hits: [
      {
        _timestamp: 1680246906644637,
        kubernetes_annotations_kubernetes_io_psp: "eks.privileged",
        kubernetes_container_hash:
          "058694856476.dkr.ecr.us-west-2.amazonaws.com/ziox@sha256:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589",
        kubernetes_container_image:
          "058694856476.dkr.ecr.us-west-2.amazonaws.com/ziox:v0.0.3",
        kubernetes_container_name: "ziox",
        kubernetes_docker_id:
          "56510ea4003f201fa7913c18d7c8dc639c576e5d1c4bbf0ead911d2d68ae8f31",
        kubernetes_host: "ip-10-2-56-221.us-east-2.compute.internal",
        kubernetes_labels_app: "ziox",
        kubernetes_labels_name: "ziox-querier",
        kubernetes_labels_pod_template_hash: "595748494c",
        kubernetes_labels_role: "querier",
        kubernetes_namespace_name: "ziox",
        kubernetes_pod_id: "810e7dbc-fb09-4a8f-9108-6b8785754af9",
        kubernetes_pod_name: "ziox-querier-595748494c-7xqlg",
        log: '[2022-12-27T14:12:29Z INFO  openobserve::service::search::datafusion] search file: Bhargav_organization_29/logs/default/2022/12/23/12/7012038228660338688.parquet, need add columns: ["from"]',
        stream: "stderr",
      },
      {
        _timestamp: 1680246906644599,
        kubernetes_annotations_kubernetes_io_psp: "eks.privileged",
        kubernetes_container_hash:
          "058694856476.dkr.ecr.us-west-2.amazonaws.com/ziox@sha256:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589",
        kubernetes_container_image:
          "058694856476.dkr.ecr.us-west-2.amazonaws.com/ziox:v0.0.3",
        kubernetes_container_name: "ziox",
        kubernetes_docker_id:
          "56510ea4003f201fa7913c18d7c8dc639c576e5d1c4bbf0ead911d2d68ae8f31",
        kubernetes_host: "ip-10-2-56-221.us-east-2.compute.internal",
        kubernetes_labels_app: "ziox",
        kubernetes_labels_name: "ziox-querier",
        kubernetes_labels_pod_template_hash: "595748494c",
        kubernetes_labels_role: "querier",
        kubernetes_namespace_name: "ziox",
        kubernetes_pod_id: "810e7dbc-fb09-4a8f-9108-6b8785754af9",
        kubernetes_pod_name: "ziox-querier-595748494c-7xqlg",
        log: "[2022-12-27T14:12:29Z INFO  aws_config::default_provider::credentials] provide_credentials; provider=default_chain",
        stream: "stderr",
      },
    ],
    aggs: {
      histogram: [
        {
          key: "2023-03-31T07:00:00",
          num: 30540,
        },
      ],
    },
    total: 30540,
    from: 0,
    size: 150,
    scan_size: 55,
  },
};
