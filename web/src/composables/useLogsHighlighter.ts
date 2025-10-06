/**
 * Logs Highlighting Composable
 * ============================
 *
 * Extracted from LogsHighlighting.vue for reusability and performance optimization.
 * Provides the core highlighting logic that can be used with caching.
 */

import { useTextHighlighter } from "@/composables/useTextHighlighter";
import { getThemeColors } from "@/utils/logs/keyValueParser";
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { searchState } from "@/composables/useLogs/searchState";

const processedResults = ref({});

export function useLogsHighlighter() {
  const store = useStore();
  const currentColors = ref(getThemeColors(store.state.theme === "dark"));
  const { searchObj } = searchState();

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
   */
  async function processHitsInChunks(
    hits: any[],
    columns: any[],
    clearCache: boolean,
    queryString: string = "",
    chunkSize: number = 50,
    selectedStreamFtsKeys: string[] = [],
  ): Promise<{ [key: string]: string }> {
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

    await new Promise((resolve) => setTimeout(resolve, 0));
    // Process each chunk with await to prevent blocking
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      await new Promise((resolve) => setTimeout(resolve, 0));

      const chunk = chunks[chunkIndex];

      // Process chunk items - one hit at a time
      for (let itemIndex = 0; itemIndex < chunk.length; itemIndex++) {
        const hit = chunk[itemIndex];
        const rowIndex = chunkIndex * chunkSize + itemIndex;

        // Process all columns for this hit
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
          const cacheKey = `${columns[columnIndex].id}_${rowIndex}`;

          await new Promise((resolve) => setTimeout(resolve, 0));
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

          processedResults.value[cacheKey] = processedHtml;
        }
      }

      // Yield to browser between chunks to keep UI responsive
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    console.log("Return ----");
    return processedResults.value;
  }

  const clearCache = () => {
    // processedResults.value = {};
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

    // Status codes
    if (/^[1-5]\d{2}$/.test(trimmed)) return "status-code";

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
        keyContent += '"';
      }

      // Process key content WITHOUT highlighting - keys should never be highlighted
      keyContent += `${escapeHtml(key)}`;

      // Add closing quote for key if needed
      if (showQuotes) {
        keyContent += '"';
      }
      parts.push(keyContent);
      parts.push('<span class="log-separator">:</span>'); // Colon separator

      // VALUES: Colored based on type + highlighted if matches search
      if (value === null) {
        parts.push(
          createStyledSpanWithClasses("null", "null", queryString, showQuotes),
        );
      } else if (typeof value === "boolean") {
        parts.push(
          createStyledSpanWithClasses(
            String(value),
            "boolean",
            queryString,
            showQuotes,
          ),
        );
      } else if (typeof value === "number") {
        const numType = String(value).length >= 13 ? "timestamp" : "number";
        parts.push(
          createStyledSpanWithClasses(
            String(value),
            numType,
            queryString,
            numType !== "timestamp",
          ),
        );
      } else if (typeof value === "string") {
        // STRING VALUES: Detect semantic type and use appropriate class
        if (isLogLineWithMixedContent(value)) {
          // Mixed content processing (HTTP logs with IPs, URLs, etc.)
          // For now, use simplified processing to reduce complexity
          const processedLine = processTextWithHighlights(
            value,
            queryString,
            currentColors,
            false,
          );
          parts.push(showQuotes ? `"${processedLine}"` : processedLine);
        } else {
          // Regular string processing with semantic detection
          processTextWithHighlights(
            value,
            queryString,
            currentColors,
            showQuotes,
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
            showQuotes,
          );
        }
      } else if (typeof data === "boolean") {
        return createStyledSpan(
          String(data),
          currentColors.booleanValue,
          queryString,
          showQuotes,
        );
      } else if (data === null) {
        return createStyledSpan(
          "null",
          currentColors.nullValue,
          queryString,
          showQuotes,
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
  };
}
