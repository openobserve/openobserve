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

export function useLogsHighlighter() {
  const processedResults = ref({});

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
      // For small datasets (<10 records), skip delay for instant rendering
      // For larger datasets, use small delay to prevent UI blocking
      const shouldDelay = hits.length >= 10 && chunkIndex < chunks.length - 1;
      const delayMs = shouldDelay ? 10 : 0; // Reduced from 50ms to 10ms, skip for small datasets

      if (delayMs > 0) {
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
          }, delayMs);

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
   * Estimates the size of data without expensive JSON.stringify
   * Used to determine if content should be truncated or skip highlighting
   * Optimized for large objects with many fields
   */
  const estimateSize = (data: any): number => {
    if (data === null || data === undefined) return 0;

    // For strings, use length directly
    if (typeof data === "string") return data.length;

    // For primitives, use string representation
    if (typeof data !== "object") return String(data).length;

    // For objects/arrays, estimate based on key count and depth
    try {
      const keys = Object.keys(data);
      if (keys.length === 0) return 2; // "{}" or "[]"

      // For very large objects (50+ fields), sample more aggressively
      const sampleSize = keys.length > 50 ? Math.min(10, keys.length) : Math.min(5, keys.length);
      let totalSize = 0;

      // Sample values to estimate
      for (let i = 0; i < sampleSize; i++) {
        const key = keys[i];
        const value = data[key];

        // Add key size (with quotes and colon)
        totalSize += key.length + 4; // "key":

        if (typeof value === "string") {
          totalSize += value.length + 2; // Add quotes
        } else if (typeof value === "object" && value !== null) {
          // For nested objects/arrays, recurse to maintain performance
          if (Array.isArray(value)) {
            // Recursively estimate array size to avoid expensive JSON.stringify
            totalSize += estimateSize(value);
          } else {
            // Recursively estimate nested object size
            totalSize += estimateSize(value);
          }
        } else {
          totalSize += String(value).length;
        }
      }

      // Extrapolate to all keys
      const avgFieldSize = totalSize / sampleSize;
      const estimate = avgFieldSize * keys.length;

      // Add overhead for braces, commas, etc (10% buffer)
      return Math.ceil(estimate * 1.1);
    } catch (error) {
      return 1000; // Default safe estimate
    }
  };

  /**
   * Truncates large content to prevent memory/performance issues
   * Always returns a string representation for consistency
   */
  const truncateLargeContent = (data: any, maxSize: number = 50000): string => {
    if (typeof data === "string") {
      if (data.length > maxSize) {
        return data.substring(0, maxSize) + `... [truncated, original size: ${data.length} chars]`;
      }
      return data;
    }

    if (typeof data === "object" && data !== null) {
      try {
        const jsonStr = JSON.stringify(data);
        if (jsonStr.length > maxSize) {
          return jsonStr.substring(0, maxSize) + `... [truncated, original size: ${jsonStr.length} chars]`;
        }
        return jsonStr;
      } catch (error) {
        return "[Object too large to display]";
      }
    }

    // For primitives (numbers, booleans, null), convert to string
    return String(data);
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

    // Estimate size and skip highlighting for large content (>50KB)
    const estimatedSize = estimateSize(data);
    const skipHighlighting = estimatedSize > 50000;

    // Truncate very large content (>50KB) to prevent memory issues
    if (estimatedSize > 50000) {
      const truncatedStr = truncateLargeContent(data, 50000);
      // After truncation, skip highlighting and use simple display
      return `<span class="log-string">${escapeHtml(truncatedStr)}</span>`;
    }

    // If skipping highlighting, use basic colorization without search highlighting
    const effectiveQueryString = skipHighlighting ? "" : queryString;

    // Simple mode: only highlighting, no semantic colorization
    if (simpleMode) {
      const textStr = String(data);
      return simpleHighlight(textStr, effectiveQueryString);
    }

    // Handle single string values with semantic colorization and highlighting
    if (typeof data === "string") {
      return processTextWithHighlights(
        data,
        effectiveQueryString,
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
            effectiveQueryString,
            false,
          );
        } else {
          return createStyledSpan(
            dataStr,
            currentColors.value.numberValue,
            effectiveQueryString,
            showQuotes,
          );
        }
      } else if (typeof data === "boolean") {
        return createStyledSpan(
          String(data),
          currentColors.value.booleanValue,
          effectiveQueryString,
          showQuotes,
        );
      } else if (data === null) {
        return createStyledSpan(
          "null",
          currentColors.value.nullValue,
          effectiveQueryString,
          showQuotes,
        );
      } else {
        return processTextWithHighlights(
          dataStr,
          effectiveQueryString,
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
        effectiveQueryString,
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
    if (
      /^(1(0[0-3])|2(0[0-8]|26)|3(0[0-8])|4(0[0-9]|1[0-9]|2[0-9]|3[01]|51)|5(0[0-9]|1[01]))$/.test(
        trimmed,
      )
    )
      return "status-code";

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
    disableTruncation: boolean = false, // Set true for expanded/detail views to show complete data
  ): string {
    if (data === null || data === undefined) {
      return "";
    }

    const currentColors = getThemeColors(isDarkTheme);

    // Apply truncation logic for list views (not expanded/detail views)
    if (!disableTruncation && typeof data === "object" && data !== null) {
      const estimatedSize = estimateSize(data);

      // Truncate very large content (>50KB) to prevent UI freeze in list view
      if (estimatedSize > 50000) {
        const truncatedStr = truncateLargeContent(data, 50000);
        // After truncation, skip highlighting and use simple display
        return `<span class="log-string">${escapeHtml(truncatedStr)}</span>`;
      }
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

  /**
   * Progressive rendering for very large logs in expanded/detail views
   * Renders field-by-field to avoid UI freeze
   * Returns a ref that updates incrementally
   */
  async function colorizeJsonProgressive(
    data: any,
    isDarkTheme: boolean,
    showBraces: boolean = true,
    showQuotes: boolean = false,
    queryString: string = "",
    onChunk?: (html: string) => void, // Callback for each chunk
  ): Promise<string> {
    if (data === null || data === undefined) {
      return "";
    }

    // For non-objects, use regular colorization
    if (typeof data !== "object") {
      return colorizeJson(data, isDarkTheme, showBraces, showQuotes, queryString, false, true);
    }

    const currentColors = getThemeColors(isDarkTheme);
    const keys = Object.keys(data);
    let result = showBraces ? "{" : "";

    // Process fields in chunks of 10 to avoid blocking
    const chunkSize = 10;
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunkKeys = keys.slice(i, Math.min(i + chunkSize, keys.length));
      let chunkHtml = "";

      for (const key of chunkKeys) {
        const value = data[key];

        // Add key
        chunkHtml += `<span style="color: ${currentColors.key}">${showQuotes ? '"' : ''}${escapeHtml(key)}${showQuotes ? '"' : ''}</span>: `;

        // Add value (truncate individual fields if >100KB)
        let processedValue = value;
        if (typeof value === "string" && value.length > 100000) {
          processedValue = value.substring(0, 100000) + `... [field truncated, ${value.length} chars]`;
        } else if (typeof value === "object" && value !== null) {
          const valueStr = JSON.stringify(value);
          if (valueStr.length > 100000) {
            processedValue = valueStr.substring(0, 100000) + `... [field truncated, ${valueStr.length} chars]`;
          }
        }

        // Colorize the value (without highlighting for performance)
        const colorizedValue = colorizeJson(processedValue, isDarkTheme, showBraces, showQuotes, "", false, true);
        chunkHtml += colorizedValue;

        // Add comma if not last
        if (key !== keys[keys.length - 1]) {
          chunkHtml += ", ";
        }
      }

      result += chunkHtml;

      // Call callback with current result if provided
      if (onChunk) {
        onChunk(result + (showBraces ? "}" : ""));
      }

      // Yield to event loop every chunk
      if (i + chunkSize < keys.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    result += showBraces ? "}" : "";
    return result;
  }

  return {
    colorizeJson,
    colorizeJsonProgressive, // New progressive rendering function
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
