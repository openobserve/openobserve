# Variable suggestions on `{{` in text fields (LLM Playground and Synthetics)

Design: `simple-english/template-input-component-design.md` (revision 4 after five cold reviews, 2026-09-22).
Fulfils rank 11 of `simple-english/synthetics-shared-variables-issue-review.md` and §9.5 of the shared variables and environments design.

## Problem Statement

A Synthetics author who wants a browser check to use a shared variable must know that the placeholder syntax is `{{NAME}}`, remember the exact stored spelling of the name (matching is case-sensitive), and type it by hand into the starting URL or a step value. Nothing in the editor offers the names. A wrong case or a typo is not caught until the run resolves to literal text.

The LLM Playground already solves this for prompt messages: typing `{{` opens a list of the declared variables, and the value of the token under the caret shows in a small box. That code is inlined in one enterprise component, so no other screen can use it.

## Solution

One library component family that wraps the existing text field and textarea and adds the `{{` suggestion list (and, optionally, the value peek). The Playground switches to it with no visible change. Synthetics attaches it to the three inputs where a variable is substituted at run time: the starting URL on the gate, the starting URL on Configure > Details, and the step value for `navigate`, `type`, `select`, and `press`. Synthetics rows show where the variable comes from (global or environment), a warning when it is missing in one selected environment, and a lock for a secret.

## User Stories

1. As a Synthetics author, I want a list of variables to appear when I type `{{` in the starting URL, so that I do not have to remember the exact name.
2. As a Synthetics author, I want the same list in a step's value input when the action is `navigate`, `type`, `select`, or `press`, so that a credential or a URL can come from a variable.
3. As a Synthetics author, I want the list to filter as I keep typing after `{{`, so that a long list narrows to what I mean.
4. As a Synthetics author, I want the match to ignore case, so that typing `{{base` finds `BASE_URL`.
5. As a Synthetics author, I want Enter, Tab, or a click to insert `{{NAME}}` in place of what I typed, with the caret placed after it, so that I keep typing without fixing braces.
6. As a Synthetics author, I want the inserted name to be the stored spelling, so that a case typo cannot happen when I pick from the list.
7. As a Synthetics author, I want ArrowUp and ArrowDown to move through the list and Escape to close it, so that I can work without the mouse.
8. As a Synthetics author, I want the list to close when I leave the field, so that it never covers what I do next.
9. As a Synthetics author, I want nothing to open when I only focus or click the field, so that a plain URL or a plain value is not interrupted.
10. As a Synthetics author, I want each row to show whether the variable is global or which environments define it, so that I know the value will resolve in the environments the check runs in.
11. As a Synthetics author, I want a warning on a row whose variable is missing in one of the check's selected environments, so that I do not pick a name that resolves to literal text in that environment.
12. As a Synthetics author, I want a lock on a secret row, so that I know the value is write-only and will be redacted in results.
13. As a Synthetics author, I want the list to offer only names the check can resolve, so that the unbound-variable warning never fires for a name I picked from the list.
14. As a Synthetics author, I want a check-scoped variable to win over a shared one of the same name in the list, so that the list matches what the run uses.
15. As a Synthetics author, I want a check-scoped variable marked secure to show the lock too, so that the list does not tell me a secret is plain.
16. As a Synthetics author, I want no list on the step name, the assertion expected value, headers, cookies, auth, the check name, description, folder, or tags, so that the editor does not suggest a syntax that is never substituted there.
17. As a Synthetics author, I want no list on an `upload` step's value, so that I am not led to put a variable in a file path the probe does not substitute.
18. As a Synthetics author, I want the gate's link icon and URL validation on blur to keep working, so that the new list changes nothing else about that field.
19. As a Synthetics author, I want the step editor's tooltip on the value label to stay, so that the action-specific help is still there.
20. As a Synthetics author editing a saved check, I want the list on Configure > Details to include the check's environments and check-scoped variables, so that it reflects the whole resolved set.
21. As a Synthetics author creating a new check, I want the list on the gate to offer the global variables, so that a global `BASE_URL` can be used before any environment is selected.
22. As a Synthetics author, I want the replay and the recorder to receive exactly what the editor saved, so that inserting a token through the list is the same as typing it.
23. As an LLM Playground user, I want typing `{{` in a system, user, assistant, or tool message to offer the declared variables, exactly as today.
24. As an LLM Playground user, I want `expected_output` to stay out of the list, so that the golden answer cannot be completed into a prompt.
25. As an LLM Playground user, I want the value of the token under my caret to appear after a short delay, and to stay while I move inside that token, exactly as today.
26. As an LLM Playground user, I want the peek to show a dash for a declared variable with no value, and nothing for an unknown name, exactly as today.
27. As an LLM Playground user, I want the peek and the list to disappear when the field loses focus, exactly as today.
28. As an LLM Playground user, I want `{{ ` with a space to keep the list open, so that the list follows the same token grammar the renderer accepts.
29. As an LLM Playground user, I want the tool-arguments field to stay a plain textarea, so that JSON typing is not interrupted.
30. As a screen reader user, I want the suggestion list announced as a named listbox with option rows, so that I know a list opened and what it holds. (Announcing the active row needs field-side ARIA, which is a follow-up.)
38. As a Synthetics author, I want the list on the last step row to float over the steps table instead of being hidden inside its scroll area, so that I can pick a name on the step I just added.
31. As a frontend engineer, I want one library component for `{{` suggestions, so that a future screen (an HTTP check target, an alert template) adds the list by swapping a component, not by copying 140 lines.
32. As a frontend engineer, I want the library component to know nothing about Synthetics or the Playground, so that it can be used anywhere and tested alone.
33. As a frontend engineer, I want the row decoration to come through a slot, so that each screen draws its own badges without a library change.
34. As a frontend engineer, I want existing `data-test` selectors on the wrapped fields to keep resolving to one element, so that the current specs and any browser test do not break.
35. As a frontend engineer, I want the Playground's peek tests to move to the library spec unchanged in substance, so that the port is proven by the tests that already exist.
36. As a frontend engineer, I want one exported token grammar in the library, so that the open-token regex, the closed-token regex, and `tokenAtCaret` cannot drift apart.
37. As a reviewer, I want every divergence from today's Playground and Synthetics behaviour listed in one table in the design, so that I can check each one in the browser.

