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

// Formatted span node in the shape produced by TraceDetails getFormattedSpan,
// as it appears inside traceTree (children nested under `spans`).
const treeSpan = (
  spanId: string,
  serviceName: string,
  parentId: string,
  spans: any[],
  durationMs: number,
) => ({
  spanId,
  span_id: spanId,
  serviceName,
  resolvedIdentity: serviceName,
  parentId,
  durationMs,
  spans,
  operationName: `${serviceName}:op`,
  operation_name: `${serviceName}:op`,
  start_time: 1755853746625720300,
  spanStatus: "UNSET",
});

// Trace-tree fixtures for pattern-tree (Trace Graph) tests. Each fixture is
// the `traceTree` array TraceDetails builds — one entry per root span.
export const patternTraceTrees = {
  // Baseline: single root, root service calls one downstream service
  singleRoot: [
    treeSpan("a1", "alertmanager", "", [treeSpan("q1", "querier", "a1", [], 80)], 100),
  ],
  // Two root spans with distinct services, each with its own downstream call
  multiRootDistinctServices: [
    treeSpan("a1", "alertmanager", "", [treeSpan("q1", "querier", "a1", [], 80)], 100),
    treeSpan("i1", "ingester", "", [treeSpan("c1", "compactor", "i1", [], 40)], 60),
  ],
  // Two root spans that belong to the same service, no cross-service calls
  multiRootSameService: [
    treeSpan("a1", "alertmanager", "", [], 100),
    treeSpan("a2", "alertmanager", "", [], 50),
  ],
  // Two root spans whose services call each other (cyclic service relationship)
  multiRootCyclicServices: [
    treeSpan("a1", "alertmanager", "", [treeSpan("q1", "querier", "a1", [], 80)], 100),
    treeSpan("q2", "querier", "", [treeSpan("a2", "alertmanager", "q2", [], 30)], 50),
  ],
  // Root span calling another service, plus an orphan root of that same child service
  multiRootOrphanChildService: [
    treeSpan("a1", "alertmanager", "", [treeSpan("q1", "querier", "a1", [], 80)], 100),
    treeSpan("q2", "querier", "missing-parent", [], 30),
  ],
  // Single root span, single service, no relationships at all
  singleServiceOnly: [treeSpan("a1", "alertmanager", "", [], 100)],
};

export default {
  tracesDetails: {
    traceMeta: {
      hits: [
        [
          {
            duration: 295986,
            end_time: 1755853746921707300,
            first_event: {
              _timestamp: 1755853746625720,
              duration: 295986,
              end_time: 1755853746921707300,
              operation_name: "service:alerts:evaluate_scheduled",
              service_name: "alertmanager",
              span_status: "UNSET",
              start_time: 1755853746625720300,
              trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
            },
            service_name: [
              {
                count: 4,
                service_name: "alertmanager",
              },
              {
                count: 31,
                service_name: "querier",
              },
              {
                count: 14,
                service_name: "ingester",
              },
            ],
            spans: [49, 0],
            start_time: 1755853746625720300,
            trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
          },
        ],
      ],
    },
    traceSpans: {
      hits: [
        {
          _timestamp: 1755853746625720,
          busy_ns: "657334",
          code_filepath: "src/service/alerts/mod.rs",
          code_lineno: "114",
          code_namespace: "openobserve::service::alerts",
          duration: 295986,
          end_time: 1755853746921707300,
          events: "[]",
          flags: 1,
          idle_ns: "295329796",
          links: "[]",
          operation_name: "service:alerts:evaluate_scheduled",
          reference_parent_span_id: "d4b07e603e2fa32f",
          reference_parent_trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
          reference_ref_type: "ChildOf",
          service_name: "alertmanager",
          service_service_instance: "dev2-openobserve-alertmanager-0",
          service_service_version: "v0.15.0-rc5",
          span_id: "6b080023171f5767",
          span_kind: "1",
          span_status: "UNSET",
          start_time: 1755853746625720300,
          status_code: 0,
          status_message: "",
          thread_id: "5",
          thread_name: "job_runtime",
          trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
          _end_time_ns: "1755853746921707300",
          _start_time_ns: "1755853746625720300",
        },
        {
          _timestamp: 1755853746625779,
          busy_ns: "648454",
          code_filepath: "src/service/search/grpc_search.rs",
          code_lineno: "31",
          code_namespace: "openobserve::service::search::grpc_search",
          duration: 295923,
          end_time: 1755853746921702400,
          events: "[]",
          flags: 1,
          idle_ns: "295275675",
          links: "[]",
          operation_name: "service:search:grpc_search",
          reference_parent_span_id: "6b080023171f5767",
          reference_parent_trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
          reference_ref_type: "ChildOf",
          service_name: "alertmanager",
          service_service_instance: "dev2-openobserve-alertmanager-0",
          service_service_version: "v0.15.0-rc5",
          span_id: "d427ced59acf399b",
          span_kind: "1",
          span_status: "UNSET",
          start_time: 1755853746625779000,
          status_code: 0,
          status_message: "",
          thread_id: "5",
          thread_name: "job_runtime",
          trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
          _end_time_ns: "1755853746921702400",
          _start_time_ns: "1755853746625779000",
        },
        {
          _timestamp: 1755853746625790,
          busy_ns: "320271",
          code_filepath: "src/service/search/grpc_search.rs",
          code_lineno: "56",
          code_namespace: "openobserve::service::search::grpc_search",
          duration: 295178,
          end_time: 1755853746920969200,
          events: "[]",
          flags: 1,
          idle_ns: "294858953",
          links: "[]",
          node_addr: "http://10.1.105.53:5081",
          node_id: "5",
          operation_name: "service:search:cluster:grpc_search",
          reference_parent_span_id: "d427ced59acf399b",
          reference_parent_trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
          reference_ref_type: "ChildOf",
          service_name: "alertmanager",
          service_service_instance: "dev2-openobserve-alertmanager-0",
          service_service_version: "v0.15.0-rc5",
          span_id: "bf6bde74cdcc245f",
          span_kind: "1",
          span_status: "UNSET",
          start_time: 1755853746625790200,
          status_code: 0,
          status_message: "",
          thread_id: "5",
          thread_name: "job_runtime",
          trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
          _end_time_ns: "1755853746920969200",
          _start_time_ns: "1755853746625790200",
        },
      ],
    },
  },
};
