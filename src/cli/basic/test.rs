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

use config::meta::stream::FileKey;

pub async fn file_list(
    mode: &str,
    stream: &str,
    hour: &str,
    group_size: &str,
) -> Result<(), anyhow::Error> {
    let parts = stream.splitn(3, '/').collect::<Vec<&str>>();
    let org = parts[0];
    let stream_type = parts[1];
    let stream_name = parts[2];

    println!("Testing group stream files:");
    println!("stream: {stream}");
    println!("date hour: {hour}");
    println!("strategy: {mode}");
    println!("group size: {group_size}gb");

    let file_list = crate::service::file_list::query_for_merge(
        org,
        stream_name,
        stream_type.into(),
        hour,
        hour,
    )
    .await?;
    println!("get files: {}", file_list.len());

    let group_size = group_size.parse::<i64>().unwrap_or(5) * 1024 * 1024 * 1024;
    let mode = mode.trim().to_lowercase();
    let groups = match mode.as_str() {
        "file_size" => group_by_file_size(file_list, group_size),
        "file_time" => group_by_file_time(file_list, group_size),
        "time_range" => group_by_time_range(file_list, group_size),
        _ => {
            return Err(anyhow::anyhow!("unsupported mode: {mode}"));
        }
    };
    println!("groups: {}", groups.len());
    Ok(())
}

fn group_by_file_size(mut file_list: Vec<FileKey>, group_size: i64) -> Vec<Vec<FileKey>> {
    file_list.sort_by_key(|f| f.meta.original_size);
    let mut groups = Vec::with_capacity(file_list.len());
    let mut current_group = Vec::with_capacity(file_list.len());
    let mut current_size = 0;
    for file in file_list {
        if !current_group.is_empty() && current_size + file.meta.original_size > group_size {
            groups.push(current_group);
            current_group = Vec::new();
            current_size = 0;
        }
        current_size += file.meta.original_size;
        current_group.push(file);
    }
    if !current_group.is_empty() {
        groups.push(current_group);
    }
    groups
}

fn group_by_file_time(mut file_list: Vec<FileKey>, group_size: i64) -> Vec<Vec<FileKey>> {
    file_list.sort_by_key(|f| f.meta.min_ts);
    let mut groups = Vec::with_capacity(file_list.len());
    let mut current_group = Vec::with_capacity(file_list.len());
    let mut current_size = 0;
    for file in file_list {
        if !current_group.is_empty() && current_size + file.meta.original_size > group_size {
            groups.push(current_group);
            current_group = Vec::new();
            current_size = 0;
        }
        current_size += file.meta.original_size;
        current_group.push(file);
    }
    if !current_group.is_empty() {
        groups.push(current_group);
    }
    groups
}

fn group_by_time_range(mut file_list: Vec<FileKey>, group_size: i64) -> Vec<Vec<FileKey>> {
    // first group file by non-overlapping
    file_list.sort_by_key(|f| f.meta.min_ts);
    let mut groups: Vec<Vec<FileKey>> = Vec::new();
    for file in file_list {
        let mut inserted = None;
        for (i, group) in groups.iter().enumerate() {
            if group
                .last()
                .is_some_and(|f| file.meta.min_ts >= f.meta.max_ts)
            {
                inserted = Some(i);
                break;
            }
        }
        if let Some(i) = inserted {
            groups[i].push(file);
        } else {
            groups.push(vec![file]);
        }
    }
    // then sort each group by file size
    let mut new_groups = Vec::with_capacity(groups.len());
    for group in groups {
        new_groups.extend(group_by_file_time(group, group_size));
    }
    new_groups
}
