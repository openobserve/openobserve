// Copyright 2023 OpenObserve Inc.
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

import { ref, watch, onMounted, onBeforeUnmount } from "vue";

export function useStickyColumns(props: any, store: any) {
  const stickyColumnOffsets = ref<{ [key: string]: number }>({});
  let styleElement: HTMLStyleElement | null = null;

  // Watch for columns changes to update sticky offsets
  watch(
    () => props.data?.columns,
    (columns: any[]) => {
      const offsets: { [key: string]: number } = {};
      let cumulativeWidth = 0;

      if (columns) {
        columns.forEach((col: any, idx: number) => {
          // Add index attribute for CSS targeting
          col.__colIndex = idx;

          if (col.sticky) {
            offsets[col.name] = cumulativeWidth;
            cumulativeWidth += col.width ? parseInt(String(col.width)) : 100;
          }
        });
      }

      stickyColumnOffsets.value = offsets;
    },
    { immediate: true, deep: true },
  );

  const getStickyColumnStyle = (column: any) => {
    if (!column?.sticky) return {};

    // Get the precomputed left offset for this column
    const leftOffset = stickyColumnOffsets.value[column.name] ?? 0;

    return {
      position: "sticky",
      left: `${leftOffset}px`,
      "z-index": 2,
      "background-color": store.state.theme === "dark" ? "#1a1a1a" : "#fff",
      "box-shadow": "2px 0 4px rgba(0, 0, 0, 0.1)",
    };
  };

  const updateStickyColumnStyles = () => {
    // Remove old style element if it exists
    if (styleElement?.parentNode) {
      styleElement.parentNode.removeChild(styleElement);
    }

    // Create new style element with current offsets
    styleElement = document.createElement("style");
    styleElement.setAttribute("data-sticky-styles", "true");

    const columns = (props.data?.columns || []) as any[];
    const bgColor = store.state.theme === "dark" ? "#1a1a1a" : "#fff";
    let css = "";

    // Generate CSS rules for each column position
    columns.forEach((col: any, colIndex: number) => {
      if (col.sticky) {
        const offset = stickyColumnOffsets.value[col.name] ?? 0;
        // Target header and body cells by their actual nth-child position (1-based)
        // Headers get position sticky, left offset, and higher z-index
        // Body cells with sticky-column class get the same positioning
        css += `
          .my-sticky-virtscroll-table thead tr th:nth-child(${colIndex + 1}) {
            position: sticky !important;
            left: ${offset}px !important;
            z-index: 4 !important;
            background-color: ${bgColor} !important;
            box-shadow: 2px 0 4px rgba(0, 0, 0, 0.1) !important;
          }
          .my-sticky-virtscroll-table tbody td:nth-child(${colIndex + 1}).sticky-column {
            left: ${offset}px !important;
          }
        `;
      }
    });

    // Add base styling for all sticky columns
    css =
      `
      /* Sticky body cells */
      .my-sticky-virtscroll-table tbody td.sticky-column {
        position: sticky !important;
        z-index: 2 !important;
        box-shadow: 2px 0 4px rgba(0, 0, 0, 0.1) !important;
      }

      /* Column-specific positions for headers and body cells */
    ` + css;

    styleElement.textContent = css;
    document.head.appendChild(styleElement);
  };

  // Watch sticky column offsets and update styles
  watch(() => stickyColumnOffsets.value, updateStickyColumnStyles, {
    deep: true,
  });

  // Watch theme changes and update styles
  watch(() => store.state.theme, updateStickyColumnStyles);

  onMounted(() => {
    updateStickyColumnStyles();
  });

  onBeforeUnmount(() => {
    if (styleElement?.parentNode) {
      styleElement.parentNode.removeChild(styleElement);
    }
  });

  return {
    stickyColumnOffsets,
    getStickyColumnStyle,
  };
}
