# How to build things here

These rules apply in every chat and every repo. They are not a style preference. They exist because
an agent can write thousands of lines in an hour, some of them invented, and a human then has to
review all of it. Every rule below either cuts invention or makes the code easier to review.

**Precedence.** A repo's own instruction file (`AGENTS.md` / `CLAUDE.md`) wins on everything
mechanical: formatting, item order, comment rules, lint thresholds, schema rules, PR conventions.
This file governs judgment: what to build, how much of it, and how to prove it works. If the two
conflict, follow the repo file and say so in your report.

The definitions and tests apply to every language in the repo. The examples in §2 and §3 are written
for the Rust backend; a frontend list belongs next to them when the frontend owners write one.

## 0. Pick the tier first

Every task is one of three sizes. Say which one you are in before touching code; it decides how
much of the rest applies.

| Tier | What it is | Spec gate | Tests | Review |
|---|---|---|---|---|
| **Patch** | One cause, one place. No new public API, table, flag or dependency. Typically under ~50 changed lines. | None. One sentence: cause → fix. | One failing test that reproduces the cause, then green. | Self-review against the three tests in §2, then the gates. |
| **Change** | New behaviour inside the existing architecture: a new branch of logic, a new field, a new error path. | Numbered rules and open questions (§5.2), a few lines each. | One per rule. | Full loop (§5). |
| **Feature** | A new component, endpoint, table, background job or config flag. | Design doc first, per the repo's PR rules; the numbered rules derive from it. | One per rule, plus a failure-path test for every `[strong]` / `[weak]` function. | Full loop, security depth where §5 says so. |

If a Patch outgrows its definition while you work, stop, say so, and re-enter as a Change. Do not
keep going.

## 1. Never invent facts

- **A claim about existing code needs a `path:line` you opened in this session.** A function,
  table, config flag, env var or endpoint you have not opened does not exist yet. Search for it
  before you use it. This applies to specs, reviews and reports, not to every sentence in chat.
- **A claim about an outside service** (Twilio, Slack, a cloud API) needs a link to the vendor's
  docs. "Twilio probably returns X" is not allowed.
- **"I don't know" is a correct answer.** Write it down as an open question. Do not fill the gap
  with something that sounds right.
- **If the spec does not decide something, stop and ask.** An invented decision is how a feature
  turns into an endless fix loop. Anything new you discover while building becomes a new numbered
  rule, and the human decides whether it is in scope.

## 2. The three things we refuse

Each one has a definition, a test you can apply mechanically, and examples. The cold reviewer (§5)
applies the same three tests, so there is one vocabulary for writer and reviewer.

### 2.1 Hacks

**Definition.** Code that makes a symptom disappear while the underlying statement about the system
stays false.

**Test.** Delete the new code: is the thing it "fixed" still wrong, for the same reason? Then it was
a hack. Second test: does the fix only work because of a value, name, order or timing that is not
part of any contract?

**Examples, all banned:**

- A branch keyed on one input, test name, org id or environment so that one case passes.
- Turning an error into success where the caller needed to know: `.ok()`, `.unwrap_or_default()`,
  `let _ = …`, `if let Ok(x)` with no `else`, a handler that logs at debug and continues.
- A sleep, retry or re-ordering that makes a race rarer instead of removing it.
- Widening a type (`String`, `serde_json::Value`, `i64` for everything) so the compiler stops
  complaining, instead of modelling the value.
- `#[allow(clippy::…)]`, `#[ignore]`, a weakened assertion, or a raised lint threshold to get green.
- A flag that defaults the new behaviour off so the bug stops reproducing.
- A "temporary" anything with no issue number and no removal condition.

**Not a hack:** a fallback the spec names and that is visible when it fires (a `warn!` with context,
a metric, an error field in the response). A default is a decision; a silent default is a hack.

**When the real cause is out of scope:** stop and report it. Do not patch the symptom to finish the
task.

### 2.2 Over-engineering

**Definition.** Structure that exists for a future the spec does not contain.

