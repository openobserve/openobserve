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

use proto::cluster_rpc;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IndexOptimizeMode {
    SimpleSelect(usize, bool),
    SimpleCount,
    SimpleHistogram(i64, u64, usize),
    SimpleTopN(String, usize, bool),
    SimpleDistinct(String, usize, bool),
}

impl std::fmt::Display for IndexOptimizeMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IndexOptimizeMode::SimpleSelect(limit, ascend) => {
                write!(f, "select(limit: {limit}, ascend: {ascend})")
            }
            IndexOptimizeMode::SimpleCount => write!(f, "count"),
            IndexOptimizeMode::SimpleHistogram(min_value, bucket_width, num_buckets) => {
                write!(
                    f,
                    "histogram(min_value: {min_value}, bucket_width: {bucket_width}, num_buckets: {num_buckets})"
                )
            }
            IndexOptimizeMode::SimpleTopN(field, limit, ascend) => {
                write!(f, "topn(field: {field}, limit: {limit}, ascend: {ascend})")
            }
            IndexOptimizeMode::SimpleDistinct(field, limit, ascend) => {
                write!(
                    f,
                    "distinct(field: {field}, limit: {limit}, ascend: {ascend})"
                )
            }
        }
    }
}

impl From<cluster_rpc::IdxOptimizeMode> for IndexOptimizeMode {
    fn from(cluster_rpc_mode: cluster_rpc::IdxOptimizeMode) -> Self {
        match cluster_rpc_mode.mode {
            Some(cluster_rpc::idx_optimize_mode::Mode::SimpleSelect(select)) => {
                IndexOptimizeMode::SimpleSelect(select.index as usize, select.asc)
            }
            Some(cluster_rpc::idx_optimize_mode::Mode::SimpleCount(_)) => {
                IndexOptimizeMode::SimpleCount
            }
            Some(cluster_rpc::idx_optimize_mode::Mode::SimpleHistogram(select)) => {
                IndexOptimizeMode::SimpleHistogram(
                    select.min_value,
                    select.bucket_width,
                    select.num_buckets as usize,
                )
            }
            Some(cluster_rpc::idx_optimize_mode::Mode::SimpleTopn(select)) => {
                IndexOptimizeMode::SimpleTopN(select.field, select.limit as usize, select.asc)
            }
            Some(cluster_rpc::idx_optimize_mode::Mode::SimpleDistinct(select)) => {
                IndexOptimizeMode::SimpleDistinct(select.field, select.limit as usize, select.asc)
            }
            None => panic!("Invalid IndexOptimizeMode"),
        }
    }
}

impl From<IndexOptimizeMode> for cluster_rpc::IdxOptimizeMode {
    fn from(mode: IndexOptimizeMode) -> Self {
        match mode {
            IndexOptimizeMode::SimpleSelect(index, asc) => cluster_rpc::IdxOptimizeMode {
                mode: Some(cluster_rpc::idx_optimize_mode::Mode::SimpleSelect(
                    cluster_rpc::SimpleSelect {
                        index: index as u32,
                        asc,
                    },
                )),
            },
            IndexOptimizeMode::SimpleCount => cluster_rpc::IdxOptimizeMode {
                mode: Some(cluster_rpc::idx_optimize_mode::Mode::SimpleCount(
                    cluster_rpc::SimpleCount {},
                )),
            },
            IndexOptimizeMode::SimpleHistogram(min_value, bucket_width, num_buckets) => {
                cluster_rpc::IdxOptimizeMode {
                    mode: Some(cluster_rpc::idx_optimize_mode::Mode::SimpleHistogram(
                        cluster_rpc::SimpleHistogram {
                            min_value,
                            bucket_width,
                            num_buckets: num_buckets as u32,
                        },
                    )),
                }
            }
            IndexOptimizeMode::SimpleTopN(field, limit, asc) => cluster_rpc::IdxOptimizeMode {
                mode: Some(cluster_rpc::idx_optimize_mode::Mode::SimpleTopn(
                    cluster_rpc::SimpleTopN {
                        field,
                        limit: limit as u32,
                        asc,
                    },
                )),
            },
            IndexOptimizeMode::SimpleDistinct(field, limit, asc) => cluster_rpc::IdxOptimizeMode {
                mode: Some(cluster_rpc::idx_optimize_mode::Mode::SimpleDistinct(
                    cluster_rpc::SimpleDistinct {
                        field,
                        limit: limit as u32,
                        asc,
                    },
                )),
            },
        }
    }
}
