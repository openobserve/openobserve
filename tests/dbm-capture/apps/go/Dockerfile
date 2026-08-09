FROM golang:1.25 AS build
WORKDIR /build
COPY go.mod .
COPY main.go .
RUN go mod tidy && go build -o /app/dbm-capture-go .

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /app/dbm-capture-go .
CMD ["./dbm-capture-go"]
