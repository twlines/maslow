# Verification: Add HTTPS/TLS Support to AppServer

## Card Title
Add HTTPS/TLS support to AppServer

## Goals
Enable the AppServer to serve over HTTPS when TLS certificate and key paths are provided via configuration. Fall back to plain HTTP when no TLS config is present.

## Acceptance Criteria

- [ ] `AppConfig.appServer` type includes optional `tlsCertPath` and `tlsKeyPath` fields
- [ ] `APP_SERVER_TLS_CERT` and `APP_SERVER_TLS_KEY` env vars are read as optional config
- [ ] TLS file paths support `~/` home directory expansion via `expandHomePath`
- [ ] When both TLS paths are set, AppServer creates an HTTPS server using `https.createServer`
- [ ] When TLS paths are not set, AppServer falls back to plain HTTP (existing behavior)
- [ ] WebSocket upgrade works identically on both HTTP and HTTPS servers
- [ ] Log message reflects actual protocol ("HTTPS/WS" vs "HTTP/WS")
- [ ] `tsc --noEmit` passes with no errors
- [ ] `eslint .` produces no new errors or warnings

## Verification Steps

1. **Type-check**: `npm run type-check` should pass with no errors
2. **Lint**: `npm run lint` should show 0 errors (pre-existing warnings are OK)
3. **HTTP fallback (no TLS config)**: Start the server without `APP_SERVER_TLS_CERT`/`APP_SERVER_TLS_KEY` set. Confirm log says `[AppServer] HTTP/WS server listening on port 3117`
4. **HTTPS mode**: Set `APP_SERVER_TLS_CERT=/path/to/cert.pem` and `APP_SERVER_TLS_KEY=/path/to/key.pem` in `.env`, start the server. Confirm log says `[AppServer] HTTPS/WS server listening on port 3117`
5. **WebSocket over TLS**: Connect a WebSocket client to `wss://localhost:3117/ws` when TLS is enabled. Confirm connection succeeds and messages flow normally.

## Files Changed

- `src/services/Config.ts` — Added `tlsCertPath` and `tlsKeyPath` optional fields to `AppConfig.appServer` type; added `APP_SERVER_TLS_CERT` and `APP_SERVER_TLS_KEY` env var reading with `Config.option`; included TLS paths in constructed config object with `expandHomePath`
- `src/services/AppServer.ts` — Added `https` and `fs` imports; read TLS config from `config.appServer`; conditionally create HTTPS or HTTP server; updated log message to reflect protocol
