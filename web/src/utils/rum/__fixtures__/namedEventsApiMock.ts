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

import { vi, type Mock } from "vitest";

type Row = Record<string, unknown> & {
  id: string;
  app: string;
  name: string;
  version: number;
  updatedBy: string;
  updatedAt: number;
};
type Method =
  | "listEvents"
  | "getEvent"
  | "createEvent"
  | "updateEvent"
  | "deleteEvent"
  | "eventUsages"
  | "listFunnels"
  | "getFunnel"
  | "createFunnel"
  | "updateFunnel"
  | "deleteFunnel";
type Impl = (...args: never[]) => Promise<unknown>;

const CAP = 50;
const ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const events = new Map<string, Row>();
const funnels = new Map<string, Row>();
const state = { clock: 1_759_300_000_000, seq: 0, actor: "me@x.com" };

const fold = (name: string) => name.trim().toLowerCase();
const tick = () => ++state.clock;

/** A 27-character id in the server's KSUID alphabet, unique per mock run. */
export function mockId(n = ++state.seq): string {
  let out = "";
  for (let v = n; out.length < 27; v = Math.floor(v / 62)) out = ID_CHARS[v % 62] + out;
  return out;
}

export function apiFailure(status: number, body?: Record<string, unknown>): unknown {
  return { response: { status, data: body ?? {} } };
}

const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => {
  throw apiFailure(status, { code, message: code, ...extra });
};

const appRows = (table: Map<string, Row>, app: string) =>
  [...table.values()]
    .filter((r) => r.app === app)
    .sort((a, b) => fold(a.name).localeCompare(fold(b.name)));

const find = (table: Map<string, Row>, app: string, id: string) => {
  const row = table.get(id);
  return row && row.app === app ? row : fail(404, "not_found");
};

const nameTaken = (table: Map<string, Row>, app: string, name: string, except?: string) =>
  appRows(table, app).some((r) => r.id !== except && fold(r.name) === fold(name));

const stepIds = (def: unknown): string[] => {
  const s = (def as { s?: unknown[] })?.s ?? [];
  return [
    ...new Set(
      s.filter((x): x is [string, string] => Array.isArray(x) && x[0] === "e").map((x) => x[1]),
    ),
  ];
};

const usages = (app: string, id: string) =>
  appRows(funnels, app)
    .filter((f) => (f.eventIds as string[]).includes(id))
    .map((f) => ({ id: f.id, name: f.name }));

const write = (
  table: Map<string, Row>,
  app: string,
  body: Record<string, unknown>,
  prev?: Row,
): Row => {
  const at = tick();
  const row = {
    ...(prev ?? { id: mockId(), app, version: 0, createdBy: state.actor, createdAt: at }),
    ...body,
    version: (prev?.version ?? 0) + 1,
    updatedBy: state.actor,
    updatedAt: at,
  } as Row;
  table.set(row.id, row);
  return structuredClone(row);
};

const create = (table: Map<string, Row>, app: string, body: Record<string, unknown>) => {
  if (appRows(table, app).length >= CAP) fail(409, "limit_reached");
  if (nameTaken(table, app, body.name as string)) fail(409, "duplicate_name");
  return write(table, app, body);
};

const update = (
  table: Map<string, Row>,
  app: string,
  id: string,
  body: Record<string, unknown>,
) => {
  const prev = find(table, app, id);
  if (body.version !== prev.version)
    fail(409, "version_conflict", { current: structuredClone(prev) });
  if (nameTaken(table, app, body.name as string, id)) fail(409, "duplicate_name");
  const { version: _version, ...rest } = body;
  return write(table, app, rest, prev);
};

const funnelBody = (app: string, body: Record<string, unknown>, prev?: Row) => {
  const ids = stepIds(body.def);
  const kept = new Set((prev?.eventIds as string[] | undefined) ?? []);
  if (ids.some((id) => !kept.has(id) && events.get(id)?.app !== app)) fail(409, "unknown_event");
  return { ...body, eventIds: ids };
};

