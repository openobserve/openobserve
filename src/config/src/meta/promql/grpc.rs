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
