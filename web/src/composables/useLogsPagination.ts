/**
 * useLogsPagination.ts
 * 
 * Manages pagination logic and calculations for the logs module.
 * Handles page calculations, row management, and navigation state for log results.
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { 
  UseLogsPagination,
  SearchObject
} from './INTERFACES_AND_TYPES';

/**
 * Pagination Composable
 * 
 * Provides comprehensive pagination functionality including:
 * - Page size management (rows per page)
 * - Page navigation calculations
 * - Result count calculations
 * - Pagination state management
 * - Offset calculations for queries
 */
export default function useLogsPagination(
  searchObj: Ref<SearchObject>
): UseLogsPagination {

  // ========================================
  // REACTIVE STATE
  // ========================================

  // Cached pagination data to prevent recalculations
  const cachedPagination = ref<{
    totalPages: number;
    totalHits: number;
    from: number;
    to: number;
  }>({
    totalPages: 0,
    totalHits: 0,
    from: 0,
    to: 0
  });

  // Loading state for pagination changes
  const paginationLoading = ref<boolean>(false);

  // ========================================
  // COMPUTED PROPERTIES
  // ========================================

  const currentPage: ComputedRef<number> = computed(() => 
    searchObj.value.data.resultGrid.currentPage
  );

  const rowsPerPage: ComputedRef<number> = computed(() => 
    searchObj.value.meta.resultGrid.rowsPerPage
  );

  const totalHits: ComputedRef<number> = computed(() => 
    searchObj.value.data.queryResults.total || 0
  );

  const hits: ComputedRef<any[]> = computed(() => 
    searchObj.value.data.queryResults.hits || []
  );

  const totalPages: ComputedRef<number> = computed(() => {
    const total = totalHits.value;
    const perPage = rowsPerPage.value;
    return perPage > 0 ? Math.ceil(total / perPage) : 0;
  });

  const hasNextPage: ComputedRef<boolean> = computed(() => 
    currentPage.value < totalPages.value
  );

  const hasPreviousPage: ComputedRef<boolean> = computed(() => 
    currentPage.value > 1
  );

  const startIndex: ComputedRef<number> = computed(() => 
    (currentPage.value - 1) * rowsPerPage.value + 1
  );

  const endIndex: ComputedRef<number> = computed(() => {
    const end = currentPage.value * rowsPerPage.value;
    return Math.min(end, totalHits.value);
  });

  const offset: ComputedRef<number> = computed(() => 
    (currentPage.value - 1) * rowsPerPage.value
  );

  const isEmpty: ComputedRef<boolean> = computed(() => 
    totalHits.value === 0
  );

  const isFirstPage: ComputedRef<boolean> = computed(() => 
    currentPage.value === 1
  );

  const isLastPage: ComputedRef<boolean> = computed(() => 
    currentPage.value === totalPages.value
  );

  // ========================================
  // PAGE NAVIGATION FUNCTIONS
  // ========================================

  /**
   * Navigates to the first page
   */
  const goToFirstPage = (): void => {
    if (!isFirstPage.value && !paginationLoading.value) {
      searchObj.value.data.resultGrid.currentPage = 1;
    }
  };

  /**
   * Navigates to the last page
   */
  const goToLastPage = (): void => {
    if (!isLastPage.value && !paginationLoading.value) {
      searchObj.value.data.resultGrid.currentPage = totalPages.value;
    }
  };

  /**
   * Navigates to the next page if available
   */
  const goToNextPage = (): void => {
    if (hasNextPage.value && !paginationLoading.value) {
      searchObj.value.data.resultGrid.currentPage++;
    }
  };

  /**
   * Navigates to the previous page if available
   */
  const goToPreviousPage = (): void => {
    if (hasPreviousPage.value && !paginationLoading.value) {
      searchObj.value.data.resultGrid.currentPage--;
    }
  };

  /**
   * Navigates to a specific page
   * 
   * @param pageNumber The page number to navigate to (1-based)
   * @returns True if navigation was successful
   */
  const goToPage = (pageNumber: number): boolean => {
    if (paginationLoading.value) return false;

    // Validate page number
    const validPageNumber = Math.max(1, Math.min(pageNumber, totalPages.value));
    
    if (validPageNumber !== currentPage.value) {
      searchObj.value.data.resultGrid.currentPage = validPageNumber;
      return true;
    }
    
    return false;
  };

  // ========================================
  // ROWS PER PAGE MANAGEMENT
  // ========================================

  /**
   * Sets the number of rows per page
   * Resets to first page when page size changes
   * 
   * @param size Number of rows per page
   */
  const setRowsPerPage = (size: number): void => {
    if (size > 0 && size !== rowsPerPage.value) {
      searchObj.value.meta.resultGrid.rowsPerPage = size;
      searchObj.value.data.resultGrid.currentPage = 1;
    }
  };

  /**
   * Gets available rows per page options
   * 
   * @returns Array of available page size options
   */
  const getRowsPerPageOptions = (): number[] => {
    return [10, 25, 50, 100, 250, 500, 1000];
  };

  // ========================================
  // PAGINATION INFO CALCULATIONS
  // ========================================

  /**
   * Gets comprehensive pagination information
   * 
   * @returns Object containing all pagination state
   */
  const getPaginationInfo = (): {
    currentPage: number;
    totalPages: number;
    rowsPerPage: number;
    totalHits: number;
    startIndex: number;
    endIndex: number;
    offset: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    isFirstPage: boolean;
    isLastPage: boolean;
    isEmpty: boolean;
  } => {
    return {
      currentPage: currentPage.value,
      totalPages: totalPages.value,
      rowsPerPage: rowsPerPage.value,
      totalHits: totalHits.value,
      startIndex: startIndex.value,
      endIndex: endIndex.value,
      offset: offset.value,
      hasNextPage: hasNextPage.value,
      hasPreviousPage: hasPreviousPage.value,
      isFirstPage: isFirstPage.value,
      isLastPage: isLastPage.value,
      isEmpty: isEmpty.value,
    };
  };

  /**
   * Gets pagination display text
   * 
   * @returns Human-readable pagination status string
   */
  const getPaginationText = (): string => {
    if (isEmpty.value) {
      return "No results found";
    }
    
    return `Showing ${startIndex.value} to ${endIndex.value} of ${totalHits.value} results`;
  };

  /**
   * Gets page numbers for pagination navigation
   * Shows a range of pages around the current page
   * 
   * @param maxPages Maximum number of page links to show (default: 5)
   * @returns Array of page numbers to display
   */
  const getPageNumbers = (maxPages: number = 5): number[] => {
    const total = totalPages.value;
    const current = currentPage.value;
    const pages: number[] = [];

    if (total <= maxPages) {
      // Show all pages if total is less than max
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }
    } else {
      // Calculate range around current page
      const half = Math.floor(maxPages / 2);
      let start = Math.max(1, current - half);
      let end = Math.min(total, current + half);

      // Adjust if we're near the beginning or end
      if (end - start + 1 < maxPages) {
        if (start === 1) {
          end = Math.min(total, start + maxPages - 1);
        } else {
          start = Math.max(1, end - maxPages + 1);
        }
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
    }

    return pages;
  };

  // ========================================
  // CACHE MANAGEMENT
  // ========================================

  /**
   * Updates cached pagination data
   * Useful for optimizing re-renders
   */
  const updatePaginationCache = (): void => {
    cachedPagination.value = {
      totalPages: totalPages.value,
      totalHits: totalHits.value,
      from: startIndex.value,
      to: endIndex.value
    };
  };

  /**
   * Clears pagination cache
   */
  const clearPaginationCache = (): void => {
    cachedPagination.value = {
      totalPages: 0,
      totalHits: 0,
      from: 0,
      to: 0
    };
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Resets pagination to first page
   */
  const resetPagination = (): void => {
    searchObj.value.data.resultGrid.currentPage = 1;
    clearPaginationCache();
  };

  /**
   * Validates if a page number is valid
   * 
   * @param pageNumber Page number to validate
   * @returns True if page number is valid
   */
  const isValidPageNumber = (pageNumber: number): boolean => {
    return pageNumber >= 1 && pageNumber <= totalPages.value;
  };

  /**
   * Calculates the query offset for the current page
   * Used by search queries to skip the appropriate number of results
   * 
   * @returns Offset value for database queries
   */
  const getQueryOffset = (): number => {
    return Math.max(0, (currentPage.value - 1) * rowsPerPage.value);
  };

  /**
   * Calculates the query limit for the current page
   * 
   * @returns Limit value for database queries
   */
  const getQueryLimit = (): number => {
    return rowsPerPage.value;
  };

  /**
   * Sets pagination loading state
   * 
   * @param loading Loading state
   */
  const setPaginationLoading = (loading: boolean): void => {
    paginationLoading.value = loading;
  };

  // ========================================
  // RETURN INTERFACE
  // ========================================

  return {
    // Computed State
    currentPage,
    rowsPerPage,
    totalHits,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    startIndex,
    endIndex,
    offset,
    isEmpty,
    isFirstPage,
    isLastPage,
    hits,

    // Navigation Functions
    goToFirstPage,
    goToLastPage,
    goToNextPage,
    goToPreviousPage,
    goToPage,

    // Configuration
    setRowsPerPage,
    getRowsPerPageOptions,

    // Information Functions
    getPaginationInfo,
    getPaginationText,
    getPageNumbers,

    // Query Helpers
    getQueryOffset,
    getQueryLimit,

    // Cache Management
    updatePaginationCache,
    clearPaginationCache,
    
    // Utility Functions
    resetPagination,
    isValidPageNumber,
    setPaginationLoading,

    // Direct access to reactive refs
    paginationLoading,
    cachedPagination,
  };
}