**Test.** Name the second concrete user that exists today, or that the spec names. If you cannot,
inline it.

**Examples, all banned until the second user exists:**

- A trait with one impl; a generic with one instantiation; a type parameter "for testing".
- A config option, env var or feature flag nobody asked for ("in case someone wants to tune it").
- A newtype or wrapper that enforces no invariant.
- Layers that only forward: `handler → service → manager → repository` with logic in one of them.
- A builder for a struct with three fields; a registry or plugin point with one entry.
- An error enum with variants nothing matches on; one variant per call site when every caller
  just logs.
- A new module or file for one function.

**Counts as a second user:** another call site in the same diff, another provider the spec names,
or an existing trait that every implementation in the repo already follows. **Does not count:** "the
UI will need it", "we may add Postgres", or a test that is the only other caller.

### 2.3 Over-complication

**Definition.** Control flow or state a reviewer cannot predict from the signature and the first
screen of the body. Over-engineering is too much structure around the code; over-complication is
too much happening inside one piece of it.

**Test.** Cover everything below the first screen of the function. Can you say what it returns for
each kind of input? If not, split it.

**Examples, each needs a split or a name:**

- A `bool` parameter that switches behaviour (`send(msg, true, false)`): two functions, or an enum.
- More than ~5 parameters: a named struct.
- Nesting deeper than three: an early return or a helper.
- `Option<Option<T>>`, `Result<Option<Result<…>>>`, `(bool, bool, Option<String>)` as a return
  type: a named enum.
- An iterator chain whose closures contain branches: a loop.
- A function that is only correct if another one ran first: return the value and pass it in, or
  make the ordering a type.
- `Arc<Mutex<_>>` to share what could be passed by value; `async` or `spawn` for work that is not
  I/O; a macro where a function works.
- A `&str` or `i32` that is really an enum (`status == "running"`).
- A mutable local that is reassigned across more than one screen.

**Default when unsure:** the version with fewer names and fewer branches wins. If two versions both
meet the rules, ship the shorter diff.

## 3. Build in logical components with predictable behaviour

Split each Change or Feature into **logical components**. A logical component is one unit with one
job, such as "decide who to page", "render the SMS text" or "send through the provider".

- **One line, no exceptions.** You must be able to explain each component in one plain sentence
  that has no "except when". If you cannot, it is two components.
- **Same input, same output.** Keep the decision logic pure: no I/O, and the clock (`now: i64`),
  randomness and config are passed in as arguments. Side effects (database, network, queue) live in
  a thin outer layer that only carries out what the pure core decided. In practice: the core takes
  the config *values* it needs; the outer layer is the one that reads the global config.
- **Deep is fine, wide is not.** A function may run many steps one after another. It should not
  fan out into many branches. Prefer an exhaustive `match` on a project enum (no catch-all `_`
  hiding a future variant; `_` is only for `#[non_exhaustive]` foreign enums), early returns, and
  lookup tables over chains of `if/else`. If a decision has more than about four outcomes, give the
  outcome a name: make it an enum.
