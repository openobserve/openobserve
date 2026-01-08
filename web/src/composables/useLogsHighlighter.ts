/**
 * Logs Highlighting Composable
 * ============================
 *
 * Extracted from LogsHighlighting.vue for reusability and performance optimization.
 * Provides the core highlighting logic that can be used with caching.
 */

import { useTextHighlighter } from "@/composables/useTextHighlighter";
import { getThemeColors } from "@/utils/logs/keyValueParser";
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import { searchState } from "@/composables/useLogs/searchState";

const processedResults = ref({});

export function useLogsHighlighter() {
  const store = useStore();
  const currentColors = ref(getThemeColors(store.state.theme === "dark"));
  const { searchObj } = searchState();

  // Track active processing to prevent memory leaks
  let abortController: AbortController | null = null;
  let pendingTimeouts: NodeJS.Timeout[] = [];

  // Cleanup function to clear pending timeouts and abort processing
  const cleanup = () => {
    // Clear all pending timeouts
    pendingTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    pendingTimeouts = [];

    // Abort any in-flight processing
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  };

  // Cleanup on component unmount (if used in a component context)
  // Note: This only works if called within a component setup
  try {
    onBeforeUnmount(() => {
      cleanup();
    });
  } catch (e) {
    // onBeforeUnmount not available (not in component context)
    // This is fine - cleanup will still happen on abort
  }

  watch(
    () => store.state.theme,
    (newTheme) => {
      currentColors.value = getThemeColors(newTheme === "dark");
    },
  );

  const {
    processTextWithHighlights,
    extractKeywords,
    splitTextByKeywords,
    escapeHtml,
    isFTSColumn,
  } = useTextHighlighter();

  /**
   * Process hits array in chunks to avoid blocking the main thread
   * Returns a Map with cache keys and processed HTML
   * Includes abort mechanism to prevent memory leaks
   */
  async function processHitsInChunks(
    hits: any[],
    columns: any[],
    clearCache: boolean,
    queryString: string = "",
    chunkSize: number = 50,
    selectedStreamFtsKeys: string[] = [],
  ): Promise<{ [key: string]: string }> {
    // Abort any previous processing before starting new one
    cleanup();

    // Create new abort controller for this processing session
    abortController = new AbortController();
    const signal = abortController.signal;

    if (clearCache) {
      processedResults.value = {};
    }
    if (!hits || hits.length === 0 || !columns || columns.length === 0) {
      return processedResults.value;
    }

    // Split hits into chunks
    const chunks = [];
    for (let i = 0; i < hits.length; i += chunkSize) {
      chunks.push(hits.slice(i, i + chunkSize));
    }

    // Process each chunk with await to prevent blocking
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      // Check if processing was aborted
      if (signal.aborted) {
        return processedResults.value;
      }

      const chunk = chunks[chunkIndex];
      const batchUpdates: { [key: string]: string } = {};

      // Process chunk items - one hit at a time
      for (let itemIndex = 0; itemIndex < chunk.length; itemIndex++) {
        const hit = chunk[itemIndex];

        const rowIndex = chunkIndex * chunkSize + itemIndex;

        // Process all columns for this hit
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
          const cacheKey = `${columns[columnIndex].id}_${rowIndex}`;

          if (processedResults.value[cacheKey]) continue;

          // Process the hit data
          const processedHtml = colorizedJson({
            data:
              columns[columnIndex].id === "source"
                ? hit
                : columns[columnIndex].accessorFn
                  ? columns[columnIndex].accessorFn(hit)
                  : hit[columns[columnIndex].id],
            simpleMode: !(
              columns[columnIndex].id === "source" ||
              isFTSColumn(
                columns[columnIndex].id,
                columns[columnIndex].id === "source"
                  ? hit
                  : hit[columns[columnIndex].id],
                selectedStreamFtsKeys,
              )
            ),
            showBraces: columns[columnIndex].id === "source",
            showQuotes: columns[columnIndex].id === "source",
            queryString,
          });

          batchUpdates[cacheKey] = processedHtml;
        }
      }

      processedResults.value = {
        ...processedResults.value,
        ...batchUpdates,
      };

      // Yield control back to event loop with tracked timeout
      // This prevents blocking the UI thread
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          // Remove from pending list when executed
          const index = pendingTimeouts.indexOf(timeoutId);
          if (index > -1) {
            pendingTimeouts.splice(index, 1);
          }

          // Check if aborted before resolving
          if (signal.aborted) {
            reject(new Error("Processing aborted"));
          } else {
            resolve();
          }
        }, 50);

        // Track this timeout for cleanup
        pendingTimeouts.push(timeoutId);

        // Handle abort signal
        signal.addEventListener("abort", () => {
          clearTimeout(timeoutId);
          const index = pendingTimeouts.indexOf(timeoutId);
          if (index > -1) {
            pendingTimeouts.splice(index, 1);
          }
          reject(new Error("Processing aborted"));
        });
      }).catch(() => {
        // Silently handle abort errors
        // Processing was intentionally cancelled
      });
    }
    return processedResults.value;
  }

  const clearCache = () => {
    // Also cleanup pending operations when clearing cache
    cleanup();
    processedResults.value = {};
  };

  /**
   * Legacy function - kept for backward compatibility
   * @deprecated Use processHitsInChunks instead
   */
  const processHitsHighlighting = (data: any): Promise<any> => {
    return new Promise((resolve) => {
      if (data === null || data === undefined) {
        resolve("");
      }

      const processedHits = data.map((hit: any) => {
        return colorizedJson({
          data: hit,
          simpleMode: false,
          showBraces: true,
          showQuotes: true,
          queryString: "",
        });
      });

      resolve(processedHits);
    });
  };

  /**
   * Main colorization logic with integrated highlighting
   */
  const colorizedJson = ({
    data,
    simpleMode,
    queryString,
    showQuotes,
    showBraces,
  }: {
    data: any;
    simpleMode: boolean;
    queryString: string;
    showQuotes: boolean;
    showBraces: boolean;
  }) => {
    if (data === null || data === undefined) {
      return "";
    }

    // Simple mode: only highlighting, no semantic colorization
    if (simpleMode) {
      const textStr = String(data);
      return simpleHighlight(textStr, queryString);
    }

    // Handle single string values with semantic colorization and highlighting
    if (typeof data === "string") {
      return processTextWithHighlights(
        data,
        queryString,
        currentColors.value,
        showQuotes,
      );
    }

    // Handle primitive data types
    if (typeof data !== "object") {
      const dataStr = String(data);

      if (typeof data === "number") {
        // Detect timestamp-like numbers
        if (dataStr.length >= 13) {
          return createStyledSpan(
            dataStr,
            currentColors.value.timestamp,
            queryString,
            false,
          );
        } else {
          return createStyledSpan(
            dataStr,
            currentColors.value.numberValue,
            queryString,
            showQuotes,
          );
        }
      } else if (typeof data === "boolean") {
        return createStyledSpan(
          String(data),
          currentColors.value.booleanValue,
          queryString,
          showQuotes,
        );
      } else if (data === null) {
        return createStyledSpan(
          "null",
          currentColors.value.nullValue,
          queryString,
          showQuotes,
        );
      } else {
        return processTextWithHighlights(
          dataStr,
          queryString,
          currentColors.value,
          showQuotes,
        );
      }
    }

    // Handle complex objects with full JSON colorization
    //this is for objects and arrays if any
    try {
      return colorizeObjectWithClasses(
        data,
        showBraces,
        showQuotes,
        queryString,
      );
    } catch (error) {
      return escapeHtml(JSON.stringify(data));
    }
  };

  /**
   * Simple highlighting without semantic colorization
   * Used when it is not an FTS key - just highlight text if query string is present
   */
  function simpleHighlight(text: string, queryString: string): string {
    if (!text || !queryString) return escapeHtml(text);

    const keywords = extractKeywords(queryString);
    const parts = splitTextByKeywords(text, keywords);

    return parts
      .map((part) => {
        if (part.isHighlighted) {
          return `<span class="log-highlighted">${escapeHtml(part.text)}</span>`;
        } else {
          return escapeHtml(part.text);
        }
      })
      .join("");
  }

  /**
   * Detects semantic type of text for CSS class assignment
   */
  function detectSemanticType(text: string): string {
    if (!text || typeof text !== "string") return "default";

    const trimmed = text.trim();

    // IP addresses
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)) return "ip";

    // URLs
    if (/^https?:\/\//i.test(trimmed)) return "url";

    // Email addresses
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "email";

    // HTTP methods
    if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/i.test(trimmed))
      return "http-method";

    // HTTP Status codes - only match valid status codes
    // 1xx: Informational (100-103)
    // 2xx: Success (200-208, 226)
    // 3xx: Redirection (300-308)
    // 4xx: Client Error (400-431, 451)
    // 5xx: Server Error (500-511)
    if (/^(1(0[0-3])|2(0[0-8]|26)|3(0[0-8])|4(0[0-9]|1[0-9]|2[0-9]|3[01]|51)|5(0[0-9]|1[01]))$/.test(trimmed)) return "status-code";

    // UUIDs
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        trimmed,
      )
    )
      return "uuid";

    // File paths
    if (/^\//.test(trimmed) || /^[A-Za-z]:\\/.test(trimmed)) return "path";

    // Large numbers (timestamps/file sizes)
    if (/^\d{10,}$/.test(trimmed)) return "timestamp";

    // Default to string
    return "string";
  }

  /**
   * Creates a styled span with CSS classes instead of inline styles
   * Quotes are always shown when requested, background only highlights content
   */
  function createStyledSpanWithClasses(
    text: string,
    semanticType: string,
    queryString: string,
    showQuotes: boolean = false,
  ): string {
    const keywords = extractKeywords(queryString);
    const highlightParts = splitTextByKeywords(text, keywords);

    let result = "";

    // Add opening quote if needed
    if (showQuotes) {
      result += `<span class="log-${semanticType}">"</span>`;
    }

    // Process content with highlighting
    result += highlightParts
      .map((part) => {
        const classes = ["log-highlight"];

        if (part.isHighlighted) {
          classes.push("log-highlighted");
        } else {
          classes.push(`log-${semanticType}`);
        }

        return `<span class="${classes.join(" ")}">${escapeHtml(part.text)}</span>`;
      })
      .join("");

    // Add closing quote if needed
    if (showQuotes) {
      result += `<span class="log-${semanticType}">"</span>`;
    }

    return result;
  }

  /**
   * Legacy function - kept for backward compatibility
   * @deprecated Use createStyledSpanWithClasses instead
   */
  function createStyledSpan(
    text: string,
    color: string,
    queryString: string,
    showQuotes: boolean = false,
  ): string {
    const semanticType = detectSemanticType(text);
    return createStyledSpanWithClasses(
      text,
      semanticType,
      queryString,
      showQuotes,
    );
  }

  /**
   * Checks if a value looks like a log line with mixed content (HTTP/web server logs)
   * Returns true ONLY if BOTH HTTP indicators AND semantic types are present
   */
  function isLogLineWithMixedContent(value: string): boolean {
    const str = value.trim();

    // HTTP INDICATORS: Look for web server/HTTP protocol signs
    const hasHttpIndicators =
      str.includes("HTTP/") || // "HTTP/1.1", "HTTP/2.0"
      /"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/.test(str) || // Quoted methods: "GET /path"
      /\s(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/.test(str); // Space-separated: " GET /path "

    // SEMANTIC TYPES: Look for network-related data patterns
    const hasSemanticTypes =
      str.match(/\d+\.\d+\.\d+\.\d+/) !== null || // IP addresses: "192.168.1.1"
      str.match(/https?:\/\/[^\s"]+/) !== null || // URLs: "https://example.com"
      str.match(/[^\s@"]+@[^\s@"]+\.[^\s@"]+/) !== null || // Emails: "user@domain.com"
      str.match(/\[\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}/) !== null; // Apache timestamps: "[01/Jan/2023:12:00:00"

    // MUST HAVE BOTH: HTTP activity + network/semantic data
    return hasHttpIndicators && hasSemanticTypes;
  }

  /**
   * Colorizes JSON objects with CSS classes instead of inline styles
   */
  function colorizeObjectWithClasses(
    obj: any,
    showBraces = true,
    showQuotes = false,
    queryString = "",
  ): string {
    const parts: string[] = [];

    // Add opening brace: "{"
    if (showBraces) {
      parts.push('<span class="log-object-brace">{</span>');
    }

    const entries = Object.entries(obj);
    entries.forEach(([key, value], index) => {
      // KEYS: Always colored, never highlighted
      let keyContent = "";

      // Add opening quote for key if needed: "level" vs level
      if (showQuotes) {
        keyContent += `<span class="log-key">"${escapeHtml(key)}"</span>`;
      } else {
        keyContent += `<span class="log-key">${escapeHtml(key)}</span>`;
      }

      parts.push(keyContent);
      parts.push('<span class="log-separator">:</span>'); // Colon separator

      // VALUES: Colored based on type + highlighted if matches search
      if (value === null) {
        parts.push(
          createStyledSpanWithClasses("null", "null", queryString, false),
        );
      } else if (typeof value === "boolean") {
        parts.push(
          createStyledSpanWithClasses(
            String(value),
            "boolean",
            queryString,
            false,
          ),
        );
      } else if (typeof value === "number") {
        const numType = String(value).length >= 13 ? "timestamp" : "number";
        parts.push(
          createStyledSpanWithClasses(
            String(value),
            numType,
            queryString,
            false,
          ),
        );
      } else if (typeof value === "string") {
        // STRING VALUES: Detect semantic type and use appropriate class
        if (isLogLineWithMixedContent(value)) {
          // Always pass showQuotes to ensure consistent quote handling
          const processedLine = processTextWithHighlights(
            value,
            queryString,
            currentColors.value,
            showQuotes,
          );
          parts.push(processedLine);
        } else {
          // Regular string processing with semantic detection
          parts.push(
            processTextWithHighlights(
              value,
              queryString,
              currentColors.value,
              showQuotes,
            ),
          );
        }
      } else if (typeof value === "object") {
        // NESTED OBJECTS/ARRAYS: Convert to JSON string and treat as object value
        const objStr = JSON.stringify(value);
        parts.push(
          createStyledSpanWithClasses(
            objStr,
            "object-value",
            queryString,
            showQuotes,
          ),
        );
      } else {
        // FALLBACK: Any other type (functions, symbols, etc.)
        const strValue = String(value);
        parts.push(
          createStyledSpanWithClasses(
            strValue,
            "default",
            queryString,
            showQuotes,
          ),
        );
      }

      // Add comma separator (except for last item): ","
      if (index < entries.length - 1) {
        parts.push('<span class="log-separator">,</span>');
      }
    });

    // Add closing brace: "}"
    if (showBraces) {
      parts.push('<span class="log-object-brace">}</span>');
    }
    return parts.join("");
  }

  /**
   * Legacy function - kept for backward compatibility
   * @deprecated Use colorizeObjectWithClasses instead
   */
  function colorizeObject(
    obj: any,
    colors: any,
    showBraces = true,
    showQuotes = false,
    queryString = "",
  ): string {
    return colorizeObjectWithClasses(obj, showBraces, showQuotes, queryString);
  }

  /**
   * Main colorization logic with integrated highlighting
   * This is the core function extracted from LogsHighlighting.vue
   */
  function colorizeJson(
    data: any,
    isDarkTheme: boolean,
    showBraces: boolean = true,
    showQuotes: boolean = false,
    queryString: string = "",
    simpleMode: boolean = false,
  ): string {
    if (data === null || data === undefined) {
      return "";
    }

    const currentColors = getThemeColors(isDarkTheme);

    // Simple mode: only highlighting, no semantic colorization
    if (simpleMode) {
      const textStr = String(data);
      return simpleHighlight(textStr, queryString);
    }

    // Handle single string values with semantic colorization and highlighting
    if (typeof data === "string") {
      return processTextWithHighlights(
        data,
        queryString,
        currentColors,
        showQuotes,
      );
    }

    // Handle primitive data types
    if (typeof data !== "object") {
      const dataStr = String(data);

      if (typeof data === "number") {
        // Detect timestamp-like numbers
        if (dataStr.length >= 13) {
          return createStyledSpan(
            dataStr,
            currentColors.timestamp,
            queryString,
            false,
          );
        } else {
          return createStyledSpan(
            dataStr,
            currentColors.numberValue,
            queryString,
            false,
          );
        }
      } else if (typeof data === "boolean") {
        return createStyledSpan(
          String(data),
          currentColors.booleanValue,
          queryString,
          false,
        );
      } else if (data === null) {
        return createStyledSpan(
          "null",
          currentColors.nullValue,
          queryString,
          false,
        );
      } else {
        return processTextWithHighlights(
          dataStr,
          queryString,
          currentColors,
          showQuotes,
        );
      }
    }

    // Handle complex objects with full JSON colorization
    try {
      return colorizeObject(
        data,
        currentColors,
        showBraces,
        showQuotes,
        queryString,
      );
    } catch (error) {
      return escapeHtml(JSON.stringify(data));
    }
  }

  return {
    colorizeJson,
    simpleHighlight,
    createStyledSpan,
    createStyledSpanWithClasses,
    isLogLineWithMixedContent,
    colorizeObject,
    colorizeObjectWithClasses,
    colorizedJson,
    processHitsHighlighting,
    processHitsInChunks,
    clearCache,
    processedResults,
    detectSemanticType,
    cleanup, // Expose cleanup for manual cleanup if needed
  };
}
