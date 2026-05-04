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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OtlpRequestType {
    Grpc,
    HttpJson,
    HttpProtobuf,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_otlp_request_type_equality() {
        assert_eq!(OtlpRequestType::Grpc, OtlpRequestType::Grpc);
        assert_eq!(OtlpRequestType::HttpJson, OtlpRequestType::HttpJson);
        assert_eq!(OtlpRequestType::HttpProtobuf, OtlpRequestType::HttpProtobuf);
        assert_ne!(OtlpRequestType::Grpc, OtlpRequestType::HttpJson);
        assert_ne!(OtlpRequestType::HttpJson, OtlpRequestType::HttpProtobuf);
    }

    #[test]
    fn test_otlp_request_type_debug() {
        assert!(format!("{:?}", OtlpRequestType::Grpc).contains("Grpc"));
        assert!(format!("{:?}", OtlpRequestType::HttpJson).contains("HttpJson"));
        assert!(format!("{:?}", OtlpRequestType::HttpProtobuf).contains("HttpProtobuf"));
    }

    #[test]
    fn test_otlp_request_type_copy_clone() {
        let a = OtlpRequestType::HttpJson;
        let b = a;
        let c = a.clone();
        assert_eq!(a, b);
        assert_eq!(a, c);
    }
}
