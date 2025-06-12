/**
 * Memory Leak Detector Utility
 * Use this to monitor and detect memory leaks in dashboard components
 */

class MemoryLeakDetector {
  constructor() {
    this.detachedNodesCount = 0;
    this.observer = null;
    this.isMonitoring = false;
  }

  /**
   * Start monitoring for detached nodes
   */
  startMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    
    // Create a mutation observer to detect DOM changes
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the removed node has Vue component data
              if (node.__vue__ || node._vnode || node.__vueParentComponent) {
                console.warn('Potential Vue component detached:', node);
                this.detachedNodesCount++;
              }
            }
          });
        }
      });
    });

    // Start observing the entire document
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('Memory leak detector started');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.isMonitoring = false;
    console.log('Memory leak detector stopped');
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage() {
    if (performance.memory) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        detachedNodesCount: this.detachedNodesCount
      };
    }
    return null;
  }

  /**
   * Log memory usage
   */
  logMemoryUsage(label = 'Memory Usage') {
    const usage = this.getMemoryUsage();
    if (usage) {
      console.group(label);
      console.log(`Used JS Heap: ${(usage.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Total JS Heap: ${(usage.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`JS Heap Limit: ${(usage.jsHeapSizeLimit / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Detached Nodes Detected: ${usage.detachedNodesCount}`);
      console.groupEnd();
    }
  }

  /**
   * Check for specific dashboard-related detached nodes
   */
  checkDashboardNodes() {
    const gridItems = document.querySelectorAll('.vue-grid-item');
    const panelContainers = document.querySelectorAll('.panelcontainer');
    
    console.group('Dashboard Node Check');
    console.log(`Grid Items: ${gridItems.length}`);
    console.log(`Panel Containers: ${panelContainers.length}`);
    
    // Check for nodes that might be detached
    gridItems.forEach((item, index) => {
      if (!item.isConnected) {
        console.warn(`Detached grid item ${index}:`, item);
      }
    });
    
    panelContainers.forEach((container, index) => {
      if (!container.isConnected) {
        console.warn(`Detached panel container ${index}:`, container);
      }
    });
    
    console.groupEnd();
  }

  /**
   * Force garbage collection (if available)
   */
  forceGC() {
    if (window.gc) {
      window.gc();
      console.log('Garbage collection triggered');
    } else {
      console.warn('Garbage collection not available. Start Chrome with --js-flags="--expose-gc"');
    }
  }

  /**
   * Reset detector
   */
  reset() {
    this.detachedNodesCount = 0;
    console.log('Memory leak detector reset');
  }
}

// Export singleton instance
export const memoryLeakDetector = new MemoryLeakDetector();

// Auto-start in development mode
if (process.env.NODE_ENV === 'development') {
  // Start monitoring after a delay to avoid initial DOM setup noise
  setTimeout(() => {
    memoryLeakDetector.startMonitoring();
  }, 5000);
  
  // Log memory usage every 30 seconds
  setInterval(() => {
    memoryLeakDetector.logMemoryUsage('Periodic Memory Check');
  }, 30000);
}

// Add to window for manual debugging
if (typeof window !== 'undefined') {
  window.memoryLeakDetector = memoryLeakDetector;
} 