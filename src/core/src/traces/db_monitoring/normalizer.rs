// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Statement normalizer for Database Monitoring (design: `docs/___databsepages/dbm-design-doc.md`
//! §3.2; test approach:
//! `docs/___databsepages/plans-and-specs/2026-08-07-dbm-phase1-test-approach-design.md` §2).
//!
//! Lexer-based (no SQL parse tree), single pass:
//! - string/number/date/binary literals → `?`
//! - ALL bind-parameter placeholder styles (`$n`, `@name`, `:name`, `%s`, `?`) rewritten to
//!   canonical `?` before hashing
//! - `IN (…)` lists and multi-row `VALUES` collapsed to one placeholder group — for placeholder
//!   lists identically to literal lists
//! - repeated identical statement blocks in multi-statement batches collapsed to one, reported via
//!   [`NormalizedStatement::batch_multiplier`]
//! - comments stripped (mandatory — sqlcommenter comments carry per-call `traceparent` values)
//! - whitespace collapsed
//!
//! Hash vs display are separate concerns: the fingerprint is computed over keyword-case-folded
//! text (quoted identifiers preserved); the stored `query_norm` keeps original casing.
//! Identifier normalization (default on): digit-runs / UUIDs / hex-runs inside identifiers fold to
//! `?` (`events_20260807` → `events_?`), generated savepoint names collapse.
//!
//! Dialect-aware lexing is privacy-load-bearing: an unrecognized literal form leaks raw values
//! into `query_norm`, violating NFR-2. Failure rule: on lexer error, `query_norm` is NOT
//! populated — raw text is never used as fallback normalized text.

use std::borrow::Cow;

use super::MAX_NORM_INPUT;

/// Lexer/routing dialect, keyed off the canonical `o2_db_system` value (design §3.2 routing
/// table). SQL-lexer dialect modes: postgresql, mysql, mariadb (mysql mode), mssql, oracle,
/// cockroachdb (postgresql mode), cassandra (CQL), clickhouse. Non-SQL routes: redis
/// (command + first-key pattern), mongodb (command doc, argument values stripped),
/// elasticsearch (method + path template).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Dialect {
    Postgresql,
    Mysql,
    Mariadb,
    Mssql,
    Oracle,
    Cockroachdb,
    Cassandra,
    Clickhouse,
    Redis,
    Mongodb,
    Elasticsearch,
}

/// Statement class stored in `o2_db_stmt_class` (design §3.1): lets FR-2 default-filter to
/// `query` so COMMIT/SET/ping noise doesn't dominate calls-sorted views.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StmtClass {
    /// DML/DDL/query work — including batches that *contain* a query (a `BEGIN; UPDATE …; COMMIT`
    /// batch is `Query`, not `TransactionControl`).
    Query,
    /// Bare BEGIN / COMMIT / ROLLBACK / SAVEPOINT.
    TransactionControl,
    /// SET / RESET.
    SessionControl,
    /// `SELECT 1`-style pool probes.
    Ping,
}

impl StmtClass {
    /// The stored string vocabulary for the `o2_db_stmt_class` column.
    pub fn as_str(self) -> &'static str {
        match self {
            StmtClass::Query => "query",
            StmtClass::TransactionControl => "transaction-control",
            StmtClass::SessionControl => "session-control",
            StmtClass::Ping => "ping",
        }
    }
}

/// Result of normalizing one statement (or multi-statement batch) text.
#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedStatement {
    /// 16-hex stable hash of the keyword-case-folded canonical text. The cross-node aggregation
    /// key — deterministic across nodes/platforms/releases; changes require an
    /// `o2_db_fp_version` bump.
    pub fingerprint: String,
    /// Display form: original casing, literals/placeholders → `?`, comments stripped. `None`
    /// when normalized text is unavailable (never raw-text fallback).
    pub query_norm: Option<String>,
    /// Leading operation keyword, skipping leading transaction-control statements in a batch;
    /// heterogeneous multi-statement batches → `BATCH`.
    pub operation: Option<String>,
    /// Statement class of the whole text (a TCL-led batch containing a query is `Query`).
    pub stmt_class: StmtClass,
    /// `N` when N > 1 identical repeated statement blocks were collapsed; `1` otherwise.
    pub batch_multiplier: i64,
}

/// Normalization failure. Per the design §3.2 failure rule the caller must NOT store any
/// normalized text on error — the fingerprint falls back to the operation+collection hash.
#[derive(Debug, thiserror::Error)]
pub enum NormalizeError {
    /// The lexer hit an unterminated or unrecognized construct (e.g. unclosed dollar-quote).
    #[error("lexer failure at byte {position}: {reason}")]
    Lexer { position: usize, reason: String },
}

fn lexer_err(position: usize, reason: &str) -> NormalizeError {
    NormalizeError::Lexer {
        position,
        reason: reason.to_string(),
    }
}

/// gxhash64 (workspace default hash, seed 0) of the canonical (case-folded, placeholder-canonical)
/// text, as 16 lowercase hex chars.
pub(crate) fn fingerprint_hex(input: &str) -> String {
    use config::utils::hash::Sum64;
    format!("{:016x}", config::utils::hash::gxhash::new().sum64(input))
}

