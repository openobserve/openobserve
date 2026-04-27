import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePanelSearchHandlers } from "./usePanelSearchHandlers";

// Mock Vue to avoid issues with markRaw/toRaw in test env
vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return {
    ...actual,
    markRaw: (v: any) => v,
    toRaw: (v: any) => v,
  };
});

// Re-export the real chunkingDirection module (vitest needs it resolved)
vi.mock("@/utils/dashboard/chunkingDirection", async () => {
  return await vi.importActual("../../utils/dashboard/chunkingDirection");
});

const makeState = (metadataOverride?: any) => ({
  data: [] as any[],
  resultMetaData: [] as any[],
  loading: false,
  loadingTotal: 0,
  loadingCompleted: 0,
  loadingProgressPercentage: 0,
  isPartialData: false,
  isOperationCancelled: false,
  errorDetail: { message: "", code: "" },
  metadata: metadataOverride ?? { queries: [] },
});

const makeHandlers = (stateOverride?: any) => {
  const state = stateOverride ?? makeState();
  const processApiError = vi.fn();
  const saveCurrentStateToCache = vi.fn();
  const loadData = vi.fn();
  const removeTraceId = vi.fn();

  const handlers = usePanelSearchHandlers({
    state,
    processApiError,
    saveCurrentStateToCache,
    loadData,
    removeTraceId,
  });

  return { state, processApiError, saveCurrentStateToCache, loadData, removeTraceId, handlers };
};

// ─── handleHistogramResponse ──────────────────────────────────────────────────

describe("handleHistogramResponse", () => {
  it("clears errorDetail", async () => {
    const { state, handlers } = makeHandlers();
    state.errorDetail = { message: "old error", code: "500" };
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      { content: { streaming_aggs: false, results: { hits: [], order_by: "desc" } } },
    );

    expect(state.errorDetail.message).toBe("");
    expect(state.errorDetail.code).toBe("");
  });

  it("initializes data array for query index if missing", async () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      { content: { streaming_aggs: false, results: { hits: [{ id: 1 }], order_by: "desc" } } },
    );

    expect(Array.isArray(state.data[0])).toBe(true);
  });

  it("replaces data when streaming_aggs is true", async () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 99 }];
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: true,
          results: { hits: [{ id: 1 }, { id: 2 }], order_by: "desc" },
        },
      },
    );

    expect(state.data[0]).toHaveLength(2);
    expect(state.data[0][0].id).toBe(1);
  });

  it("prepends hits for ascending order", async () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 10 }];
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: false,
          results: { hits: [{ id: 1 }], order_by: "ASC" },
        },
      },
    );

    // prepend: new hit first
    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });

  it("appends hits for descending order (default)", async () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 1 }];
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: false,
          results: { hits: [{ id: 2 }], order_by: "desc" },
        },
      },
    );

    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(2);
  });

  it("pushes result metadata", async () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      { content: { streaming_aggs: false, results: { hits: [], order_by: "desc", total: 5 } } },
    );

    expect(state.resultMetaData[0]).toHaveLength(1);
    expect(state.resultMetaData[0][0].total).toBe(5);
  });

  it("sets isPartialData to false when data has items and loading is complete", async () => {
    const state = makeState();
    state.loading = false;
    state.isPartialData = true;
    state.resultMetaData[0] = [];
    const { handlers } = makeHandlers(state);

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      { content: { streaming_aggs: false, results: { hits: [{ id: 1 }], order_by: "desc" } } },
    );

    expect(state.isPartialData).toBe(false);
  });
});

// ─── handleHistogramResponse chunking direction ──────────────────────────────

