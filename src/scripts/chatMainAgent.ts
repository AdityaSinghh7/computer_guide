import { stdin as input, stdout as output } from 'node:process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { readEnv } from '../mastra/env';
import { mastra } from '../mastra';
import type { ComputerUseWorkflowOutput } from '../mastra/computer-use/schemas';
import { mainAgentMemory } from '../mastra/memory/main-agent-memory';
import { preflightDesktopPermissions } from '../mastra/tools/desktopActionClient';
import { resumeComputerUseTool } from '../mastra/tools/computerUseTools';

const { values, positionals } = parseArgs({
  options: {
    thread: { type: 'string' },
    resource: { type: 'string' },
    'max-steps': { type: 'string' },
  },
  allowPositionals: true,
});

type ChatMemory = {
  thread: string;
  resource: string;
};

type SuspendedRunContext = {
  runId: string;
  suspendedPath?: string[];
  question: string;
};

type RunTimelineEventPayload = Record<string, unknown>;

type RunTimelineEventInput = {
  runId: string;
  event: {
    type: string;
    timestamp: string;
    payload: RunTimelineEventPayload;
  };
};

type RunTimelineModule = {
  appendRunTimelineEvent?: (input: RunTimelineEventInput) => Promise<void> | void;
  recordRunTimelineEvent?: (input: RunTimelineEventInput) => Promise<void> | void;
};

const suspendedRunMetadataKey = 'computerGuideSuspendedRun';
const runTimelineModulePath = '../mastra/observability/runTimeline';

const defaultInteractiveResource = 'local-user';
const defaultThreadFromEnv = readEnv('MAIN_AGENT_DEFAULT_THREAD');
const defaultResourceFromEnv = readEnv('MAIN_AGENT_DEFAULT_RESOURCE');

const readStdinPrompt = async () => {
  let data = '';
  for await (const chunk of input) {
    data += chunk;
  }
  return data.trim();
};

const loadRunTimelineModule = async (): Promise<RunTimelineModule | null> => {
  try {
    return (await import(runTimelineModulePath)) as RunTimelineModule;
  } catch {
    return null;
  }
};

const appendRunTimelineEvent = async (
  runId: string,
  type: string,
  payload: RunTimelineEventPayload,
) => {
  if (!runId.trim()) {
    return;
  }

  try {
    const module = await loadRunTimelineModule();
    const input: RunTimelineEventInput = {
      runId,
      event: {
        type,
        timestamp: new Date().toISOString(),
        payload,
      },
    };

    if (module?.appendRunTimelineEvent) {
      await module.appendRunTimelineEvent(input);
      return;
    }

    if (module?.recordRunTimelineEvent) {
      await module.recordRunTimelineEvent(input);
    }
  } catch {
    // Observability must stay best-effort so chat execution is never blocked by logging.
  }
};

const createInteractiveMemory = (): ChatMemory => ({
  thread: values.thread ?? defaultThreadFromEnv ?? `terminal-chat-${randomUUID()}`,
  resource: values.resource ?? defaultResourceFromEnv ?? defaultInteractiveResource,
});

const createOneShotMemory = (): ChatMemory | undefined => {
  const thread = values.thread ?? defaultThreadFromEnv;
  const resource = values.resource ?? defaultResourceFromEnv;

  if (!thread && !resource) {
    return undefined;
  }

  return {
    thread: thread ?? 'terminal-chat',
    resource: resource ?? defaultInteractiveResource,
  };
};

