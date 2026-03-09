import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { readEnv, readEnvOrDefault } from '../env';

export type DesktopToolEvent = {
  timestamp: string;
  component: 'mastra-desktop-tool';
  run_id: string | null;
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

export const resolveDesktopToolLogPath = () =>
  path.resolve(process.cwd(), readEnvOrDefault('COMPUTER_GUIDE_DESKTOP_LOG_PATH', defaultDesktopToolLogPath));

export const getObservabilityRunId = () => readEnv('COMPUTER_GUIDE_OBSERVABILITY_RUN_ID') ?? null;

export const recordDesktopToolEvent = async (event: DesktopToolEvent) => {
  const logPath = resolveDesktopToolLogPath();

  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to write desktop tool observability event: ${message}`);
  }
};
