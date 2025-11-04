<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.

-->


<!--
LogsHighLighting Component
===============================
A Vue component that intelligently colorizes JSON data and log lines with syntax highlighting and keyword highlighting.

Features:
- Colorizes JSON objects with different colors for keys, values, and structural elements
- Detects and highlights semantic types in log lines (IPs, URLs, timestamps, etc.)
- Highlights matching keywords from query strings with yellow background
- Theme-aware coloring that adapts to light/dark modes
- Handles primitive values (strings, numbers, booleans, null)
- Smart tokenization that preserves quoted strings and bracketed content

Usage Examples:
- <LogsHighLighting :data="{name: 'John', age: 25}" />  // JSON object
- <LogsHighLighting :data="'192.168.1.1'" :query-string="match_all('192')" />  // IP with highlighting
- <LogsHighLighting :data="false" />  // Boolean value
- <LogsHighLighting :data="1234567890123" />  // Timestamp-like number
-->
<template>
  <span class="logs-highlight-json" v-html="colorizedJson"></span>
</template>

<script setup lang="ts">
import { computed, ref, watch, withDefaults } from "vue";
import { getThemeColors } from "@/utils/logs/keyValueParser";
import { useStore } from "vuex";
import { useTextHighlighter } from "@/composables/useTextHighlighter";

/**
 * Component Props Interface
 */
interface Props {
  data: any;
  showBraces?: boolean;
  showQuotes?: boolean;
  queryString?: string;
  simpleMode?: boolean; // Only highlighting, no semantic colorization
}

const props = withDefaults(defineProps<Props>(), {
  showBraces: true,
  showQuotes: false,
  queryString: "",
  simpleMode: false,
});

const store = useStore();
const { processTextWithHighlights, escapeHtml, splitTextByKeywords, extractKeywords } = useTextHighlighter();

/**
 * Color Theme Management
 * Cache colors and watch for theme changes
 */
const currentColors = ref(getThemeColors(store.state.theme === "dark"));

watch(
  () => store.state.theme,
  (newTheme) => {
    currentColors.value = getThemeColors(newTheme === "dark");
  },
);

/**
 * Simple highlighting without semantic colorization 
 * that is when it is not fts key right we dont want to apply color to it so then we just highlight the text if query string is there that is if user
 * added match_all or fuzzy_match_all in the query string
 * if not we will simply return the text as it is without adding any color to it
 * if query string is there we will highlight the text with yellow background
 */
function simpleHighlight(text: string, queryString: string): string {
  if (!text || !queryString) return escapeHtml(text);
  
  const keywords = extractKeywords(queryString);
  const parts = splitTextByKeywords(text, keywords);
  
  return parts.map(part => {
    if (part.isHighlighted) {
      return `<span style="background-color: rgb(255, 213, 0);">${escapeHtml(part.text)}</span>`;
    } else {
      return escapeHtml(part.text);
    }
  }).join('');
}

/**
 * Main colorization logic with integrated highlighting
 */
const colorizedJson = computed((): string => {
  if (props.data === null || props.data === undefined) {
    return "";
  }


  // Simple mode: only highlighting, no semantic colorization
  if (props.simpleMode) {
    const textStr = String(props.data);
    return simpleHighlight(textStr, props.queryString);
  }

  // Handle single string values with semantic colorization and highlighting
  if (typeof props.data === "string") {
    return processTextWithHighlights(
      props.data, 
      props.queryString, 
      currentColors.value, 
      props.showQuotes
    );
  }

  // Handle primitive data types
  if (typeof props.data !== "object") {
    const dataStr = String(props.data);
    
    if (typeof props.data === "number") {
      // Detect timestamp-like numbers
      if (dataStr.length >= 13) {
        return createStyledSpan(dataStr, currentColors.value.timestamp, props.queryString, props.showQuotes);
      } else {
        return createStyledSpan(dataStr, currentColors.value.numberValue, props.queryString, props.showQuotes);
      }
    } else if (typeof props.data === "boolean") {
      return createStyledSpan(String(props.data), currentColors.value.booleanValue, props.queryString, props.showQuotes);
    } else if (props.data === null) {
      return createStyledSpan("null", currentColors.value.nullValue, props.queryString, props.showQuotes);
    } else {
      return processTextWithHighlights(
        dataStr, 
        props.queryString, 
        currentColors.value, 
        props.showQuotes
      );
    }
  }

  // Handle complex objects with full JSON colorization
  //this is for objects and arrays if any
  try {
    return colorizeObject(props.data, currentColors.value, props.showBraces, props.showQuotes, props.queryString);
  } catch (error) {
    return escapeHtml(JSON.stringify(props.data));
  }
});

/**
 * Creates a styled span with optional highlighting for simple values
 * Quotes are always shown when requested, background only highlights content
 */
function createStyledSpan(text: string, color: string, queryString: string, showQuotes: boolean = false): string {
  const keywords = extractKeywords(queryString);
  const highlightParts = splitTextByKeywords(text, keywords);
  
  let result = '';
  
  // Add opening quote if needed
  if (showQuotes) {
    result += `<span style="color: ${color};">"</span>`;
  }
  
  // Process content with highlighting
  result += highlightParts.map(part => {
    const style = part.isHighlighted 
      ? 'background-color: rgb(255, 213, 0); color: black;'
      : `color: ${color};`;
    return `<span style="${style}">${escapeHtml(part.text)}</span>`;
  }).join('');
  
  // Add closing quote if needed
  if (showQuotes) {
    result += `<span style="color: ${color};">"</span>`;
  }
  
  return result;
}

/**
 * Colorizes JSON objects with integrated highlighting
 * 
 * Example input: {level: "error", ip: "192.168.1.1", count: 42, active: true, data: null}
 * Example output: Colored HTML with red keys, semantic value colors, and yellow highlighting for matches
 */
