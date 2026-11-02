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

use std::{
    sync::mpsc,
    thread::sleep,
    time::{Duration, Instant},
};

use tempfile::tempdir;
use wal::{ReadFrom, Reader, Writer, build_file_path};

#[test]
fn test_wal_new() {
    let entry_num = 100;
    let dir = tempdir().unwrap();
    let dir = dir.path();
    let path = build_file_path(dir, "org", "stream", "1".to_string());
    let (mut writer, _) = Writer::new(path.clone(), 1024_1024, 8 * 1024, None).unwrap();
    for i in 0..entry_num {
        let data = format!("hello world {i}");
        writer.write(data.as_bytes()).unwrap();
    }
    writer.close().unwrap();

    let mut reader = Reader::from_path(path).unwrap();
    for i in 0..entry_num {
        let data = format!("hello world {i}");
        let entry = reader.read_entry().unwrap().unwrap();
        assert_eq!(entry, data.as_bytes());
    }
    assert!(reader.read_entry().unwrap().is_none());
}
#[test]
fn test_wal_build() {
    let entry_num = 100;
    let dir = tempdir().unwrap();
    let dir = dir.path();
    let mut header = wal::FileHeader::new();
    header.insert("key1".into(), "value1".into());
    header.insert("key2".into(), "value2".into());
    let path = build_file_path(dir, "org", "stream", "1".to_string());
    let (mut writer, _) = Writer::new(path.clone(), 1024_1024, 8 * 1024, Some(header)).unwrap();
    for i in 0..entry_num {
        let data = format!("hello world {i}");
        writer.write(data.as_bytes()).unwrap();
    }
    writer.close().unwrap();

    let mut reader = Reader::from_path(path).unwrap();
    let header = reader.header();
    assert_eq!(header.get("key1"), Some(&"value1".to_string()));
    assert_eq!(header.get("key2"), Some(&"value2".to_string()));

    for i in 0..entry_num {
        let data = format!("hello world {i}");
        let entry = reader.read_entry().unwrap().unwrap();
        assert_eq!(entry, data.as_bytes());
    }
    assert!(reader.read_entry().unwrap().is_none());
}

#[test]
fn test_position() {
    let entry_num = 100;
    let dir = tempdir().unwrap();
    let dir = dir.path();
    let path = build_file_path(dir, "org", "stream", "1".to_string());
    let (mut writer, _) = Writer::new(path.clone(), 1024_1024, 8 * 1024, None).unwrap();
    for i in 0..entry_num {
        let data = format!("hello world {i}");
        writer.write(data.as_bytes()).unwrap();
    }
    writer.close().unwrap();

    let mut reader = Reader::from_path(path).unwrap();
    let mut pos = wal::FILE_TYPE_IDENTIFIER_LEN as u64 + wal::WAL_FILE_HEADER_LEN as u64;
    for _ in 0..entry_num {
        let (_, len) = reader.read_entry_with_length().unwrap();
        pos += wal::ENTRY_HEADER_LEN + len;
        assert_eq!(pos, reader.current_position().unwrap());
    }
    assert!(reader.read_entry().unwrap().is_none());
}

#[test]
fn test_metadata() {
    let entry_num = 5;
    let dir = tempdir().unwrap();
    let dir = dir.path();
    let path = build_file_path(dir, "org", "stream", "1".to_string());
    let (mut writer, _) = Writer::new(path, 1024_1024, 8 * 1024, None).unwrap();
    for i in 0..entry_num {
        let data = format!("hello world {i}");
        writer.write(data.as_bytes()).unwrap();
        sleep(Duration::from_millis(100));
        writer.sync().unwrap();
        let metadata = writer.metadata().unwrap();
        let ts = metadata
            .modified()
            .ok()
            .and_then(|mtime| mtime.elapsed().ok())
            .and_then(|diff| Instant::now().checked_sub(diff))
            .unwrap_or_else(Instant::now);
        println!("metadata modified: {:?}", ts.elapsed().as_millis());
    }
    writer.close().unwrap();
}

