# Functions in alert templates

Alert row templates and custom destination bodies/titles support `{field|function}` for every alert type. Use one case-sensitive function, with no chains. Numeric functions have no arguments. Timestamp functions accept optional quoted arguments as described below. Plain `{field}` and existing length/row/spread forms retain their behavior; length syntax cannot be combined with a function. This is O2 placeholder syntax, not Go templates.

| Function | Input | Result |
| --- | --- | --- |
| `humanize` | `1234567` | `1.235M` |
| `humanize1024` | `1048576` | `1Mi` |
| `humanizeDuration` | `3661.9` seconds | `1h 1m 1s` |
| `humanizePercentage` | `0.9123` | `91.23%` |
| `humanSize` | `1536` bytes | `1.5 KiB` |
| `formatTimestamp` | `0` Unix seconds | `1970-01-01T00:00:00Z` |
| `formatTimestampMicros` | `1700000000123456` Unix microseconds | `2023-11-14T22:13:20.123456Z` |

For example, a row template can contain `CPU: {value|humanizePercentage}` or `Latency: {duration|humanizeDuration}`. A custom destination can contain `Observed: {alert_agg_value|humanizePercentage}` and `Count: {alert_count|humanize}`. A JSON row template can use `{"cpu":"{value|humanizePercentage}"}`.

JSON numbers and numeric strings (including exponent notation) are accepted. Formatting follows the four significant digits and prefixes used by [Prometheus numeric functions](https://prometheus.io/docs/prometheus/latest/configuration/template_reference/). `humanize` uses powers of 1000 (`k`, `M`, ..., `Y`) and fractional prefixes (`m`, `u`, ..., `y`); `humanize1024` uses powers of 1024 (`ki`, `Mi`, ..., `Yi`). Duration input is seconds: minutes and larger units discard fractional seconds, and subsecond values use fractional SI units. Durations with absolute value at or above the signed 64-bit seconds boundary render as four-significant-digit seconds in scientific notation rather than overflowing.

`NaN`, `+Inf`, and `-Inf` remain readable. Percentage formatting appends `%` even to special values (`NaN%`, `+Inf%`, `-Inf%`); arithmetic overflow also renders as infinity. Unknown functions, malformed syntax, absent fields, and invalid numeric values preserve the original placeholder, so notifications still render. Empty strings, booleans, nulls, arrays, objects, and strings containing surrounding whitespace are not numeric inputs.

Field lookup uses the existing renderer and its substitution order: row fields precede row built-ins and attributes; destination built-ins precede row columns, attributes, metadata, and group labels. An existing literal field named `value|humanize` wins over interpreting `{value|humanize}` as a function. Destination row columns retain their existing deduplicated comma-separated aggregation; a single numeric value can be formatted, while `1, 2` is not numeric and leaves the modifier unchanged.

`humanSize` uses powers of 1024 with explicit IEC byte units (`B`, `KiB`, `MiB`, ..., `YiB`) separated by a space, and four significant digits. `humanize1024` retains its Prometheus numeric prefix output without byte units. Non-finite `humanSize` inputs remain `NaN`, `+Inf`, or `-Inf` without units.

## Timestamps and timezones

`formatTimestamp` takes Unix seconds; `formatTimestampMicros` takes O2 Unix microseconds. Both default to ISO 8601 in UTC, independently of the server timezone. Integer microseconds retain their precision; decimal input supports fractional seconds and microseconds, including negative epochs. Decimal fractions beyond nanosecond precision are truncated; exponent notation follows floating-point precision. Non-finite or out-of-range timestamps leave the original placeholder unchanged.

Optional arguments are a double-quoted [Chrono/strftime format](https://docs.rs/chrono/latest/chrono/format/strftime/index.html) and then a double-quoted timezone. Formats may use JSON string escapes such as `\"`. Omit the timezone to use UTC; omit both arguments for the ISO 8601 default. Empty parentheses, unquoted arguments, extra arguments, unknown directives, and invalid timezones leave the original placeholder unchanged.

```text
{value|formatTimestamp("%Y-%m-%d")}
{value|formatTimestamp("%Y%m%d%H%M%S%z", "UTC")}
{_timestamp|formatTimestampMicros("%Y-%m-%d %H:%M:%S %:z", "Asia/Shanghai")}
{value|formatTimestamp("%Y-%m-%d %H:%M", "+08:00")}
```

`%Y-%m-%d` produces a date, `%Y%m%d%H%M%S%z` a compact date/time with an offset such as `+0800`, and `%:z` an offset with a colon such as `+08:00`. Accepted timezones include `UTC`, fixed offsets in `+HH:MM`/`-HH:MM` form, and IANA names such as `America/New_York`. IANA daylight-saving offsets are evaluated at the timestamp. Numeric timezone directives describe the offset at that instant; timezone names from `%Z` reflect the resolved fixed offset.

Formatted output receives the renderer's existing JSON escaping for row/non-email templates, and raw output for email. Braces in a custom format stay literal during their originating renderer pass. Rendered rows embedded in a destination still follow the existing ordinary placeholder substitution order; this feature preserves that behavior.

Only modifiers written in the original template run. Braces in field values or rendered rows embedded through `{rows}` stay data and never invoke numeric functions. Existing escaping, truncation, row limits, JSON rows, and spread behavior continue to apply to plain placeholders.
