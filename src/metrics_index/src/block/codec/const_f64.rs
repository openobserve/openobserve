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

//! ConstF64: one f64 bit pattern repeated for every row, as 8 raw bytes.

use anyhow::Result;

use super::pack::get_u64;

pub(crate) fn encode(bits: u64, out: &mut Vec<u8>) {
    out.extend_from_slice(&bits.to_le_bytes());
}

pub(crate) fn decode(body: &[u8], pos: &mut usize, rows: usize, bits: &mut Vec<u64>) -> Result<()> {
    bits.resize(rows, get_u64(body, pos)?);
    Ok(())
}
