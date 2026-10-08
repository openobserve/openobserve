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

//! Runs a test in a child process, because the SSRF allowlist is read once per process.

use std::{future::Future, process::Command};

/// Runs the test at `path` (a `module_path!` path) in a child process that runs `task`.
pub(crate) fn isolated<F: Future<Output = ()>>(
    path: &str,
    envs: &[(&str, &str)],
    task: impl FnOnce() -> F,
) {
    let test = path.split_once("::").map_or(path, |(_, test)| test);
    if std::env::var("O2_SSRF_ISOLATED_TEST").as_deref() == Ok(test) {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(task());
        return;
    }
    let mut command = Command::new(std::env::current_exe().unwrap());
    for (name, _) in std::env::vars().filter(|(name, _)| name.contains("SSRF")) {
        command.env_remove(name);
    }
    let output = command
        .args(["--exact", test, "--nocapture"])
        .env("O2_SSRF_ISOLATED_TEST", test)
        .envs(envs.iter().copied())
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success() && stdout.contains("1 passed"),
        "{test} failed in its child process:\n{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Base URL of a local server that answers `secret` with 200 on `/ok` and with 500 elsewhere.
pub(crate) async fn secret_server() -> String {
    use tokio::io::AsyncWriteExt;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let request = read_request(&mut sock).await;
            let status = if request.contains(" /ok ") {
                "200 OK"
            } else {
                "500 Internal Server Error"
            };
            let reply = format!(
                "HTTP/1.1 {status}\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsecret"
            );
            let _ = sock.write_all(reply.as_bytes()).await;
        }
    });
    format!("http://127.0.0.1:{port}")
}

/// The request line and headers; the body is drained so the client never sees a reset.
async fn read_request(sock: &mut tokio::net::TcpStream) -> String {
    use tokio::io::AsyncReadExt;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        if let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break end + 4;
        }
        match sock.read(&mut chunk).await {
            Ok(0) | Err(_) => return String::from_utf8_lossy(&buf).into_owned(),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let length = head
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())?
        })
        .unwrap_or(0);
    let mut remaining = (head_end + length).saturating_sub(buf.len());
    while remaining > 0 {
        match sock.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => remaining = remaining.saturating_sub(n),
        }
    }
    head
}
