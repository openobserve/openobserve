import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDbmContextProvider, type DbmContextInput } from "./dbmContextProvider";

const store = { state: { selectedOrganization: { identifier: "org-prod" } } };

const input = (over: Partial<DbmContextInput> = {}): DbmContextInput => ({
  currentPage: "queries",
  scope: { startTime: 1_700_000_000_000_000, endTime: 1_700_003_600_000_000, period: "1h" },
  ...over,
});

describe("createDbmContextProvider", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("namespaces the page so it cannot collide with another module's page id", () => {
    const provider = createDbmContextProvider(() => input(), store);
    expect(provider.getContext().currentPage).toBe("dbm_queries");
  });

  it("carries the org, the window and the request timestamp in microseconds", () => {
    const provider = createDbmContextProvider(() => input(), store);
    const context = provider.getContext();

    expect(context.org_id).toBe("org-prod");
    expect(context.time_range).toEqual({
      start_time: 1_700_000_000_000_000,
      end_time: 1_700_003_600_000_000,
      period: "1h",
    });
    expect(context.request_timestamp).toBe(1_800_000_000_000_000);
  });

  it("maps every scope filter to its stream-field name", () => {
    const provider = createDbmContextProvider(
      () =>
        input({
          scope: {
            system: "postgresql",
            instance: "orders-db",
            namespace: "public",
            env: "prod",
            service: "checkout",
          },
        }),
      store,
    );
    const context = provider.getContext();

    expect(context.db_system).toBe("postgresql");
    expect(context.db_instance).toBe("orders-db");
    expect(context.db_namespace).toBe("public");
    expect(context.env).toBe("prod");
    expect(context.service_name).toBe("checkout");
  });

  /** A null filter means "not filtered" — it must not travel as a value. */
  it("drops a null filter rather than sending null", () => {
    const provider = createDbmContextProvider(
      () => input({ scope: { system: null, instance: null } }),
      store,
    );
    const context = provider.getContext();

    expect(context.db_system).toBeUndefined();
    expect(context.db_instance).toBeUndefined();
  });

  it("adds the fingerprint and statement on query detail", () => {
    const provider = createDbmContextProvider(
      () =>
        input({
          currentPage: "query_detail",
          focus: { fingerprint: "abc123", query: "SELECT * FROM orders WHERE id = ?" },
        }),
      store,
    );
    const context = provider.getContext();

    expect(context.currentPage).toBe("dbm_query_detail");
    expect(context.query_fingerprint).toBe("abc123");
    expect(context.query_text).toBe("SELECT * FROM orders WHERE id = ?");
  });

  it("adds both statements on deadlocks", () => {
    const provider = createDbmContextProvider(
      () =>
        input({
          currentPage: "deadlocks",
          focus: { deadlockQueries: ["UPDATE a SET x = ?", "UPDATE a SET y = ?"] },
        }),
      store,
    );
    expect(provider.getContext().deadlock_queries).toEqual([
      "UPDATE a SET x = ?",
      "UPDATE a SET y = ?",
    ]);
  });

  it("adds the blocking root on blocked queries", () => {
    const provider = createDbmContextProvider(
      () =>
        input({
          currentPage: "blocked_queries",
          focus: { blockingRootPid: 4711, blockingRootQuery: "UPDATE inventory SET qty = ?" },
        }),
      store,
    );
    const context = provider.getContext();

    expect(context.blocking_root_pid).toBe(4711);
    expect(context.blocking_root_query).toBe("UPDATE inventory SET qty = ?");
  });

  /** pid 0 is a real pid; a truthiness check would silently drop it. */
  it("keeps a zero root pid", () => {
    const provider = createDbmContextProvider(
      () => input({ currentPage: "blocked_queries", focus: { blockingRootPid: 0 } }),
      store,
    );
    expect(provider.getContext().blocking_root_pid).toBe(0);
  });

  it("omits focus keys entirely when nothing is focused", () => {
    const provider = createDbmContextProvider(() => input(), store);
    const context = provider.getContext();

    expect("query_fingerprint" in context).toBe(false);
    expect("deadlock_queries" in context).toBe(false);
    expect("blocking_root_pid" in context).toBe(false);
  });

  /**
   * The registry reads context at SEND time, which can be several filter
   * changes after registration — a snapshot would describe a scope the user
   * has already left.
   */
  it("reads the getter on every call, so a filter change is picked up", () => {
    let system = "postgresql";
    const provider = createDbmContextProvider(() => input({ scope: { system } }), store);

    expect(provider.getContext().db_system).toBe("postgresql");
    system = "mysql";
    expect(provider.getContext().db_system).toBe("mysql");
  });

  it("degrades to an empty org rather than throwing on a bare store", () => {
    const provider = createDbmContextProvider(() => input(), {});
    expect(provider.getContext().org_id).toBe("");
  });
});