describe("handleHistogramResponse – chunking direction", () => {
  // User range: 1000..2000 (microseconds)
  const userStart = 1000;
  const userEnd = 2000;

  it("detects LTR and appends for asc order (LTR+asc→append)", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.resultMetaData[0] = [];
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    // First chunk: start_time matches userStart → LTR
    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: false,
          results: {
            hits: [{ id: 1 }],
            order_by: "asc",
            time_offset: { start_time: userStart, end_time: 1500 },
          },
        },
      },
    );

    // LTR + asc → append: existing data first, then new
    expect(state.data[0][0].id).toBe(10);
    expect(state.data[0][1].id).toBe(1);
  });

  it("detects LTR and prepends for desc order (LTR+desc→prepend)", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.resultMetaData[0] = [];
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: false,
          results: {
            hits: [{ id: 1 }],
            order_by: "desc",
            time_offset: { start_time: userStart, end_time: 1500 },
          },
        },
      },
    );

    // LTR + desc → prepend: new data first
    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });

  it("detects RTL and prepends for asc order (RTL+asc→prepend)", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.resultMetaData[0] = [];
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    // First chunk: end_time matches userEnd → RTL
    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: false,
          results: {
            hits: [{ id: 1 }],
            order_by: "asc",
            time_offset: { start_time: 1500, end_time: userEnd },
          },
        },
      },
    );

    // RTL + asc → prepend: new data first
    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });

  it("detects RTL and appends for desc order (RTL+desc→append)", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.resultMetaData[0] = [];
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: false,
          results: {
            hits: [{ id: 1 }],
            order_by: "desc",
            time_offset: { start_time: 1500, end_time: userEnd },
          },
        },
      },
    );

    // RTL + desc → append: existing first
    expect(state.data[0][0].id).toBe(10);
    expect(state.data[0][1].id).toBe(1);
  });

  it("defaults to RTL when no time_offset is provided", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.resultMetaData[0] = [];
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    // No time_offset → defaults to RTL
    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: false,
          results: { hits: [{ id: 1 }], order_by: "asc" },
        },
      },
    );

    // RTL + asc → prepend
    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });
});

// ─── handleStreamingHistogramMetadata ─────────────────────────────────────────

describe("handleStreamingHistogramMetadata", () => {
  it("initializes resultMetaData array if missing for query index", () => {
    const { state, handlers } = makeHandlers();

    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 1 } },
      { content: { total: 42, results: { took: 10 } } },
    );

    expect(Array.isArray(state.resultMetaData[1])).toBe(true);
    expect(state.resultMetaData[1]).toHaveLength(1);
  });

  it("merges content and results into pushed metadata", () => {
    const { state, handlers } = makeHandlers();

    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 0 } },
      { content: { total: 42, results: { took: 10 } } },
    );

    expect(state.resultMetaData[0][0].total).toBe(42);
    expect(state.resultMetaData[0][0].took).toBe(10);
  });

  it("appends multiple metadata entries on successive calls", () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [];

    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 0 } },
      { content: { total: 10, results: {} } },
    );
    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 0 } },
      { content: { total: 20, results: {} } },
    );

    expect(state.resultMetaData[0]).toHaveLength(2);
  });
});

// ─── handleStreamingHistogramHits ─────────────────────────────────────────────

