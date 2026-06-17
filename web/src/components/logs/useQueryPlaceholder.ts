import { ref, computed, watch, onMounted, onBeforeUnmount, type Ref } from "vue";

interface StreamField {
  name: string;
  ftsKey?: boolean;
  isInterestingField?: boolean;
  dataType?: string;
  label?: boolean; // true for group header rows — must be excluded
}

interface FieldValueEntry {
  key: string;
  count: number;
}

interface FieldValuesState {
  isLoading: boolean;
  values: FieldValueEntry[];
  hasMore: boolean;
  errMsg: string;
}

interface Options {
  typeSpeedMs?: number;
  eraseSpeedMs?: number;
  holdMs?: number;
  initialDelayMs?: number;
  /** Override the text shown when no stream is selected. Default: "Select a stream first". */
  noStreamText?: string;
  /** When true, all example queries containing match_all() are omitted (e.g. traces page). */
  excludeMatchAll?: boolean;
}

const SYSTEM_FIELDS = new Set([
  "_timestamp",
  "_all",
  "_stream",
]);

const NUMERIC_TYPES = new Set(["Int64", "Float64", "UInt64", "Int32", "UInt32"]);

/**
 * Builds animated typewriter example queries from real stream field/value data.
 * Priority: interesting (key) fields → FTS fields → other fields.
 * Uses correct OpenObserve query syntax:
 *   - FTS fields  → match_all('term'), match_all('term*'), match_all('*term')
 *   - string cols → str_match(field, 'val'), str_match_ignore_case
 *   - numeric     → field=value / WHERE field >= value
 */
