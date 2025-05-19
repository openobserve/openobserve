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

use std::io;

use bytes::{Bytes, BytesMut};

mod encoder;

pub use self::encoder::Encoder;

/// Special-purpose writer for streaming (de-)compression.
///
/// Pre-allocates 8KiB of capacity.
struct Writer {
    buf: BytesMut,
}

impl Writer {
    fn new() -> Writer {
        Writer {
            buf: BytesMut::with_capacity(8192),
        }
    }

    fn take(&mut self) -> Bytes {
        self.buf.split().freeze()
    }
}

impl io::Write for Writer {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