pub(crate) fn truncate_at_boundary(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Normalize one statement text in the given dialect mode, with identifier folding on
/// (the default behavior; see [`normalize_with_opts`]).
///
/// Input is capped at the first 16 KB; stored `query_norm` is capped at 4 KB by the caller.
pub fn normalize(text: &str, dialect: Dialect) -> Result<NormalizedStatement, NormalizeError> {
    normalize_with_opts(text, dialect, true)
}

/// [`normalize`] with the `ZO_DB_MONITORING_NORMALIZE_IDENTIFIERS` knob exposed (design §3.2):
/// `fold_identifiers=false` keeps digit/UUID/hex runs inside identifiers and Elasticsearch path
/// segments verbatim. Literal/placeholder replacement is NOT affected — it is privacy-load-bearing
/// and always on, as is the Redis high-entropy key folding (an NFR-2 guarantee, not cosmetics).
pub fn normalize_with_opts(
    text: &str,
    dialect: Dialect,
    fold_identifiers: bool,
) -> Result<NormalizedStatement, NormalizeError> {
    let text = truncate_at_boundary(text, MAX_NORM_INPUT);
    match dialect {
        Dialect::Redis => normalize_redis(text),
        Dialect::Mongodb => normalize_mongodb(text),
        Dialect::Elasticsearch => normalize_elasticsearch(text, fold_identifiers),
        _ => normalize_sql(text, dialect, fold_identifiers),
    }
}

// ---------------------------------------------------------------------------
// SQL lexer (single pass, dialect-mode aware)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokKind {
    /// Unquoted word (keyword or identifier) — case-folded for hashing, digit/hex-folded for both
    /// hash and display.
    Word,
    /// Quoted identifier (`"x"`, `` `x` ``, `[x]`) — preserved verbatim in hash and display.
    Quoted,
    /// A literal or bind placeholder, already rewritten to canonical `?`.
    Replaced,
    /// Operator/punctuation (1–2 chars).
    Punct,
}

struct Tok<'a> {
    kind: TokKind,
    text: Cow<'a, str>,
    /// Whether whitespace (or a stripped comment) preceded this token in the source.
    ws: bool,
}

struct SqlMode {
    hash_comments: bool,
    backtick_idents: bool,
    bracket_idents: bool,
    dquote_is_string: bool,
    dollar: bool,
    backslash_in_strings: bool,
    q_quote: bool,
}

impl SqlMode {
    fn for_dialect(d: Dialect) -> Self {
        let mut m = SqlMode {
            hash_comments: false,
            backtick_idents: false,
            bracket_idents: false,
            dquote_is_string: false,
            dollar: false,
            backslash_in_strings: false,
            q_quote: false,
        };
        match d {
            Dialect::Postgresql | Dialect::Cockroachdb => m.dollar = true,
            Dialect::Mysql | Dialect::Mariadb => {
                m.hash_comments = true;
                m.backtick_idents = true;
                m.dquote_is_string = true;
                m.backslash_in_strings = true;
            }
            Dialect::Mssql => m.bracket_idents = true,
            Dialect::Oracle => m.q_quote = true,
            Dialect::Clickhouse => {
                m.backtick_idents = true;
                m.backslash_in_strings = true;
            }
            Dialect::Cassandra => {}
            // Non-SQL routes never reach the SQL lexer.
            Dialect::Redis | Dialect::Mongodb | Dialect::Elasticsearch => {}
        }
        m
    }
}

fn is_word_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_' || b >= 0x80
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b >= 0x80
}

/// Scan a `'…'` string starting at the opening quote; returns the index just past the closing
/// quote. Handles `''` doubling and (optionally) backslash escapes.
fn scan_sq_string(text: &str, start: usize, backslash: bool) -> Result<usize, NormalizeError> {
    let b = text.as_bytes();
    let n = b.len();
    let mut j = start + 1;
    loop {
        if j >= n {
            return Err(lexer_err(start, "unterminated string literal"));
        }
        if backslash && b[j] == b'\\' {
            j += 2;
            continue;
        }
        if b[j] == b'\'' {
            if j + 1 < n && b[j + 1] == b'\'' {
                j += 2;
                continue;
            }
            return Ok(j + 1);
        }
        j += 1;
    }
}

/// Scan a delimiter-quoted region (`"…"` / `` `…` ``) with delimiter-doubling; returns the index
/// just past the closing delimiter.
fn scan_delim(
    text: &str,
    start: usize,
    delim: u8,
    backslash: bool,
) -> Result<usize, NormalizeError> {
    let b = text.as_bytes();
    let n = b.len();
    let mut j = start + 1;
    loop {
        if j >= n {
            return Err(lexer_err(start, "unterminated quoted region"));
        }
        if backslash && b[j] == b'\\' {
            j += 2;
            continue;
        }
        if b[j] == delim {
            if j + 1 < n && b[j + 1] == delim {
                j += 2;
                continue;
            }
            return Ok(j + 1);
        }
        j += 1;
    }
}

/// Identifier digit/uuid/hex folding (design §3.2, default on): `_`-separated segments that are
/// all-digits, or long hex runs containing a digit, fold to `?` (`events_20260807` → `events_?`,
/// `sp_c4d5e6f7` → `sp_?`).
fn fold_word(w: &str) -> Cow<'_, str> {
    if !w.bytes().any(|b| b.is_ascii_digit()) {
        return Cow::Borrowed(w);
    }
    let folded = w
        .split('_')
        .map(|seg| if fold_segment(seg) { "?" } else { seg })
        .collect::<Vec<_>>()
        .join("_");
    if folded == w {
        Cow::Borrowed(w)
    } else {
        Cow::Owned(folded)
    }
}

