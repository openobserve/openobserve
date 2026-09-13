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

//! Agent-signal ownership handoff from v1 to v4: boundary decision and durable per-stream progress.

/// Durable agent-signal progress of one stream: what is done, and the one range in flight.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AgentProgress {
    pub done_upto: Option<i64>,
    pub pending: Option<(i64, i64)>,
    /// The pending range was ingested but its completion is not yet durable.
    pub delivered: bool,
}

impl AgentProgress {
    /// `<done>` or `<from>;<to>` (a range whose ingestion may or may not have happened).
    pub fn parse(value: &str) -> Self {
        let value = value.trim();
        match value.split_once(';') {
            Some((from, to)) => match (from.parse::<i64>(), to.parse::<i64>()) {
                (Ok(from), Ok(to)) if from < to => Self {
                    done_upto: Some(from),
                    pending: Some((from, to)),
                    delivered: false,
                },
                _ => Self::default(),
            },
            None => Self {
                done_upto: value.parse::<i64>().ok(),
                pending: None,
                delivered: false,
            },
        }
    }

    pub fn encode(&self) -> String {
        match self.pending {
            Some((from, to)) => format!("{from};{to}"),
            None => self.done_upto.unwrap_or(0).to_string(),
        }
    }

    /// The range to work on for `end`: the pending one until it is durable, never a wider one.
    pub fn begin(&mut self, handoff: Option<i64>, end: i64) -> Option<(i64, i64)> {
        if self.pending.is_none() {
            let range = agent_window(handoff, self.done_upto, end)?;
            self.pending = Some(range);
            self.delivered = false;
        }
        self.pending
    }

    pub fn needs_ingest(&self) -> bool {
        self.pending.is_some() && !self.delivered
    }

    pub fn mark_delivered(&mut self) {
        self.delivered = true;
    }

    pub fn mark_durable(&mut self) {
        if let Some((_, to)) = self.pending.take() {
            self.done_upto = Some(to);
        }
        self.delivered = false;
    }
}

/// A read failure is not "no progress": processing must wait rather than restart from the boundary.
pub fn load_progress<E>(read: Result<Option<String>, E>) -> Option<AgentProgress> {
    match read {
        Ok(Some(value)) => Some(AgentProgress::parse(&value)),
        Ok(None) => Some(AgentProgress::default()),
        Err(_) => None,
    }
}

/// v4 owes agent signals from the handoff boundary (v1's last window) or its own durable progress.
pub fn agent_window(handoff: Option<i64>, done_upto: Option<i64>, end: i64) -> Option<(i64, i64)> {
    let start = done_upto.unwrap_or(handoff?);
    (start < end).then_some((start, end))
}

/// The boundary is the ack's own value; the v1 offset counts only when no run can be in flight.
pub fn handoff_boundary(
    ack: Option<i64>,
    holder: &str,
    holder_alive: bool,
    v1_offset: impl FnOnce() -> i64,
    now: i64,
) -> Option<i64> {
    let boundary = match ack {
        Some(final_offset) => final_offset,
        None if holder.is_empty() || !holder_alive => v1_offset(),
        None => return None,
    };
    Some(if boundary > 0 { boundary } else { now })
}

#[cfg(test)]
mod tests {
    use super::{super::MICROS, *};

    const H: i64 = 12 * 3600 * MICROS;

    #[test]
    fn test_agent_window_handoff_boundary() {
        assert_eq!(agent_window(None, None, H + 300 * MICROS), None);
        assert_eq!(agent_window(Some(H), None, H - 240 * MICROS), None);
        assert_eq!(agent_window(Some(H), None, H), None);
        assert_eq!(
            agent_window(Some(H), None, H + 300 * MICROS),
            Some((H, H + 300 * MICROS))
        );
        assert_eq!(
            agent_window(Some(H), Some(H + 300 * MICROS), H + 360 * MICROS),
            Some((H + 300 * MICROS, H + 360 * MICROS))
        );
        assert_eq!(
            agent_window(Some(H), Some(H + 360 * MICROS), H + 360 * MICROS),
            None
        );
    }

