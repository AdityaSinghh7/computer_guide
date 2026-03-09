# Computer Guide Desktop Server

Local macOS desktop action server for `computer_guide`.

## Requirements

- macOS 15+
- Accessibility permission for the installed desktop server app
- Swift 6.2 toolchain available through `swiftly`
- `COMPUTER_GUIDE_DESKTOP_TOKEN` set in the environment

## Run

From the repo root:

```bash
npm run desktop-server:install-app
npm run desktop-server:start
```

For development-only `swift run` startup:

```bash
npm run desktop-server:start:dev
```

The preferred end-user path is the installed app bundle at `~/Applications/ComputerGuideDesktopServer.app`, which gives macOS Accessibility a stable executable identity instead of relying on `.build/...` paths.

Optional environment variables:

- `COMPUTER_GUIDE_DESKTOP_HOST` default `127.0.0.1`
- `COMPUTER_GUIDE_DESKTOP_PORT` default `47613`
- `COMPUTER_GUIDE_DESKTOP_APP_PATH` default `~/Applications/ComputerGuideDesktopServer.app`
- `COMPUTER_GUIDE_DESKTOP_BUNDLE_ID` default `com.computerguide.desktopserver`
- `COMPUTER_GUIDE_DESKTOP_CODESIGN_IDENTITY` optional signing identity for the installed app bundle
- `COMPUTER_GUIDE_DESKTOP_SERVER_LOG_PATH` default `.logs/desktop-server-actions.jsonl`

## Endpoints

- `GET /v1/health`
- `GET /v1/permissions`
- `POST /v1/permissions/request-accessibility`
- `POST /v1/permissions/request-screen-recording`
- `POST /v1/click`
- `POST /v1/switch-application`
- `POST /v1/open`
- `POST /v1/type`
- `POST /v1/drag`
- `POST /v1/scroll`
- `POST /v1/hotkey`
- `POST /v1/hold-and-press`
- `POST /v1/wait`
- `POST /v1/see`

## Observability

The server appends one JSON line per request to `.logs/desktop-server-actions.jsonl` by default.

Each event includes:

- `run_id` from the `x-observability-run-id` request header when present
- `action_id`, route, method, duration, and payload
- success message / resolved target or structured error details