fn fold_segment(seg: &str) -> bool {
    if seg.is_empty() {
        return false;
    }
    if seg.bytes().all(|b| b.is_ascii_digit()) {
        return true;
    }
    seg.len() >= 8
        && seg.bytes().all(|b| b.is_ascii_hexdigit())
        && seg.bytes().any(|b| b.is_ascii_digit())
}

fn lex_sql<'a>(
    text: &'a str,
    d: Dialect,
    fold_identifiers: bool,
) -> Result<Vec<Tok<'a>>, NormalizeError> {
    let m = SqlMode::for_dialect(d);
    let b = text.as_bytes();
    let n = b.len();
    let mut toks: Vec<Tok<'a>> = Vec::new();
    let mut i = 0usize;
    let mut ws = false;
    macro_rules! push {
        ($kind:expr, $text:expr) => {{
            toks.push(Tok {
                kind: $kind,
                text: $text,
                ws,
            });
            #[allow(unused_assignments)]
            {
                ws = false;
            }
        }};
    }
    while i < n {
        let c = b[i];
        match c {
            b' ' | b'\t' | b'\r' | b'\n' => {
                ws = true;
                i += 1;
            }
            b'-' if i + 1 < n && b[i + 1] == b'-' => {
                while i < n && b[i] != b'\n' {
                    i += 1;
                }
                ws = true;
            }
            b'#' if m.hash_comments => {
                while i < n && b[i] != b'\n' {
                    i += 1;
                }
                ws = true;
            }
            b'/' if i + 1 < n && b[i + 1] == b'*' => {
                // Block comment; nesting counted (PG semantics — harmless elsewhere for
                // normalization purposes).
                let start = i;
                let mut depth = 1usize;
                i += 2;
                while i < n && depth > 0 {
                    if b[i] == b'/' && i + 1 < n && b[i + 1] == b'*' {
                        depth += 1;
                        i += 2;
                    } else if b[i] == b'*' && i + 1 < n && b[i + 1] == b'/' {
                        depth -= 1;
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                if depth > 0 {
                    return Err(lexer_err(start, "unterminated block comment"));
                }
                ws = true;
            }
            b'\'' => {
                i = scan_sq_string(text, i, m.backslash_in_strings)?;
                push!(TokKind::Replaced, Cow::Borrowed("?"));
            }
            b'"' => {
                let end = scan_delim(text, i, b'"', m.backslash_in_strings && m.dquote_is_string)?;
                if m.dquote_is_string {
                    push!(TokKind::Replaced, Cow::Borrowed("?"));
                } else {
                    push!(TokKind::Quoted, Cow::Borrowed(&text[i..end]));
                }
                i = end;
            }
            b'`' if m.backtick_idents => {
                let end = scan_delim(text, i, b'`', false)?;
                push!(TokKind::Quoted, Cow::Borrowed(&text[i..end]));
                i = end;
            }
            b'[' if m.bracket_idents => {
                let mut j = i + 1;
                loop {
                    if j >= n {
                        return Err(lexer_err(i, "unterminated bracket identifier"));
                    }
                    if b[j] == b']' {
                        if j + 1 < n && b[j + 1] == b']' {
                            j += 2;
                            continue;
                        }
                        break;
                    }
                    j += 1;
                }
                push!(TokKind::Quoted, Cow::Borrowed(&text[i..j + 1]));
                i = j + 1;
            }
            b'$' if m.dollar => {
                // `$tag$…$tag$` / `$$…$$` dollar-quote vs `$n` positional placeholder.
                let mut j = i + 1;
                while j < n && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
                    j += 1;
                }
                if j < n && b[j] == b'$' && (j == i + 1 || !b[i + 1].is_ascii_digit()) {
                    let tag = &text[i..j + 1];
                    match text[j + 1..].find(tag) {
                        Some(k) => {
                            i = j + 1 + k + tag.len();
                            push!(TokKind::Replaced, Cow::Borrowed("?"));
                        }
                        None => return Err(lexer_err(i, "unterminated dollar-quoted string")),
                    }
                } else if i + 1 < n && b[i + 1].is_ascii_digit() {
                    let mut k = i + 1;
                    while k < n && b[k].is_ascii_digit() {
                        k += 1;
                    }
                    push!(TokKind::Replaced, Cow::Borrowed("?"));
                    i = k;
                } else {
                    push!(TokKind::Punct, Cow::Borrowed("$"));
                    i += 1;
                }
            }
            b'?' => {
                push!(TokKind::Replaced, Cow::Borrowed("?"));
                i += 1;
            }
            b'@' => {
                // `@name` / `@@var` bind-parameter styles (Npgsql/ADO.NET, MSSQL).
                let mut j = i + 1;
                if j < n && b[j] == b'@' {
                    j += 1;
                }
                let word_start = j;
                while j < n && is_word_byte(b[j]) {
                    j += 1;
                }
                if j > word_start {
                    push!(TokKind::Replaced, Cow::Borrowed("?"));
                    i = j;
                } else {
                    push!(TokKind::Punct, Cow::Borrowed("@"));
                    i += 1;
                }
            }
            b':' => {
                if i + 1 < n && b[i + 1] == b':' {
                    // PG cast `::` — not a bind parameter.
                    push!(TokKind::Punct, Cow::Borrowed("::"));
                    i += 2;
                } else {
                    let mut j = i + 1;
                    while j < n && is_word_byte(b[j]) {
                        j += 1;
                    }
                    if j > i + 1 {
                        push!(TokKind::Replaced, Cow::Borrowed("?"));
                        i = j;
                    } else {
                        push!(TokKind::Punct, Cow::Borrowed(":"));
                        i += 1;
                    }
                }
            }
            b'%' => {
                // psycopg `%s` / `%(name)s` pyformat placeholders.
                if i + 1 < n && b[i + 1] == b's' && (i + 2 >= n || !is_word_byte(b[i + 2])) {
                    push!(TokKind::Replaced, Cow::Borrowed("?"));
                    i += 2;
                } else if i + 1 < n && b[i + 1] == b'(' {
                    let mut j = i + 2;
                    while j < n && is_word_byte(b[j]) {
                        j += 1;
                    }
                    if j + 1 < n && b[j] == b')' && b[j + 1] == b's' {
                        push!(TokKind::Replaced, Cow::Borrowed("?"));
                        i = j + 2;
                    } else {
                        push!(TokKind::Punct, Cow::Borrowed("%"));
                        i += 1;
                    }
                } else {
                    push!(TokKind::Punct, Cow::Borrowed("%"));
                    i += 1;
                }
            }
            b'0'..=b'9' => {
                let mut j = i;
                if b[i] == b'0' && i + 1 < n && (b[i + 1] | 32) == b'x' {
                    j = i + 2;
                    while j < n && b[j].is_ascii_hexdigit() {
                        j += 1;
                    }
                } else {
                    while j < n && b[j].is_ascii_digit() {
                        j += 1;
                    }
                    if j < n && b[j] == b'.' && j + 1 < n && b[j + 1].is_ascii_digit() {
                        j += 1;
                        while j < n && b[j].is_ascii_digit() {
                            j += 1;
                        }
                    }
                    if j < n
                        && (b[j] | 32) == b'e'
                        && j + 1 < n
                        && (b[j + 1].is_ascii_digit()
                            || ((b[j + 1] == b'+' || b[j + 1] == b'-')
                                && j + 2 < n
                                && b[j + 2].is_ascii_digit()))
                    {
                        j += 2;
                        while j < n && b[j].is_ascii_digit() {
                            j += 1;
                        }
                    }
                }
                // Absorb trailing word chars so `123abc`-style tokens fold whole.
                while j < n && is_word_byte(b[j]) {
                    j += 1;
                }
                push!(TokKind::Replaced, Cow::Borrowed("?"));
                i = j;
            }
            c if is_word_start(c) => {
                let start = i;
                let mut j = i + 1;
                while j < n && is_word_byte(b[j]) {
                    j += 1;
                }
                let word = &text[start..j];
                // String-literal prefixes directly attached to a quote.
                if j < n && b[j] == b'\'' && word.len() == 1 {
                    let p = word.as_bytes()[0] | 32;
                    if p == b'q' && m.q_quote {
                        // Oracle q'<delim>…<close>' quoting.
                        if j + 1 >= n {
                            return Err(lexer_err(start, "unterminated q-quoted string"));
                        }
                        let open = b[j + 1];
                        let close = match open {
                            b'[' => b']',
                            b'{' => b'}',
                            b'(' => b')',
                            b'<' => b'>',
                            other => other,
                        };
                        let mut k = j + 2;
                        loop {
                            if k + 1 >= n {
                                return Err(lexer_err(start, "unterminated q-quoted string"));
                            }
                            if b[k] == close && b[k + 1] == b'\'' {
                                break;
                            }
                            k += 1;
                        }
                        push!(TokKind::Replaced, Cow::Borrowed("?"));
                        i = k + 2;
                        continue;
                    }
                    if matches!(p, b'e' | b'n' | b'b' | b'x') {
                        // E'' (backslash escapes), N'' (national), B''/X'' (bit/hex).
                        let backslash = p == b'e' || m.backslash_in_strings;
                        i = scan_sq_string(text, j, backslash)?;
                        push!(TokKind::Replaced, Cow::Borrowed("?"));
                        continue;
                    }
                }
                push!(
                    TokKind::Word,
                    if fold_identifiers {
                        fold_word(word)
                    } else {
                        Cow::Borrowed(word)
                    }
                );
                i = j;
            }
            _ => {
                push!(TokKind::Punct, Cow::Borrowed(&text[i..i + 1]));
                i += 1;
            }
        }
    }
    Ok(toks)
}