    #[test]
    fn test_boundary_comes_from_ack_not_from_earlier_offset_read() {
        let stale = H - 3600 * MICROS;
        let now = H + 600 * MICROS;
        // the in-flight v1 run finished at 12:00 and acked after v4 had read 11:00
        assert_eq!(
            handoff_boundary(Some(H), "holder", true, || stale, now),
            Some(H)
        );
        assert_eq!(handoff_boundary(None, "holder", true, || H, now), None);
        assert_eq!(handoff_boundary(None, "holder", false, || H, now), Some(H));
        assert_eq!(handoff_boundary(None, "", false, || 0, now), Some(now));
        assert_eq!(
            handoff_boundary(Some(0), "holder", true, || H, now),
            Some(now)
        );
    }

    #[test]
    fn test_failed_progress_read_keeps_pending_range() {
        let m = |i: i64| H + i * 60 * MICROS;
        let mut p = AgentProgress::default();
        p.begin(Some(H), m(1));
        p.mark_delivered();
        let stored = p.encode();
        // completion write failed, then the next tick cannot read progress: nothing may run
        assert_eq!(load_progress::<String>(Err("db down".to_string())), None);
        // once the read works again the stored pending range is resumed, never [12:00, 12:02)
        let mut resumed = load_progress::<String>(Ok(Some(stored))).unwrap();
        assert_eq!(resumed.begin(Some(H), m(2)), Some((H, m(1))));
        assert!(resumed.needs_ingest());
        let mut fresh = load_progress::<String>(Ok(None)).unwrap();
        assert_eq!(fresh.begin(Some(H), m(2)), Some((H, m(2))));
    }

    #[test]
    fn test_progress_round_trip() {
        let p = AgentProgress::parse("123");
        assert_eq!(p.done_upto, Some(123));
        assert_eq!(p.pending, None);
        assert_eq!(p.encode(), "123");
        let p = AgentProgress::parse("100;160");
        assert_eq!(p.done_upto, Some(100));
        assert_eq!(p.pending, Some((100, 160)));
        assert!(!p.delivered);
        assert_eq!(p.encode(), "100;160");
        assert_eq!(AgentProgress::parse("garbage"), AgentProgress::default());
        assert_eq!(AgentProgress::parse("200;100"), AgentProgress::default());
        assert_eq!(AgentProgress::default().encode(), "0");
    }

    #[test]
    fn test_failed_progress_write_retries_same_range_without_widening() {
        let m = |i: i64| H + i * 60 * MICROS;
        let mut p = AgentProgress::default();
        assert_eq!(p.begin(Some(H), m(1)), Some((H, m(1))));
        assert!(p.needs_ingest());
        p.mark_delivered();
        assert!(!p.needs_ingest());
        assert_eq!(p.encode(), format!("{H};{}", m(1)));
        // durable write failed; the next window must retry [12:00, 12:01), not [12:00, 12:02)
        assert_eq!(p.begin(Some(H), m(2)), Some((H, m(1))));
        assert!(!p.needs_ingest());
        p.mark_durable();
        assert_eq!(p.done_upto, Some(m(1)));
        assert_eq!(p.encode(), m(1).to_string());
        assert_eq!(p.begin(Some(H), m(2)), Some((m(1), m(2))));
        assert!(p.needs_ingest());
        // restart between ingestion and durable completion: the stored range is re-ingested as is
        let restarted =
            AgentProgress::parse(&AgentProgress::parse(&format!("{};{}", m(1), m(2))).encode());
        let mut restarted = restarted;
        assert_eq!(restarted.begin(Some(H), m(3)), Some((m(1), m(2))));
        assert!(restarted.needs_ingest());
    }
}
