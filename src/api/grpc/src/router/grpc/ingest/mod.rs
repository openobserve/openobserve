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

pub mod logs;
pub mod metrics;
pub mod traces;

// The proxy re-encodes the body, so a forwarded content-length is stale and h2 rejects it
const SKIP_FORWARD_HEADERS: &[&str] = &[
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "host",
];

fn strip_http_framing_headers(metadata: &mut tonic::metadata::MetadataMap) {
    for key in SKIP_FORWARD_HEADERS {
        metadata.remove(*key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_http_framing_headers() {
        let mut metadata = tonic::metadata::MetadataMap::new();
        metadata.insert("content-length", "123".parse().unwrap());
        metadata.insert("transfer-encoding", "chunked".parse().unwrap());
        metadata.insert("connection", "keep-alive".parse().unwrap());
        metadata.insert("keep-alive", "timeout=5".parse().unwrap());
        metadata.insert("host", "example.com".parse().unwrap());
        metadata.insert("organization", "default".parse().unwrap());
        metadata.insert("authorization", "Basic abc".parse().unwrap());

        strip_http_framing_headers(&mut metadata);

        for key in SKIP_FORWARD_HEADERS {
            assert!(!metadata.contains_key(*key), "{key} should be stripped");
        }
        assert!(metadata.contains_key("organization"));
        assert!(metadata.contains_key("authorization"));
    }
}
