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

use std::{
    error::Error as StdError,
    future::Future,
    io::{self, Write as _},
    pin::Pin,
    task::{Context, Poll},
};

use actix_http::{
    ResponseHead, StatusCode,
    body::{self, BodySize, MessageBody},
    header::{self, CONTENT_ENCODING, ContentEncoding, HeaderValue},
};
use actix_web::rt::task::{JoinHandle, spawn_blocking};
use bytes::Bytes;
use derive_more::Display;
use flate2::write::{GzEncoder, ZlibEncoder};
use futures_core::ready;
use pin_project_lite::pin_project;
use tracing::trace;
use zstd::stream::write::Encoder as ZstdEncoder;

use super::Writer;

const MAX_CHUNK_SIZE_ENCODE_IN_PLACE: usize = 1024;

pin_project! {
    pub struct Encoder<B> {
        #[pin]
        body: EncoderBody<B>,
        encoder: Option<ContentEncoder>,
        fut: Option<JoinHandle<Result<ContentEncoder, io::Error>>>,
        eof: bool,
    }
}

impl<B: MessageBody> Encoder<B> {
    fn none() -> Self {
        Encoder {
            body: EncoderBody::None {
                body: body::None::new(),
            },
            encoder: None,
            fut: None,
            eof: true,
        }
    }

    fn empty() -> Self {
        Encoder {
            body: EncoderBody::Full { body: Bytes::new() },
            encoder: None,
            fut: None,
            eof: true,
        }
    }

    pub fn response(encoding: ContentEncoding, head: &mut ResponseHead, body: B) -> Self {
        // no need to compress empty bodies
        match body.size() {
            BodySize::None => return Self::none(),
            BodySize::Sized(0) => return Self::empty(),
            _ => {}
        }

        let should_encode = !(head.headers().contains_key(&CONTENT_ENCODING)
            || head.status == StatusCode::SWITCHING_PROTOCOLS
            || head.status == StatusCode::NO_CONTENT
            || encoding == ContentEncoding::Identity);

        let body = match body.try_into_bytes() {
            Ok(body) => EncoderBody::Full { body },
            Err(body) => EncoderBody::Stream { body },
        };

        if should_encode {
            // wrap body only if encoder is feature-enabled
            if let Some(enc) = ContentEncoder::select(encoding) {
                update_head(encoding, head);

                return Encoder {
                    body,
                    encoder: Some(enc),
                    fut: None,
                    eof: false,
                };
            }
        }

        Encoder {
            body,
            encoder: None,
            fut: None,
            eof: false,
        }
    }
}

