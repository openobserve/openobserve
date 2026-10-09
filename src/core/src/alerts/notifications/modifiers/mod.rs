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

mod duration;
mod humanize;
mod numeric;
mod percentage;
mod size;
mod timestamp;

pub(crate) struct PreparedTemplate {
    pub(crate) template: String,
    replacements: Vec<(String, String)>,
}

impl PreparedTemplate {
    pub(crate) fn plain(template: String) -> Self {
        Self {
            template,
            replacements: Vec::new(),
        }
    }

    pub(crate) fn finish(&self, mut rendered: String) -> String {
        for (marker, output) in &self.replacements {
            rendered = rendered.replace(marker, output);
        }
        rendered
    }

    fn protect(&mut self, output: String) {
        // Opaque markers keep formatted and rejected expressions inert until substitution ends.
        let marker = format!("\u{e000}{:032x}\u{e001}", rand::random::<u128>());
        self.template.push_str(&marker);
        self.replacements.push((marker, output));
    }
}

pub(crate) fn prepare_modifiers(
    tpl: &str,
    mut lookup: impl FnMut(&str) -> Option<String>,
    mut literal_field_exists: impl FnMut(&str) -> bool,
    is_email: bool,
) -> PreparedTemplate {
    let mut prepared = PreparedTemplate::plain(String::with_capacity(tpl.len()));
    let mut cursor = 0;
    while let Some((start, end, closed)) = next_placeholder(tpl, cursor) {
        prepared.template.push_str(&tpl[cursor..start]);
        let expression_end = if closed { end - 1 } else { end };
        let expression = &tpl[start + 1..expression_end];
        let literal = is_literal_placeholder(expression, &mut literal_field_exists)
            || (!closed
                && tpl[..end].ends_with('}')
                && is_literal_placeholder(&tpl[start + 1..end - 1], &mut literal_field_exists));
        if let Some((field, function)) = expression.split_once('|').filter(|_| !literal) {
            let replacement = if closed
                && !field.is_empty()
                && !tpl[..start].ends_with('{')
                && (!field.contains(':') || literal_field_exists(field))
            {
                lookup(field).and_then(|value| format_modifier(&value, function))
            } else {
                None
            };
            let output = match replacement {
                Some(output) if !is_email => super::custom::format_variable_value(output),
                Some(output) => output,
                None => tpl[start..end].to_string(),
            };
            prepared.protect(output);
        } else {
            prepared.template.push_str(&tpl[start..end]);
        }
        cursor = end;
    }
    prepared.template.push_str(&tpl[cursor..]);
    prepared
}

fn next_placeholder(tpl: &str, cursor: usize) -> Option<(usize, usize, bool)> {
    let mut start = None;
    let mut modifier = false;
    let mut quoted = false;
    let mut escaped = false;
    let mut nested = 0usize;
    for (index, ch) in tpl[cursor..].char_indices() {
        let index = cursor + index;
        if quoted {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                quoted = false;
            }
            continue;
        }
        match ch {
            '{' if modifier => nested += 1,
            '{' => {
                start = (!tpl[index + 1..].trim_start().starts_with('"')).then_some(index);
                modifier = false;
            }
            '|' if start.is_some() => modifier = true,
            '"' if modifier => quoted = true,
            '}' if nested > 0 => nested -= 1,
            '}' => {
                if let Some(start) = start {
                    return Some((start, index + 1, true));
                }
            }
            _ => {}
        }
    }
    start
        .filter(|_| modifier)
        .map(|start| (start, tpl.len(), false))
}

fn is_literal_placeholder(
    expression: &str,
    literal_field_exists: &mut impl FnMut(&str) -> bool,
) -> bool {
    literal_field_exists(expression)
        || expression.rsplit_once(':').is_some_and(|(field, length)| {
            length.parse::<usize>().is_ok_and(|length| length > 0) && literal_field_exists(field)
        })
}

fn format_modifier(input: &str, function: &str) -> Option<String> {
    if let Some(args) = function.strip_prefix("formatTimestampMicros") {
        return timestamp::format(input, args, true);
    }
    if let Some(args) = function.strip_prefix("formatTimestamp") {
        return timestamp::format(input, args, false);
    }
    match function {
        "humanize" => humanize::format(input, false),
        "humanize1024" => humanize::format(input, true),
        "humanizeDuration" => duration::format(input),
        "humanizePercentage" => percentage::format(input),
        "humanSize" => size::format(input),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render_modifiers(tpl: &str, lookup: impl FnMut(&str) -> Option<String>) -> String {
        let lookup = std::cell::RefCell::new(lookup);
        let prepared = prepare_modifiers(
            tpl,
            |field| lookup.borrow_mut()(field),
            |field| lookup.borrow_mut()(field).is_some(),
            true,
        );
        prepared.finish(prepared.template.clone())
    }

    #[test]
    fn parser_preserves_unsupported_and_literal_fields() {
        let tpl = "{v} {v|unknown} {missing|humanize} {v|} {|humanize} {v|humanize|humanize} {v|humanize:2} {{v|humanize}} {v|humanize";
        assert_eq!(
            render_modifiers(tpl, |field| (field == "v").then(|| "1200".into())),
            tpl
        );
        assert_eq!(
            render_modifiers("{v|humanize}", |field| match field {
                "v" => Some("1200".into()),
                "v|humanize" => Some("literal".into()),
                _ => None,
            }),
            "{v|humanize}"
        );
        assert_eq!(
            render_modifiers(r#"{"value":"{v|humanize}"}"#, |field| (field == "v")
                .then(|| "1200".into())),
            r#"{"value":"1.2k"}"#
        );
    }

    #[test]
    fn quoted_format_braces_stay_inert() {
        let tpl = r#"{t|formatTimestamp("{alert_count} %Y \"quoted\"", "UTC")}"#;
        let prepared = prepare_modifiers(
            tpl,
            |field| (field == "t").then(|| "0".into()),
            |_| false,
            false,
        );
        let plain = prepared.template.replace("{alert_count}", "99");
        assert_eq!(prepared.finish(plain), r#"{alert_count} 1970 \"quoted\""#);
    }
}
