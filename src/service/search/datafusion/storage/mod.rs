// Copyright 2024 Zinc Labs Inc.
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

use std::ops::Range;

use object_store::GetRange;
use snafu::Snafu;
use thiserror::Error as ThisError;

pub mod file_list;
pub mod file_statistics_cache;
pub mod memory;
pub mod tmpfs;
pub mod wal;

/// A specialized `Error` for in-memory object store-related errors
#[derive(ThisError, Debug)]
#[allow(missing_docs)]
pub(crate) enum Error {
    #[error("Out of range")]
    OutOfRange(String),
    #[error("Bad range")]
    BadRange(String),
}

impl From<Error> for object_store::Error {
    fn from(source: Error) -> Self {
        Self::Generic {
            store: "storage",
            source: Box::new(source),
        }
    }
}

#[derive(Debug, Snafu)]
pub(crate) enum InvalidGetRange {
    #[snafu(display(
        "Wanted range starting at {requested}, but object was only {length} bytes long"
    ))]
    StartTooLarge { requested: usize, length: usize },

    #[snafu(display("Range started at {start} and ended at {end}"))]
    Inconsistent { start: usize, end: usize },
}

pub(crate) trait GetRangeExt {
    fn is_valid(&self) -> Result<(), InvalidGetRange>;
    /// Convert to a [`Range`] if valid.
    fn as_range(&self, len: usize) -> Result<Range<usize>, InvalidGetRange>;
}

impl GetRangeExt for GetRange {
    fn is_valid(&self) -> Result<(), InvalidGetRange> {
        match self {
            Self::Bounded(r) if r.end <= r.start => {
                return Err(InvalidGetRange::Inconsistent {
                    start: r.start,
                    end: r.end,
                });
            }
            _ => (),
        };
        Ok(())
    }

    /// Convert to a [`Range`] if valid.
    fn as_range(&self, len: usize) -> Result<Range<usize>, InvalidGetRange> {
        self.is_valid()?;
        match self {
            Self::Bounded(r) => {
                if r.start >= len {
                    Err(InvalidGetRange::StartTooLarge {
                        requested: r.start,
                        length: len,
                    })
                } else if r.end > len {
                    Ok(r.start..len)
                } else {
                    Ok(r.clone())
                }
            }
            Self::Offset(o) => {
                if *o >= len {
                    Err(InvalidGetRange::StartTooLarge {
                        requested: *o,
                        length: len,
                    })
                } else {
                    Ok(*o..len)
                }
            }
            Self::Suffix(n) => Ok(len.saturating_sub(*n)..len),
        }
    }
}