// ---------------------------------------------------------------------------
// SQL rendering: group collapsing + display/hash text assembly
// ---------------------------------------------------------------------------

/// If `toks[open]` opens a parenthesized group containing ONLY placeholders and commas (with at
/// least one placeholder), return the index of the closing paren.
fn collapsible_group_end(toks: &[Tok<'_>], open: usize) -> Option<usize> {
    let mut j = open + 1;
    let mut seen_replaced = false;
    while j < toks.len() {
        match toks[j].kind {
            TokKind::Replaced => {
                seen_replaced = true;
                j += 1;
            }
            TokKind::Punct if toks[j].text == "," => j += 1,
            TokKind::Punct if toks[j].text == ")" => {
                return seen_replaced.then_some(j);
            }
            _ => return None,
        }
    }
    None
}

struct RenderedStmt {
    norm: String,
    folded: String,
    first_word: Option<String>,
}

/// Whether the HASH stream needs a space before this token.
///
/// The display stream reproduces the author's spacing; the hash stream must not,
/// because the two vantages do not agree on it. `pg_stat_statements` (and MySQL's
/// `performance_schema`) hand us text their own jumbler already re-spaced —
/// `count ( * )` for the driver's `count(*)`, `( a, b, c )` for `(a, b, c)`. Same
/// statement, and before this rule two different fingerprints, which hid the
/// server's captured plan from the client's query row (measured: every INSERT and
/// every aggregate SELECT missed).
///
/// A space is emitted ONLY between two tokens that would otherwise fuse into a
/// different token: two adjacent words (`a b` must not become `ab`, or an alias
/// merges into its column). Space adjacent to punctuation is dropped, because no
/// punctuation-adjacent space can change the token stream — and that is exactly
/// the spacing the two vantages disagree about.
///
/// Deliberately NOT "strip all whitespace": that would merge `SELECT a b` with
/// `SELECT ab`, and a fingerprint collision between two real statements shows a
/// confident, wrong plan — worse than showing none.
fn hash_needs_space(prev: Option<TokKind>, next: TokKind) -> bool {
    matches!(
        (prev, next),
        (
            Some(TokKind::Word | TokKind::Quoted | TokKind::Replaced),
            TokKind::Word | TokKind::Quoted | TokKind::Replaced
        )
    )
}

fn render_stmt(toks: &[Tok<'_>]) -> RenderedStmt {
    let mut norm = String::new();
    let mut folded = String::new();
    let mut first_word: Option<String> = None;
    // Kind of the last token appended to the HASH stream (the display stream keeps
    // using each token's own `ws` flag).
    let mut prev_kind: Option<TokKind> = None;
    let mut i = 0;
    while i < toks.len() {
        let t = &toks[i];
        if t.kind == TokKind::Punct
            && t.text == "("
            && let Some(close) = collapsible_group_end(toks, i)
        {
            if t.ws && !norm.is_empty() {
                norm.push(' ');
            }
            norm.push_str("(?)");
            // A collapsed group opens with `(` — punctuation, so never space-prefixed
            // in the hash stream — and closes with `)`.
            folded.push_str("(?)");
            prev_kind = Some(TokKind::Punct);
            i = close + 1;
            // Multi-row VALUES: absorb subsequent `, (…)` all-placeholder groups.
            loop {
                let comma =
                    matches!(toks.get(i), Some(t) if t.kind == TokKind::Punct && t.text == ",");
                if !comma {
                    break;
                }
                let open2 =
                    matches!(toks.get(i + 1), Some(t) if t.kind == TokKind::Punct && t.text == "(");
                if !open2 {
                    break;
                }
                match collapsible_group_end(toks, i + 1) {
                    Some(close2) => i = close2 + 1,
                    None => break,
                }
            }
            continue;
        }
        if t.kind == TokKind::Word && first_word.is_none() {
            first_word = Some(t.text.to_string());
        }
        if t.ws && !norm.is_empty() {
            norm.push(' ');
        }
        if hash_needs_space(prev_kind, t.kind) {
            folded.push(' ');
        }
        norm.push_str(&t.text);
        if t.kind == TokKind::Word {
            folded.push_str(&t.text.to_lowercase());
        } else {
            folded.push_str(&t.text);
        }
        prev_kind = Some(t.kind);
        i += 1;
    }
    RenderedStmt {
        norm,
        folded,
        first_word,
    }
}

fn is_tcl_word(w: &str) -> bool {
    matches!(
        w,
        "BEGIN" | "START" | "COMMIT" | "ROLLBACK" | "SAVEPOINT" | "RELEASE" | "ABORT" | "END"
    )
}

fn single_stmt_class(s: &RenderedStmt) -> StmtClass {
    let fw = s
        .first_word
        .as_deref()
        .map(|w| w.to_ascii_uppercase())
        .unwrap_or_default();
    if is_tcl_word(&fw) {
        StmtClass::TransactionControl
    } else if fw == "SET" || fw == "RESET" {
        StmtClass::SessionControl
    } else if s.folded == "select ?" {
        StmtClass::Ping
    } else {
        StmtClass::Query
    }
}

fn normalize_sql(
    text: &str,
    dialect: Dialect,
    fold_identifiers: bool,
) -> Result<NormalizedStatement, NormalizeError> {
    let toks = lex_sql(text, dialect, fold_identifiers)?;
    let mut rendered: Vec<RenderedStmt> = Vec::new();
    for stmt_toks in toks.split(|t| t.kind == TokKind::Punct && t.text == ";") {
        let s = render_stmt(stmt_toks);
        if !s.norm.is_empty() {
            rendered.push(s);
        }
    }
    if rendered.is_empty() {
        return Err(lexer_err(0, "no statement tokens"));
    }

    // Collapse consecutive identical statement blocks (Npgsql-style repeated batch INSERTs);
    // report the largest collapsed run as the batch multiplier.
    let mut blocks: Vec<RenderedStmt> = Vec::new();
    let mut run = 1i64;
    let mut multiplier = 1i64;
    for s in rendered {
        match blocks.last() {
            Some(prev) if prev.folded == s.folded => {
                run += 1;
                multiplier = multiplier.max(run);
            }
            _ => {
                run = 1;
                blocks.push(s);
            }
        }
    }

    let norm = blocks
        .iter()
        .map(|s| s.norm.as_str())
        .collect::<Vec<_>>()
        .join("; ");
    let folded = blocks
        .iter()
        .map(|s| s.folded.as_str())
        .collect::<Vec<_>>()
        .join("; ");

    // Operation: first non-TCL statement's leading keyword; heterogeneous batches → BATCH;
    // all-TCL batches → the first statement's keyword.
    let mut non_tcl_ops: Vec<String> = Vec::new();
    for s in &blocks {
        if let Some(fw) = s.first_word.as_deref() {
            let up = fw.to_ascii_uppercase();
            if !is_tcl_word(&up) && !non_tcl_ops.contains(&up) {
                non_tcl_ops.push(up);
            }
        }
    }
    let operation = match non_tcl_ops.len() {
        0 => blocks[0]
            .first_word
            .as_deref()
            .map(|w| w.to_ascii_uppercase()),
        1 => Some(non_tcl_ops.remove(0)),
        _ => Some("BATCH".to_string()),
    };

    let stmt_class = if blocks.len() == 1 {
        single_stmt_class(&blocks[0])
    } else {
        let classes: Vec<StmtClass> = blocks
            .iter()
            .map(single_stmt_class)
            .filter(|c| *c != StmtClass::TransactionControl)
            .collect();
        if classes.is_empty() {
            StmtClass::TransactionControl
        } else if classes.iter().all(|c| *c == StmtClass::SessionControl) {
            StmtClass::SessionControl
        } else {
            StmtClass::Query
        }
    };

    Ok(NormalizedStatement {
        fingerprint: fingerprint_hex(&folded),
        query_norm: Some(norm),
        operation,
        stmt_class,
        batch_multiplier: multiplier,
    })
}

// ---------------------------------------------------------------------------
// Redis: command + first-key pattern, high-entropy segment folding
// ---------------------------------------------------------------------------

/// High-entropy key-segment heuristic (design §3.2 redis route): digit runs, hex runs, UUIDs,
/// AND base64-like / email-like / long non-dictionary segments fold to `?` — digit-folding alone
/// leaks `user:foo@bar.com:session`-style key literals.
fn is_high_entropy_segment(seg: &str) -> bool {
    if seg.is_empty() {
        return false;
    }
    if seg.contains('@') {
        return true; // email-like
    }
    if seg.bytes().all(|b| b.is_ascii_digit()) {
        return true;
    }
    // Hex/UUID runs (dashes stripped so canonical UUIDs match).
    let hexish_len = seg.bytes().filter(|b| *b != b'-').count();
    if hexish_len >= 8
        && seg.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        && seg.bytes().any(|b| b.is_ascii_digit())
    {
        return true;
    }
    // Base64-like / long non-dictionary segments (charset/length heuristic).
    seg.len() >= 16
        && seg
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=' | b'-' | b'_'))
}

fn redis_key_pattern(key: &str) -> String {
    key.split(':')
        .map(|seg| {
            if is_high_entropy_segment(seg) {
                "?"
            } else {
                seg
            }
        })
        .collect::<Vec<_>>()
        .join(":")
}

fn normalize_redis(text: &str) -> Result<NormalizedStatement, NormalizeError> {
    // Jedis serializes MULTI/pipeline bodies as one `;`-joined text
    // (`INCR txn:counter;INCR txn:counter`, `SET batch:1 ?; SET batch:2 ?; …` —
    // real capture, tests/dbm-capture fixtures java-*). Only the first command binds
    // the pattern; without this cut the trailing `;CMD` glues onto the key and every
    // batch size mints a distinct fingerprint (and leaks the extra commands into
    // `query_norm`).
    let text = text.split(';').next().unwrap_or(text);
    let mut it = text.split_whitespace();
    let Some(cmd) = it.next() else {
        return Err(lexer_err(0, "empty redis command"));
    };
    let op = cmd.to_ascii_uppercase();
    // First key only; remaining arguments (and the js-contrib "[N other arguments]" suffix) are
    // dropped entirely.
    let key = it.next().filter(|k| !k.starts_with('['));
    let norm = match key {
        Some(k) => format!("{op} {}", redis_key_pattern(k)),
        None => op.clone(),
    };
    let stmt_class = if op == "PING" {
        StmtClass::Ping
    } else {
        StmtClass::Query
    };
    Ok(NormalizedStatement {
        fingerprint: fingerprint_hex(&norm.to_lowercase()),
        query_norm: Some(norm),
        operation: Some(op),
        stmt_class,
        batch_multiplier: 1,
    })
}

// ---------------------------------------------------------------------------
// MongoDB: command document with argument values stripped
// ---------------------------------------------------------------------------

/// Mongo command text arrives in two real-world serializations (captured corpus,
/// `tests/dbm-capture/`):
///
/// * JSON command document, driver-masked or raw — js-contrib (`{"find":"?","filter":{"_id":"?"}}`)
///   and generic clients (`{"find":"users","filter":{"email":"bob@…"}}`);
/// * pymongo `capture_statement=True` dict-repr with a leading bare command word, single-quoted
///   strings, and Python `True`/`False`/`None` literals (`find {'_id': 3}`, `insert [{'_id': 101,
///   'name': 'ins-1', …}]`) — with `capture_statement=False` (the default) the text is the bare
///   command name alone.
///
/// Normalization: keys preserved (author's order, raw text — no serde round-trip), the
/// command value string (the collection) preserved, every other scalar value folds to
/// `"?"`, and arrays of repeated identical folded elements collapse to one element —
/// the `IN (…)`-collapse analog: `$in` arity and `insert_many` document count must not
/// mint per-arity fingerprints.
///
/// Operation: the leading bare command word, else the first top-level key — unless it
/// starts with `_`/`$` (a bare document like js-contrib's `{"_id":"?",…}` insert shape
/// has no command key; claiming `_id` as the operation would be wrong). `ping` gets
/// [`StmtClass::Ping`] — it is the Mongo pool-probe analog of `SELECT 1`.
fn normalize_mongodb(text: &str) -> Result<NormalizedStatement, NormalizeError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(lexer_err(0, "empty mongodb command"));
    }
    let (command_word, doc) = split_leading_command(trimmed);
    let mut operation: Option<String> = command_word.map(str::to_string);
    let folded = match doc {
        Some(d) => Some(collapse_repeated_array_elements(&fold_command_doc(
            d,
            &mut operation,
        )?)),
        None => None,
    };
    let norm = match (command_word, folded) {
        (Some(w), Some(d)) => format!("{w} {d}"),
        (Some(w), None) => w.to_string(),
        (None, Some(d)) => d,
        (None, None) => return Err(lexer_err(0, "empty mongodb command")),
    };
    let stmt_class = if operation
        .as_deref()
        .is_some_and(|o| o.eq_ignore_ascii_case("ping"))
    {
        StmtClass::Ping
    } else {
        StmtClass::Query
    };
    Ok(NormalizedStatement {
        fingerprint: fingerprint_hex(&norm.to_lowercase()),
        query_norm: Some(norm),
        operation,
        stmt_class,
        batch_multiplier: 1,
    })
}

