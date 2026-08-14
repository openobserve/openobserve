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

import { describe, it, expect } from "vitest";
import {
  createRecordConverter,
  convertRecords,
  hasChangeFormatRecords,
} from "./sessionReplayChangeFormat";

// ChangeType ids (mirror the SDK).
const ADD_STRING = 0;
const ADD_NODE = 1;
const REMOVE_NODE = 2;
const ATTRIBUTE = 3;
const TEXT = 4;
const SCROLL_POSITION = 6;
const ADD_STYLESHEET = 7;
const ATTACHED_STYLESHEETS = 8;
const MEDIA_PLAYBACK_STATE = 9;

function fullSnapshot(data: any[]) {
  return { type: 2, format: 1, timestamp: 1000, data };
}

describe("sessionReplayChangeFormat", () => {
  describe("full snapshot conversion", () => {
    it("rebuilds a nested V1 node tree with correct ids and structure", () => {
      const record = fullSnapshot([
        [
          ADD_NODE,
          [null, "#document"],
          [1, "#doctype", "html", "", ""],
          [0, "HTML", ["lang", "en"]],
          [1, "HEAD"],
          [1, "STYLE"],
          [3, "BODY"],
          [1, "DIV", ["id", "a"]],
          [1, "#text", "hello"],
        ],
        [SCROLL_POSITION, [0, 3, 4], [6, 10, 20]],
        [ADD_STYLESHEET, [".x{color:red}"]],
        [ATTACHED_STYLESHEETS, [4, 0]],
      ]);

      const [out] = createRecordConverter().convert(record);

      // Record shape: classic FullSnapshot, format stripped.
      expect(out.type).toBe(2);
      expect(out.format).toBeUndefined();
      expect(out.timestamp).toBe(1000);
      expect(out.data.initialOffset).toEqual({ left: 3, top: 4 });

      const doc = out.data.node;
      expect(doc.type).toBe(0); // Document
      expect(doc.id).toBe(0);
      expect(doc.childNodes.map((n: any) => n.id)).toEqual([1, 2]);

      const [doctype, html] = doc.childNodes;
      expect(doctype.type).toBe(1);
      expect(doctype.name).toBe("html");

      expect(html.type).toBe(2);
      expect(html.tagName).toBe("html"); // lowercased
      expect(html.attributes).toEqual({ lang: "en" });
      expect(html.childNodes.map((n: any) => n.id)).toEqual([3, 5]); // head, body

      const [head, body] = html.childNodes;
      expect(head.tagName).toBe("head");
      const style = head.childNodes[0];
      expect(style.id).toBe(4);
      expect(style.tagName).toBe("style");
      // _cssText reconstructed from AddStyleSheet + AttachedStyleSheets.
      expect(style.attributes._cssText).toBe(".x{color:red}");

      const div = body.childNodes[0];
      expect(div.id).toBe(6);
      expect(div.attributes.id).toBe("a");
      // element scroll -> rr_scrollLeft/rr_scrollTop attributes.
      expect(div.attributes.rr_scrollLeft).toBe(10);
      expect(div.attributes.rr_scrollTop).toBe(20);

      const text = div.childNodes[0];
      expect(text.id).toBe(7);
      expect(text.type).toBe(3);
      expect(text.textContent).toBe("hello");
    });

    it("resolves string-table references and AddString changes", () => {
      const record = fullSnapshot([
        [ADD_STRING, "div", "id", "foo"], // table: 0=div,1=id,2=foo
        [ADD_NODE, [null, "#document"], [1, 0, [1, 2]]],
      ]);
      const [out] = createRecordConverter().convert(record);
      const div = out.data.node.childNodes[0];
      expect(div.tagName).toBe("div");
      expect(div.attributes).toEqual({ id: "foo" });
    });

    it("marks svg elements with isSVG and lowercases the tag", () => {
      const record = fullSnapshot([
        [ADD_NODE, [null, "#document"], [1, "svg>svg"], [1, "svg>PATH"]],
      ]);
      const [out] = createRecordConverter().convert(record);
      const svg = out.data.node.childNodes[0];
      expect(svg.tagName).toBe("svg");
      expect(svg.isSVG).toBe(true);
      const path = svg.childNodes[0];
      expect(path.tagName).toBe("path");
      expect(path.isSVG).toBe(true);
    });

    it("maps media playback state to rr_mediaState", () => {
      const record = fullSnapshot([
        [ADD_NODE, [null, "#document"], [1, "VIDEO"]],
        [MEDIA_PLAYBACK_STATE, [1, 1]], // paused
      ]);
      const [out] = createRecordConverter().convert(record);
      expect(out.data.node.childNodes[0].attributes.rr_mediaState).toBe("paused");
    });

    it("attaches adoptedStyleSheets to the document node", () => {
      const record = fullSnapshot([
        [ADD_NODE, [null, "#document"]],
        [ADD_STYLESHEET, [[".a{}", ".b{}"]]],
        [ATTACHED_STYLESHEETS, [0, 0]],
      ]);
      const [out] = createRecordConverter().convert(record);
      expect(out.data.node.adoptedStyleSheets).toEqual([{ cssRules: [".a{}", ".b{}"] }]);
    });
  });

  describe("incremental Change (type 12) conversion", () => {
    it("converts adds/removes/attributes/texts into a mutation record", () => {
      const converter = createRecordConverter();
      // Establish a document with body(1) containing div(2).
      converter.convert(
        fullSnapshot([[ADD_NODE, [null, "#document"], [1, "BODY"], [1, "DIV", ["id", "a"]]]]),
      );

      const change = {
        type: 12,
        timestamp: 2000,
        data: [
          [ADD_NODE, [1, "SPAN"]], // id3 appended to BODY(1): insertionPoint 3-... = 2 -> parent 1
          [REMOVE_NODE, 2], // remove the div
          [ATTRIBUTE, [1, ["class", "x"]]], // set body class
          [TEXT, [3, "hi"]],
        ],
      };
      // Fix the SPAN insertion point: appendChild to BODY(1) => id3 - 1 = 2.
      change.data[0] = [ADD_NODE, [2, "SPAN"]];

      const out = converter.convert(change);
      expect(out).toHaveLength(1);
      const mutation = out[0];
      expect(mutation.type).toBe(3);
      expect(mutation.data.source).toBe(0);

      expect(mutation.data.adds).toHaveLength(1);
      expect(mutation.data.adds[0].parentId).toBe(1);
      expect(mutation.data.adds[0].node.tagName).toBe("span");
      expect(mutation.data.adds[0].node.id).toBe(3);

      expect(mutation.data.removes).toEqual([{ id: 2, parentId: 1 }]);
      expect(mutation.data.attributes).toEqual([{ id: 1, attributes: { class: "x" } }]);
      expect(mutation.data.texts).toEqual([{ id: 3, value: "hi" }]);
    });

    it("emits scroll changes as separate incremental scroll records", () => {
      const converter = createRecordConverter();
      converter.convert(fullSnapshot([[ADD_NODE, [null, "#document"], [1, "BODY"]]]));
      const out = converter.convert({
        type: 12,
        timestamp: 3000,
        data: [[SCROLL_POSITION, [1, 5, 6]]],
      });
      expect(out).toEqual([
        {
          type: 3,
          timestamp: 3000,
          data: { source: 3, id: 1, x: 5, y: 6 },
        },
      ]);
    });

    it("treats attribute deletion (single-element mutation) as null", () => {
      const converter = createRecordConverter();
      converter.convert(
        fullSnapshot([[ADD_NODE, [null, "#document"], [1, "DIV", ["hidden", ""]]]]),
      );
      const out = converter.convert({
        type: 12,
        timestamp: 4000,
        data: [[ATTRIBUTE, [1, ["hidden"]]]],
      });
      expect(out[0].data.attributes).toEqual([{ id: 1, attributes: { hidden: null } }]);
    });
  });

  describe("passthrough + helpers", () => {
    it("returns classic records unchanged", () => {
      const meta = { type: 4, timestamp: 1, data: { width: 100, height: 200 } };
      expect(createRecordConverter().convert(meta)).toEqual([meta]);
    });

    it("hasChangeFormatRecords detects new-format records", () => {
      expect(hasChangeFormatRecords([{ type: 4 }, { type: 12, data: [] }])).toBe(true);
      expect(hasChangeFormatRecords([{ type: 2, format: 1, data: [] }])).toBe(true);
      expect(hasChangeFormatRecords([{ type: 2, data: { node: {} } }, { type: 3 }])).toBe(false);
    });

    it("convertRecords threads state and resets on each full snapshot", () => {
      const records = [
        fullSnapshot([[ADD_NODE, [null, "#document"], [1, "BODY"]]]),
        { type: 12, timestamp: 1, data: [[ATTRIBUTE, [1, ["a", "b"]]]] },
        // second full snapshot -> ids reset, so BODY is id1 again
        fullSnapshot([[ADD_NODE, [null, "#document"], [1, "BODY"]]]),
      ];
      const out = convertRecords(records);
      expect(out).toHaveLength(3);
      expect(out[0].data.node.childNodes[0].id).toBe(1);
      expect(out[1].data.attributes[0].id).toBe(1);
      expect(out[2].data.node.childNodes[0].id).toBe(1);
    });
  });
});
