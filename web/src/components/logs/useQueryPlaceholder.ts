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
}

const SYSTEM_FIELDS = new Set([
  "_timestamp",
  "_all",
  "_stream",
]);

const NUMERIC_TYPES = new Set(["Int64", "Float64", "UInt64", "Int32", "UInt32"]);

// Rotate through several example patterns per FTS field so the animation feels varied
function makeFtsExamples(val: string | undefined): string[] {
  const term = val ?? "error";
  return [
    `match_all('${term}')`,           // inverted index search
    `match_all('${term}*')`,          // prefix search
    `match_all('*${term}')`,          // postfix search
  ];
}

function makeColumnExamples(name: string, val: string): string[] {
  return [
    `str_match(${name}, '${val}')`,                   // column search
    `str_match_ignore_case(${name}, '${val}')`,        // case-insensitive column search
    `fuzzy_match(${name}, '${val}', 1)`,               // fuzzy match
  ];
}

/**
 * Builds animated typewriter example queries from real stream field/value data.
 * Priority: interesting (key) fields → FTS fields → other fields.
 * Uses correct OpenObserve query syntax:
 *   - FTS fields  → match_all('term'), match_all('term*'), match_all('*term')
 *   - string cols → str_match(field, 'val'), str_match_ignore_case, fuzzy_match
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

    // Exclude group header rows (label: true) — they are section dividers, not fields
    const realFields = f.filter((x) => !x.label);

    const interesting = realFields.filter(
      (x) => x.isInterestingField && !SYSTEM_FIELDS.has(x.name),
    );
    const ftsOnly = realFields.filter(
      (x) => x.ftsKey && !SYSTEM_FIELDS.has(x.name) && !x.isInterestingField,
    );
    const others = realFields
      .filter(
        (x) => !x.isInterestingField && !x.ftsKey && !SYSTEM_FIELDS.has(x.name),
      )
      .slice(0, 3);

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

    const makeKeyExample = (field: StreamField, pairField?: StreamField): string | null => {
      if (isSql) {
        const base = `SELECT * FROM stream WHERE ${fieldExprSql(field)}`;
        if (pairField) {
          const op = Math.random() < 0.5 ? "AND" : "OR";
          return `${base} ${op} ${fieldExprSql(pairField)}`;
        }
        return base;
      }
      if (pairField) {
        const op = Math.random() < 0.5 ? " AND " : " OR ";
        return `${fieldExpr(field)}${op}${fieldExpr(pairField)}`;
      }
      return fieldExpr(field);
    };

    const makeFtsExample = (field: StreamField, variant: number): string | null => {
      if (isSql) return null;
      const vals = fv[field.name]?.values ?? [];
      const firstVal = vals[0]?.key;
      const examples = makeFtsExamples(firstVal);
      return examples[variant % examples.length] ?? null;
    };

    // Build alternating list: key field, fts variant, key field, fts variant, …
    const keyFields = [...interesting, ...others.filter((x) => !x.ftsKey)].slice(0, 4);
    const allFts = [...interesting.filter((x) => x.ftsKey), ...ftsOnly].slice(0, 4);

    const result: string[] = [];
    const len = Math.max(keyFields.length, allFts.length, 1);

    for (let i = 0; i < len && result.length < 8; i++) {
      const kf = keyFields[i % keyFields.length];
      const ff = allFts[i % (allFts.length || 1)];
      // Every other iteration pair with the next key field for AND/OR examples
      const pairKf = keyFields.length > 1 && i % 2 === 1
        ? keyFields[(i + 1) % keyFields.length]
        : undefined;

      if (kf) {
        const ex = makeKeyExample(kf, pairKf);
        if (ex) result.push(ex);
      }

      if (ff && !isSql) {
        const ex = makeFtsExample(ff, i);
        if (ex) result.push(ex);
      }
    }

    return result;
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
