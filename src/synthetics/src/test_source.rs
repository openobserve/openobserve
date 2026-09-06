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

//! Helpers for the crate's source scans, so no assertion can match its own text.

/// The file minus its test modules, so an assertion cannot match its own text.
pub(crate) fn production(src: &str) -> &str {
    let at = src
        .find("\n#[cfg(test)]")
        .expect("the scanned file must still end in test modules");
    &src[..at]
}

/// A comment names what it forbids, so a guard scanning one fails on its own explanation.
pub(crate) fn code_only(src: &str) -> String {
    src.lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Byte range of the brace-balanced block opened at or after `at`.
pub(crate) fn block_from(src: &str, at: usize) -> (usize, usize) {
    let open = at + src[at..].find('{').expect("a block must follow the anchor");
    let mut depth = 0usize;
    for (i, c) in src[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return (open, open + i);
                }
            }
            _ => {}
        }
    }
    panic!("the anchored block is not brace-balanced");
}

/// Byte range of the block opened by the first non-definition call to `needle`.
pub(crate) fn guarded_block(src: &str, needle: &str) -> (usize, usize) {
    let def_ident_at = src
        .find(&["fn ", needle].concat())
        .expect("the guard must be defined in this file")
        + 3;
    let call_at = src
        .match_indices(needle)
        .map(|(i, _)| i)
        .find(|i| *i != def_ident_at)
        .expect("the guard must be called from the scheduler");
    block_from(src, call_at)
}

/// The innermost brace-balanced block enclosing `at`.
pub(crate) fn enclosing_block(src: &str, at: usize) -> &str {
    let mut depth = 0usize;
    let open = src[..at]
        .char_indices()
        .rev()
        .find(|&(_, c)| match c {
            '}' => {
                depth += 1;
                false
            }
            '{' if depth == 0 => true,
            '{' => {
                depth -= 1;
                false
            }
            _ => false,
        })
        .expect("the call site must sit inside a block")
        .0;
    let (open, end) = block_from(src, open);
    &src[open..end]
}

/// The one statement starting at `at`, so a neighbour's arguments cannot satisfy an assertion.
pub(crate) fn statement_at(src: &str, at: usize) -> &str {
    let end = at + src[at..].find(';').unwrap_or(src.len() - at);
    &src[at..end]
}
