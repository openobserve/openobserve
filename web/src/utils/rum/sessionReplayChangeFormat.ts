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

/**
 * Session Replay "Change format" -> classic (rrweb V1) record converter.
 *
 * The browser SDK v7 encodes session-replay snapshots as a compact stream of
 * "changes" instead of the classic rrweb-style tree:
 *
 *   - FullSnapshot record (type 2) carries `format: 1` and `data: Change[]`.
 *   - DOM mutations are a Change record (type 12, `data: Change[]`).
 *
 * `@openobserve/rrweb-player` only understands the classic V1 format, so this module
 * converts the new records back into the V1 records the player expects.
 *
 * Key facts about the encoding:
 *   - Node ids are NOT stored in the stream. They are assigned by a sequential counter
 *     (starting at 0) as nodes are serialized top-down in document order. The counter,
 *     the string table and the stylesheet table are all reset before EVERY full snapshot
 *     (`scope.resetIds()`), so decoding stays deterministic as long as records are
 *     processed in order and each snapshot begins with a FullSnapshot record.
 *   - Strings are de-duplicated via a string table; `AddString` changes append to it and
 *     other changes reference entries by numeric index.
 *   - An `AddNode` change is `[insertionPoint, nodeName, ...attributeAssignments]`. The
 *     insertion point encodes position relative to already-assigned ids:
 *        null  -> root node (the #document)
 *        > 0   -> appendChild to node (id - insertionPoint)
 *        0     -> insert right after the previously-added node (id - 1)
 *        < 0   -> insert before node (id + insertionPoint)
 */

 

// ---------------------------------------------------------------------------
// Constants (mirror packages/browser-rum sessionReplayConstants.ts)
// ---------------------------------------------------------------------------

const RecordType = {
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Change: 12,
} as const;

const SnapshotFormatChange = 1;

const NodeType = {
  Document: 0,
  DocumentType: 1,
  Element: 2,
  Text: 3,
  CDATA: 4,
  DocumentFragment: 11,
} as const;

const ChangeType = {
  AddString: 0,
  AddNode: 1,
  RemoveNode: 2,
  Attribute: 3,
  Text: 4,
  Size: 5,
  ScrollPosition: 6,
  AddStyleSheet: 7,
  AttachedStyleSheets: 8,
  MediaPlaybackState: 9,
  VisualViewport: 10,
} as const;

const IncrementalSource = {
  Mutation: 0,
  Scroll: 3,
  MediaInteraction: 7,
} as const;

const PlaybackState = {
  Playing: 0,
  Paused: 1,
} as const;

const MediaInteractionType = {
  Play: 0,
  Pause: 1,
} as const;

// A single record is `type-8` VisualViewport; keep in sync with VideoPlayer handling.
const VISUAL_VIEWPORT_RECORD_TYPE = 8;

// ---------------------------------------------------------------------------
// getValidTagName — normalize a tag name to a valid HTML tag name
// ---------------------------------------------------------------------------

const TAG_NAME_REGEX = /[^a-z1-6-_]/;

function getValidTagName(tagName: string): string {
  const processedTagName = tagName.toLowerCase().trim();
  if (TAG_NAME_REGEX.test(processedTagName)) {
    return "div";
  }
  return processedTagName;
}

// ---------------------------------------------------------------------------
// Internal decoder state
// ---------------------------------------------------------------------------

interface TrackedNode {
  // The serialized node object (mutated in place as children/attributes are added).
  node: any;
  parentId: number; // -1 for the root document node
}

interface StoredStyleSheet {
  rules: string | string[];
  media?: string[];
  disabled?: boolean;
}

export interface RecordConverter {
  /**
   * Convert one raw record. Returns an array of classic records (usually one, but a
   * single Change record can expand into a mutation plus scroll/media/viewport records).
   * Records that are already in the classic format are returned unchanged.
   */
  convert(record: any): any[];
}

