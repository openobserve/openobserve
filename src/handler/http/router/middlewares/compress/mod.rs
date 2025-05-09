//! For middleware documentation, see [`Compress`].

use std::{
    future::Future,
    marker::PhantomData,
    pin::Pin,
    task::{Context, Poll},
};

use actix_service::{Service, Transform};
use actix_utils::future::{Either, Ready, ok};
use actix_web::{
    Error, HttpMessage, HttpResponse,
    body::{EitherBody, MessageBody},
    dev::{ServiceRequest, ServiceResponse},
    http::{
        StatusCode,
        header::{self, AcceptEncoding, ContentEncoding, Encoding, HeaderValue},
    },
};
use futures_core::ready;
use mime::Mime;
use once_cell::sync::Lazy;
use pin_project_lite::pin_project;

use super::encoding::Encoder;

/// Middleware for compressing response payloads.
///
/// # Encoding Negotiation
/// `Compress` will read the `Accept-Encoding` header to negotiate which compression codec to use.
/// Payloads are not compressed if the header is not sent. The `compress-*` [feature flags] are also
/// considered in this selection process.
///
/// # Pre-compressed Payload
/// If you are serving some data that is already using a compressed representation (e.g., a gzip
/// compressed HTML file from disk) you can signal this to `Compress` by setting an appropriate
/// `Content-Encoding` header. In addition to preventing double compressing the payload, this header
/// is required by the spec when using compressed representations and will inform the client that
/// the content should be uncompressed.
///
/// However, it is not advised to unconditionally serve encoded representations of content because
/// the client may not support it. The [`AcceptEncoding`] typed header has some utilities to help
/// perform manual encoding negotiation, if required. When negotiating content encoding, it is also
/// required by the spec to send a `Vary: Accept-Encoding` header.
///
/// A (naïve) example serving an pre-compressed Gzip file is included below.
///
/// # Examples
/// To enable automatic payload compression just include `Compress` as a top-level middleware:
/// ```
/// use actix_web::{App, HttpResponse, middleware, web};
///
/// let app = App::new()
///     .wrap(middleware::Compress::default())
///     .default_service(web::to(|| async { HttpResponse::Ok().body("hello world") }));
/// ```
///
/// Pre-compressed Gzip file being served from disk with correct headers added to bypass middleware:
/// ```no_run
/// use actix_web::{App, HttpResponse, Responder, http::header, middleware, web};
///
/// async fn index_handler() -> actix_web::Result<impl Responder> {
///     Ok(actix_files::NamedFile::open_async("./assets/index.html.gz")
///         .await?
///         .customize()
///         .insert_header(header::ContentEncoding::Gzip))
/// }
///
/// let app = App::new()
///     .wrap(middleware::Compress::default())
///     .default_service(web::to(index_handler));
/// ```
///
/// [feature flags]: ../index.html#crate-features
#[derive(Debug, Clone, Default)]
#[non_exhaustive]
pub struct Compress;

impl<S, B> Transform<S, ServiceRequest> for Compress
where
    B: MessageBody,
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
{
    type Response = ServiceResponse<EitherBody<Encoder<B>>>;
    type Error = Error;
    type Transform = CompressMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(CompressMiddleware { service })
    }
}

pub struct CompressMiddleware<S> {
    service: S,
}

impl<S, B> Service<ServiceRequest> for CompressMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    B: MessageBody,
{
    type Response = ServiceResponse<EitherBody<Encoder<B>>>;
    type Error = Error;
    #[allow(clippy::type_complexity)]
    type Future = Either<CompressResponse<S, B>, Ready<Result<Self::Response, Self::Error>>>;

    actix_service::forward_ready!(service);

    #[allow(clippy::borrow_interior_mutable_const)]
    fn call(&self, req: ServiceRequest) -> Self::Future {
        // negotiate content-encoding
        let accept_encoding = req.get_header::<AcceptEncoding>();

        let accept_encoding = match accept_encoding {
            // missing header; fallback to identity
            None => {
                return Either::left(CompressResponse {
                    encoding: Encoding::identity(),
                    fut: self.service.call(req),
                    _phantom: PhantomData,
                });
            }

            // valid accept-encoding header
            Some(accept_encoding) => accept_encoding,
        };

        match accept_encoding.negotiate(SUPPORTED_ENCODINGS.iter()) {
            None => {
                let mut res = HttpResponse::with_body(
                    StatusCode::NOT_ACCEPTABLE,
                    SUPPORTED_ENCODINGS_STRING.as_str(),
                );

                res.headers_mut()
                    .insert(header::VARY, HeaderValue::from_static("Accept-Encoding"));

                Either::right(ok(req
                    .into_response(res)
                    .map_into_boxed_body()
                    .map_into_right_body()))
            }

            Some(encoding) => Either::left(CompressResponse {
                fut: self.service.call(req),
                encoding,
                _phantom: PhantomData,
            }),
        }
    }
}

pin_project! {
    pub struct CompressResponse<S, B>
    where
        S: Service<ServiceRequest>,
    {
        #[pin]
        fut: S::Future,
        encoding: Encoding,
        _phantom: PhantomData<B>,
    }
}

impl<S, B> Future for CompressResponse<S, B>
where
    B: MessageBody,
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
{
    type Output = Result<ServiceResponse<EitherBody<Encoder<B>>>, Error>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.as_mut().project();

        match ready!(this.fut.poll(cx)) {
            Ok(resp) => {
                let enc = match this.encoding {
                    Encoding::Known(enc) => *enc,
                    Encoding::Unknown(enc) => {
                        unimplemented!("encoding '{enc}' should not be here");
                    }
                };

                Poll::Ready(Ok(resp.map_body(move |head, body| {
                    let content_type = head.headers.get(header::CONTENT_TYPE);

                    fn default_compress_predicate(content_type: Option<&HeaderValue>) -> bool {
                        match content_type {
                            None => true,
                            Some(hdr) => {
                                match hdr.to_str().ok().and_then(|hdr| hdr.parse::<Mime>().ok()) {
                                    Some(mime) if mime.type_().as_str() == "image" => false,
                                    Some(mime) if mime.type_().as_str() == "video" => false,
                                    _ => true,
                                }
                            }
                        }
                    }

                    let enc = if default_compress_predicate(content_type) {
                        enc
                    } else {
                        ContentEncoding::Identity
                    };

                    // For SSE responses, we'll use the default encoder which handles streaming
                    EitherBody::left(Encoder::response(enc, head, body))
                })))
            }

            Err(err) => Poll::Ready(Err(err)),
        }
    }
}

static SUPPORTED_ENCODINGS_STRING: Lazy<String> =
    Lazy::new(|| "br, gzip, deflate, zstd".to_string());

static SUPPORTED_ENCODINGS: &[Encoding] = &[
    Encoding::identity(),
    Encoding::brotli(),
    Encoding::gzip(),
    Encoding::deflate(),
    Encoding::zstd(),
];
