// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/// Escapes a value embedded in a SQL `LIKE` pattern.
pub fn escape_like(input: impl AsRef<str>) -> String {
    let input = input.as_ref();
    let mut escaped = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '\\' => escaped.push_str(r"\\"),
            '%' => escaped.push_str(r"\%"),
            '_' => escaped.push_str(r"\_"),
            '\'' => escaped.push_str("''"),
            _ => escaped.push(c),
        }
    }
    escaped
}
