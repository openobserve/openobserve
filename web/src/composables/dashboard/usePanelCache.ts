/**
 * This is the IndexedDB-based cache implementation for panel level cache data
 * Database structure:
 * - Database: 'PanelCache'
 * - Object Store: 'panels'
 * - Key format: 'folder_id:dashboard_id:panel_id'
 * - Value: { key, value, cacheTimeRange, timestamp }
 */

const DB_NAME = "PanelCache";
const DB_VERSION = 1;
const STORE_NAME = "panels";

declare global {
  interface Window {
    _o2_removeDashboardCache: () => Promise<void>;
    _o2_getDashboardCache: () => Promise<any>;
  }
}

// Initialize IndexedDB
const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("folderId", "folderId", { unique: false });
        store.createIndex("dashboardId", "dashboardId", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  });
};

// Helper function to generate cache key
const generateCacheKey = (
  folderId: string,
  dashboardId: string,
  panelId: string,
): string => {
  return `${folderId}:${dashboardId}:${panelId}`;
};

// Helper function to perform IndexedDB transactions
const performTransaction = async <T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await initDB();
  const transaction = db.transaction([STORE_NAME], mode);
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// Global cache management functions
window._o2_removeDashboardCache = async (): Promise<void> => {
  try {
    await performTransaction("readwrite", (store) => store.clear());
  } catch (error) {
    console.error("Error clearing dashboard cache:", error);
  }
};

window._o2_getDashboardCache = async (): Promise<any> => {
  try {
    const allRecords = await performTransaction("readonly", (store) =>
      store.getAll(),
    );
    const cache: any = {};

    allRecords.forEach((record: any) => {
      const [folderId, dashboardId, panelId] = record.id.split(":");

      if (!cache[folderId]) cache[folderId] = {};
      if (!cache[folderId][dashboardId]) cache[folderId][dashboardId] = {};

      cache[folderId][dashboardId][panelId] = {
        key: record.key,
        value: record.value,
        cacheTimeRange: record.cacheTimeRange,
        timestamp: record.timestamp,
      };
    });

    return cache;
  } catch (error) {
    console.error("Error getting dashboard cache:", error);
    return {};
  }
};

/**
 * Use Panel Cache Data on a per dashboard basis in combination with folderid, dashboard id and panel id
 */
export const usePanelCache = (
  folderId: string,
  dashboardId: string,
  panelId: string,
) => {
  if (!(folderId && dashboardId && panelId)) {
    const savePanelCache = async (
      key: any,
      data: any,
      cacheTimeRange: any,
    ): Promise<void> => {
      // do nothing
    };

    const getPanelCache = async (): Promise<null> => {
      return null;
    };

    return {
      savePanelCache,
      getPanelCache,
    };
  }

  const cacheKey = generateCacheKey(folderId, dashboardId, panelId);

  const savePanelCache = async (
    key: any,
    data: any,
    cacheTimeRange: any,
  ): Promise<void> => {
    try {
      const cacheData = {
        id: cacheKey,
        folderId,
        dashboardId,
        panelId,
        key: JSON.parse(JSON.stringify(key)), // deep copy key
        value: JSON.parse(JSON.stringify(data)), // deep copy data
        cacheTimeRange: JSON.parse(JSON.stringify(cacheTimeRange)),
        timestamp: new Date().getTime(),
      };

      await performTransaction("readwrite", (store) => store.put(cacheData));
    } catch (error) {
      console.error("Error saving panel cache:", error);
    }
  };

  const getPanelCache = async (): Promise<any> => {
    try {
      const result = await performTransaction("readonly", (store) =>
        store.get(cacheKey),
      );

      if (result) {
        return {
          key: result.key,
          value: result.value,
          cacheTimeRange: result.cacheTimeRange,
          timestamp: result.timestamp,
        };
      }

      return null;
    } catch (error) {
      console.error("Error getting panel cache:", error);
      return null;
    }
  };

  return {
    savePanelCache,
    getPanelCache,
  };
};
