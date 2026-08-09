FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /build
# NPGSQL_VERSION selects the semconv era: 9.0.5 = old-only, 10.0.3 = new-only
# (Npgsql's native ActivitySource ignores OTEL_SEMCONV_STABILITY_OPT_IN).
ARG NPGSQL_VERSION=10.0.3
COPY dbm-capture-dotnet.csproj .
RUN dotnet restore -p:NpgsqlVersion=${NPGSQL_VERSION}
COPY Program.cs .
RUN dotnet publish -c Release -o /app -p:NpgsqlVersion=${NPGSQL_VERSION} --no-restore

FROM mcr.microsoft.com/dotnet/runtime:8.0
WORKDIR /app
COPY --from=build /app .
CMD ["dotnet", "dbm-capture-dotnet.dll"]