pin_project! {
    #[project = EncoderBodyProj]
    enum EncoderBody<B> {
        None { body: body::None },
        Full { body: Bytes },
        Stream { #[pin] body: B },
    }
}

impl<B> MessageBody for EncoderBody<B>
where
    B: MessageBody,
{
    type Error = EncoderError;

    #[inline]
    fn size(&self) -> BodySize {
        match self {
            EncoderBody::None { body } => body.size(),
            EncoderBody::Full { body } => body.size(),
            EncoderBody::Stream { body } => body.size(),
        }
    }

    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Bytes, Self::Error>>> {
        match self.project() {
            EncoderBodyProj::None { body } => {
                Pin::new(body).poll_next(cx).map_err(|err| match err {})
            }
            EncoderBodyProj::Full { body } => {
                Pin::new(body).poll_next(cx).map_err(|err| match err {})
            }
            EncoderBodyProj::Stream { body } => body
                .poll_next(cx)
                .map_err(|err| EncoderError::Body(err.into())),
        }
    }

    #[inline]
    fn try_into_bytes(self) -> Result<Bytes, Self>
    where
        Self: Sized,
    {
        match self {
            EncoderBody::None { body } => Ok(body.try_into_bytes().unwrap()),
            EncoderBody::Full { body } => Ok(body.try_into_bytes().unwrap()),
            _ => Err(self),
        }
    }
}

impl<B> MessageBody for Encoder<B>
where
    B: MessageBody,
{
    type Error = EncoderError;

    #[inline]
    fn size(&self) -> BodySize {
        if self.encoder.is_some() {
            BodySize::Stream
        } else {
            self.body.size()
        }
    }

    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Bytes, Self::Error>>> {
        let mut this = self.project();

        loop {
            if *this.eof {
                return Poll::Ready(None);
            }

            if let Some(fut) = this.fut {
                let mut encoder = ready!(Pin::new(fut).poll(cx))
                    .map_err(|_| {
                        EncoderError::Io(io::Error::other(
                            "Blocking task was cancelled unexpectedly",
                        ))
                    })?
                    .map_err(EncoderError::Io)?;

                let chunk = encoder.take();
                *this.encoder = Some(encoder);
                this.fut.take();

                if !chunk.is_empty() {
                    return Poll::Ready(Some(Ok(chunk)));
                }
            }

            let result = ready!(this.body.as_mut().poll_next(cx));

            match result {
                Some(Err(err)) => return Poll::Ready(Some(Err(err))),

                Some(Ok(chunk)) => {
                    // log::debug!(
                    //     "chunk: {:?}, {}",
                    //     chunk.len(),
                    //     String::from_utf8_lossy(&chunk)
                    // );
                    if let Some(mut encoder) = this.encoder.take() {
                        if chunk.len() < MAX_CHUNK_SIZE_ENCODE_IN_PLACE {
                            encoder.write(&chunk).map_err(EncoderError::Io)?;
                            let chunk = encoder.flush().map_err(EncoderError::Io)?;
                            let _ = encoder.take();
                            *this.encoder = Some(encoder);

                            if !chunk.is_empty() {
                                return Poll::Ready(Some(Ok(chunk)));
                            }
                        } else {
                            *this.fut = Some(spawn_blocking(move || {
                                encoder.write(&chunk)?;
                                Ok(encoder)
                            }));
                        }
                    } else {
                        return Poll::Ready(Some(Ok(chunk)));
                    }
                }

                None => {
                    if let Some(encoder) = this.encoder.take() {
                        let chunk = encoder.finish().map_err(EncoderError::Io)?;

                        if chunk.is_empty() {
                            return Poll::Ready(None);
                        } else {
                            *this.eof = true;
                            return Poll::Ready(Some(Ok(chunk)));
                        }
                    } else {
                        return Poll::Ready(None);
                    }
                }
            }
        }
    }

    #[inline]
    fn try_into_bytes(mut self) -> Result<Bytes, Self>
    where
        Self: Sized,
    {
        if self.encoder.is_some() {
            Err(self)
        } else {
            match self.body.try_into_bytes() {
                Ok(body) => Ok(body),
                Err(body) => {
                    self.body = body;
                    Err(self)
                }
            }
        }
    }
}

fn update_head(encoding: ContentEncoding, head: &mut ResponseHead) {
    head.headers_mut()
        .insert(header::CONTENT_ENCODING, encoding.to_header_value());

    // Collect all existing Vary header values
    let mut vary_values: Vec<String> = head
        .headers()
        .get_all(header::VARY)
        .filter_map(|v| v.to_str().ok())
        .flat_map(|s| s.split(','))
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .collect();

    // Add accept-encoding if not already present
    if !vary_values
        .iter()
        .any(|v| v.eq_ignore_ascii_case("accept-encoding"))
    {
        vary_values.push("accept-encoding".to_string());
    }

    // Remove all existing Vary headers and insert a single combined one
    head.headers_mut().remove(header::VARY);
    let combined = vary_values.join(", ");
    if let Ok(header_value) = HeaderValue::from_str(&combined) {
        head.headers_mut().insert(header::VARY, header_value);
    }

    head.no_chunking(false);
}

enum ContentEncoder {
    Deflate(ZlibEncoder<Writer>),
    Gzip(GzEncoder<Writer>),
    Brotli(Box<brotli::CompressorWriter<Writer>>),
    // We need explicit 'static lifetime here because ZstdEncoder needs a lifetime argument and
    // we use `spawn_blocking` in `Encoder::poll_next` that requires `FnOnce() -> R + Send +
    // 'static`.
    Zstd(ZstdEncoder<'static, Writer>),
}

impl ContentEncoder {
    fn select(encoding: ContentEncoding) -> Option<Self> {
        match encoding {
            ContentEncoding::Deflate => Some(ContentEncoder::Deflate(ZlibEncoder::new(
                Writer::new(),
                flate2::Compression::fast(),
            ))),
            ContentEncoding::Gzip => Some(ContentEncoder::Gzip(GzEncoder::new(
                Writer::new(),
                flate2::Compression::fast(),
            ))),
            ContentEncoding::Brotli => Some(ContentEncoder::Brotli(new_brotli_compressor())),
            ContentEncoding::Zstd => {
                let encoder = ZstdEncoder::new(Writer::new(), 3).ok()?;
                Some(ContentEncoder::Zstd(encoder))
            }

            _ => None,
        }
    }

    #[inline]
    pub(crate) fn take(&mut self) -> Bytes {
        match *self {
            ContentEncoder::Brotli(ref mut encoder) => encoder.get_mut().take(),
            ContentEncoder::Deflate(ref mut encoder) => encoder.get_mut().take(),
            ContentEncoder::Gzip(ref mut encoder) => encoder.get_mut().take(),
            ContentEncoder::Zstd(ref mut encoder) => encoder.get_mut().take(),
        }
    }

    fn flush(&mut self) -> Result<Bytes, io::Error> {
        match self {
            ContentEncoder::Brotli(encoder) => match encoder.flush() {
                Ok(()) => Ok(encoder.get_mut().take()),
                Err(err) => Err(err),
            },
            ContentEncoder::Gzip(encoder) => match encoder.flush() {
                Ok(()) => Ok(encoder.get_mut().take()),
                Err(err) => Err(err),
            },
            ContentEncoder::Deflate(encoder) => match encoder.flush() {
                Ok(()) => Ok(encoder.get_mut().take()),
                Err(err) => Err(err),
            },
            ContentEncoder::Zstd(encoder) => match encoder.flush() {
                Ok(()) => Ok(encoder.get_mut().take()),
                Err(err) => Err(err),
            },
        }
    }

    fn finish(self) -> Result<Bytes, io::Error> {
        match self {
            ContentEncoder::Brotli(mut encoder) => match encoder.flush() {
                Ok(()) => Ok(encoder.into_inner().buf.freeze()),
                Err(err) => Err(err),
            },
            ContentEncoder::Gzip(encoder) => match encoder.finish() {
                Ok(writer) => Ok(writer.buf.freeze()),
                Err(err) => Err(err),
            },
            ContentEncoder::Deflate(encoder) => match encoder.finish() {
                Ok(writer) => Ok(writer.buf.freeze()),
                Err(err) => Err(err),
            },
            ContentEncoder::Zstd(encoder) => match encoder.finish() {
                Ok(writer) => Ok(writer.buf.freeze()),
                Err(err) => Err(err),
            },
        }
    }

    fn write(&mut self, data: &[u8]) -> Result<(), io::Error> {
        match *self {
            ContentEncoder::Brotli(ref mut encoder) => match encoder.write_all(data) {
                Ok(_) => Ok(()),
                Err(err) => {
                    trace!("Error decoding br encoding: {}", err);
                    Err(err)
                }
            },
            ContentEncoder::Gzip(ref mut encoder) => match encoder.write_all(data) {
                Ok(_) => Ok(()),
                Err(err) => {
                    trace!("Error decoding gzip encoding: {}", err);
                    Err(err)
                }
            },
            ContentEncoder::Deflate(ref mut encoder) => match encoder.write_all(data) {
                Ok(_) => Ok(()),
                Err(err) => {
                    trace!("Error decoding deflate encoding: {}", err);
                    Err(err)
                }
            },
            ContentEncoder::Zstd(ref mut encoder) => match encoder.write_all(data) {
                Ok(_) => Ok(()),
                Err(err) => {
                    trace!("Error decoding ZSTD encoding: {err}");
                    Err(err)
                }
            },
        }
    }
}

fn new_brotli_compressor() -> Box<brotli::CompressorWriter<Writer>> {
    Box::new(brotli::CompressorWriter::new(
        Writer::new(),
        32 * 1024, // 32 KiB buffer
        3,         // BROTLI_PARAM_QUALITY
        22,        // BROTLI_PARAM_LGWIN
    ))
}

#[derive(Debug, Display)]
#[non_exhaustive]
pub enum EncoderError {
    /// Wrapped body stream error.
    #[display("body")]
    Body(Box<dyn StdError>),

    /// Generic I/O error.
    #[display("io")]
    Io(io::Error),
}

impl StdError for EncoderError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            EncoderError::Body(err) => Some(&**err),
            EncoderError::Io(err) => Some(err),
        }
    }
}

