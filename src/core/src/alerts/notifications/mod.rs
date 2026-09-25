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

//! Notification rendering.
//!
//! Split into a side-effecting context build ([`context::NotificationContext`])
//! and a pure render ([`custom::apply_custom_template`]) so the customer-facing
//! output can be locked by a golden corpus.

pub mod chart;
pub mod context;
pub mod custom;
pub mod default_template;
pub mod format;
pub mod org_default;
pub mod platform;
pub mod preview;
pub mod render;
pub mod resolve;
pub mod test_send;

pub use context::{NotificationContext, build_row_columns};
pub use custom::apply_custom_template;
pub use format::{ChannelFormat, derive_channel_format, teams_format_for_url};
pub use preview::{PreviewError, PreviewRequest, PreviewResponse, preview};
pub use render::{RenderError, RenderedMessage, render, severity_color};
pub use resolve::{RenderedContent, UNMATCHED_MARKER, resolve_content};
pub use test_send::{TEST_MARKER, TestSendError, build_test_message, check_rate_limit, test_send};

/// `{alert_status}` while the condition holds.
pub const STATUS_FIRING: &str = "firing";
/// `{alert_status}` once the episode has recovered.
pub const STATUS_RESOLVED: &str = "resolved";