/// Split pymongo's `command {doc}` / `command [{docs}]` / bare `command` shapes off the
/// front of the text. Returns `(command_word, document_part)`.
fn split_leading_command(text: &str) -> (Option<&str>, Option<&str>) {
    let b = text.as_bytes();
    if !(b[0].is_ascii_alphabetic() || b[0] == b'_') {
        return (None, Some(text));
    }
    let mut j = 1;
    while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
        j += 1;
    }
    let rest = text[j..].trim_start();
    if rest.is_empty() {
        (Some(&text[..j]), None)
    } else if rest.starts_with('{') || rest.starts_with('[') {
        (Some(&text[..j]), Some(rest))
    } else {
        // Not a command-plus-document shape; treat the whole text as a document.
        (None, Some(text))
    }
}

/// Single pass over a command-document body: keys (double-quoted, single-quoted, or
/// bare) are preserved, the first top-level command value string is preserved (the
/// collection), all other scalar values — numbers, quoted strings, JSON and Python
/// word literals — fold to `"?"`.
fn fold_command_doc(text: &str, operation: &mut Option<String>) -> Result<String, NormalizeError> {
    let b = text.as_bytes();
    let n = b.len();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    let mut depth = 0i32;
    // Only meaningful when no leading command word claimed the operation already.
    let mut first_key_pending = operation.is_none();
    let mut command_value_pending = false;
    let is_key = |end: usize| {
        let mut j = end;
        while j < n && (b[j] as char).is_ascii_whitespace() {
            j += 1;
        }
        j < n && b[j] == b':'
    };
    while i < n {
        match b[i] {
            b'{' | b'[' => {
                depth += 1;
                if command_value_pending {
                    // Command value is a nested doc — never preserve nested content.
                    command_value_pending = false;
                }
                out.push(b[i] as char);
                i += 1;
            }
            b'}' | b']' => {
                depth -= 1;
                out.push(b[i] as char);
                i += 1;
            }
            q @ (b'"' | b'\'') => {
                let start = i;
                i += 1;
                while i < n && b[i] != q {
                    if b[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
                if i >= n {
                    return Err(lexer_err(start, "unterminated string in command document"));
                }
                i += 1; // past closing quote
                let span = &text[start..i];
                if is_key(i) {
                    out.push_str(span);
                    if depth == 1 && first_key_pending {
                        first_key_pending = false;
                        let name = &span[1..span.len() - 1];
                        if !name.starts_with(['_', '$']) {
                            *operation = Some(name.to_string());
                            command_value_pending = true;
                        }
                    }
                } else if depth == 1 && command_value_pending {
                    out.push_str(span); // the collection name
                    command_value_pending = false;
                } else {
                    out.push_str("\"?\"");
                }
            }
            b'0'..=b'9' | b'-' => {
                while i < n
                    && (b[i].is_ascii_digit() || matches!(b[i], b'-' | b'+' | b'.' | b'e' | b'E'))
                {
                    i += 1;
                }
                command_value_pending = false;
                out.push_str("\"?\"");
            }
            c if c.is_ascii_alphabetic() || c == b'_' || c == b'$' => {
                // Bare word: an unquoted key is preserved; anything else is a word
                // literal (JSON true/false/null, Python True/False/None, …) → `"?"`.
                let start = i;
                while i < n && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'$')) {
                    i += 1;
                }
                let span = &text[start..i];
                if is_key(i) {
                    out.push_str(span);
                    if depth == 1 && first_key_pending {
                        first_key_pending = false;
                        if !span.starts_with(['_', '$']) {
                            *operation = Some(span.to_string());
                            command_value_pending = true;
                        }
                    }
                } else {
                    command_value_pending = false;
                    out.push_str("\"?\"");
                }
            }
            other => {
                out.push(other as char);
                i += 1;
            }
        }
    }
    Ok(out)
}

