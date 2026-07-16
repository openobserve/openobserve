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

pub mod cache;
pub mod partition;
pub mod pruner;
pub mod result;
pub mod search;
pub mod warm;

use arrow::{
    buffer::{BooleanBuffer, MutableBuffer},
    util::bit_util,
};
pub use result::{TantivyMultiResult, TantivyMultiResultBuilder};
pub use search::TantivyResult;

/// Build a per-row match bitmap of length `num_rows` from matched row ids.
pub fn selection_from_row_ids(
    num_rows: usize,
    row_ids: impl Iterator<Item = u32>,
) -> BooleanBuffer {
    let mut buffer = MutableBuffer::from_len_zeroed(bit_util::ceil(num_rows, 8));
    let slice = buffer.as_slice_mut();
    for id in row_ids {
        bit_util::set_bit(slice, id as usize);
    }
    BooleanBuffer::new(buffer.into(), 0, num_rows)
}