export function createRecordConverter(): RecordConverter {
  let stringTable: string[] = [];
  let nextNodeId = 0;
  let nodes = new Map<number, TrackedNode>();
  let styleSheets = new Map<number, StoredStyleSheet>();
  let nextStyleSheetId = 0;

  function reset() {
    stringTable = [];
    nextNodeId = 0;
    nodes = new Map();
    styleSheets = new Map();
    nextStyleSheetId = 0;
  }

  // Resolve a value that may be a string literal or a numeric string-table reference.
  function decodeStr(value: string | number): string {
    if (typeof value === "number") {
      return stringTable[value] ?? "";
    }
    return value;
  }

  function rulesToCssText(rules: string | string[]): string {
    return Array.isArray(rules) ? rules.join("") : rules;
  }

  function rulesToArray(rules: string | string[]): string[] {
    return Array.isArray(rules) ? rules : [rules];
  }

  // Build a serialized node (without children) from an AddNode change tuple.
  function buildNode(change: any[], id: number): any {
    const name = decodeStr(change[1]);
    switch (name) {
      case "#document":
        return { type: NodeType.Document, childNodes: [], id };
      case "#document-fragment":
        return {
          type: NodeType.DocumentFragment,
          childNodes: [],
          isShadowRoot: false,
          id,
        };
      case "#shadow-root":
        return {
          type: NodeType.DocumentFragment,
          childNodes: [],
          isShadowRoot: true,
          id,
        };
      case "#doctype":
        return {
          type: NodeType.DocumentType,
          name: decodeStr(change[2]),
          publicId: decodeStr(change[3]),
          systemId: decodeStr(change[4]),
          id,
        };
      case "#text":
        return { type: NodeType.Text, textContent: decodeStr(change[2]), id };
      case "#cdata-section":
        return { type: NodeType.CDATA, textContent: "", id };
      default: {
        // Element node. SVG elements are encoded as "svg>tagName".
        let rawName = name;
        let isSVG: true | undefined;
        if (rawName.indexOf("svg>") === 0) {
          isSVG = true;
          rawName = rawName.slice(4);
        }
        const attributes: Record<string, string> = {};
        for (let i = 2; i < change.length; i++) {
          const pair = change[i];
          attributes[decodeStr(pair[0])] = decodeStr(pair[1]);
        }
        const node: any = {
          type: NodeType.Element,
          tagName: getValidTagName(rawName),
          attributes,
          childNodes: [],
          id,
        };
        if (isSVG) node.isSVG = true;
        return node;
      }
    }
  }

  // Resolve where a node with the given id and insertion point sits in the tree.
  // Returns { parentId, index } where index is the position in parent's childNodes,
  // or null for the root node.
  function resolveInsertion(
    id: number,
    insertionPoint: number | null,
  ): { parentId: number; index: number } | null {
    if (insertionPoint === null) {
      return null; // root document node
    }
    if (insertionPoint > 0) {
      // appendChild to (id - insertionPoint)
      const parentId = id - insertionPoint;
      const parent = nodes.get(parentId);
      const index = parent ? parent.node.childNodes.length : 0;
      return { parentId, index };
    }
    if (insertionPoint === 0) {
      // insert right after previously-added node (id - 1)
      const prevSiblingId = id - 1;
      const prevSibling = nodes.get(prevSiblingId);
      const parentId = prevSibling ? prevSibling.parentId : -1;
      const parent = nodes.get(parentId);
      if (!parent) return { parentId, index: 0 };
      const idx = parent.node.childNodes.findIndex(
        (c: any) => c.id === prevSiblingId,
      );
      return { parentId, index: idx === -1 ? parent.node.childNodes.length : idx + 1 };
    }
    // insertionPoint < 0 : insert before (id + insertionPoint)
    const nextSiblingId = id + insertionPoint;
    const nextSibling = nodes.get(nextSiblingId);
    const parentId = nextSibling ? nextSibling.parentId : -1;
    const parent = nodes.get(parentId);
    if (!parent) return { parentId, index: 0 };
    const idx = parent.node.childNodes.findIndex(
      (c: any) => c.id === nextSiblingId,
    );
    return { parentId, index: idx === -1 ? parent.node.childNodes.length : idx };
  }

  function applyStyleSheetToNode(nodeId: number, sheetIds: number[]) {
    const tracked = nodes.get(nodeId);
    if (!tracked) return;
    const node = tracked.node;
    if (node.type === NodeType.Element) {
      // <link> / <style>: single sheet -> _cssText attribute.
      const sheet = styleSheets.get(sheetIds[0]);
      if (sheet) {
        node.attributes._cssText = rulesToCssText(sheet.rules);
      }
    } else if (
      node.type === NodeType.Document ||
      node.type === NodeType.DocumentFragment
    ) {
      // #document / #shadow-root: adoptedStyleSheets array.
      node.adoptedStyleSheets = sheetIds.map((sid) => {
        const sheet = styleSheets.get(sid);
        const out: any = { cssRules: sheet ? rulesToArray(sheet.rules) : [] };
        if (sheet?.media && sheet.media.length) out.media = sheet.media;
        if (sheet?.disabled) out.disabled = sheet.disabled;
        return out;
      });
    }
  }

  function ingestAddStyleSheet(change: any) {
    // change: [rules] | [rules, media] | [rules, media, disabled]
    const rawRules = change[0];
    const rules: string | string[] = Array.isArray(rawRules)
      ? rawRules.map((r: any) => decodeStr(r))
      : decodeStr(rawRules);
    const stored: StoredStyleSheet = { rules };
    if (change.length >= 2 && Array.isArray(change[1])) {
      stored.media = change[1].map((m: any) => decodeStr(m));
    }
    if (change.length >= 3) {
      stored.disabled = change[2];
    }
    styleSheets.set(nextStyleSheetId++, stored);
  }

  // ---- Full snapshot (type 2, format 1) -> classic FullSnapshot ------------

  function convertFullSnapshot(record: any): any {
    reset();

    let documentNode: any = null;
    let initialOffset = { left: 0, top: 0 };

    for (const group of record.data as any[]) {
      const changeType = group[0];
      switch (changeType) {
        case ChangeType.AddString:
          for (let i = 1; i < group.length; i++) {
            stringTable.push(group[i] as string);
          }
          break;

        case ChangeType.AddNode:
          for (let i = 1; i < group.length; i++) {
            const change = group[i];
            const id = nextNodeId++;
            const node = buildNode(change, id);
            const placement = resolveInsertion(id, change[0]);
            if (placement === null) {
              documentNode = node;
              nodes.set(id, { node, parentId: -1 });
            } else {
              const parent = nodes.get(placement.parentId);
              if (parent) {
                parent.node.childNodes.splice(placement.index, 0, node);
              }
              nodes.set(id, { node, parentId: placement.parentId });
            }
          }
          break;

        case ChangeType.ScrollPosition:
          for (let i = 1; i < group.length; i++) {
            const [nodeId, x, y] = group[i];
            if (nodeId === 0) {
              initialOffset = { left: x, top: y };
            } else {
              const tracked = nodes.get(nodeId);
              if (tracked && tracked.node.attributes) {
                if (x) tracked.node.attributes.rr_scrollLeft = x;
                if (y) tracked.node.attributes.rr_scrollTop = y;
              }
            }
          }
          break;

        case ChangeType.Size:
          for (let i = 1; i < group.length; i++) {
            const [nodeId, w, h] = group[i];
            const tracked = nodes.get(nodeId);
            if (tracked && tracked.node.attributes) {
              tracked.node.attributes.rr_width = `${w}px`;
              tracked.node.attributes.rr_height = `${h}px`;
            }
          }
          break;

        case ChangeType.MediaPlaybackState:
          for (let i = 1; i < group.length; i++) {
            const [nodeId, state] = group[i];
            const tracked = nodes.get(nodeId);
            if (tracked && tracked.node.attributes) {
              tracked.node.attributes.rr_mediaState =
                state === PlaybackState.Playing ? "played" : "paused";
            }
          }
          break;

        case ChangeType.AddStyleSheet:
          for (let i = 1; i < group.length; i++) {
            ingestAddStyleSheet(group[i]);
          }
          break;

        case ChangeType.AttachedStyleSheets:
          for (let i = 1; i < group.length; i++) {
            const attach = group[i];
            applyStyleSheetToNode(attach[0], attach.slice(1));
          }
          break;

        default:
          // Attribute / Text / RemoveNode / VisualViewport are not expected inside a
          // full snapshot; ignore them here (handled in the incremental path).
          break;
      }
    }

    const out: any = { ...record };
    delete out.format;
    out.type = RecordType.FullSnapshot;
    out.data = {
      node: documentNode ?? { type: NodeType.Document, childNodes: [], id: 0 },
      initialOffset,
    };
    return out;
  }

  // ---- Change record (type 12) -> classic IncrementalSnapshot(s) -----------

  function convertChange(record: any): any[] {
    const timestamp = record.timestamp;
    const adds: any[] = [];
    const removes: any[] = [];
    const attributes: any[] = [];
    const texts: any[] = [];
    const extraRecords: any[] = [];

    for (const group of record.data as any[]) {
      const changeType = group[0];
      switch (changeType) {
        case ChangeType.AddString:
          for (let i = 1; i < group.length; i++) {
            stringTable.push(group[i] as string);
          }
          break;

        case ChangeType.AddNode:
          for (let i = 1; i < group.length; i++) {
            const change = group[i];
            const id = nextNodeId++;
            const node = buildNode(change, id);
            const placement = resolveInsertion(id, change[0]);
            let parentId = -1;
            let nextId: number | null = null;
            if (placement !== null) {
              parentId = placement.parentId;
              const parent = nodes.get(parentId);
              if (parent) {
                const sibling = parent.node.childNodes[placement.index];
                nextId = sibling ? sibling.id : null;
                parent.node.childNodes.splice(placement.index, 0, node);
              }
            }
            nodes.set(id, { node, parentId });
            // Emit the node with empty children; descendants arrive as their own adds.
            const emitted = { ...node, childNodes: [] };
            adds.push({ parentId, nextId, node: emitted });
          }
          break;

        case ChangeType.RemoveNode:
          for (let i = 1; i < group.length; i++) {
            const nodeId = group[i];
            const tracked = nodes.get(nodeId);
            const parentId = tracked ? tracked.parentId : -1;
            removes.push({ id: nodeId, parentId });
            if (tracked) {
              const parent = nodes.get(parentId);
              if (parent) {
                const idx = parent.node.childNodes.findIndex(
                  (c: any) => c.id === nodeId,
                );
                if (idx !== -1) parent.node.childNodes.splice(idx, 1);
              }
              nodes.delete(nodeId);
            }
          }
          break;

        case ChangeType.Attribute:
          for (let i = 1; i < group.length; i++) {
            const change = group[i];
            const nodeId = change[0];
            const attrs: Record<string, string | null> = {};
            for (let j = 1; j < change.length; j++) {
              const mutation = change[j];
              const attrName = decodeStr(mutation[0]);
              // length 1 => deletion (null), length 2 => assignment
              const value = mutation.length === 1 ? null : decodeStr(mutation[1]);
              attrs[attrName] = value;
              const tracked = nodes.get(nodeId);
              if (tracked && tracked.node.attributes) {
                if (value === null) delete tracked.node.attributes[attrName];
                else tracked.node.attributes[attrName] = value;
              }
            }
            attributes.push({ id: nodeId, attributes: attrs });
          }
          break;

        case ChangeType.Text:
          for (let i = 1; i < group.length; i++) {
            const [nodeId, value] = group[i];
            const text = decodeStr(value);
            texts.push({ id: nodeId, value: text });
            const tracked = nodes.get(nodeId);
            if (tracked) tracked.node.textContent = text;
          }
          break;

        case ChangeType.Size:
          for (let i = 1; i < group.length; i++) {
            const [nodeId, w, h] = group[i];
            attributes.push({
              id: nodeId,
              attributes: { rr_width: `${w}px`, rr_height: `${h}px` },
            });
          }
          break;

        case ChangeType.ScrollPosition:
          for (let i = 1; i < group.length; i++) {
            const [nodeId, x, y] = group[i];
            extraRecords.push({
              type: RecordType.IncrementalSnapshot,
              timestamp,
              data: { source: IncrementalSource.Scroll, id: nodeId, x, y },
            });
          }
          break;

        case ChangeType.MediaPlaybackState:
          for (let i = 1; i < group.length; i++) {
            const [nodeId, state] = group[i];
            extraRecords.push({
              type: RecordType.IncrementalSnapshot,
              timestamp,
              data: {
                source: IncrementalSource.MediaInteraction,
                id: nodeId,
                type:
                  state === PlaybackState.Playing
                    ? MediaInteractionType.Play
                    : MediaInteractionType.Pause,
              },
            });
          }
          break;

        case ChangeType.AddStyleSheet:
          for (let i = 1; i < group.length; i++) {
            ingestAddStyleSheet(group[i]);
          }
          break;

        case ChangeType.AttachedStyleSheets:
          for (let i = 1; i < group.length; i++) {
            const attach = group[i];
            const nodeId = attach[0];
            const sheetIds = attach.slice(1);
            const tracked = nodes.get(nodeId);
            if (tracked && tracked.node.type === NodeType.Element) {
              const sheet = styleSheets.get(sheetIds[0]);
              if (sheet) {
                attributes.push({
                  id: nodeId,
                  attributes: { _cssText: rulesToCssText(sheet.rules) },
                });
              }
            } else {
              applyStyleSheetToNode(nodeId, sheetIds);
            }
          }
          break;

        case ChangeType.VisualViewport:
          for (let i = 1; i < group.length; i++) {
            const v = group[i];
            extraRecords.push({
              type: VISUAL_VIEWPORT_RECORD_TYPE,
              timestamp,
              data: {
                offsetLeft: v[0],
                offsetTop: v[1],
                pageLeft: v[2],
                pageTop: v[3],
                width: v[4],
                height: v[5],
                scale: v[6],
              },
            });
          }
          break;

        default:
          break;
      }
    }

    const result: any[] = [];
    if (adds.length || removes.length || attributes.length || texts.length) {
      result.push({
        type: RecordType.IncrementalSnapshot,
        timestamp,
        data: {
          source: IncrementalSource.Mutation,
          adds,
          removes,
          attributes,
          texts,
        },
      });
    }
    result.push(...extraRecords);
    return result;
  }

  return {
    convert(record: any): any[] {
      if (
        record &&
        record.type === RecordType.FullSnapshot &&
        record.format === SnapshotFormatChange &&
        Array.isArray(record.data)
      ) {
        return [convertFullSnapshot(record)];
      }
      if (record && record.type === RecordType.Change) {
        return convertChange(record);
      }
      // Already classic (or a passthrough record like Meta/Focus/type-3/type-8).
      return [record];
    },
  };
}

/**
 * Convenience helper: convert an ordered list of records (e.g. one segment's records)
 * into classic records. State (node ids, string table) is threaded across the list and
 * reset on each full snapshot, matching the SDK's serialization scope.
 */
export function convertRecords(records: any[]): any[] {
  const converter = createRecordConverter();
  const out: any[] = [];
  for (const record of records) {
    out.push(...converter.convert(record));
  }
  return out;
}

/**
 * Whether any record in the list uses the new Change format. Cheap guard so callers can
 * skip conversion entirely for legacy data.
 */
export function hasChangeFormatRecords(records: any[]): boolean {
  return records.some(
    (r) =>
      r &&
      (r.type === RecordType.Change ||
        (r.type === RecordType.FullSnapshot && r.format === SnapshotFormatChange)),
  );
}