/// Collapse consecutive identical elements inside every `[…]` of an already-folded
/// document (`{'$in': ["?", "?", "?"]}` → `{'$in': ["?"]}`; `insert_many`'s repeated
/// `{'_id': "?", …}` docs → one). Kept elements preserve their original text; the
/// separator style of the source (`", "` vs `","`) is preserved.
fn collapse_repeated_array_elements(s: &str) -> String {
    fn skip_quoted(b: &[u8], mut i: usize) -> usize {
        let q = b[i];
        i += 1;
        while i < b.len() && b[i] != q {
            if b[i] == b'\\' {
                i += 1;
            }
            i += 1;
        }
        (i + 1).min(b.len())
    }
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < b.len() {
        match b[i] {
            b'"' | b'\'' => {
                let end = skip_quoted(b, i);
                out.push_str(&s[i..end]);
                i = end;
            }
            b'[' => {
                // Find the matching close bracket.
                let open = i;
                let mut depth = 0i32;
                let mut j = i;
                while j < b.len() {
                    match b[j] {
                        b'"' | b'\'' => {
                            j = skip_quoted(b, j);
                            continue;
                        }
                        b'[' | b'{' => depth += 1,
                        b']' | b'}' => {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            }
                        }
                        _ => {}
                    }
                    j += 1;
                }
                if j >= b.len() {
                    // Unbalanced — emit as-is (fold_command_doc already validated
                    // strings; this is defensive only).
                    out.push_str(&s[open..]);
                    return out;
                }
                let inner = &s[open + 1..j];
                // Split inner on top-level commas.
                let ib = inner.as_bytes();
                let mut elems: Vec<&str> = Vec::new();
                let (mut d, mut start, mut k) = (0i32, 0usize, 0usize);
                while k < ib.len() {
                    match ib[k] {
                        b'"' | b'\'' => {
                            k = skip_quoted(ib, k);
                            continue;
                        }
                        b'[' | b'{' => d += 1,
                        b']' | b'}' => d -= 1,
                        b',' if d == 0 => {
                            elems.push(&inner[start..k]);
                            start = k + 1;
                        }
                        _ => {}
                    }
                    k += 1;
                }
                elems.push(&inner[start..]);
                let sep = if inner.contains(", ") { ", " } else { "," };
                let mut kept: Vec<String> = Vec::new();
                for e in elems {
                    let processed = collapse_repeated_array_elements(e.trim());
                    if kept.last() != Some(&processed) {
                        kept.push(processed);
                    }
                }
                out.push('[');
                out.push_str(&kept.join(sep));
                out.push(']');
                i = j + 1;
            }
            other => {
                out.push(other as char);
                i += 1;
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Elasticsearch: method + path template
// ---------------------------------------------------------------------------

/// Fold digit/date runs in a path (`/logs-2026.08.07/_search` → `/logs-?/_search`); the query
/// string is never part of the template.
fn fold_path_digits(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let mut chars = path.chars().peekable();
    while let Some(c) = chars.next() {
        if c.is_ascii_digit() {
            while let Some(&nc) = chars.peek() {
                if nc.is_ascii_digit() || nc == '.' {
                    chars.next();
                } else {
                    break;
                }
            }
            out.push('?');
        } else {
            out.push(c);
        }
    }
    out
}

fn normalize_elasticsearch(
    text: &str,
    fold_identifiers: bool,
) -> Result<NormalizedStatement, NormalizeError> {
    // ES clients populate statement text with "METHOD /endpoint" on the first line; the request
    // body (subsequent lines) is never normalized into the template.
    let line = text.lines().next().unwrap_or("").trim();
    let mut it = line.split_whitespace();
    let Some(first) = it.next() else {
        return Err(lexer_err(0, "empty elasticsearch statement"));
    };
    let (method, path_raw) = if first.starts_with('/') {
        (None, first)
    } else {
        (Some(first.to_ascii_uppercase()), it.next().unwrap_or(""))
    };
    let path = path_raw.split(['?', '#']).next().unwrap_or("");
    let folded_path = if fold_identifiers {
        fold_path_digits(path)
    } else {
        path.to_string()
    };
    let norm = match (&method, folded_path.is_empty()) {
        (Some(m), false) => format!("{m} {folded_path}"),
        (Some(m), true) => m.clone(),
        (None, _) => folded_path.clone(),
    };
    if norm.is_empty() {
        return Err(lexer_err(0, "empty elasticsearch template"));
    }
    Ok(NormalizedStatement {
        fingerprint: fingerprint_hex(&norm.to_lowercase()),
        query_norm: Some(norm),
        operation: method,
        stmt_class: StmtClass::Query,
        batch_multiplier: 1,
    })
}