describe("handleStreamingHistogramHits", () => {
  it("clears errorDetail", () => {
    const { state, handlers } = makeHandlers();
    state.errorDetail = { message: "old", code: "500" };
    state.resultMetaData[0] = [{ streaming_aggs: false }];
    state.data[0] = [];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 1 }] } } },
    );

    expect(state.errorDetail.message).toBe("");
  });

  it("replaces data when streaming_aggs is true and hits are non-empty", async () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 99 }];
    state.resultMetaData[0] = [{ streaming_aggs: true }];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 1 }, { id: 2 }] } } },
    );

    // Wait for microtask flush
    await Promise.resolve();

    expect(state.data[0]).toHaveLength(2);
    expect(state.data[0][0].id).toBe(1);
  });

  it("does not replace data when streaming_aggs is true but hits are empty", () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 99 }];
    state.resultMetaData[0] = [{ streaming_aggs: true }];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [] } } },
    );

    expect(state.data[0][0].id).toBe(99);
  });

  it("prepends hits for asc order_by", async () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 10 }];
    state.resultMetaData[0] = [{ streaming_aggs: false, order_by: "ASC" }];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 1 }] } } },
    );

    // Wait for microtask flush
    await Promise.resolve();

    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });

  it("appends hits for non-asc order_by", async () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 1 }];
    state.resultMetaData[0] = [{ streaming_aggs: false, order_by: "desc" }];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 2 }] } } },
    );

    // Wait for microtask flush
    await Promise.resolve();

    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(2);
  });

  it("initializes data array if missing for query index", () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [{ streaming_aggs: false }];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 5 }] } } },
    );

    expect(Array.isArray(state.data[0])).toBe(true);
  });

  it("appends hits for LTR+asc direction", async () => {
    const state = makeState({ queries: [{ startTime: 1000, endTime: 2000 }] });
    state.data[0] = [{ id: 10 }];
    // Don't pre-set resultMetaData so direction detection works on first metadata
    const { handlers } = makeHandlers(state);

    // First metadata: start_time matches userStart → LTR detected, order_by: asc
    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          time_offset: { start_time: 1000, end_time: 1500 },
          results: { streaming_aggs: false, order_by: "asc" },
        },
      },
    );

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 1 }] } } },
    );

    await Promise.resolve();

    // LTR + asc → append
    expect(state.data[0][0].id).toBe(10);
    expect(state.data[0][1].id).toBe(1);
  });

  it("prepends hits for LTR+desc direction", async () => {
    const state = makeState({ queries: [{ startTime: 1000, endTime: 2000 }] });
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    // First metadata: start_time matches userStart → LTR detected, order_by: desc
    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          time_offset: { start_time: 1000, end_time: 1500 },
          results: { streaming_aggs: false, order_by: "desc" },
        },
      },
    );

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 1 }] } } },
    );

    await Promise.resolve();

    // LTR + desc → prepend
    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });
});

// ─── Comprehensive chunking direction + order_by + streaming_aggs tests ──────