const runDesktopPreflight = async () => {
  if (!readEnv('COMPUTER_GUIDE_DESKTOP_TOKEN')) {
    output.write('Desktop preflight skipped: COMPUTER_GUIDE_DESKTOP_TOKEN is not configured.\n');
    return;
  }

  const preflight = await preflightDesktopPermissions({
    requestAccessibilityIfMissing: true,
    requestScreenRecordingIfMissing: true,
  });

  if (!preflight.serverReachable) {
    output.write(`Desktop preflight warning: ${preflight.warning ?? 'desktop server is unavailable'}\n`);
    output.write('GUI tools will fail until `npm run desktop-server:start` is running.\n');
    return;
  }

  if (preflight.accessibilityRequest) {
    output.write(`${preflight.accessibilityRequest.message}\n`);
  }

  if (preflight.screenRecordingRequest) {
    output.write(`${preflight.screenRecordingRequest.message}\n`);
  }

  const permissions = preflight.permissions;
  if (!permissions) {
    output.write('Desktop preflight warning: permissions could not be determined.\n');
    return;
  }

  const missing: string[] = [];
  if (!permissions.accessibility) {
    missing.push('Accessibility');
  }
  if (!permissions.screen_recording) {
    missing.push('Screen Recording');
  }

  const identity = permissions.identity?.display_name ?? 'desktop server';
  if (missing.length === 0) {
    output.write(`Desktop permissions ready for ${identity}.\n`);
    return;
  }

  output.write(`Desktop permissions missing for ${identity}: ${missing.join(', ')}.\n`);
  if (!permissions.accessibility) {
    output.write('Typing, clicking, scrolling, dragging, and hotkeys will not work until Accessibility is granted.\n');
  }
  if (!permissions.screen_recording) {
    output.write('See, screenshot, clicking, typing, scrolling, and dragging will not work until Screen Recording is granted.\n');
  }
};

const isComputerUseWorkflowOutput = (value: unknown): value is ComputerUseWorkflowOutput =>
  typeof value === 'object' &&
  value !== null &&
  'status' in value &&
  'finalResponse' in value &&
  'workflowRunId' in value;

const readToolResultEntry = (value: unknown) => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as {
    toolName?: unknown;
    result?: unknown;
    payload?: {
      toolName?: unknown;
      result?: unknown;
    };
  };

  const toolName =
    typeof record.toolName === 'string'
      ? record.toolName
      : typeof record.payload?.toolName === 'string'
        ? record.payload.toolName
        : undefined;
  const result = 'result' in record ? record.result : record.payload?.result;

  return {
    toolName,
    result,
  };
};

const extractLatestComputerUseResult = (result: { toolResults?: unknown[] }) => {
  const toolResults = result.toolResults ?? [];
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const toolResult = readToolResultEntry(toolResults[index]);
    if (!toolResult) {
      continue;
    }

    if (
      (toolResult.toolName === 'run_computer_use' ||
        toolResult.toolName === 'resume_computer_use') &&
      isComputerUseWorkflowOutput(toolResult.result)
    ) {
      return toolResult.result;
    }
  }

  return undefined;
};

const normalizeSuspendedText = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const isGenericSuspendedQuestion = (value: string | undefined) =>
  !!value && /^what should i do next\?/i.test(value.trim());

const isGenericSuspendedUserAction = (value: string | undefined) =>
  !!value &&
  /tell the assistant what changed|provide the missing information needed to continue/i.test(
    value.trim(),
  );

