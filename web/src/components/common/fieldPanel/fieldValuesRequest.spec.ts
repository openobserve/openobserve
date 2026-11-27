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
import { b64EncodeUnicode } from "@/utils/zincutils";
import { buildFieldValuesRequest } from "./fieldValuesRequest";

const base = {
  field: "level",
  stream: "app",
  streamType: "logs",
  startTime: 1000,
  endTime: 2000,
  size: 10,
  where: "",
};

describe("buildFieldValuesRequest", () => {
  it("asks for the whole stream when there is no filter, with no keyword and no offset", () => {
    expect(buildFieldValuesRequest(base)).toStrictEqual({
      fields: ["level"],
      size: 10,
      no_count: false,
      start_time: 1000,
      end_time: 2000,
      stream_name: "app",
      stream_type: "logs",
      sql: b64EncodeUnicode('SELECT * FROM "app"'),
      keyword: undefined,
      timeout: 30000,
      use_cache: true,
    });
  });

  it("scopes the values by the WHERE body and sends the keyword and offset when given", () => {
    const request = buildFieldValuesRequest({
      ...base,
      where: "code = 500",
      keyword: "err",
      from: 0,
      size: 20,
    });
    expect(request.sql).toBe(b64EncodeUnicode('SELECT * FROM "app" WHERE code = 500'));
    expect(request).toMatchObject({ keyword: "err", from: 0, size: 20 });
  });
});