describe("chunking direction – comprehensive edge cases", () => {
  const userStart = 1000;
  const userEnd = 2000;

  // Helper: sends metadata then hits via the streaming path
  const sendStreamingChunk = async (
    handlers: any,
    opts: {
      timeOffset: { start_time: number; end_time: number };
      orderBy: string;
      streamingAggs: boolean;
      hits: any[];
    },
  ) => {
    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          time_offset: opts.timeOffset,
          results: {
            streaming_aggs: opts.streamingAggs,
            order_by: opts.orderBy,
          },
        },
      },
    );
    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: opts.hits } } },
    );
    await Promise.resolve(); // flush microtask
  };

  // --- streaming_aggs: true always replaces data regardless of direction ---

  it("streaming_aggs=true replaces data for LTR direction", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.data[0] = [{ id: 99 }];
    const { handlers } = makeHandlers(state);

    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: userStart, end_time: 1500 },
      orderBy: "asc",
      streamingAggs: true,
      hits: [{ id: 1 }, { id: 2 }],
    });

    // streaming_aggs replaces regardless of direction
    expect(state.data[0]).toHaveLength(2);
    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(2);
  });

  it("streaming_aggs=true replaces data for RTL direction", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.data[0] = [{ id: 99 }];
    const { handlers } = makeHandlers(state);

    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1500, end_time: userEnd },
      orderBy: "desc",
      streamingAggs: true,
      hits: [{ id: 5 }],
    });

    expect(state.data[0]).toHaveLength(1);
    expect(state.data[0][0].id).toBe(5);
  });

  // --- missing order_by defaults to desc ---

  it("missing order_by defaults to desc: RTL → append", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    // RTL (end matches user end), no order_by → defaults to desc
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1500, end_time: userEnd },
      orderBy: "", // missing/empty → orderAsc = false (desc default)
      streamingAggs: false,
      hits: [{ id: 1 }],
    });

    // RTL + desc → append
    expect(state.data[0][0].id).toBe(10);
    expect(state.data[0][1].id).toBe(1);
  });

  it("missing order_by defaults to desc: LTR → prepend", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    // LTR (start matches user start), no order_by → defaults to desc
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: userStart, end_time: 1500 },
      orderBy: "", // missing → desc
      streamingAggs: false,
      hits: [{ id: 1 }],
    });

    // LTR + desc → prepend
    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });

  // --- multi-chunk accumulation: LTR + asc (append, append, append) ---

  it("LTR multi-chunk: appends chronologically for asc order", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    const { handlers } = makeHandlers(state);

    // Chunk 1: earliest
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: userStart, end_time: 1300 },
      orderBy: "asc",
      streamingAggs: false,
      hits: [{ id: 1 }],
    });
    // Chunk 2: middle
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1300, end_time: 1700 },
      orderBy: "asc",
      streamingAggs: false,
      hits: [{ id: 2 }, { id: 3 }],
    });
    // Chunk 3: latest
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1700, end_time: userEnd },
      orderBy: "asc",
      streamingAggs: false,
      hits: [{ id: 4 }],
    });

    expect(state.data[0].map((d: any) => d.id)).toEqual([1, 2, 3, 4]);
  });

  // --- multi-chunk accumulation: RTL + asc (prepend, prepend, prepend) ---

  it("RTL multi-chunk: prepends to maintain chronological order for asc", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    const { handlers } = makeHandlers(state);

    // Chunk 1: latest (arrives first in RTL)
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1700, end_time: userEnd },
      orderBy: "asc",
      streamingAggs: false,
      hits: [{ id: 4 }],
    });
    // Chunk 2: middle
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1300, end_time: 1700 },
      orderBy: "asc",
      streamingAggs: false,
      hits: [{ id: 2 }, { id: 3 }],
    });
    // Chunk 3: earliest (arrives last in RTL)
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: userStart, end_time: 1300 },
      orderBy: "asc",
      streamingAggs: false,
      hits: [{ id: 1 }],
    });

    expect(state.data[0].map((d: any) => d.id)).toEqual([1, 2, 3, 4]);
  });

  // --- multi-chunk: LTR + desc (prepend, prepend, prepend) ---

  it("LTR multi-chunk: prepends to maintain desc order", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    const { handlers } = makeHandlers(state);

    // Chunk 1: earliest data, desc within chunk
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: userStart, end_time: 1300 },
      orderBy: "desc",
      streamingAggs: false,
      hits: [{ id: 2 }, { id: 1 }], // desc within chunk
    });
    // Chunk 2: later data, desc within chunk
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1300, end_time: userEnd },
      orderBy: "desc",
      streamingAggs: false,
      hits: [{ id: 4 }, { id: 3 }],
    });

    // LTR+desc → prepend: [4,3] prepended before [2,1] → [4,3,2,1]
    expect(state.data[0].map((d: any) => d.id)).toEqual([4, 3, 2, 1]);
  });

  // --- multi-chunk: RTL + desc (append, append, append) ---

  it("RTL multi-chunk: appends to maintain desc order", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    const { handlers } = makeHandlers(state);

    // Chunk 1: latest data first, desc within chunk
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1300, end_time: userEnd },
      orderBy: "desc",
      streamingAggs: false,
      hits: [{ id: 4 }, { id: 3 }],
    });
    // Chunk 2: earlier data, desc within chunk
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: userStart, end_time: 1300 },
      orderBy: "desc",
      streamingAggs: false,
      hits: [{ id: 2 }, { id: 1 }],
    });

    // RTL+desc → append: [4,3] then [2,1] appended → [4,3,2,1]
    expect(state.data[0].map((d: any) => d.id)).toEqual([4, 3, 2, 1]);
  });

  // --- direction detection only happens on first chunk ---

  it("direction is locked after first metadata, not re-detected on subsequent chunks", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    // First metadata: LTR detected
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: userStart, end_time: 1500 },
      orderBy: "asc",
      streamingAggs: false,
      hits: [{ id: 1 }],
    });

    // Second chunk: time_offset would suggest RTL if re-detected, but direction is locked
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1500, end_time: userEnd },
      orderBy: "asc",
      streamingAggs: false,
      hits: [{ id: 2 }],
    });

    // LTR + asc → append for both chunks: [10, 1, 2]
    expect(state.data[0].map((d: any) => d.id)).toEqual([10, 1, 2]);
  });

  // --- no metadata available: defaults to RTL ---

  it("defaults to RTL when metadata.queries is empty", async () => {
    const state = makeState({ queries: [] }); // no query metadata
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1500, end_time: 1800 },
      orderBy: "asc",
      streamingAggs: false,
      hits: [{ id: 1 }],
    });

    // No userStart/userEnd → detection fails → defaults to RTL
    // RTL + asc → prepend
    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });

  // --- handleHistogramResponse (non-streaming) direction combos ---

  it("handleHistogramResponse: streaming_aggs=true replaces regardless of direction", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.resultMetaData[0] = [];
    state.data[0] = [{ id: 99 }];
    const { handlers } = makeHandlers(state);

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: true,
          results: {
            hits: [{ id: 1 }],
            order_by: "asc",
            time_offset: { start_time: userStart, end_time: 1500 },
          },
        },
      },
    );

    expect(state.data[0]).toHaveLength(1);
    expect(state.data[0][0].id).toBe(1);
  });

  it("handleHistogramResponse: missing order_by defaults to desc", async () => {
    const state = makeState({ queries: [{ startTime: userStart, endTime: userEnd }] });
    state.resultMetaData[0] = [];
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    // LTR detected, no order_by → desc → shouldPrepend = LTR !== desc = true !== false = true
    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: false,
          results: {
            hits: [{ id: 1 }],
            // order_by omitted → defaults to desc (orderAsc = false)
            time_offset: { start_time: userStart, end_time: 1500 },
          },
        },
      },
    );

    // LTR + desc → prepend
    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });

  // --- equal distance from both ends → defaults to LTR ---

  it("equal distance to both user start and end → detects as LTR (<=)", async () => {
    const state = makeState({ queries: [{ startTime: 1000, endTime: 2000 }] });
    state.data[0] = [{ id: 10 }];
    const { handlers } = makeHandlers(state);

    // Chunk at exact center: |1500-1000| = 500, |1500-2000| = 500 → <= is true → LTR
    await sendStreamingChunk(handlers, {
      timeOffset: { start_time: 1500, end_time: 1500 },
      orderBy: "asc",
      streamingAggs: false,
      hits: [{ id: 1 }],
    });

    // LTR + asc → append
    expect(state.data[0][0].id).toBe(10);
    expect(state.data[0][1].id).toBe(1);
  });
});

