import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { readEnvOrDefault } from '../mastra/env';
import { mastra } from '../mastra';
import { getDesktopServerBaseUrl, getDesktopServerToken } from '../mastra/tools/desktopActionClient';
import { resolveDesktopToolLogPath } from '../mastra/tools/desktopObservability';

type HealthPayload = {
  ok: boolean;
  host: string;
  port: number;
};

type PermissionStatusPayload = {
  screen_recording: boolean;
  accessibility: boolean;
  apple_script: boolean;
};

type Assertion = {
  name: string;
  ok: boolean;
  details?: string;
};

const defaultPrompt = `Use the desktop tools to verify that GUI automation is working on this Mac.
Execute these exact steps in order:
1. Use the open tool to open TextEdit.
2. Use the wait tool for 1 second.
3. Use the hotkey tool with keys ["cmd","n"] to create a new document if TextEdit is open without a focused editor.
4. Use the type tool targeting the main empty TextEdit editor area to type exactly: Peekaboo desktop E2E is working
5. Finish with the exact text E2E_OK
Do not claim success unless the tools actually succeed.`;

const defaultServerLogPath = path.resolve(
  process.cwd(),
  readEnvOrDefault('COMPUTER_GUIDE_DESKTOP_SERVER_LOG_PATH', path.join('.logs', 'desktop-server-actions.jsonl')),
);

const defaultReportDirectory = path.resolve(process.cwd(), '.logs', 'desktop-agent-e2e');

const { values } = parseArgs({
  options: {
    prompt: { type: 'string' },
    report: { type: 'string' },
  },
  allowPositionals: false,
});

const runId = `desktop-e2e-${Date.now()}`;
process.env.COMPUTER_GUIDE_OBSERVABILITY_RUN_ID = runId;

const prompt = values.prompt ?? defaultPrompt;
const toolLogPath = resolveDesktopToolLogPath();
const serverLogPath = path.resolve(defaultServerLogPath);
const reportPath = path.resolve(values.report ?? path.join(defaultReportDirectory, `${runId}.json`));

const fetchDesktopServerJSON = async <T>(pathname: string): Promise<T> => {
  const baseUrl = getDesktopServerBaseUrl();
  const token = getDesktopServerToken();
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-observability-run-id': runId,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Desktop server request failed for ${pathname}: HTTP ${response.status} ${body}`);
  }

  return JSON.parse(body) as T;
};

const readJsonl = async (filePath: string) => {
  try {
    const contents = await readFile(filePath, 'utf8');
    return contents
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line) as Record<string, unknown>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const createAssertion = (name: string, ok: boolean, details?: string): Assertion => ({
  name,
  ok,
  details,
});

const writeReport = async (report: unknown) => {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const health = await fetchDesktopServerJSON<HealthPayload>('/v1/health');
  const permissions = await fetchDesktopServerJSON<PermissionStatusPayload>('/v1/permissions');

  const agent = mastra.getAgent('mainAgent');
  const result = await agent.generate(prompt, {
    maxSteps: 12,
    toolChoice: 'required',
    memory: {
      thread: runId,
      resource: 'desktop-e2e',
    },
  });

  const toolEvents = (await readJsonl(toolLogPath)).filter(event => event.run_id === runId);
  const serverEvents = (await readJsonl(serverLogPath)).filter(event => event.run_id === runId);

  const assertions = [
    createAssertion('desktop server health endpoint returned ok', health.ok === true),
    createAssertion(
      'accessibility permission is enabled for the desktop server process',
      permissions.accessibility === true,
      permissions.accessibility ? undefined : 'Grant Accessibility access before rerunning the E2E test.',
    ),
    createAssertion(
      'agent finished without a recorded execution error',
      result.error === undefined,
      result.error?.message,
    ),
    createAssertion(
      'agent produced at least one tool call',
      result.toolCalls.length > 0,
      `Observed ${result.toolCalls.length} tool calls.`,
    ),
    createAssertion(
      'tool-side observability captured at least one event for this run',
      toolEvents.length > 0,
      `Observed ${toolEvents.length} tool events in ${toolLogPath}.`,
    ),
    createAssertion(
      'tool-side observability recorded at least one successful tool event',
      toolEvents.some(event => event.outcome === 'success'),
      `Observed outcomes: ${toolEvents.map(event => String(event.outcome)).join(', ') || 'none'}.`,
    ),
    createAssertion(
      'desktop server observability captured at least one event for this run',
      serverEvents.length > 0,
      `Observed ${serverEvents.length} server events in ${serverLogPath}.`,
    ),
    createAssertion(
      'agent returned the expected completion token',
      result.text.includes('E2E_OK'),
      result.text,
    ),
  ];

  const report = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    prompt,
    paths: {
      toolLogPath,
      serverLogPath,
      reportPath,
    },
    health,
    permissions,
    agent: {
      text: result.text,
      finishReason: result.finishReason,
      runId: result.runId,
      traceId: result.traceId,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
      error: result.error?.message,
    },
    observability: {
      toolEvents,
      serverEvents,
    },
    assertions,
  };

  await writeReport(report);

  const failedAssertions = assertions.filter(assertion => !assertion.ok);
  if (failedAssertions.length > 0) {
    console.error(`Desktop E2E failed. Report written to ${reportPath}`);
    for (const assertion of failedAssertions) {
      console.error(`- ${assertion.name}${assertion.details ? `: ${assertion.details}` : ''}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Desktop E2E passed. Report written to ${reportPath}`);
  console.log(`Tool events: ${toolEvents.length}`);
  console.log(`Server events: ${serverEvents.length}`);
};

main().catch(async error => {
  const message = error instanceof Error ? error.message : String(error);
  const report = {
    runId,
    prompt,
    paths: {
      toolLogPath,
      serverLogPath,
      reportPath,
    },
    error: message,
  };

  await writeReport(report);
  console.error(`Desktop E2E crashed. Report written to ${reportPath}`);
  console.error(message);
  process.exitCode = 1;
});
