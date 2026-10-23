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
import {
  HTTP_HEADER_ALLOWLIST,
  HTTP_REQUEST_PAYLOAD_FIELDS,
  buildHttpRequestSample,
  httpQueryKeys,
  httpRequestPayloadFields,
  isHttpRequestInput,
} from "./httpRequestSample";

describe("buildHttpRequestSample", () => {
  it("the sample carries trigger_source http", () => {
    const sample = buildHttpRequestSample() as any[];

    expect(sample).toHaveLength(1);
    expect(sample[0].meta).toMatchObject({
      event_type: "webhook",
      trigger_source: "http",
      query: {},
      headers: { "content-type": "application/json" },
    });
    expect(typeof sample[0].meta.trigger_id).toBe("string");
    expect(typeof sample[0].meta.run_id).toBe("string");
    expect(Number.isInteger(sample[0].meta.received_at)).toBe(true);
    expect(String(sample[0].meta.received_at)).toHaveLength(16);
    expect(Array.isArray(sample[0].data)).toBe(true);
    expect(sample[0].data.length).toBeGreaterThan(0);
  });

  it("takes the trigger id and the body rows it is given", () => {
    const [first] = buildHttpRequestSample({ trigger_id: "test", data: [{ a: 1 }] }) as any[];

    expect(first.meta.trigger_id).toBe("test");
    expect(first.data).toEqual([{ a: 1 }]);
  });

  it("returns a fresh copy every call", () => {
    const a = buildHttpRequestSample() as any[];
    a[0].meta.headers.extra = "x";

    expect((buildHttpRequestSample() as any[])[0].meta.headers.extra).toBeUndefined();
  });
});

describe("HTTP_REQUEST_PAYLOAD_FIELDS", () => {
  it("the field list has no data fields", () => {
    const values = HTTP_REQUEST_PAYLOAD_FIELDS.map((f) => f.value);

    expect(values.some((v) => v.startsWith("data"))).toBe(false);
    expect(values).toEqual(
      expect.arrayContaining(["meta_trigger_source", "meta_event_type", "meta_trigger_id"]),
    );
  });

  it("offers every allowlisted header as meta.headers.<name>", () => {
    expect(HTTP_HEADER_ALLOWLIST).toHaveLength(14);
    for (const name of HTTP_HEADER_ALLOWLIST) {
      expect(HTTP_REQUEST_PAYLOAD_FIELDS.map((f) => String(f.label))).toContain(
        `meta.headers.${name}`,
      );
    }
    expect(HTTP_HEADER_ALLOWLIST).not.toContain("authorization");
  });

  it("query keys become meta.query fields", () => {
    const fields = httpRequestPayloadFields(["env", "region"]);

    expect(fields.slice(-2)).toEqual([
      { label: "meta.query.env", value: "meta_query_env", type: "Utf8" },
      { label: "meta.query.region", value: "meta_query_region", type: "Utf8" },
    ]);
    expect(fields.slice(0, HTTP_REQUEST_PAYLOAD_FIELDS.length)).toEqual(
      HTTP_REQUEST_PAYLOAD_FIELDS,
    );
  });
});

describe("reading an HTTP request input", () => {
  const http = JSON.stringify([
    { meta: { trigger_source: "http", query: { env: ["a", "b"], region: "eu" } }, data: [] },
  ]);

  it("httpQueryKeys lists the query keys of an HTTP input and nothing else", () => {
    expect(httpQueryKeys(http)).toEqual(["env", "region"]);
    expect(httpQueryKeys(JSON.stringify(buildHttpRequestSample()))).toEqual([]);
    expect(httpQueryKeys(JSON.stringify([{ meta: { query: { a: 1 } } }]))).toEqual([]);
    expect(httpQueryKeys("not json")).toEqual([]);
    expect(httpQueryKeys(undefined)).toEqual([]);
  });

  it("isHttpRequestInput is true only for records stamped trigger_source http", () => {
    expect(isHttpRequestInput(http)).toBe(true);
    expect(isHttpRequestInput(JSON.stringify([{ meta: { alert_name: "x" } }]))).toBe(false);
    expect(isHttpRequestInput("{")).toBe(false);
  });
});
