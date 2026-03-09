# computer_guide

Mastra project scaffold initialized in this repository.

## Structure

- `src/mastra/index.ts`: Mastra entrypoint
- `src/mastra/agents/`: agent definitions
- `src/mastra/tools/`: tool definitions
- `src/mastra/workflows/`: workflow definitions

## Setup

1. Copy `.env.example` to `.env`
2. Add your `OPENROUTER_API_KEY`
3. Run `npm run dev`

The main agent now defaults to `openrouter/openai/gpt-5.1`. Override it with `MAIN_AGENT_MODEL` if you want a different OpenRouter model.

## Desktop Server

The GUI Mastra tools now call a local macOS desktop action server in `desktop-server/`.

Required environment variables:

- `COMPUTER_GUIDE_DESKTOP_TOKEN`: bearer token shared by Mastra and the desktop server
- `COMPUTER_GUIDE_DESKTOP_HOST`: optional, defaults to `127.0.0.1`
- `COMPUTER_GUIDE_DESKTOP_PORT`: optional, defaults to `47613`

Useful commands:

- `npm run chat:agent -- "your prompt here"`
- `npm run desktop-server:build`
- `npm run desktop-server:install-app`
- `npm run desktop-server:start`
- `npm run desktop-server:start:dev`
- `npm run desktop-server:status`
- `npm run desktop-server:stop`
- `npm run e2e:desktop-agent`

Local observability:

- Tool calls are appended to `.logs/desktop-tool-events.jsonl`
- Native server events are appended to `.logs/desktop-server-actions.jsonl`
- Set `COMPUTER_GUIDE_OBSERVABILITY_RUN_ID` if you want to correlate a specific run across both logs

Desktop tool behavior:

- `desktop-server:start` now runs the installed app-bundle helper at `~/Applications/ComputerGuideDesktopServer.app` by default so Accessibility trust is attached to a stable executable identity.
- `desktop-server:start:dev` still exists for direct `swift run` development, but it is not the preferred path for end users.
- Terminal chat now performs a desktop permission preflight before interactive GUI use.
- The desktop client also preflights permissions for protected GUI actions, so tool calls fail early with clear Screen Recording / Accessibility errors instead of failing mid-flow.
- The `open` tool supports direct URLs plus an optional target application, so the agent can open `https://linkedin.com` in Chrome without typing into the address bar.
- The GUI tool surface now includes `see` and `screenshot` for Peekaboo-backed UI capture and element inspection.

Swift toolchain note:

- The desktop server scripts now source `~/.swiftly/env.sh` before invoking `swift`
- The local `Peekaboo` checkout builds successfully with the Swiftly-managed 6.2 toolchain

## Desktop E2E

The repo includes an agent-driven desktop E2E runner at `src/evals/desktopAgentE2E.ts`.

Before running it:

1. Install the stable helper once with `npm run desktop-server:install-app`
2. Start the desktop server with `npm run desktop-server:start`
3. Ensure `OPENAI_API_KEY` and `COMPUTER_GUIDE_DESKTOP_TOKEN` are exported in the same shell
4. Grant Accessibility permission to `Computer Guide Desktop Server` if prompted

Run it with:

```bash
npm run e2e:desktop-agent
```

Optional overrides:

- `npm run e2e:desktop-agent -- --prompt "..."` to change the agent instructions
- `npm run e2e:desktop-agent -- --report .logs/my-report.json` to change the report path

## Terminal Chat

To send a one-off prompt to the agent from the terminal:

```bash
npm run chat:agent -- "Open TextEdit and type hello"
```

Optional flags:

- `--thread my-thread`
- `--resource my-resource`
- `--max-steps 12`

If you run `npm run chat:agent` with no prompt in a TTY, it now starts an interactive multi-turn session.
The script prints the active `thread` and `resource` so you can resume the same conversation later:

```bash
npm run chat:agent
npm run chat:agent -- --thread your-printed-thread --resource local-user
```

Persistence details:

- Conversation history is stored through Mastra memory in `mastra.db`
- Desktop action observability logs are stored separately in `.logs/*.jsonl`
- Interactive chat preflights desktop server health plus current Accessibility / Screen Recording status before GUI actions are attempted

If you prefer the Mastra dev server and Studio UI, run:

```bash
npm run dev
```

Then open `http://localhost:4111/` and chat with `Main Agent`.
