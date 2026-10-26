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

/// Decodes raw snappy, refusing before allocation when the untrusted header claims over `limit`.
pub fn decode_raw_snappy(compressed: &[u8], limit: usize) -> Result<Vec<u8>, snap::Error> {
    let declared_len = snap::raw::decompress_len(compressed)?;
    if declared_len > limit {
        return Err(snap::Error::TooBig {
            given: declared_len as u64,
            max: limit as u64,
        });
    }
    snap::raw::Decoder::new().decompress_vec(compressed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compress(raw: &[u8]) -> Vec<u8> {
        snap::raw::Encoder::new().compress_vec(raw).unwrap()
    }

    #[test]
    fn decode_raw_snappy_accepts_data_within_the_limit() {
        let raw = b"hello world";
        let compressed = compress(raw);
        assert_eq!(decode_raw_snappy(&compressed, raw.len()).unwrap(), raw);
    }

    #[test]
    fn decode_raw_snappy_rejects_a_declared_length_over_the_limit_without_allocating() {
        let raw = vec![b'a'; 10_000];
        let compressed = compress(&raw);
        assert!(matches!(
            decode_raw_snappy(&compressed, 100),
            Err(snap::Error::TooBig {
                given: 10_000,
                max: 100
            })
        ));
    }

    #[test]
    fn decode_raw_snappy_rejects_corrupt_input() {
        assert!(decode_raw_snappy(b"not snappy", 1024).is_err());
    }
}