## Implementation Decisions

Library family, in the forms group:

- `OTemplateInput` wraps `OInput`. `OTemplateTextarea` wraps `OTextarea`. Both ship together with a shared sub-component `OTemplateSuggestList` and a co-located composable `useTemplateSuggest`.
- Props on both: `modelValue: string`, `suggestions?: TemplateSuggestion[]` (`{ name: string }` plus any caller fields, display order preserved), `values?: Record<string, string>` (present turns the peek on). Every prop of the wrapped field is re-bound by name, the way `OFormInput` does, and `$attrs` is bound onto the field so `data-test`, `id`, and undeclared listeners fall through. When `suggestions` is absent or empty the wrapper behaves as the plain field.
- Unsupported on `OTemplateInput`: `debounce`, `mask`, `modelModifiers`, `revealable`, and any `type` other than `text` or `url`. The list opens from `update:modelValue` and inserts at `selectionStart`, and each of those makes the caret and the emitted text disagree. The types file omits the keys.
- Emits: `update:modelValue`, `select(name)`, and re-emitted `focus`, `blur`, `keydown`. `clear`, `keyup`, `keypress`, `paste` reach the field through `$attrs`.
- Slots: `OTemplateInput` forwards `icon-left`, `icon-right`, `prefix`, `suffix`, `tooltip`, `append`. `OTemplateTextarea` forwards `tooltip`, `append`. Both add a scoped `suggestion` slot receiving `{ suggestion, active }`. The default row renders `{{name}}` in mono through `raw()`.
- The wrapper sets `inheritAttrs: false`, re-binds every field prop by name (including `id`), and binds `$attrs` onto the field so `data-test` and `class` land on the field root only. It obtains the native element from the `focus` event target, because neither field exposes it. On first focus it adds native `click` and `keyup` listeners, always, not only when the peek is on. They re-run the open-token check at the new caret and close the list when no open token ends there (new; the Playground re-checks on input only, which lets a stale start duplicate text on accept). On unmount the wrapper removes the listeners and clears the peek timer. All three components are generic over the suggestion type, so a Synthetics caller gets `VariableSuggestion` in the slot without a cast.
- Token grammar, exported from the composable: closed token `/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g`, open token `/\{\{\s*([A-Za-z0-9_]*)$/` on the text before the caret, and `tokenAtCaret(text, caret)`. Match is `startsWith` on lower-cased text on both sides.
- Keys: ArrowDown and ArrowUp move with wrap. Enter and Tab insert, only while the list is open with at least one match. Escape closes. Blur closes. A row click uses `mousedown.prevent` so the field keeps focus.
- Insert reads the text from the native element, not the prop, writes `{{NAME}}` over the open token, emits, closes, then inside `requestAnimationFrame` calls `focus()` and `setSelectionRange` after the token.
- Peek: triggers are input, focus, native click, native keyup. 300 ms delay before show, stays inside the same token, hides at once when the token name changes or the caret leaves every token. Shows `—` (through `raw()`) for a known name with an empty value, nothing for an unknown name.
- Why not `OCombobox`: the catalog names it for typed text with suggestions, and the check was done. It is list first (opens on focus and click), its input is reka's `ComboboxInput` rather than `OInput`/`OTextarea` (no `autogrow`, `maxRows`, or `prefix` slot), its select replaces the whole text instead of splicing at the caret, and it has no peek. Both catalog entries get a "Don't use for" line pointing at the other.
- The list is built the `OSelect` way: reka `PopoverRoot` with an empty `PopoverAnchor` whose `reference` is the native element, `PopoverPortal`, `PopoverContent`, then `ListboxRoot`, a scroll box, and one `ListboxItem` per match. The list component owns the `PopoverRoot`, binds `open`, and listens to `update:open` so a reka dismiss (outside click, focus leaving) reaches the composable's `close()`. Highlight is the component's own `highlightedIndex`, never reka's, so wrap-around and Enter work exactly as the Playground does today. After every arrow move the list scrolls the highlighted row into view, as `OSelect` does. Hovering a row moves the highlight (new; the Playground rows have no hover handler).
- `PopoverContent` copies `OSelect`'s props (`align="start"`, `side-offset` 4, `hide-when-detached`, outside pointer events enabled) and adds three: `@open-auto-focus.prevent` (the popover's focus scope would otherwise focus the first row on open and steal focus from the field), an `@interact-outside` handler that prevents dismiss when the target is inside the wrapper (a caret click in the field must not close the list), and `collision-padding` 8 below the `lg` breakpoint.
- A row's `@select` handler calls `preventDefault()` on reka's cancelable select event and then runs the insert. reka then skips its own value change and highlight, so the row is never focused and a repeated pick never toggles to `undefined`. Rows also have `@mousedown.prevent`. The `ListboxRoot` is never given a `model-value`, because a controlled change focuses the row.
- ARIA: the list sets `role="listbox"` and an `aria-label` from a new library key `components.templateInput.suggestions` (reka's root renders no role). Rows are `role="option"`. `aria-selected` is always `false` because the root model is never set. No ARIA is set on the native element.
- Tokens and classes: content `z-10001 w-56 rounded-default shadow-md bg-select-content-bg border-select-content-border`, scroll box `max-h-72 overflow-y-auto` capped to the popover's available height, rows `text-select-item-text text-start`, active row `bg-select-item-hover-bg`. `shadow-md` keeps the Playground's shadow. Bare Tailwind classes, logical properties, no `px`. The virtual spacer and row transforms are the one sanctioned inline style, a JS-computed length.
- Virtualisation is always on: the scroll box renders rows through `useVirtualizer` from `@tanstack/vue-virtual` with `measureElement` per row, one render path. The list can grow past the resolved cap because the inherited union spans every selected environment. Specs stub `getBoundingClientRect` the way `OTable.spec` does, because the virtualizer renders nothing in jsdom without a size.
- Popper flip: near the viewport bottom the list flips above the field. The peek hides while the list is open.
- Escape: the field handler prevents default only while the list is open, which also suppresses reka's window-level dismiss. Closed, Escape passes through so an enclosing dialog still closes.
- The peek stays an absolute box above the field, outside a portal. This is a stated exception to the responsive rule, scoped to the Playground, which is the only caller with a peek.
- `data-test`: the wrapper root carries none. The field root gets the consumer's id and the native element gets `-field`, as today. The list appends `-suggest` on the popover content, `-suggest-item-{name}` with the name as stored (case kept, because `Foo` and `foo` can both exist), and `-peek`. Rows are in a portal, so specs query the document, not the wrapper.

Playground:

- The message content field becomes `OTemplateTextarea` with the same field props. `suggestions` is `varNames` minus `expected_output`. `values` is `vars`. The tool-arguments field stays `OTextarea`.
- The inline list and peek state and handlers are deleted. `tokenAtCaret` is deleted from the draft module and imported from the library. `renderTemplate`, `extractVars`, and their pattern do not change.
- Divergences: `expected_output` filtered by the caller; `data-test` ids of the list and peek change; one list state per field and native listeners removed on unmount; one extra wrapper element; listbox ARIA on the list; `{{ ` with a space keeps the list open; the list is portalled and can flip above the field; the peek hides while the list is open; a row inserts on click rather than mousedown; caret movement closes a stale list; hovering a row moves the highlight. Only the last six are visible, and none changes what a keyboard accept inserts.

Synthetics:

- New constant `SUBSTITUTED_VALUE_ACTIONS = ["navigate", "type", "select", "press"]` beside `VALUE_ACTIONS` in the synthetics constants module. These are the actions whose value reaches `url`, `key`, or `value`, the three step fields the probe substitutes. `upload` writes `files` and is not substituted; `scroll` and `wait` are retired.
- New module in the synthetics variables folder: `VariableSuggestion { name, envs, global, secret, gap }` and `buildVariableSuggestions(grouped, checkVariables)`. Check-scoped rows first, from the raw check variables with the name as stored (untrimmed, matching the resolved helper) and `secret` from the `secure` flag (the resolved helper drops it), alphabetical. Then the inherited union minus overridden rows, alphabetical, with `gap` from the coverage gaps. Invariant: every suggestion name is in the known-name set that drives the unbound banner.
- The browser check view adds a `variableSuggestions` computed beside the known-name set, `undefined` until the shared tiers load. It stays the only place that builds it.
- Threading: the gate uses the computed directly. `CheckConfigure` and `CheckDetails` gain an optional `variableSuggestions` prop; the protocol check view passes nothing, so the HTTP target stays a plain input. `BrowserJourney` gains the same optional prop beside `knownVariables` and passes it to the step editor; the recording-panel host of the editor passes nothing.
- The step editor renders inside `OTable`, whose root is `overflow-hidden`. The portal is what lets the list float over the table on the last step row.
- The three inputs switch from `OInput` to `OTemplateInput` with every prop, slot, `data-test`, and handler kept. The step editor passes `suggestions` only when the action is in `SUBSTITUTED_VALUE_ACTIONS`. The write path through `applyValueToWire` does not change.
- New `VariableSuggestionRow` component fills the `suggestion` slot: scope icon `public` when global and defined in no environment, else `layers`; the name in mono; environment names in secondary text, truncated; a `warning` icon with the coverage-gap tooltip when `gap` is not empty; a `lock` icon with the existing secret tooltip. No new Synthetics i18n keys. The one new key in this work is the library's `components.templateInput.suggestions`.
- No `values` prop, so no peek in Synthetics.
- Divergences: shared code in the library rather than the synthetics folder as rank 11 proposed; accepting a suggestion writes the stored spelling (both tiers store names as typed since commit `15dadbbe3e`, which closed rank 4's upper-casing item); Tab inserts while the list is open; overridden shared rows are hidden from the list although the inherited panel shows them struck through.
- The gate hint string is owned by rank 4 of the review doc and is not changed here.

Order of work: library family plus Playground switch in one PR (the Playground spec is the regression net), then Synthetics in a second PR on `feat/synthetics-shared-variables`. Both live in this repo, and no enterprise repo change is needed. The first PR also registers the family in the ui-architect catalog (`forms-inputs.md`) and adds the `components.templateInput.suggestions` key to `en-US.json`.

## Testing Decisions

A good test drives the component the way a user does and asserts what the user sees or what the caller receives: text typed at the native element, `selectionStart` set, keys pressed, a row clicked, then the emitted value, the caret position, the rows shown, or the peek text. No test reads composable internals or asserts on classes.

Two seams:

1. Wrapper component with the real field inside. `OTemplateTextarea.spec` and `OTemplateInput.spec` mount the wrapper with the real `OTextarea` or `OInput`, attached to the document, find the native element by `data-test` `-field`, drive it, and query rows on the document because they render in a portal (pattern: `OSelect.spec.ts`). Each lib spec stubs `Element.prototype.getBoundingClientRect` (so the virtualizer renders rows) and `Element.prototype.scrollIntoView`, which jsdom lacks and no global setup provides. Prior art: the peek block of `PlaygroundMessageList.spec.ts`, which mounts the real `OTextarea` and uses `setSelectionRange` plus `trigger("click")` with fake timers. Covered here: open on `{{` and `{{ba` and `{{ ba`, closed on a closed token, close when the caret moves before the braces, case-insensitive filter, arrow wrap, insert at the caret not the end, caret after the token, Enter not intercepted when closed, Escape and blur close, native listeners removed on unmount, the six peek cases moved from the Playground spec plus "no peek without `values`" and "stays inside the same token", forwarded `prefix` and `tooltip` slots, `blur` reaching the caller, `data-test` landing once on the field root and `-field` on the native element, `role="listbox"` with an accessible name and `role="option"` rows present, a row click inserting while `document.activeElement` stays the field, a pointerdown inside the wrapper not closing the list, the peek hidden while the list is open, the virtual spacer and row transforms present, and the list closing when a click moves the caret before the `{{`. `tokenAtCaret`'s tests move here from the draft module spec.
2. Pure builder. `suggestions.spec` calls `buildVariableSuggestions` with grouped data and check variables. Prior art: `resolved.spec.ts` for `inheritedUnion` and `coverageGaps`. Covered: check rows first, secure check row has `secret`, overridden shared row absent, `gap` filled, every name present in the known-name set built from the same inputs.

Wiring-only specs at the callers, with the wrapper stubbed:

- `PlaygroundMessageList.spec`: keep the layout test and add the wrapper to its stubs; one test that the message field is the wrapper and receives `suggestions` without `expected_output` and `values` with it.
- `BrowserJourneyStepEditor.spec`: the value input receives `suggestions` for `type` and `undefined` for `upload`; accepting writes `{{NAME}}` into the step and into the wire step.
- `CreateBrowserTest.spec` and `BrowserJourney.spec`: add an `OTemplateInput` stub shaped like the existing `OInput` stub, because those specs stub `OInput` by name and the real wrapper would otherwise mount; `variableSuggestions` is `undefined` before load and holds check rows first after.
- `CheckDetails.spec`: the URL field renders with and without the new prop.

Manual pass in light and dark, at 375 and 1280, and in `ar-SA`: Playground list and peek unchanged in look, the list flips above the field near the bottom and the peek hides, Synthetics rows readable at rest, the list floats over the table on the last step row, gate link icon and step tooltip present, a tap on a row on iOS keeps the field focused.

## Out of Scope

- Field-side ARIA (`aria-autocomplete`, `aria-expanded`, `aria-activedescendant`). The wrapper holds the native element and could set them imperatively; deferred so the first PR stays a behaviour-preserving port. Controlling the `ListboxRoot` model to get a real `aria-selected` is not possible, because it focuses the row.
- A Synthetics peek. A value differs per environment and a secret has none to show.
- Replacing recorded literals with a variable (rank 12 of the review doc).
- The list on the HTTP check target, which the server also substitutes.
- The recorder extension's replay substitution surface.
- The gate hint text (rank 4) and the environment picker on the gate (rank 3b).
- Adding the family to the component-usage catalog (a follow-up, together with the missing `OCombobox` entry).
- Any change to `OInput` or `OTextarea`.

## Further Notes

- `OSelect` is the precedent for the list mechanics (own highlight index, reka `ListboxItem` rows, popover portal). It does not use `@open-auto-focus.prevent` or an interact-outside guard because its own search input holds focus. `OTemplateInput` needs both because the field outside the popover holds focus.
- The Playground is tracked in this public repo under `web/src/enterprise/`, so naming it in the public issue is fine. Do not link the private designs repo.
- The `o2-component-create` skill text says `tw:` prefix; the current library files use bare Tailwind classes. The code is the ground truth.
- The `o2-component-usage` catalog does not list `OCombobox` either, so its absence is not a signal to avoid the combobox; it is a stale catalog.
- Two open questions in the design: environment names inline versus in a tooltip on the row, and whether the gate list opens at all before rank 3b lands. The design answers yes to both and an implementer can proceed on those answers.
