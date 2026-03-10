# Computer Use Refactor

## Goal

Reshape `computer_guide` from a single prompt-heavy GUI agent into a structured computer-use system with:

- Mastra workflow orchestration
- separate router, worker, and verifier agents
- typed run state and step artifacts
- a thinner Swift desktop controller boundary
- a shared grounded action pipeline for vision-based actions

## Principles

- Keep the user-facing product focus of `computer_guide`: local, natural-language help for non-technical users.
- Reuse the good parts of `muscle_mem` and `TakeBridge-S3` without cloning their stale or platform-specific edges.
- Keep Swift as the macOS-native execution layer.
- Keep Mastra as the orchestration and memory layer.

## Phases

### Phase 1

- [x] Add typed computer-use run state and step artifact modules in `src/mastra`
- [x] Split the current `mainAgent` into router, worker, and verifier roles
- [x] Add a Mastra workflow scaffold for the computer-use step loop
- [x] Split the workflow into explicit observe/decide/execute/observe/verify/conclude turn steps
- [x] Register workflows in `src/mastra/index.ts`
- [x] Wire the chat agent entrypoint through the workflow tool path for computer-use tasks

### Phase 2

- [ ] Refactor `desktop-server` further into thinner controller-style services
- [x] Introduce a shared grounded action pipeline for click/type/drag/scroll
- [x] Return standardized action artifacts with before/after capture references
- [x] Preserve `.logs` observability while surfacing artifacts directly in responses

### Phase 3

- [x] Add verifier-driven retry and recovery policy fields to workflow state and verifier output
- [x] Add task-local scratchpad/todo support to workflow state and worker planning
- [x] Add resumable workflow handling and explicit human handoff states
- [ ] Add optional specialist agents such as code-agent or subagent flows

### Phase 4

- [x] Replace the structured worker planner with a real tool-calling Mastra worker agent
- [x] Add a worker-only control tool so the workflow still receives typed continue/done/handoff signals
- [x] Persist worker turn artifacts as tool calls, tool results, execution results, and grounding summaries
- [ ] Add targeted eval coverage for tool-calling worker turns and verifier recovery behavior
- [ ] Live-test the tool-calling worker path against the running desktop server

## Phase 3 Checklist

- [x] Extend computer-use schemas with recovery action, handoff, todo board, and scratchpad state
- [x] Surface task-local todo and scratchpad context into worker/verifier prompts
- [x] Teach the worker to maintain todo/scratchpad outputs and reserve handoff for real user dependencies
- [x] Teach the verifier to return concrete recovery actions and handoff requests
- [x] Add bounded retry/recovery counting in the workflow turn policy
- [x] Suspend the workflow with a structured handoff payload when recovery escalates to user input
- [x] Add a `resume_computer_use` tool to continue suspended runs
- [ ] Thread suspended run metadata back through the chat UX with a polished user-facing resume experience
- [ ] Add targeted evaluation coverage for retry, handoff, and resume paths
- [ ] Live-test the suspend/resume path against the running desktop server

## Current Focus

The active implementation target is Phase 4 follow-through: validate the new tool-calling worker loop with targeted eval coverage and live desktop runs, then continue thinning the desktop controller boundary. The phase checklists above are the source of truth for the remaining work.