// ─── handleSearchResponse ─────────────────────────────────────────────────────

describe("handleSearchResponse", () => {
  it("delegates search_response_metadata to handleStreamingHistogramMetadata", () => {
    const { state, handlers } = makeHandlers();

    handlers.handleSearchResponse(
      { meta: { currentQueryIndex: 0 } },
      { type: "search_response_metadata", content: { total: 5, results: {} } },
    );

    expect(Array.isArray(state.resultMetaData[0])).toBe(true);
  });

  it("delegates search_response_hits to handleStreamingHistogramHits", () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [{ streaming_aggs: false }];

    handlers.handleSearchResponse(
      { meta: { currentQueryIndex: 0 } },
      { type: "search_response_hits", content: { results: { hits: [{ id: 1 }] } } },
    );

    expect(state.data[0]).toBeDefined();
  });

  it("delegates search_response to handleHistogramResponse", async () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [];

    handlers.handleSearchResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        type: "search_response",
        content: { streaming_aggs: false, results: { hits: [{ id: 1 }], order_by: "desc" } },
      },
    );

    // state.data[0] should be populated (async handler)
    expect(state.data[0]).toBeDefined();
  });

  it("sets loading=false and calls processApiError on error type", () => {
    const { state, handlers, processApiError } = makeHandlers();
    state.loading = true;

    handlers.handleSearchResponse(
      {},
      { type: "error", content: { message: "bad query" } },
    );

    expect(state.loading).toBe(false);
    expect(state.loadingProgressPercentage).toBe(0);
    expect(processApiError).toHaveBeenCalledWith({ message: "bad query" }, "sql");
  });

  it("sets loading=false and calls saveCurrentStateToCache on end type", () => {
    const { state, handlers, saveCurrentStateToCache } = makeHandlers();
    state.loading = true;

    handlers.handleSearchResponse({}, { type: "end" });

    expect(state.loading).toBe(false);
    expect(state.loadingProgressPercentage).toBe(100);
    expect(state.isPartialData).toBe(false);
    expect(saveCurrentStateToCache).toHaveBeenCalled();
  });

  it("updates loadingProgressPercentage on event_progress", async () => {
    const { state, handlers } = makeHandlers();

    handlers.handleSearchResponse(
      {},
      { type: "event_progress", content: { percent: 55 } },
    );

    await Promise.resolve();

    expect(state.loadingProgressPercentage).toBe(55);
    expect(state.isPartialData).toBe(true);
  });

  it("handles unknown type gracefully (no-op)", () => {
    const { state, handlers } = makeHandlers();
    // Unknown type should not throw or mutate state
    expect(() => {
      handlers.handleSearchResponse({}, { type: "unknown_type" });
    }).not.toThrow();
    expect(state.loading).toBe(false);
  });
});

