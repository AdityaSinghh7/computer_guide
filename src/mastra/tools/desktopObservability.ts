import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { readEnv, readEnvOrDefault } from '../env';
import {
  appendRunTimelineEvent,
  collectImagePaths,
  getCurrentObservabilityRunId,
} from '../observability/runTimeline';

export type DesktopToolEvent = {
  timestamp: string;
  component: 'mastra-desktop-tool';
  run_id: string | null;
  origin: 'worker-tool' | 'workflow-observation' | 'workflow-recovery';
  tool_id: string;
  path: string;
  server_url: string;
  payload: unknown;
  outcome: 'success' | 'error';
  duration_ms: number;
  action_id?: string;
  response?: unknown;
  error?: {
    name: string;
    message: string;
    code?: string;
    status?: number;
    candidates?: string[];
  };
};

const defaultDesktopToolLogPath = path.join('.logs', 'desktop-tool-events.jsonl');
const desktopToolOriginStorage = new AsyncLocalStorage<DesktopToolEvent['origin']>();

export const resolveDesktopToolLogPath = () =>
  path.resolve(process.cwd(), readEnvOrDefault('COMPUTER_GUIDE_DESKTOP_LOG_PATH', defaultDesktopToolLogPath));

export const getObservabilityRunId = () =>
  getCurrentObservabilityRunId() ?? readEnv('COMPUTER_GUIDE_OBSERVABILITY_RUN_ID') ?? null;

export const withDesktopToolEventOrigin = async <T>(
  origin: DesktopToolEvent['origin'],
  callback: () => Promise<T>,
) => desktopToolOriginStorage.run(origin, callback);

export const getDesktopToolEventOrigin = () =>
  desktopToolOriginStorage.getStore() ?? 'worker-tool';

const describeDesktopToolEvent = (event: DesktopToolEvent) => {
  switch (event.origin) {
    case 'workflow-observation':
      return {
        title: `Workflow observation via ${event.tool_id}`,
        summary: `${event.path} captured workflow-owned state in ${event.duration_ms}ms.`,
      };
    case 'workflow-recovery':
      return {
        title: `Workflow recovery via ${event.tool_id}`,
        summary: `${event.path} ran during workflow recovery in ${event.duration_ms}ms.`,
      };
    default:
      return {
        title: `Worker tool ${event.tool_id}`,
        summary: `${event.path} ran as a worker-issued desktop tool in ${event.duration_ms}ms.`,
      };
  }
};

export const recordDesktopToolEvent = async (event: DesktopToolEvent) => {
  const logPath = resolveDesktopToolLogPath();

  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf8');

    if (event.run_id) {
      const description = describeDesktopToolEvent(event);
      await appendRunTimelineEvent(event.run_id, {
        type: 'desktop-tool',
        title: description.title,
        outcome: event.outcome === 'success' ? 'success' : 'error',
        summary: description.summary,
        details: {
          origin: event.origin,
          toolId: event.tool_id,
          path: event.path,
          serverUrl: event.server_url,
          payload: event.payload,
          response: event.response,
          error: event.error,
          durationMs: event.duration_ms,
          actionId: event.action_id,
        },
        images: collectImagePaths({
          payload: event.payload,
          response: event.response,
        }),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to write desktop tool observability event: ${message}`);
  }
};