const pickSuspendedExplanation = (output: ComputerUseWorkflowOutput) => {
  const question = normalizeSuspendedText(output.handoff?.question);
  const userAction = normalizeSuspendedText(output.handoff?.userAction);
  const summary = normalizeSuspendedText(output.handoff?.summary);
  const reason = normalizeSuspendedText(output.handoff?.reason);
  const finalResponse = normalizeSuspendedText(output.finalResponse);

  const candidates = [
    !isGenericSuspendedQuestion(question) ? question : undefined,
    !isGenericSuspendedUserAction(userAction) ? userAction : undefined,
    summary,
    reason,
    finalResponse,
    question,
    userAction,
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return 'The workflow is waiting for more input before it can continue.';
};

const formatSuspendedQuestion = (output: ComputerUseWorkflowOutput) =>
  pickSuspendedExplanation(output);

const inferResumeAction = (prompt: string): 'continue' | 'abort' => {
  const normalized = prompt.trim().toLowerCase();
  if (
    normalized === 'stop' ||
    normalized === 'cancel' ||
    normalized === 'abort' ||
    normalized === 'never mind' ||
    normalized === 'nevermind' ||
    normalized === 'quit' ||
    normalized === 'don\'t continue'
  ) {
    return 'abort';
  }

  return 'continue';
};

const readPersistedSuspendedRun = async (
  memory: ChatMemory,
): Promise<SuspendedRunContext | null> => {
  const thread = await mainAgentMemory.getThreadById({ threadId: memory.thread });
  if (!thread) {
    return null;
  }

  const record = thread.metadata?.[suspendedRunMetadataKey];
  if (!record || typeof record !== 'object') {
    return null;
  }

  const runId = 'runId' in record && typeof record.runId === 'string' ? record.runId : null;
  const question =
    'question' in record && typeof record.question === 'string' ? record.question : null;
  const suspendedPath =
    'suspendedPath' in record && Array.isArray(record.suspendedPath)
      ? record.suspendedPath.filter((value): value is string => typeof value === 'string')
      : undefined;

  if (!runId || !question) {
    return null;
  }

  return {
    runId,
    suspendedPath,
    question,
  };
};

const persistSuspendedRun = async (
  memory: ChatMemory,
  suspendedRun: SuspendedRunContext | null,
) => {
  let thread = await mainAgentMemory.getThreadById({ threadId: memory.thread });

  if (!thread) {
    thread = await mainAgentMemory.createThread({
      threadId: memory.thread,
      resourceId: memory.resource,
      title: 'Terminal Chat',
    });
  }

  const metadata = { ...(thread.metadata ?? {}) };

  if (suspendedRun) {
    metadata[suspendedRunMetadataKey] = suspendedRun;
  } else {
    delete metadata[suspendedRunMetadataKey];
  }

  await mainAgentMemory.updateThread({
    id: thread.id,
    title: thread.title ?? 'Terminal Chat',
    metadata,
  });
};

const generateReply = async (prompt: string, memory: ChatMemory | undefined, maxSteps: number) => {
  const agent = mastra.getAgent('mainAgent');
  const result = await agent.generate(prompt, {
    maxSteps,
    activeTools: ['run_computer_use'],
    prepareStep: async ({ stepNumber }) => {
      if (stepNumber > 0) {
        return {
          toolChoice: 'none',
        };
      }

      return undefined;
    },
    ...(memory ? { memory } : {}),
  });

  if (result.error) {
    throw result.error;
  }

  const workflowResult = extractLatestComputerUseResult(result);
  const suspendedRun =
    workflowResult?.status === 'suspended' && workflowResult.workflowRunId
      ? {
          runId: workflowResult.workflowRunId,
          suspendedPath: workflowResult.suspendedPath,
          question: formatSuspendedQuestion(workflowResult),
        }
      : null;

  const text =
    workflowResult?.status === 'suspended'
      ? `I need one thing before I can continue: ${formatSuspendedQuestion(workflowResult)}`
      : result.text;

  return {
    text,
    suspendedRun,
    workflowResult,
    rawModelText: result.text,
  };
};

const runOneShot = async (prompt: string, maxSteps: number) => {
  if (!prompt) {
    throw new Error('A prompt is required.');
  }

  const memory = createOneShotMemory();
  const reply = await generateReply(prompt, memory, maxSteps);
  const runId = reply.workflowResult?.workflowRunId;

  if (runId) {
    await appendRunTimelineEvent(runId, 'human-input', {
      source: 'one-shot',
      text: prompt,
      threadId: memory?.thread ?? null,
      resourceId: memory?.resource ?? null,
    });
    await appendRunTimelineEvent(runId, 'assistant-output', {
      source: 'one-shot',
      text: reply.text,
      rawModelText: reply.rawModelText,
      workflowStatus: reply.workflowResult?.status ?? null,
      suspendedPath: reply.workflowResult?.suspendedPath ?? null,
    });
  }

  if (memory) {
    output.write(`thread=${memory.thread} resource=${memory.resource}\n`);
  }

  output.write(`${reply.text}\n`);
};

const runInteractive = async (maxSteps: number) => {
  const memory = createInteractiveMemory();
  const rl = createInterface({ input, output });
  let suspendedRun = await readPersistedSuspendedRun(memory);

  output.write('Interactive chat started. Type "exit" to quit.\n');
  output.write(`thread=${memory.thread} resource=${memory.resource}\n`);
  output.write('Conversation history is stored in mastra.db. Desktop action logs are stored in .logs/*.jsonl.\n');
  await runDesktopPreflight();
  if (suspendedRun) {
    output.write(`agent> I need one thing before I can continue: ${suspendedRun.question}\n`);
  }

  try {
    while (true) {
      const prompt = (await rl.question('you> ')).trim();
      if (!prompt) {
        continue;
      }
      if (prompt.toLowerCase() === 'exit' || prompt.toLowerCase() === 'quit') {
        break;
      }

      if (suspendedRun) {
        await appendRunTimelineEvent(suspendedRun.runId, 'human-input', {
          source: 'resume',
          text: prompt,
          threadId: memory.thread,
          resourceId: memory.resource,
          suspendedPath: suspendedRun.suspendedPath ?? null,
        });

        let resumed: unknown;
        try {
          resumed = await resumeComputerUseTool.execute?.(
            {
              runId: suspendedRun.runId,
              ...(suspendedRun.suspendedPath ? { suspendedPath: suspendedRun.suspendedPath } : {}),
              userResponse: prompt,
              action: inferResumeAction(prompt),
            },
            {},
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/not suspended/i.test(message)) {
            suspendedRun = null;
            await persistSuspendedRun(memory, null);
          } else {
            throw error;
          }
        }

        if (!resumed) {
          const reply = await generateReply(prompt, memory, maxSteps);
          const runId = reply.workflowResult?.workflowRunId;
          if (runId) {
            await appendRunTimelineEvent(runId, 'human-input', {
              source: 'interactive',
              text: prompt,
              threadId: memory.thread,
              resourceId: memory.resource,
            });
            await appendRunTimelineEvent(runId, 'assistant-output', {
              source: 'interactive',
              text: reply.text,
              rawModelText: reply.rawModelText,
              workflowStatus: reply.workflowResult?.status ?? null,
              suspendedPath: reply.workflowResult?.suspendedPath ?? null,
            });
          }
          suspendedRun = reply.suspendedRun;
          await persistSuspendedRun(memory, suspendedRun);
          output.write(`agent> ${reply.text}\n`);
          continue;
        }

        const workflowResult = resumed as ComputerUseWorkflowOutput;
        if (workflowResult.status === 'suspended' && workflowResult.workflowRunId) {
          suspendedRun = {
            runId: workflowResult.workflowRunId,
            suspendedPath: workflowResult.suspendedPath,
            question: formatSuspendedQuestion(workflowResult),
          };
          await persistSuspendedRun(memory, suspendedRun);
          await appendRunTimelineEvent(workflowResult.workflowRunId, 'assistant-output', {
            source: 'resume',
            text: formatSuspendedQuestion(workflowResult),
            rawModelText: workflowResult.finalResponse,
            workflowStatus: workflowResult.status,
            suspendedPath: workflowResult.suspendedPath ?? null,
          });
          output.write(
            `agent> I still need one thing before I can continue: ${formatSuspendedQuestion(workflowResult)}\n`,
          );
          continue;
        }

        suspendedRun = null;
        await persistSuspendedRun(memory, null);
        if (workflowResult.workflowRunId) {
          await appendRunTimelineEvent(workflowResult.workflowRunId, 'assistant-output', {
            source: 'resume',
            text: workflowResult.finalResponse,
            rawModelText: workflowResult.finalResponse,
            workflowStatus: workflowResult.status,
            suspendedPath: workflowResult.suspendedPath ?? null,
          });
        }
        output.write(`agent> ${workflowResult.finalResponse}\n`);
        continue;
      }

      const reply = await generateReply(prompt, memory, maxSteps);
      const runId = reply.workflowResult?.workflowRunId;
      if (runId) {
        await appendRunTimelineEvent(runId, 'human-input', {
          source: 'interactive',
          text: prompt,
          threadId: memory.thread,
          resourceId: memory.resource,
        });
        await appendRunTimelineEvent(runId, 'assistant-output', {
          source: 'interactive',
          text: reply.text,
          rawModelText: reply.rawModelText,
          workflowStatus: reply.workflowResult?.status ?? null,
          suspendedPath: reply.workflowResult?.suspendedPath ?? null,
        });
      }
      suspendedRun = reply.suspendedRun;
      await persistSuspendedRun(memory, suspendedRun);
      output.write(`agent> ${reply.text}\n`);
    }
  } finally {
    rl.close();
  }
};

const main = async () => {
  const maxSteps = values['max-steps'] ? Number(values['max-steps']) : 12;
  if (!Number.isFinite(maxSteps) || maxSteps < 1) {
    throw new Error('--max-steps must be a positive number.');
  }

  if (positionals.length > 0) {
    await runOneShot(positionals.join(' ').trim(), maxSteps);
    return;
  }

  if (!input.isTTY) {
    await runOneShot(await readStdinPrompt(), maxSteps);
    return;
  }

  await runInteractive(maxSteps);
};

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
