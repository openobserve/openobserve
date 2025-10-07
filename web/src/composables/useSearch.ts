interface OrderByField {
    0: string;
    1: "asc" | "desc" | "ASC" | "DESC";
}

type OrderByArray = OrderByField[];
interface RecordObject {
    [key: string]: any;
}
interface RecordWithTimestamp {
    [key: string]: any;
}

const useSearch = () => {
  function getTsValue(tsColumn: string, record: RecordWithTimestamp): number {
    const ts = record[tsColumn];

    if (ts === undefined || ts === null) return 0;

    if (typeof ts === 'string') {
      const timestamp = Date.parse(ts);
      return timestamp * 1000;
    }

    if (typeof ts === 'number') return ts;

    return 0;
  }


  function sortResponse(
    responseObj: RecordObject[],
    tsColumn: string,
    orderBy: OrderByArray
  ): void {
    if (!Array.isArray(orderBy) || orderBy.length === 0) return;

    responseObj.sort((a: RecordObject, b: RecordObject) => {
      for (const entry of orderBy) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [field, order] = entry;
        let cmp = 0;

        if (field === tsColumn) {
          const aTs = getTsValue(tsColumn, a);
          const bTs = getTsValue(tsColumn, b);
          cmp = aTs - bTs;
        } else {
          const aVal = a[field] ?? null;
          const bVal = b[field] ?? null;

          if (typeof aVal === 'string' && typeof bVal === 'string') {
            cmp = aVal.localeCompare(bVal);
          } else if (typeof aVal === 'number' && typeof bVal === 'number') {
            cmp = aVal - bVal;
          } else if (typeof aVal === 'string' && typeof bVal === 'number') {
            cmp = -1;
          } else if (typeof aVal === 'number' && typeof bVal === 'string') {
            cmp = 1;
          } else {
            cmp = 0;
          }
        }

        const finalCmp = order === "desc" ? -cmp : cmp;
        if (finalCmp !== 0) return finalCmp;
      }
      return 0;
    });
  }

  return {
    sortResponse,
    getTsValue,
  }
  
}

export default useSearch;