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

use std::sync::Arc;

use proto::cluster_rpc;

use super::value::*;

impl From<&cluster_rpc::Label> for Label {
    fn from(req: &cluster_rpc::Label) -> Self {
        Label {
            name: req.name.to_owned(),
            value: req.value.to_owned(),
        }
    }
}

impl From<&Label> for cluster_rpc::Label {
    fn from(req: &Label) -> Self {
        cluster_rpc::Label {
            name: req.name.to_owned(),
            value: req.value.to_owned(),
        }
    }
}

impl From<&cluster_rpc::Sample> for Sample {
    fn from(req: &cluster_rpc::Sample) -> Self {
        Sample::new(req.time, req.value)
    }
}

impl From<&Sample> for cluster_rpc::Sample {
    fn from(req: &Sample) -> Self {
        cluster_rpc::Sample {
            time: req.timestamp,
            value: req.value,
        }
    }
}

impl From<&Exemplar> for cluster_rpc::Exemplar {
    fn from(req: &Exemplar) -> Self {
        cluster_rpc::Exemplar {
            time: req.timestamp,
            value: req.value,
            labels: req.labels.iter().map(|x| x.as_ref().into()).collect(),
        }
    }
}

impl From<&cluster_rpc::Exemplar> for Exemplar {
    fn from(req: &cluster_rpc::Exemplar) -> Self {
        Exemplar {
            timestamp: req.time,
            value: req.value,
            labels: req.labels.iter().map(|x| Arc::new(x.into())).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use proto::cluster_rpc;

    use super::*;

    #[test]
    fn test_label_from_rpc() {
        let rpc = cluster_rpc::Label {
            name: "job".to_string(),
            value: "api".to_string(),
        };
        let label = Label::from(&rpc);
        assert_eq!(label.name, "job");
        assert_eq!(label.value, "api");
    }

    #[test]
    fn test_label_to_rpc() {
        let label = Label {
            name: "env".to_string(),
            value: "prod".to_string(),
        };
        let rpc = cluster_rpc::Label::from(&label);
        assert_eq!(rpc.name, "env");
        assert_eq!(rpc.value, "prod");
    }

    #[test]
    fn test_label_roundtrip() {
        let original = cluster_rpc::Label {
            name: "region".to_string(),
            value: "us-west".to_string(),
        };
        let local = Label::from(&original);
        let back = cluster_rpc::Label::from(&local);
        assert_eq!(back.name, original.name);
        assert_eq!(back.value, original.value);
    }

    #[test]
    fn test_sample_from_rpc() {
        let rpc = cluster_rpc::Sample {
            time: 1_700_000_000,
            value: 3.14,
        };
        let sample = Sample::from(&rpc);
        assert_eq!(sample.timestamp, 1_700_000_000);
        assert_eq!(sample.value, 3.14);
    }

    #[test]
    fn test_sample_to_rpc() {
        let sample = Sample::new(12345, 99.9);
        let rpc = cluster_rpc::Sample::from(&sample);
        assert_eq!(rpc.time, 12345);
        assert_eq!(rpc.value, 99.9);
    }

    #[test]
    fn test_sample_roundtrip() {
        let original = cluster_rpc::Sample {
            time: 9_999_999,
            value: -1.5,
        };
        let local = Sample::from(&original);
        let back = cluster_rpc::Sample::from(&local);
        assert_eq!(back.time, original.time);
        assert_eq!(back.value, original.value);
    }

    #[test]
    fn test_exemplar_from_rpc_no_labels() {
        let rpc = cluster_rpc::Exemplar {
            time: 42,
            value: 1.0,
            labels: vec![],
        };
        let ex = Exemplar::from(&rpc);
        assert_eq!(ex.timestamp, 42);
        assert_eq!(ex.value, 1.0);
        assert!(ex.labels.is_empty());
    }

    #[test]
    fn test_exemplar_from_rpc_with_labels() {
        let rpc = cluster_rpc::Exemplar {
            time: 100,
            value: 2.5,
            labels: vec![
                cluster_rpc::Label {
                    name: "trace_id".to_string(),
                    value: "abc123".to_string(),
                },
                cluster_rpc::Label {
                    name: "span_id".to_string(),
                    value: "def456".to_string(),
                },
            ],
        };
        let ex = Exemplar::from(&rpc);
        assert_eq!(ex.labels.len(), 2);
        assert_eq!(ex.labels[0].name, "trace_id");
    }

    #[test]
    fn test_exemplar_to_rpc_with_labels() {
        let ex = Exemplar {
            timestamp: 200,
            value: 5.0,
            labels: vec![Arc::new(Label {
                name: "job".to_string(),
                value: "worker".to_string(),
            })],
        };
        let rpc = cluster_rpc::Exemplar::from(&ex);
        assert_eq!(rpc.time, 200);
        assert_eq!(rpc.value, 5.0);
        assert_eq!(rpc.labels.len(), 1);
        assert_eq!(rpc.labels[0].name, "job");
    }
}