- **Write the guarantee in the type wherever the type can say it.** Adapted from Audacity's
  safety guarantees (https://audacity.gitbook.io/dev/getting-started/coding-standards#safety_guarantees_defined):
  - *pure*: the signature says it. Takes values or `&`, returns a value, not `async`, touches no
    global. No tag needed.
  - *no-fail*: returns `T`, not `Result<T>`. Any `unwrap`, `expect`, index or unchecked arithmetic
    inside needs a one-line comment naming the invariant that makes failure impossible.
  - `[strong]`, tagged at the end of the doc comment: either it fully succeeds, or it fails and
    nothing changed. For example, one database transaction.
  - `[weak: <what may be left behind>]`, tagged: a failure can leave partial effects, but
    everything stays consistent. Name what is left behind and what makes a retry safe. For example:
    `[weak: the ledger row may exist without a send; a retry is a no-op]`.

  Only the outer I/O layer carries `[strong]` / `[weak]`. A tag is a promise: each one needs a test
  of its failure path.

## 4. TDD, without the bloat

- **Test first, and see it fail.** A test written after the code, or one you never saw fail,
  proves nothing. Run the narrowest target that contains it red, then make it green.
  Exempt: a pure refactor (behaviour unchanged, the existing tests are the net and you do not edit
  them) and a pure deletion.
- **One test per numbered rule or per real branch.** Use table-driven tests (inputs → expected
  outputs) for pure components. Do not test the framework, getters or private helpers on their
  own. Do not repeat an assertion that another test already makes.
- **Pass values, do not mock.** If a function needs a mock to be tested, its I/O is in the wrong
  layer (§3). Mocks are for the thin outer layer only, and only when no real local dependency is
  available.
- **Never change a test's expectation to get green** unless the PR states why the old expectation
  was wrong.
- **Done = every numbered rule has a passing test and the repo's gates pass.** "It looks
  complete" is not done.
- **Size each diff by rule, not by subsystem.** One rule (or a few small ones), its test and its
  code, small enough for a person to review in one sitting.

## 5. The working loop

In repos that have the `o2-loop` skill (openobserve, o2-enterprise), the skill *is* steps 3–6
below: it owns the round cap and the findings ledger. Elsewhere, run the steps by hand.

1. **The main chat is the monitor.** It holds the spec, the rule list and the progress. It
   delegates the work and does not do bulk reading or writing itself.
2. **Spec gate** (Change and Feature only). Before any code, write the numbered rules, the
   components with their one-line jobs and guarantee tags, and the open questions. Ask the human
   about every open question.
3. **Tests.** A subagent writes the tests for the next rule-sized slice. Before it reports, it
   checks them once against this list: does each test map to a rule, did it fail first, is any
   test a duplicate, is anything invented.
4. **Cold review.** A fresh reviewer (one that did not write the code) gets only the spec path
   and the diff, not the conversation, and applies the three tests in §2. Each finding must give
   `path:line` and a concrete failure: "input X gives wrong output Y". A finding with no concrete
   failure is dropped.
5. **Confirm each finding before acting on it.** Read the cited lines, or run a test that shows
   the failure. Reviewers make things up too. Fix only the findings you confirmed, and record the
   ones you rejected along with the reason.
6. **Repeat step 4** until a round produces no confirmed finding. If the round cap is reached and
   real problems remain, the spec is the problem: go back to the human.
7. **Run the repo's gates (fmt, clippy, tests) before every review round** so reviewers do not
   spend tokens on what a tool would catch.

**Review depth follows risk.** Pure logic with good table tests needs one cold round. Full depth
for anything that touches: unauthenticated endpoints, authorization, signature verification,
secrets, money, data deletion, migrations, anything that pages a human.

**Stop and ask the human when:**

- the spec does not decide something (§1);
- the only green path you can find is a hack (§2.1);
- the fix needs to touch files or layers outside the stated scope;
- an abstraction needs a second user and the spec has none (§2.2);
- a test can only pass by changing its expectation;
- the gates fail for a reason that predates your change.

**Keeping the token cost down.** Give a subagent file paths and a narrow question, not pasted
contents, and ask for conclusions with citations, capped in length. Use read-only search agents
for searching. Continue an existing agent instead of starting one that has to re-read everything.
Do not re-read files you already read, and do not re-derive facts you already settled.

## 6. UI

- Follow the repo's UI rules. In openobserve that is the `ui-architect` skill: O2 components,
  rem not px, design tokens. Mock the flow on the real product UI before building it.
- **Zero-config for 90% of users.** Defaults that work without any setup, controls whose meaning
  is obvious from the screen, and no step that needs the docs. Advanced options stay out of the way
  until someone needs them.

## 7. How to write for the human

- Write for a reader who has not followed the conversation. Define each term the first time you
  use it, use plain words, and make the conclusion the first thing they read.
- When agents reach a decision, present it as: what we will build, how it behaves for the user,
  what we decided not to do, and what still needs a human answer.
- A PR description states the tier (§0), lists the numbered rules with the test that covers each,
  and lists the rejected review findings with their reasons.