const impls: Record<Method, Impl> = {
  listEvents: async (_org: string, app: string) => ({
    data: { list: structuredClone(appRows(events, app)) },
  }),
  getEvent: async (_org: string, app: string, id: string) => ({
    data: structuredClone(find(events, app, id)),
  }),
  createEvent: async (_org: string, app: string, body: Record<string, unknown>) => ({
    status: 201,
    data: create(events, app, body),
  }),
  updateEvent: async (_org: string, app: string, id: string, body: Record<string, unknown>) => ({
    data: update(events, app, id, body),
  }),
  deleteEvent: async (_org: string, app: string, id: string, force = false) => {
    find(events, app, id);
    const used = usages(app, id);
    if (used.length && !force) fail(409, "event_in_use", { funnels: used });
    events.delete(id);
    return { status: 204, data: "" };
  },
  eventUsages: async (_org: string, app: string, id: string) => {
    find(events, app, id);
    return { data: { list: usages(app, id) } };
  },
  listFunnels: async (_org: string, app: string) => ({
    data: { list: structuredClone(appRows(funnels, app)) },
  }),
  getFunnel: async (_org: string, app: string, id: string) => ({
    data: structuredClone(find(funnels, app, id)),
  }),
  createFunnel: async (_org: string, app: string, body: Record<string, unknown>) => ({
    status: 201,
    data: create(funnels, app, funnelBody(app, body)),
  }),
  updateFunnel: async (_org: string, app: string, id: string, body: Record<string, unknown>) => {
    const prev = find(funnels, app, id);
    return { data: update(funnels, app, id, funnelBody(app, body, prev)) };
  },
  deleteFunnel: async (_org: string, app: string, id: string) => {
    find(funnels, app, id);
    funnels.delete(id);
    return { status: 204, data: "" };
  },
};

const service = Object.fromEntries(
  (Object.keys(impls) as Method[]).map((m) => [m, vi.fn(impls[m])]),
) as unknown as Record<Method, Mock<Impl>>;

const seedRow = (table: Map<string, Row>, app: string, fields: Record<string, unknown>): Row => {
  const at = tick();
  const row = {
    id: mockId(),
    app,
    version: 1,
    createdBy: "seed@x.com",
    createdAt: at,
    updatedBy: "seed@x.com",
    updatedAt: at,
    ...fields,
  } as unknown as Row;
  table.set(row.id, row);
  return structuredClone(row);
};

/** An in-memory, server-shaped stand-in for `@/services/rumProductAnalytics`, with per-call gates and failures. */
export const rumPaApiMock = {
  service,
  events,
  funnels,
  reset(): void {
    events.clear();
    funnels.clear();
    state.seq = 0;
    state.actor = "me@x.com";
    for (const m of Object.keys(impls) as Method[]) {
      service[m].mockReset();
      service[m].mockImplementation(impls[m]);
    }
  },
  /** Seeds a stored named event, as another user would have saved it. */
  seedEvent(app: string, name: string, fields: Record<string, unknown> = {}): Row {
    return seedRow(events, app, {
      name,
      rules: [{ t: "view", op: "eq", value: "/web/logs" }],
      ...fields,
    });
  },
  seedFunnel(
    app: string,
    name: string,
    def: Record<string, unknown>,
    fields: Record<string, unknown> = {},
  ): Row {
    return seedRow(funnels, app, {
      name,
      def,
      sql: 'SELECT 1 FROM "_rumdata"',
      eventIds: stepIds(def),
      ...fields,
    });
  },
  /** Changes a stored row as another user would, bumping its version. */
  touch(
    table: "events" | "funnels",
    id: string,
    patch: Record<string, unknown>,
    by = "other@x.com",
  ): Row {
    const map = table === "events" ? events : funnels;
    const prev = map.get(id)!;
    const at = tick();
    const row = { ...prev, ...patch, version: prev.version + 1, updatedBy: by, updatedAt: at };
    map.set(id, row);
    return structuredClone(row);
  },
  /** Holds the next call of `method` until the returned release runs. */
  gate(method: Method): () => void {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    service[method].mockImplementationOnce(async (...args: never[]) => {
      await held;
      return impls[method](...args);
    });
    return () => release();
  },
  /** Fails the next call of `method` with this status and error code. */
  failNext(
    method: Method,
    status: number,
    code?: string,
    extra: Record<string, unknown> = {},
  ): void {
    service[method].mockImplementationOnce(async () => {
      throw apiFailure(status, code ? { code, message: code, ...extra } : undefined);
    });
  },
  names(app: string): string[] {
    return appRows(events, app).map((r) => r.name);
  },
  bodies(
    method: "createEvent" | "updateEvent" | "createFunnel" | "updateFunnel",
  ): Record<string, unknown>[] {
    return service[method].mock.calls.map(
      (c) => (c as unknown[])[method.startsWith("create") ? 2 : 3] as Record<string, unknown>,
    );
  },
};