// ─── handleSearchClose ────────────────────────────────────────────────────────

describe("handleSearchClose", () => {
  it("calls removeTraceId with payload traceId", () => {
    const { handlers, removeTraceId } = makeHandlers();

    handlers.handleSearchClose({ traceId: "abc-123" }, { type: "normal", code: 1000 });

    expect(removeTraceId).toHaveBeenCalledWith("abc-123");
  });

  it("calls processApiError when response type is error", () => {
    const { handlers, processApiError } = makeHandlers();

    handlers.handleSearchClose(
      { traceId: "t1" },
      { type: "error", content: { message: "ws error" } },
    );

    expect(processApiError).toHaveBeenCalledWith({ message: "ws error" }, "sql");
  });

  it("calls handleSearchError for WebSocket error codes", () => {
    // handleSearchClose internally calls handleSearchError which is returned by the composable
    // We verify processApiError is called via the chain
    const { handlers, processApiError } = makeHandlers();

    // Code 1006 = abnormal closure
    handlers.handleSearchClose(
      { traceId: "t1" },
      { type: "normal", code: 1006 },
    );

    expect(processApiError).toHaveBeenCalled();
  });

  it("does not call processApiError for clean close (code 1000)", () => {
    const { handlers, processApiError } = makeHandlers();

    handlers.handleSearchClose(
      { traceId: "t1" },
      { type: "normal", code: 1000 },
    );

    expect(processApiError).not.toHaveBeenCalled();
  });

  it("sets loading=false and calls saveCurrentStateToCache", () => {
    const { state, handlers, saveCurrentStateToCache } = makeHandlers();
    state.loading = true;

    handlers.handleSearchClose({ traceId: "t1" }, { type: "normal", code: 1000 });

    expect(state.loading).toBe(false);
    expect(saveCurrentStateToCache).toHaveBeenCalled();
  });
});

// ─── handleSearchError ────────────────────────────────────────────────────────

describe("handleSearchError", () => {
  it("calls removeTraceId with payload.traceId", () => {
    const { handlers, removeTraceId } = makeHandlers();

    handlers.handleSearchError(
      { traceId: "err-trace" },
      { content: { message: "err" } },
    );

    expect(removeTraceId).toHaveBeenCalledWith("err-trace");
  });

  it("sets loading=false and resets counters", () => {
    const { state, handlers } = makeHandlers();
    state.loading = true;
    state.loadingTotal = 5;
    state.loadingCompleted = 3;

    handlers.handleSearchError({ traceId: "t" }, { content: { message: "err" } });

    expect(state.loading).toBe(false);
    expect(state.loadingTotal).toBe(0);
    expect(state.loadingCompleted).toBe(0);
    expect(state.loadingProgressPercentage).toBe(0);
  });

  it("calls processApiError with response content", () => {
    const { handlers, processApiError } = makeHandlers();

    handlers.handleSearchError({ traceId: "t" }, { content: { message: "query failed" } });

    expect(processApiError).toHaveBeenCalledWith({ message: "query failed" }, "sql");
  });
});

// ─── handleSearchReset ────────────────────────────────────────────────────────

describe("handleSearchReset", () => {
  it("calls saveCurrentStateToCache and loadData", () => {
    const { handlers, saveCurrentStateToCache, loadData } = makeHandlers();

    handlers.handleSearchReset({}, "trace-id");

    expect(saveCurrentStateToCache).toHaveBeenCalled();
    expect(loadData).toHaveBeenCalled();
  });
});