#[test]
fn test_realtime_write_and_read() {
    let entry_num = 50;
    let pause_at = entry_num / 2;
    let dir = tempdir().unwrap();
    let dir = dir.path();
    let mut header = wal::FileHeader::new();
    header.insert("key1".into(), "value1".into());
    header.insert("key2".into(), "value2".into());
    let path = build_file_path(dir, "org", "stream", "1".to_string());
    let (mut writer, header_len) = Writer::new(path, 0, 8 * 1024, Some(header)).unwrap();

    let (synced_tx, synced_rx) = mpsc::channel();
    let (drained_tx, drained_rx) = mpsc::channel();
    let write_thread = std::thread::spawn(move || {
        for i in 0..entry_num {
            if i == pause_at {
                drained_rx.recv().unwrap();
            }
            let data = format!("hello world {i}");
            writer.write(data.as_bytes()).unwrap();
            writer.sync().unwrap();
            // Not current_position(): its seek flushes the buffer and would mask a broken sync().
            let position = writer.size().0 + wal::WAL_FILE_HEADER_LEN + header_len;
            synced_tx.send(position as u64).unwrap();
        }
        writer.close().unwrap();
    });

    let path = build_file_path(dir, "org", "stream", "1".to_string());
    let mut reader = Reader::from_path(path).unwrap();
    let header = reader.header();
    assert_eq!(header.get("key1"), Some(&"value1".to_string()));
    assert_eq!(header.get("key2"), Some(&"value2".to_string()));

    for i in 0..entry_num {
        // A read racing an unfinished flush can see a torn entry, so only read what is synced.
        let synced_position = synced_rx.recv().unwrap();
        let entry = reader.read_entry().unwrap().unwrap();
        assert_eq!(entry, format!("hello world {i}").as_bytes());
        assert_eq!(reader.current_position().unwrap(), synced_position);
        if i + 1 == pause_at {
            assert!(reader.read_entry().unwrap().is_none());
            drained_tx.send(()).unwrap();
        }
    }

    write_thread.join().unwrap();
    assert!(reader.read_entry().unwrap().is_none());
}

#[test]
fn test_reader_from_path_position_and_metadata() {
    let entry_num = 5;
    let dir = tempdir().unwrap();
    let dir = dir.path();
    let path = build_file_path(dir, "org", "stream", "1".to_string());
    let (mut writer, _) = Writer::new(path.clone(), 1024_1024, 8 * 1024, None).unwrap();

    for i in 0..entry_num {
        let data = format!("hello {i}");
        writer.write(data.as_bytes()).unwrap();
    }
    writer.close().unwrap();

    let fs_metadata = std::fs::metadata(&path).unwrap();

    let mut reader = Reader::from_path_position(path.clone(), ReadFrom::Beginning).unwrap();
    let entry = reader.read_entry().unwrap().unwrap();
    assert_eq!(entry, b"hello 0");

    let mut reader = Reader::from_path_position(path.clone(), ReadFrom::End).unwrap();

    for _ in 0..entry_num {
        let entry = reader.read_entry().unwrap();
        assert!(entry.is_none());
    }

    let start_pos = wal::FILE_TYPE_IDENTIFIER_LEN as u64 + wal::WAL_FILE_HEADER_LEN as u64;
    let mut reader = Reader::from_path_position(path, ReadFrom::Checkpoint(start_pos)).unwrap();

    for i in 0..entry_num {
        let entry = reader.read_entry().unwrap().unwrap();
        assert_eq!(entry, format!("hello {i}").as_bytes());
    }
    assert!(reader.read_entry().unwrap().is_none());

    let reader_metadata = reader.metadata().unwrap();
    assert_eq!(reader_metadata.len(), fs_metadata.len());
}

#[test]
fn test_build_file_path() {
    // Test with string path
    let root_dir = "/tmp/wal";
    let org_id = "test_org";
    let stream_type = "logs";
    let id = "stream_123";

    let path = build_file_path(root_dir, org_id, stream_type, id.to_string());

    // Verify the path structure
    assert_eq!(
        path.to_string_lossy(),
        "/tmp/wal/test_org/logs/stream_123.wal"
    );
}
