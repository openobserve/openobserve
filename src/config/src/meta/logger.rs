// Copyright 2025 OpenObserve Inc.
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

// refer: https://docs.rs/tracing-subscriber/latest/tracing_subscriber/fmt/trait.FormatEvent.html#examples

use chrono::{Local, Utc};
use tracing::{Event, Subscriber};
use tracing_log::NormalizeEvent;
use tracing_subscriber::{
    fmt::{
        FmtContext, FormatEvent, FormatFields,
        format::{self, Writer},
        time::FormatTime,
    },
    registry::LookupSpan,
};

pub struct CustomTimeFormat;

impl FormatTime for CustomTimeFormat {
    fn format_time(&self, w: &mut Writer<'_>) -> std::fmt::Result {
        let cfg = crate::get_config();
        if cfg.log.local_time_format.is_empty() {
            write!(w, "{}", Utc::now().to_rfc3339())
        } else {
            write!(w, "{}", Local::now().format(&cfg.log.local_time_format))
        }
    }
}

pub struct O2Formatter {
    timer: CustomTimeFormat,
}

impl O2Formatter {
    pub fn new() -> Self {
        Self {
            timer: CustomTimeFormat,
        }
    }
}

impl Default for O2Formatter {
    fn default() -> Self {
        Self::new()
    }
}

impl<S, N> FormatEvent<S, N> for O2Formatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: format::Writer<'_>,
        event: &Event<'_>,
    ) -> std::fmt::Result {
        // Format values from the event's's metadata:
        let normalized_meta = event.normalized_metadata();
        let meta = normalized_meta.as_ref().unwrap_or_else(|| event.metadata());
        self.timer.format_time(&mut writer)?;
        write!(&mut writer, " {} {}: ", meta.level(), meta.target())?;

        // Write fields on the event
        ctx.field_format().format_fields(writer.by_ref(), event)?;

        writeln!(writer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_custom_time_format_utc() {
        let timer = CustomTimeFormat;
        let mut buffer = String::new();
        let mut writer = tracing_subscriber::fmt::format::Writer::new(&mut buffer);

        // Test that format_time doesn't panic and produces output
        let result = timer.format_time(&mut writer);
        assert!(result.is_ok());

        assert!(!buffer.is_empty());
        // Should contain RFC3339 format (contains 'T')
        assert!(buffer.contains('T'));
    }

    #[test]
    fn test_o2_formatter_new() {
        let formatter = O2Formatter::new();
        // Should not panic and create a valid formatter
        // O2Formatter is a zero-sized type, so size is 0
        assert_eq!(std::mem::size_of_val(&formatter), 0);
    }

    #[test]
    fn test_o2_formatter_default() {
        let formatter = O2Formatter::default();
        let formatter_new = O2Formatter::new();

        // Default should be equivalent to new()
        assert_eq!(
            std::mem::size_of_val(&formatter),
            std::mem::size_of_val(&formatter_new)
        );
    }

    #[test]
    fn test_custom_time_format_writer() {
        let timer = CustomTimeFormat;
        let mut buffer = String::new();
        let mut writer = tracing_subscriber::fmt::format::Writer::new(&mut buffer);

        let result = timer.format_time(&mut writer);
        assert!(result.is_ok());

        // Buffer should contain some output
        assert!(!buffer.is_empty());
    }
}