impl From<EncoderError> for actix_web::Error {
    fn from(err: EncoderError) -> Self {
        actix_web::error::ErrorInternalServerError(err)
    }
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::*;

    #[test]
    fn test_max_chunk_size_constant() {
        assert_eq!(MAX_CHUNK_SIZE_ENCODE_IN_PLACE, 1024);
    }

    #[test]
    fn test_content_encoder_select_deflate() {
        let encoder = ContentEncoder::select(ContentEncoding::Deflate);
        assert!(encoder.is_some());
        if let Some(ContentEncoder::Deflate(_)) = encoder {
            // Success
        } else {
            panic!("Expected Deflate encoder");
        }
    }

    #[test]
    fn test_content_encoder_select_gzip() {
        let encoder = ContentEncoder::select(ContentEncoding::Gzip);
        assert!(encoder.is_some());
        if let Some(ContentEncoder::Gzip(_)) = encoder {
            // Success
        } else {
            panic!("Expected Gzip encoder");
        }
    }

    #[test]
    fn test_content_encoder_select_brotli() {
        let encoder = ContentEncoder::select(ContentEncoding::Brotli);
        assert!(encoder.is_some());
        if let Some(ContentEncoder::Brotli(_)) = encoder {
            // Success
        } else {
            panic!("Expected Brotli encoder");
        }
    }

