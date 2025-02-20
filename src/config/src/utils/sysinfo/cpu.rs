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

use sysinfo::{CpuExt, SystemExt};

pub fn get_cpu_usage() -> f32 {
    let mut system = sysinfo::System::new();
    system.refresh_cpu();
    let cpus = system.cpus();
    if cpus.is_empty() {
        return 0.0;
    }
    let total_usage = cpus.iter().map(|cpu| cpu.cpu_usage()).sum::<f32>();
    total_usage / cpus.len() as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sysinfo_get_cpu_usage() {
        assert!(get_cpu_usage() > 0.0);
    }
}
