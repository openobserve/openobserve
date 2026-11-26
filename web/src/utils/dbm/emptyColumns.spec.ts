import { describe, expect, it } from "vitest";

import { emptyColumnIds } from "@/utils/dbm/emptyColumns";

type Row = { a: number | null; b: string };
const accessors = { a: (r: Row) => r.a, b: (r: Row) => r.b };

describe("emptyColumnIds", () => {
  it("hides nothing for no rows", () => {
    expect(emptyColumnIds<Row>([], accessors)).toEqual([]);
  });

  it("lists columns that are null, undefined, blank or a dash on every row", () => {
    expect(
      emptyColumnIds<Row>(
        [
          { a: null, b: "" },
          { a: null, b: "—" },
        ],
        accessors,
      ),
    ).toEqual(["a", "b"]);
  });

  it("keeps a column as soon as one row has a value, and treats 0 as a value", () => {
    expect(
      emptyColumnIds<Row>(
        [
          { a: null, b: "" },
          { a: 0, b: "" },
        ],
        accessors,
      ),
    ).toEqual(["b"]);
  });
});