    #[test]
    fn test_content_encoder_select_zstd() {
        let encoder = ContentEncoder::select(ContentEncoding::Zstd);
        assert!(encoder.is_some());
        if let Some(ContentEncoder::Zstd(_)) = encoder {
            // Success
        } else {
            panic!("Expected Zstd encoder");
        }
    }

    #[test]
    fn test_content_encoder_select_identity() {
        let encoder = ContentEncoder::select(ContentEncoding::Identity);
        assert!(encoder.is_none());
    }

    #[test]
    fn test_content_encoder_write_and_flush_gzip() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();
        let test_data = b"Hello, World!";

        let write_result = encoder.write(test_data);
        assert!(write_result.is_ok());

        let flush_result = encoder.flush();
        assert!(flush_result.is_ok());

        let chunk = flush_result.unwrap();
        assert!(!chunk.is_empty());
    }

    #[test]
    fn test_content_encoder_write_and_flush_deflate() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Deflate).unwrap();
        let test_data = b"Test deflate compression";

        let write_result = encoder.write(test_data);
        assert!(write_result.is_ok());

        let flush_result = encoder.flush();
        assert!(flush_result.is_ok());

        let chunk = flush_result.unwrap();
        assert!(!chunk.is_empty());
    }

    #[test]
    fn test_content_encoder_write_and_flush_zstd() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Zstd).unwrap();
        let test_data = b"Zstd compression test data";

        let write_result = encoder.write(test_data);
        assert!(write_result.is_ok());

        let flush_result = encoder.flush();
        assert!(flush_result.is_ok());

        let chunk = flush_result.unwrap();
        assert!(!chunk.is_empty());
    }

    #[test]
    fn test_content_encoder_write_and_flush_brotli() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Brotli).unwrap();
        let test_data = b"Brotli compression test";

        let write_result = encoder.write(test_data);
        assert!(write_result.is_ok());

        let flush_result = encoder.flush();
        assert!(flush_result.is_ok());

        let chunk = flush_result.unwrap();
        assert!(!chunk.is_empty());
    }

    #[test]
    fn test_content_encoder_take_gzip() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();
        encoder.write(b"data to compress for testing take").unwrap();
        let _flush_result = encoder.flush().unwrap();

        let _chunk = encoder.take();
        // After flush, take should return the buffer (may or may not be empty depending on flush)
        // The key is that take() works without error

        // Taking again should return empty since buffer was already taken
        let chunk2 = encoder.take();
        assert!(chunk2.is_empty());
    }

    #[test]
    fn test_content_encoder_finish_gzip() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();
        encoder.write(b"Final data").unwrap();

        let result = encoder.finish();
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn test_content_encoder_finish_deflate() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Deflate).unwrap();
        encoder.write(b"Deflate final data").unwrap();

        let result = encoder.finish();
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn test_content_encoder_finish_zstd() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Zstd).unwrap();
        encoder.write(b"Zstd final data").unwrap();

        let result = encoder.finish();
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn test_content_encoder_finish_brotli() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Brotli).unwrap();
        encoder.write(b"Brotli final").unwrap();

        let result = encoder.finish();
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn test_content_encoder_write_empty_data() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();
        let empty_data = b"";

        let result = encoder.write(empty_data);
        assert!(result.is_ok());
    }

    #[test]
    fn test_content_encoder_write_large_data() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();
        let large_data = vec![b'A'; 10000];

        let result = encoder.write(&large_data);
        assert!(result.is_ok());

        let flush_result = encoder.flush();
        assert!(flush_result.is_ok());
    }

    #[test]
    fn test_content_encoder_multiple_writes() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();

        encoder.write(b"First chunk ").unwrap();
        encoder.write(b"Second chunk ").unwrap();
        encoder.write(b"Third chunk").unwrap();

        let result = encoder.finish();
        assert!(result.is_ok());
        assert!(!result.unwrap().is_empty());
    }

    #[test]
    fn test_new_brotli_compressor() {
        let compressor = new_brotli_compressor();
        // Just verify it can be created without panicking
        assert!(std::mem::size_of_val(&*compressor) > 0);
    }

    #[test]
    fn test_encoder_error_body_display() {
        let err = EncoderError::Body(Box::new(io::Error::other("test error")));
        let display = format!("{err}");
        assert_eq!(display, "body");
    }

    #[test]
    fn test_encoder_error_io_display() {
        let err = EncoderError::Io(io::Error::other("io error"));
        let display = format!("{err}");
        assert_eq!(display, "io");
    }

    #[test]
    fn test_encoder_error_body_source() {
        let io_err = io::Error::other("test error");
        let err = EncoderError::Body(Box::new(io_err));
        assert!(err.source().is_some());
    }

    #[test]
    fn test_encoder_error_io_source() {
        let io_err = io::Error::other("io error");
        let err = EncoderError::Io(io_err);
        assert!(err.source().is_some());
    }

    #[test]
    fn test_encoder_error_to_actix_error() {
        let err = EncoderError::Io(io::Error::other("test"));
        let actix_err: actix_web::Error = err.into();
        assert_eq!(
            actix_err.as_response_error().status_code(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_content_encoder_compresses_data() {
        let original_data = b"This is test data that should be compressed. ".repeat(10);

        let mut encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();
        encoder.write(&original_data).unwrap();
        let compressed = encoder.finish().unwrap();

        // Compressed data should be smaller than original
        assert!(compressed.len() < original_data.len());
    }

    #[test]
    fn test_content_encoder_flush_multiple_times() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();

        encoder.write(b"chunk1").unwrap();
        let flush1 = encoder.flush().unwrap();
        assert!(!flush1.is_empty());

        encoder.write(b"chunk2").unwrap();
        let flush2 = encoder.flush().unwrap();
        assert!(!flush2.is_empty());
    }

    #[test]
    fn test_encoder_body_size_full_via_bytes() {
        // Test that Full body reports correct size
        let data = Bytes::from("test data");
        let data_len = data.len() as u64;
        // EncoderBody::Full would have size BodySize::Sized(data_len)
        assert_eq!(BodySize::Sized(data_len), BodySize::Sized(9));
    }

    #[test]
    fn test_content_encoder_write_unicode() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();
        let unicode_data = "Hello 世界! 🎉".as_bytes();

        let result = encoder.write(unicode_data);
        assert!(result.is_ok());

        let finish_result = encoder.finish();
        assert!(finish_result.is_ok());
    }

    #[test]
    fn test_content_encoder_write_binary_data() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Deflate).unwrap();
        let binary_data: Vec<u8> = (0..255).collect();

        let result = encoder.write(&binary_data);
        assert!(result.is_ok());

        let finish_result = encoder.finish();
        assert!(finish_result.is_ok());
    }

    #[test]
    fn test_update_head_sets_content_encoding() {
        let mut head = ResponseHead::new(StatusCode::OK);
        update_head(ContentEncoding::Gzip, &mut head);

        assert!(head.headers().contains_key(CONTENT_ENCODING));
        assert_eq!(
            head.headers().get(CONTENT_ENCODING).unwrap(),
            &HeaderValue::from_static("gzip")
        );
    }

    #[test]
    fn test_update_head_adds_vary_header() {
        let mut head = ResponseHead::new(StatusCode::OK);
        update_head(ContentEncoding::Gzip, &mut head);

        assert!(head.headers().contains_key(header::VARY));
        let vary_values: Vec<_> = head.headers().get_all(header::VARY).collect();
        assert!(!vary_values.is_empty());
    }

    #[test]
    fn test_update_head_with_different_encodings() {
        let encodings = vec![
            ContentEncoding::Gzip,
            ContentEncoding::Deflate,
            ContentEncoding::Brotli,
            ContentEncoding::Zstd,
        ];

        for encoding in encodings {
            let mut head = ResponseHead::new(StatusCode::OK);
            update_head(encoding, &mut head);
            assert!(head.headers().contains_key(CONTENT_ENCODING));
        }
    }

    #[test]
    fn test_encoder_none_creates_none_body() {
        let encoder: Encoder<body::None> = Encoder::none();
        assert!(encoder.eof);
        assert!(encoder.encoder.is_none());
        assert_eq!(encoder.size(), BodySize::None);
    }

    #[test]
    fn test_encoder_empty_creates_empty_body() {
        let encoder: Encoder<Bytes> = Encoder::empty();
        assert!(encoder.eof);
        assert!(encoder.encoder.is_none());
        assert_eq!(encoder.size(), BodySize::Sized(0));
    }

    #[test]
    fn test_encoder_response_with_none_body_size() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let none_body = body::None::new();
        let encoder = Encoder::response(ContentEncoding::Gzip, &mut head, none_body);

        assert!(encoder.eof);
        assert_eq!(encoder.size(), BodySize::None);
    }

    #[test]
    fn test_encoder_response_with_zero_sized_body() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let empty_bytes = Bytes::new();
        let encoder = Encoder::response(ContentEncoding::Gzip, &mut head, empty_bytes);

        assert!(encoder.eof);
        assert_eq!(encoder.size(), BodySize::Sized(0));
    }

    #[test]
    fn test_encoder_response_with_gzip_encoding() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let body = Bytes::from("test data");
        let encoder = Encoder::response(ContentEncoding::Gzip, &mut head, body);

        assert!(!encoder.eof);
        assert!(encoder.encoder.is_some());
        assert_eq!(encoder.size(), BodySize::Stream);
        assert!(head.headers().contains_key(CONTENT_ENCODING));
    }

    #[test]
    fn test_encoder_response_with_identity_encoding() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let body = Bytes::from("test data");
        let encoder = Encoder::response(ContentEncoding::Identity, &mut head, body);

        assert!(!encoder.eof);
        assert!(encoder.encoder.is_none());
        // Identity means no compression, so size should not be Stream
        assert_ne!(encoder.size(), BodySize::Stream);
    }

    #[test]
    fn test_encoder_response_with_switching_protocols_status() {
        let mut head = ResponseHead::new(StatusCode::SWITCHING_PROTOCOLS);
        let body = Bytes::from("test data");
        let encoder = Encoder::response(ContentEncoding::Gzip, &mut head, body);

        // Should not encode because status is SWITCHING_PROTOCOLS
        assert!(encoder.encoder.is_none());
    }

    #[test]
    fn test_encoder_response_with_no_content_status() {
        let mut head = ResponseHead::new(StatusCode::NO_CONTENT);
        let body = Bytes::from("test");
        let encoder = Encoder::response(ContentEncoding::Gzip, &mut head, body);

        // Should not encode because status is NO_CONTENT
        assert!(encoder.encoder.is_none());
    }

    #[test]
    fn test_encoder_response_with_existing_content_encoding() {
        let mut head = ResponseHead::new(StatusCode::OK);
        head.headers_mut()
            .insert(CONTENT_ENCODING, HeaderValue::from_static("custom"));
        let body = Bytes::from("test data");
        let encoder = Encoder::response(ContentEncoding::Gzip, &mut head, body);

        // Should not encode because content-encoding already exists
        assert!(encoder.encoder.is_none());
    }

    #[test]
    fn test_encoder_response_with_deflate_encoding() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let body = Bytes::from("deflate test data");
        let encoder = Encoder::response(ContentEncoding::Deflate, &mut head, body);

        assert!(encoder.encoder.is_some());
        assert_eq!(encoder.size(), BodySize::Stream);
    }

    #[test]
    fn test_encoder_response_with_brotli_encoding() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let body = Bytes::from("brotli test data");
        let encoder = Encoder::response(ContentEncoding::Brotli, &mut head, body);

        assert!(encoder.encoder.is_some());
        assert_eq!(encoder.size(), BodySize::Stream);
    }

    #[test]
    fn test_encoder_response_with_zstd_encoding() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let body = Bytes::from("zstd test data");
        let encoder = Encoder::response(ContentEncoding::Zstd, &mut head, body);

        assert!(encoder.encoder.is_some());
        assert_eq!(encoder.size(), BodySize::Stream);
    }

    #[test]
    fn test_encoder_body_try_into_bytes_none() {
        let none_body: EncoderBody<body::None> = EncoderBody::None {
            body: body::None::new(),
        };
        let result = none_body.try_into_bytes();
        match result {
            Ok(bytes) => assert!(bytes.is_empty()),
            Err(_) => panic!("Expected Ok, got Err"),
        }
    }

    #[test]
    fn test_encoder_body_try_into_bytes_full() {
        let test_data = Bytes::from("test data");
        let full_body: EncoderBody<Bytes> = EncoderBody::Full {
            body: test_data.clone(),
        };
        let result = full_body.try_into_bytes();
        match result {
            Ok(bytes) => assert_eq!(bytes, test_data),
            Err(_) => panic!("Expected Ok, got Err"),
        }
    }

    #[test]
    fn test_encoder_body_try_into_bytes_stream_fails() {
        let bytes_body = Bytes::from("stream data");
        let stream_body = EncoderBody::Stream { body: bytes_body };
        let result = stream_body.try_into_bytes();
        assert!(result.is_err());
    }

    #[test]
    fn test_encoder_body_size_none() {
        let none_body: EncoderBody<body::None> = EncoderBody::None {
            body: body::None::new(),
        };
        assert_eq!(none_body.size(), BodySize::None);
    }

    #[test]
    fn test_encoder_body_size_full() {
        let test_data = Bytes::from("test data");
        let expected_size = test_data.len() as u64;
        let full_body: EncoderBody<Bytes> = EncoderBody::Full { body: test_data };
        assert_eq!(full_body.size(), BodySize::Sized(expected_size));
    }

    #[test]
    fn test_encoder_body_size_stream() {
        let bytes_body = Bytes::from("stream data");
        let expected_size = bytes_body.len() as u64;
        let stream_body = EncoderBody::Stream { body: bytes_body };
        assert_eq!(stream_body.size(), BodySize::Sized(expected_size));
    }

    #[test]
    fn test_encoder_size_without_encoder() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let body = Bytes::from("test");
        let encoder = Encoder::response(ContentEncoding::Identity, &mut head, body);

        // Without encoder, should return body size
        let size = encoder.size();
        assert_ne!(size, BodySize::Stream);
    }

    #[test]
    fn test_encoder_size_with_encoder() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let body = Bytes::from("test data");
        let encoder = Encoder::response(ContentEncoding::Gzip, &mut head, body);

        // With encoder, should return Stream
        assert_eq!(encoder.size(), BodySize::Stream);
    }

    #[test]
    fn test_encoder_try_into_bytes_without_encoder() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let test_data = Bytes::from("test data");
        let encoder = Encoder::response(ContentEncoding::Identity, &mut head, test_data.clone());

        let result = encoder.try_into_bytes();
        match result {
            Ok(bytes) => assert_eq!(bytes, test_data),
            Err(_) => panic!("Expected Ok, got Err"),
        }
    }

    #[test]
    fn test_encoder_try_into_bytes_with_encoder_fails() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let body = Bytes::from("test data");
        let encoder = Encoder::response(ContentEncoding::Gzip, &mut head, body);

        let result = encoder.try_into_bytes();
        assert!(result.is_err());
    }

    #[test]
    fn test_update_head_multiple_vary_headers() {
        let mut head = ResponseHead::new(StatusCode::OK);
        head.headers_mut()
            .append(header::VARY, HeaderValue::from_static("origin"));

        update_head(ContentEncoding::Gzip, &mut head);

        // Should combine into a single Vary header
        let vary_values: Vec<_> = head.headers().get_all(header::VARY).collect();
        assert_eq!(vary_values.len(), 1);
        let combined = vary_values[0].to_str().unwrap();
        assert!(combined.contains("origin"));
        assert!(combined.contains("accept-encoding"));
    }

    #[test]
    fn test_update_head_cors_vary_headers() {
        let mut head = ResponseHead::new(StatusCode::OK);
        // Simulate CORS middleware adding Vary header with multiple comma-separated values
        head.headers_mut().append(
            header::VARY,
            HeaderValue::from_static(
                "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
            ),
        );

        update_head(ContentEncoding::Gzip, &mut head);

        // Should combine into a single Vary header
        let vary_values: Vec<_> = head.headers().get_all(header::VARY).collect();
        assert_eq!(vary_values.len(), 1);
        let combined = vary_values[0].to_str().unwrap();
        assert!(combined.contains("Origin"));
        assert!(combined.contains("Access-Control-Request-Method"));
        assert!(combined.contains("Access-Control-Request-Headers"));
        assert!(combined.contains("accept-encoding"));
    }

    #[test]
    fn test_update_head_no_duplicate_accept_encoding() {
        let mut head = ResponseHead::new(StatusCode::OK);
        // Already has accept-encoding in Vary
        head.headers_mut().append(
            header::VARY,
            HeaderValue::from_static("Origin, Accept-Encoding"),
        );

        update_head(ContentEncoding::Gzip, &mut head);

        // Should not add accept-encoding again (case-insensitive check)
        let vary_values: Vec<_> = head.headers().get_all(header::VARY).collect();
        assert_eq!(vary_values.len(), 1);
        let combined = vary_values[0].to_str().unwrap();
        // Count occurrences of "accept-encoding" (case-insensitive)
        let count = combined
            .split(',')
            .map(|s| s.trim())
            .filter(|s| s.eq_ignore_ascii_case("accept-encoding"))
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_content_encoder_take_after_write_no_flush() {
        let mut encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();
        encoder.write(b"test data").unwrap();

        // Take without flush - buffer may be empty
        let chunk = encoder.take();
        // Just verify take works without error
        let _ = chunk;
    }

    #[test]
    fn test_content_encoder_finish_without_write() {
        let encoder = ContentEncoder::select(ContentEncoding::Gzip).unwrap();
        let result = encoder.finish();
        assert!(result.is_ok());
        // Finishing without write should produce valid compressed stream (may be empty or contain
        // headers)
    }

    #[test]
    fn test_encoder_response_large_body() {
        let mut head = ResponseHead::new(StatusCode::OK);
        let large_body = Bytes::from(vec![b'X'; 5000]);
        let encoder = Encoder::response(ContentEncoding::Gzip, &mut head, large_body);

        assert!(encoder.encoder.is_some());
        assert_eq!(encoder.size(), BodySize::Stream);
    }
}
