# timeRangeInput

A pure parser that reads typed or pasted text as a time range, in 17 languages. It makes no network
call and reads no store, clock, DOM, `navigator` or browser zone: everything it needs comes in the
context. Any form that takes a time range (a picker, an alert, a dashboard, a query editor, an API
form) can use it.

## Context

`parseTimeRangeInput(ctx)` takes a `ParseContext`:

| Field    | Meaning                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| `text`   | The input, at most 512 code points.                                                                             |
| `nowUs`  | Now, in Unix microseconds.                                                                                      |
| `zone`   | IANA zone that zone-less dates and clocks are read in.                                                          |
| `pack`   | A compiled locale pack: `EN_US_TIME_RANGE_PACK` or `await loadTimeRangeLocale(locale)`.                         |
| `source` | `"typed"` (default) or `"paste"`; copied into each reading's `origin`.                                          |
| `units`  | Relative units the caller can store (`s m h d w M`); other durations read as absolute.                          |
| `kinds`  | Which of `relative`, `calendar`, `absolute` the caller can store; see below.                                    |
| `limits` | `RangeLimits`: `allowFuture`, and optional `maxEndUs`, `minStartUs`, `maxSpanUs`, `retentionStartUs`, `skewUs`. |

A rolling or calendar reading the caller cannot store becomes absolute when `kinds.absolute` is on.
With `kinds.absolute` off, nothing becomes absolute, and an input whose every reading is of a kind
the caller cannot store is `invalid/unreadable`.

## Result

`TimeRangeParseResult` is exactly one of:

- `empty`: nothing typed.
- `incomplete`: typing is not done; `completions` are readings to offer.
- `invalid`: `reason` is `unreadable`, `too-long`, `out-of-range`, `zero-length` or `reversed`
  (end before start; never swapped). `at` is the span to mark, and `examples` are inputs that work.
- `ambiguous`: two or more `readings` and the `reason` to ask with. None is preferred; the caller asks.
- `valid`: one `reading`.
- `blocked`: the `reading` breaks a limit (`future`, `after-max`, `before-min`, `retention`,
  `max-span`); `fix` is a reading that passes every limit, when there is one.

A reading has `startUs`/`endUs` (end exclusive), its `kind` (`rolling`, `calendar`, `absolute`),
`rolling` or `calendarToken` when it has one, display offsets, notes and its `origin`.

## Helpers

- `formatTimeRangeInput(range, { zone })` writes a range as text that parses back to the same range
  in every pack and zone: rolling as `now-15m` (units `s m h d w M`), calendar as its token
  (`calendar:day:0`), absolute as `<ISO start> - <ISO end>` with the zone offset at each end and
  microseconds when not zero. Rolling and calendar output ignore the zone. For an absolute range it
  returns `null` on an unknown zone, an unsafe instant or a year out of range. An
  offset the parser cannot read (outside -12:00..+14:00, or minutes other than 00, 30 or 45) is
  written in UTC. It lives in its own module, so a caller that only parses does not bundle it.
- `checkTimeRange({ startUs, endUs, nowUs, maxSpanHours?, retentionDays?, allowFuture? })` is the
  validity gate the parser's policy step uses. It returns `{ ok: true, endUs }` or
  `{ ok: false, reason, fix? }` with the parser's reasons and fixes. Like the parser it treats an
  end at most `skewUs` (default 5 s) after now as now; `endUs` is that end, so store it in place of
  the input end. The exact `RangeLimits` fields (`maxSpanUs`,
  `retentionStartUs`, `maxEndUs`, `minStartUs`, `skewUs`) are accepted too and win. Hours and days
  are rounded to whole microseconds; a span or retention limit of `0` or less means no limit.
- `check.ts` and `format.ts` import nothing from the parser, so a caller that only checks and writes
  ranges imports `timeRangeInput/check` and `timeRangeInput/format` and bundles neither the parser
  nor any locale pack.

## Locale packs

`en-us` is bundled. The other 16 load lazily, each in its own chunk:
`const pack = await loadTimeRangeLocale("de")`. The promise rejects if the chunk cannot load; there
is no English fallback inside an unloaded pack, so keep the last loaded pack until it resolves.
The keys are `ar`, `zh-cn`, `tr-turk`, `de`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pt`, `zh-tw`,
`ru`, `pl`, `vi` and `th` (`TimeRangeLocale` in `types.ts`).

The Intl tables in `packs/generated/` come from `npm run gen:time-range-intl`. Add `-- --check` to
fail on drift; a file generated on another ICU version (the committed one is 79.1) is skipped with
a warning.

## Example

```ts
import {
  EN_US_TIME_RANGE_PACK,
  formatTimeRangeInput,
  parseTimeRangeInput,
} from "@/utils/timeRangeInput";

const result = parseTimeRangeInput({
  text: "last 15 minutes",
  nowUs: Date.now() * 1000,
  zone: "Europe/Berlin",
  pack: EN_US_TIME_RANGE_PACK,
  units: ["s", "m", "h", "d", "w", "M"],
  kinds: { relative: true, calendar: true, absolute: true },
  limits: { allowFuture: false },
});
if (result.state === "valid") formatTimeRangeInput(result.reading, { zone: "Europe/Berlin" }); // "now-15m"
```
