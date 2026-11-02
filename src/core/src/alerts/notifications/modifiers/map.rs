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

pub(super) fn format(input: &str, args: &str) -> Option<String> {
    let pairs = parse_pairs(args.strip_prefix('(')?.strip_suffix(')')?)?;
    pairs
        .into_iter()
        .find(|(key, _)| key == input)
        .map(|(_, value)| value)
}

fn parse_pairs(mut args: &str) -> Option<Vec<(String, String)>> {
    let mut pairs = Vec::new();
    loop {
        let (key, rest) = token(args.trim_start(), '=')?;
        if key.is_empty() {
            return None;
        }
        let rest = rest.trim_start().strip_prefix('=')?;
        let (value, rest) = token(rest.trim_start(), ',')?;
        pairs.push((key, value));
        let rest = rest.trim_start();
        if rest.is_empty() {
            return Some(pairs);
        }
        args = rest.strip_prefix(',')?;
    }
}

fn token(input: &str, delimiter: char) -> Option<(String, &str)> {
    if !input.starts_with('"') {
        let end = input.find(delimiter).unwrap_or(input.len());
        let bare = input[..end].trim_end();
        return (!bare.contains(['=', ','])).then(|| (bare.to_string(), &input[end..]));
    }
    let mut escaped = false;
    let (close, _) = input.char_indices().skip(1).find(|&(_, ch)| {
        let closes = !escaped && ch == '"';
        escaped = !escaped && ch == '\\';
        closes
    })?;
    let value = serde_json::from_str(&input[..=close]).ok()?;
    Some((value, &input[close + 1..]))
}

#[cfg(test)]
mod tests {
    use super::super::{format_modifier, prepare_modifiers};

    #[test]
    fn maps_value_to_its_pair() {
        let function = "map(firing=#D63232, resolved = #36a64f)";
        for (input, expected) in [
            ("firing", Some("#D63232")),
            ("resolved", Some("#36a64f")),
            ("pending", None),
            ("Firing", None),
        ] {
            assert_eq!(
                format_modifier(input, function).as_deref(),
                expected,
                "{input}"
            );
        }
        assert_eq!(
            format_modifier("firing", r#"map("firing"="a, b", resolved="c\"d")"#).as_deref(),
            Some("a, b")
        );
        assert_eq!(
            format_modifier("resolved", r#"map("firing"="a, b", resolved="c\"d")"#).as_deref(),
            Some("c\"d")
        );
        assert_eq!(
            format_modifier("firing", "map(firing=,resolved=ok)").as_deref(),
            Some("")
        );
    }

    #[test]
    fn malformed_arguments_are_rejected() {
        for function in [
            "map",
            "map()",
            "map(firing)",
            "map(=red)",
            "map(firing=red,)",
            "map(firing=red resolved=green)",
            "map(a,b=red)",
            r#"map(firing="red)"#,
            r#"map(firing="red"x)"#,
            "mapx(firing=red)",
        ] {
            assert_eq!(format_modifier("firing", function), None, "{function}");
        }
    }

    #[test]
    fn slack_color_follows_alert_status() {
        let tpl = r##"{"attachments":[{"color":"{alert_status|map(firing=#D63232,resolved=#36a64f)}"}]}"##;
        for (status, color) in [("firing", "#D63232"), ("resolved", "#36a64f")] {
            let prepared = prepare_modifiers(
                tpl,
                |field| (field == "alert_status").then(|| status.to_string()),
                |_| false,
                false,
            );
            assert_eq!(
                prepared.finish(prepared.template.clone()),
                format!(r#"{{"attachments":[{{"color":"{color}"}}]}}"#)
            );
        }
    }
}