export function useQueryPlaceholder(
  fields: Ref<StreamField[]>,
  fieldValues: Ref<Record<string, FieldValuesState>>,
  sqlMode: Ref<boolean>,
  noStream: Ref<boolean>,
  options: Options = {},
) {
  const placeholder = ref("");

  const typeSpeed = options.typeSpeedMs ?? 45;
  const eraseSpeed = options.eraseSpeedMs ?? 22;
  const holdMs = options.holdMs ?? 2000;
  const initialDelay = options.initialDelayMs ?? 400;

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      clearTimer();
      timer = setTimeout(resolve, ms);
    });
  }

  // Build example query strings from available field+value data
  const examples = computed((): string[] => {
    if (noStream.value) return [options.noStreamText ?? "Select a stream first"];

    const f = fields.value;
    if (!f || f.length === 0) return [];

    const fv = fieldValues.value ?? {};
    const isSql = sqlMode.value;

    const realFields = f.filter((x) => !x.label);

    const interesting = realFields.filter(
      (x) => x.isInterestingField && !SYSTEM_FIELDS.has(x.name),
    );
    const ftsOnly = realFields.filter(
      (x) => x.ftsKey && !SYSTEM_FIELDS.has(x.name) && !x.isInterestingField,
    );
    const others = realFields
      .filter((x) => !x.isInterestingField && !x.ftsKey && !SYSTEM_FIELDS.has(x.name))
      .slice(0, 3);

    const strFields = realFields.filter(
      (x) => !SYSTEM_FIELDS.has(x.name) && !NUMERIC_TYPES.has(x.dataType ?? ""),
    ).slice(0, 3);

    const fieldExpr = (field: StreamField): string => {
      const name = field.name;
      const vals = fv[name]?.values ?? [];
      const firstVal = vals[0]?.key;
      const isNumeric = NUMERIC_TYPES.has(field.dataType ?? "");
      if (isNumeric) return `${name}=${firstVal ?? 200}`;
      return firstVal != null ? `${name}='${firstVal}'` : `${name}='value'`;
    };

    const fieldExprSql = (field: StreamField): string => {
      const name = field.name;
      const vals = fv[name]?.values ?? [];
      const firstVal = vals[0]?.key;
      const isNumeric = NUMERIC_TYPES.has(field.dataType ?? "");
      if (isNumeric) return `${name} >= ${firstVal ?? 500}`;
      return firstVal != null ? `${name} = '${firstVal}'` : `${name} = 'value'`;
    };

    const ftsVal = (field: StreamField): string => {
      const vals = fv[field.name]?.values ?? [];
      return vals[0]?.key ?? "error";
    };

    const strVal = (field: StreamField): string => {
      const vals = fv[field.name]?.values ?? [];
      return vals[0]?.key ?? "value";
    };

    const keyFields = [...interesting, ...others.filter((x) => !x.ftsKey)].slice(0, 4);
    const allFts = [...interesting.filter((x) => x.ftsKey), ...ftsOnly].slice(0, 4);
    const kf0 = keyFields[0];
    const kf1 = keyFields[1];
    const ff0 = allFts[0];
    const sf0 = strFields[0];

    if (isSql) {
      const result: string[] = [];
      if (kf0) {
        const base = `SELECT * FROM stream WHERE ${fieldExprSql(kf0)}`;
        result.push(base);
        if (kf1) result.push(`${base} AND ${fieldExprSql(kf1)}`);
        if (kf1) result.push(`${base} OR ${fieldExprSql(kf1)}`);
        if (!options.excludeMatchAll) {
          if (ff0) result.push(`SELECT * FROM stream WHERE match_all('${ftsVal(ff0)}')`);
          if (ff0 && kf1) result.push(`SELECT * FROM stream WHERE ${fieldExprSql(kf0)} AND match_all('${ftsVal(ff0)}')`);
        }
      }
      return result;
    }

    // Filter mode — interleaved variations covering raw filters, match_all, and other functions
    const result: string[] = [];
    const term = ff0 ? ftsVal(ff0) : "error";

    // 1. Simple raw filter
    if (kf0) result.push(fieldExpr(kf0));

    // 2. match_all exact
    result.push(`match_all('${term}')`);

    // 3. Raw filter AND match_all
    if (kf0) result.push(`${fieldExpr(kf0)} AND match_all('${term}')`);

    // 4. match_all prefix variant
    result.push(`match_all('${term}*')`);

    // 5. Two raw filters AND match_all (covers AND + OR operators together)
    if (kf0 && kf1) result.push(`${fieldExpr(kf0)} AND ${fieldExpr(kf1)} AND match_all('${term}')`);
    else if (kf0) result.push(`${fieldExpr(kf0)} OR match_all('${term}')`);

    // 6. match_all postfix variant
    result.push(`match_all('*${term}')`);

    // 7. standalone str_match — no match_all, shown on all pages including traces
    if (sf0) result.push(`str_match(${sf0.name}, '${strVal(sf0)}')`);

    // 8. Raw filter OR match_all postfix
    if (kf0) result.push(`${fieldExpr(kf0)} OR match_all('*${term}')`);

    const filtered = options.excludeMatchAll
      ? result.filter((q) => !q.includes("match_all"))
      : result;
    return filtered.slice(0, 9);
  });

  async function loop(): Promise<void> {
    let i = 0;
    await delay(initialDelay);
    while (!cancelled) {
      const list = examples.value;
      if (list.length === 0) {
        await delay(300);
        continue;
      }
      const target = list[i % list.length];
      for (let c = 1; c <= target.length; c++) {
        if (cancelled) return;
        placeholder.value = target.slice(0, c);
        await delay(typeSpeed);
      }
      await delay(holdMs);
      if (cancelled) return;
      for (let c = target.length - 1; c >= 0; c--) {
        if (cancelled) return;
        placeholder.value = target.slice(0, c);
        await delay(eraseSpeed);
      }
      i++;
    }
  }

  onMounted(() => {
    loop();
  });

  onBeforeUnmount(() => {
    cancelled = true;
    clearTimer();
  });

  // Reset index on field change so we show fresh examples
  watch(fields, () => {
    placeholder.value = "";
  });

  return { placeholder };
}