function colorizeObject(obj: any, colors: any, showBraces = true, showQuotes = false, queryString = ""): string {
  const parts: string[] = [];
  const keywords = extractKeywords(queryString);
  
  // Add opening brace: "{"
  if (showBraces) {
    parts.push('<span style="color: #9ca3af;">{</span>');
  }

  const entries = Object.entries(obj);
  entries.forEach(([key, value], index) => {
    // KEYS: Always colored, never highlighted
    // Example: "level" → <span style="color: #B71C1C;">level</span>
    let keyContent = '';
    
    // Add opening quote for key if needed: "level" vs level
    if (showQuotes) {
      keyContent += `<span style="color: ${colors.key};">"</span>`;
    }
    
    // Process key content WITHOUT highlighting - keys should never be highlighted
    keyContent += `<span style="color: ${colors.key};">${escapeHtml(key)}</span>`;
    
    // Add closing quote for key if needed
    if (showQuotes) {
      keyContent += `<span style="color: ${colors.key};">"</span>`;
    }
    parts.push(keyContent);
    parts.push('<span style="color: #9ca3af;">:</span>'); // Colon separator

    // VALUES: Colored based on type + highlighted if matches search
    if (value === null) {
      // Example: null → <span style="color: #6B7280;">null</span>
      parts.push(createStyledSpan("null", colors.nullValue, queryString, showQuotes));
    } else if (typeof value === "boolean") {
      // Example: true → <span style="color: #6D28D9;">true</span>
      parts.push(createStyledSpan(String(value), colors.booleanValue, queryString, showQuotes));
    } else if (typeof value === "number") {
      // Example: 42 → <span style="color: #2563EB;">42</span>
      parts.push(createStyledSpan(String(value), colors.numberValue, queryString, showQuotes));
    } else if (typeof value === "string") {
      // STRING VALUES: Most complex case with semantic detection
      // Check if this looks like a log line with mixed content
      // Example: "GET /api/users 192.168.1.1 200" (has HTTP + IP)
      if (isLogLineWithMixedContent(value)) {
        // Mixed content processing (HTTP logs with IPs, URLs, etc.)
        const processedLine = processTextWithHighlights(value, queryString, colors, false);
        parts.push(showQuotes ? `"${processedLine}"` : processedLine);
      } else {
        // Regular string processing with semantic detection
        // Example: "192.168.1.1" → IP color, "error message" → string color + highlighting
        const processedValue = processTextWithHighlights(value, queryString, colors, showQuotes);
        parts.push(processedValue);
      }
    } else if (typeof value === "object") {
      // NESTED OBJECTS/ARRAYS: Convert to JSON string and treat as object value
      // Example: {user: "john"} → <span style="color: #4B5563;">{"user":"john"}</span>
      const objStr = JSON.stringify(value);
      parts.push(createStyledSpan(objStr, colors.objectValue, queryString, showQuotes));
    } else {
      // FALLBACK: Any other type (functions, symbols, etc.)
      // Convert to string and process normally
      const strValue = String(value);
      const processedValue = processTextWithHighlights(strValue, queryString, colors, showQuotes);
      parts.push(processedValue);
    }

    // Add comma separator (except for last item): ","
    if (index < entries.length - 1) {
      parts.push('<span style="color: #9ca3af;">,</span>');
    }
  });

  // Add closing brace: "}"
  if (showBraces) {
    parts.push('<span style="color: #9ca3af;">}</span>');
  }
  return parts.join("");
}

/**
 * Checks if a value looks like a log line with mixed content (HTTP/web server logs)
 * Returns true ONLY if BOTH HTTP indicators AND semantic types are present
 * 
 * Examples that return TRUE:
 * - "GET /api/users 192.168.1.1 200" (has GET + IP)
 * - "POST https://api.com user@email.com 201" (has POST + URL + email)
 * - "HTTP/1.1 200 OK from 127.0.0.1" (has HTTP/ + IP)
 * - "[01/Jan/2023:12:00:00 +0000] GET /home 192.168.1.1" (has timestamp + GET + IP)
 * 
 * Examples that return FALSE:
 * - "192.168.1.1 connection failed" (has IP but NO HTTP indicators)
 * - "GET /api/users" (has GET but no semantic types like IPs/URLs)
 * - "Error connecting to database" (no HTTP or semantic types)
 * - "https://example.com is down" (has URL but no HTTP method/protocol)
 */
function isLogLineWithMixedContent(value: string): boolean {
  const str = value.trim();
  
  // HTTP INDICATORS: Look for web server/HTTP protocol signs
  const hasHttpIndicators =
    str.includes("HTTP/") ||                                         // "HTTP/1.1", "HTTP/2.0"
    /"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/.test(str) ||      // Quoted methods: "GET /path"
    /\s(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/.test(str);       // Space-separated: " GET /path "

  // SEMANTIC TYPES: Look for network-related data patterns
  const hasSemanticTypes =
    str.match(/\d+\.\d+\.\d+\.\d+/) !== null ||                     // IP addresses: "192.168.1.1"
    str.match(/https?:\/\/[^\s"]+/) !== null ||                     // URLs: "https://example.com"
    str.match(/[^\s@"]+@[^\s@"]+\.[^\s@"]+/) !== null ||            // Emails: "user@domain.com"
    str.match(/\[\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}/) !== null; // Apache timestamps: "[01/Jan/2023:12:00:00"

  // MUST HAVE BOTH: HTTP activity + network/semantic data
  return hasHttpIndicators && hasSemanticTypes;
}
</script>

<style scoped>
.logs-highlight-json {
  font-family: monospace;
  font-size: 12px;
  word-break: break-word;
  display: inline;
}
</style>