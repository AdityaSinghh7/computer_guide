import { stdin as input, stdout as output } from 'node:process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { readEnv } from '../mastra/env';
import { mastra } from '../mastra';
import { preflightDesktopPermissions } from '../mastra/tools/desktopActionClient';

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
    output.write('The see/screenshot tools will not work until Screen Recording is granted.\n');
  }
};

const generateReply = async (prompt: string, memory: ChatMemory | undefined, maxSteps: number) => {
  const agent = mastra.getAgent('mainAgent');
  const result = await agent.generate(prompt, {
    maxSteps,
    ...(memory ? { memory } : {}),
  });

  if (result.error) {
    throw result.error;
  }

  return result.text;
};

const runOneShot = async (prompt: string, maxSteps: number) => {
  if (!prompt) {
    throw new Error('A prompt is required.');
  }

  const memory = createOneShotMemory();
  const reply = await generateReply(prompt, memory, maxSteps);

  if (memory) {
    output.write(`thread=${memory.thread} resource=${memory.resource}\n`);
  }

  output.write(`${reply}\n`);
};

const runInteractive = async (maxSteps: number) => {
  const memory = createInteractiveMemory();
  const rl = createInterface({ input, output });

  output.write('Interactive chat started. Type "exit" to quit.\n');
  output.write(`thread=${memory.thread} resource=${memory.resource}\n`);
  output.write('Conversation history is stored in mastra.db. Desktop action logs are stored in .logs/*.jsonl.\n');
  await runDesktopPreflight();

  try {
    while (true) {
      const prompt = (await rl.question('you> ')).trim();
      if (!prompt) {
        continue;
      }
      if (prompt.toLowerCase() === 'exit' || prompt.toLowerCase() === 'quit') {
        break;
      }

      const reply = await generateReply(prompt, memory, maxSteps);
      output.write(`agent> ${reply}\n`);
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
