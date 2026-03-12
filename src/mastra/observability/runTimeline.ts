import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type RunTimelineEvent = {
  timestamp: string;
  type:
    | 'run'
    | 'human-input'
    | 'model-output'
    | 'desktop-tool'
    | 'workflow-turn'
    | 'note';
  title: string;
  outcome?: 'info' | 'success' | 'error';
  summary?: string;
  details?: unknown;
  images?: string[];
};

type RunTimelineStore = {
  runId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  events: RunTimelineEvent[];
};

type InitializeRunTimelineOptions = {
  title?: string;
  metadata?: Record<string, unknown>;
};

type AppendRunTimelineEventInput = Omit<RunTimelineEvent, 'timestamp'> & {
  timestamp?: string;
};

type StructuredRunTimelineEventInput = {
  runId: string;
  event: {
    type: string;
    timestamp?: string;
    payload?: Record<string, unknown>;
  };
};

const runTimelineStorage = new AsyncLocalStorage<string>();
const runTimelineDirectory = path.resolve(process.cwd(), '.logs', 'computer-use-runs');
const writeQueues = new Map<string, Promise<void>>();

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatJson = (value: unknown) => escapeHtml(JSON.stringify(value, null, 2));

const dedupe = <T>(values: T[]) => [...new Set(values)];

const resolveRunJsonPath = (runId: string) => path.join(runTimelineDirectory, `${runId}.json`);
const resolveRunHtmlPath = (runId: string) => path.join(runTimelineDirectory, `${runId}.html`);

const resolveImagePath = (imagePath: string) =>
  path.isAbsolute(imagePath) ? imagePath : path.resolve(process.cwd(), imagePath);

const extToMimeType = (filePath: string) => {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return null;
  }
};

const maybeStat = async (filePath: string) => {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
};

const imageToDataUrl = async (imagePath: string) => {
  const resolvedPath = resolveImagePath(imagePath);
  const fileStats = await maybeStat(resolvedPath);
  const mimeType = extToMimeType(resolvedPath);
  if (!fileStats || !fileStats.isFile() || !mimeType) {
    return null;
  }

  const bytes = await readFile(resolvedPath);
  return {
    label: imagePath,
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
  };
};

const createRunTimelineStore = (
  runId: string,
  options?: InitializeRunTimelineOptions,
): RunTimelineStore => {
  const now = new Date().toISOString();

  return {
    runId,
    title: options?.title ?? `Computer Use Run ${runId}`,
    createdAt: now,
    updatedAt: now,
    metadata: options?.metadata ?? {},
    events: [],
  };
};

const normalizeEventType = (value: string): RunTimelineEvent['type'] => {
  switch (value) {
    case 'assistant-output':
      return 'model-output';
    case 'human-input':
    case 'model-output':
    case 'desktop-tool':
    case 'workflow-turn':
    case 'run':
    case 'note':
      return value;
    default:
      return 'note';
  }
};

const summarizeStructuredPayload = (
  type: RunTimelineEvent['type'],
  payload: Record<string, unknown>,
) => {
  switch (type) {
    case 'human-input':
    case 'model-output':
      return typeof payload.text === 'string' ? payload.text : undefined;
    case 'workflow-turn': {
      const workerTurn =
        typeof payload.workerTurn === 'object' && payload.workerTurn !== null
          ? (payload.workerTurn as { toolCalls?: unknown[] })
          : null;
      return Array.isArray(workerTurn?.toolCalls) &&
        workerTurn.toolCalls.length === 0
        ? `Workflow step ${String(payload.stepIndex ?? '?')} captured the current state without any worker-issued desktop tool calls.`
        : typeof payload.request === 'string'
          ? `Workflow step ${String(payload.stepIndex ?? '?')} ran one observe/act/verify cycle for: ${payload.request}`
          : undefined;
    }
    case 'desktop-tool':
      return typeof payload.path === 'string'
        ? `${String(payload.path)} completed`
        : undefined;
    case 'run':
      return typeof payload.phase === 'string' ? `Workflow ${payload.phase}` : undefined;
    default:
      return undefined;
  }
};

const titleForStructuredEvent = (
  type: RunTimelineEvent['type'],
  payload: Record<string, unknown>,
) => {
  switch (type) {
    case 'human-input':
      return 'Human input';
    case 'model-output':
      return 'Model output';
    case 'workflow-turn':
      return `Workflow step ${String(payload.stepIndex ?? '?')}`;
    case 'desktop-tool':
      return typeof payload.toolId === 'string'
        ? `${payload.toolId} event`
        : 'Desktop tool event';
    case 'run':
      return typeof payload.phase === 'string'
        ? `Workflow ${payload.phase}`
        : 'Workflow event';
    default:
      return 'Timeline event';
  }
};

const coerceStructuredEvent = ({
  runId,
  event,
}: StructuredRunTimelineEventInput): [string, AppendRunTimelineEventInput] => {
  const type = normalizeEventType(event.type);
  const payload = event.payload ?? {};

  return [
    runId,
    {
      timestamp: event.timestamp,
      type,
      title: titleForStructuredEvent(type, payload),
      summary: summarizeStructuredPayload(type, payload),
      details: payload,
      images: collectImagePaths(payload),
    },
  ];
};

const readRunTimelineStore = async (runId: string): Promise<RunTimelineStore | null> => {
  try {
    const serialized = await readFile(resolveRunJsonPath(runId), 'utf8');
    return JSON.parse(serialized) as RunTimelineStore;
  } catch {
    return null;
  }
};

const enqueueRunWrite = async (runId: string, work: () => Promise<void>) => {
  const previous = writeQueues.get(runId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  writeQueues.set(runId, next);
  await next.finally(() => {
    if (writeQueues.get(runId) === next) {
      writeQueues.delete(runId);
    }
  });
};

const renderImages = async (imagePaths: string[]) => {
  if (imagePaths.length === 0) {
    return '';
  }

  const encoded = await Promise.all(imagePaths.map(imageToDataUrl));
  const cards = encoded.map((image, index) =>
    image
      ? `
        <figure class="image-card">
          <img src="${image.dataUrl}" alt="${escapeHtml(image.label)}" loading="lazy" />
          <figcaption class="image-label">${escapeHtml(image.label)}</figcaption>
        </figure>
      `
      : `
        <div class="image-card missing">
          <div class="image-label">${escapeHtml(imagePaths[index])}</div>
          <div class="image-missing">Image unavailable</div>
        </div>
      `,
  );

  return `<section class="images">${cards.join('')}</section>`;
};

const renderEvent = async (event: RunTimelineEvent, index: number) => {
  const summary = event.summary ? `<p class="summary">${escapeHtml(event.summary)}</p>` : '';
  const details =
    event.details === undefined
      ? ''
      : `<details class="payload"><summary>Details</summary><pre>${formatJson(event.details)}</pre></details>`;
  const images = await renderImages(event.images ?? []);

  return `
    <article class="event outcome-${event.outcome ?? 'info'}">
      <header class="event-header">
        <div>
          <div class="event-index">#${index + 1}</div>
          <h2>${escapeHtml(event.title)}</h2>
        </div>
        <div class="event-meta">
          <span class="event-type">${escapeHtml(event.type)}</span>
          <time datetime="${escapeHtml(event.timestamp)}">${escapeHtml(event.timestamp)}</time>
        </div>
      </header>
      ${summary}
      ${details}
      ${images}
    </article>
  `;
};

const renderRunTimelineHtml = async (store: RunTimelineStore) => {
  const events = await Promise.all(store.events.map((event, index) => renderEvent(event, index)));

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(store.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1ea;
        --panel: #fffdf8;
        --panel-border: #d8cfbf;
        --ink: #1f1c17;
        --muted: #6f6558;
        --accent: #9a5f2d;
        --success: #2d6a4f;
        --error: #9b2226;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px 20px 48px;
        background:
          radial-gradient(circle at top left, rgba(154, 95, 45, 0.12), transparent 36%),
          linear-gradient(180deg, #f7f3eb 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      }
      main { max-width: 1080px; margin: 0 auto; }
      .hero, .event {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 18px;
        box-shadow: 0 12px 30px rgba(47, 36, 25, 0.08);
      }
      .hero { padding: 24px 28px; margin-bottom: 24px; }
      h1, h2 {
        margin: 0;
        font-family: "Avenir Next", "Helvetica Neue", Arial, sans-serif;
        letter-spacing: -0.02em;
      }
      h1 { font-size: 2rem; margin-bottom: 8px; }
      .hero-meta {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 0.95rem;
      }
      .timeline { display: grid; gap: 18px; }
      .event { padding: 22px 24px; }
      .event-header {
        display: flex;
        gap: 16px;
        justify-content: space-between;
        align-items: flex-start;
      }
      .event-index, .event-type, .event-meta time {
        font-family: "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
        font-size: 0.82rem;
      }
      .event-index { color: var(--accent); margin-bottom: 6px; }
      .event-meta { display: grid; justify-items: end; gap: 6px; color: var(--muted); }
      .event-type { text-transform: uppercase; letter-spacing: 0.08em; }
      .summary { margin: 14px 0 0; line-height: 1.5; }
      .payload { margin-top: 16px; }
      .payload summary {
        cursor: pointer;
        color: var(--accent);
        font-family: "Avenir Next", "Helvetica Neue", Arial, sans-serif;
        font-weight: 600;
      }
      pre {
        margin: 12px 0 0;
        padding: 14px;
        background: #f8f4ec;
        border: 1px solid #e6dccb;
        border-radius: 12px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
        font-size: 0.88rem;
        line-height: 1.45;
      }
      .images { margin-top: 18px; display: grid; gap: 14px; }
      .image-card {
        margin: 0;
        padding: 12px;
        border: 1px solid #e0d7c8;
        border-radius: 14px;
        background: #faf6ef;
      }
      .image-card img {
        display: block;
        width: 100%;
        border-radius: 10px;
        border: 1px solid #ded4c4;
      }
      .image-label, .image-missing {
        margin-top: 10px;
        color: var(--muted);
        font-family: "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
        font-size: 0.8rem;
        word-break: break-all;
      }
      .image-missing { color: var(--error); }
      .outcome-success { border-left: 6px solid var(--success); }
      .outcome-error { border-left: 6px solid var(--error); }
      .outcome-info { border-left: 6px solid var(--accent); }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>${escapeHtml(store.title)}</h1>
        <div class="hero-meta">
          <div>Run ID: ${escapeHtml(store.runId)}</div>
          <div>Created: ${escapeHtml(store.createdAt)}</div>
          <div>Updated: ${escapeHtml(store.updatedAt)}</div>
          <div>Events: ${store.events.length}</div>
        </div>
        <details class="payload">
          <summary>Run metadata</summary>
          <pre>${formatJson(store.metadata)}</pre>
        </details>
      </section>
      <section class="timeline">
        ${events.join('')}
      </section>
    </main>
  </body>
</html>`;
};

const persistRunTimelineStore = async (store: RunTimelineStore) => {
  await mkdir(runTimelineDirectory, { recursive: true });
  const html = await renderRunTimelineHtml(store);
  await writeFile(resolveRunJsonPath(store.runId), `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await writeFile(resolveRunHtmlPath(store.runId), html, 'utf8');
};

export const withObservabilityRun = async <T>(runId: string, callback: () => Promise<T>) =>
  runTimelineStorage.run(runId, callback);

export const getCurrentObservabilityRunId = () => runTimelineStorage.getStore() ?? null;

export const initializeRunTimeline = async (
  runId: string,
  options?: InitializeRunTimelineOptions,
) => {
  await enqueueRunWrite(runId, async () => {
    const existing = await readRunTimelineStore(runId);
    const store = existing
      ? {
          ...existing,
          title: options?.title ?? existing.title,
          metadata: {
            ...existing.metadata,
            ...(options?.metadata ?? {}),
          },
          updatedAt: new Date().toISOString(),
        }
      : createRunTimelineStore(runId, options);
    await persistRunTimelineStore(store);
  });
};

export const appendRunTimelineEvent = async (
  runIdOrInput: string | StructuredRunTimelineEventInput,
  maybeEvent?: AppendRunTimelineEventInput,
) => {
  const [runId, event] =
    typeof runIdOrInput === 'string'
      ? [runIdOrInput, maybeEvent]
      : coerceStructuredEvent(runIdOrInput);

  if (!event) {
    throw new Error('appendRunTimelineEvent requires an event payload.');
  }

  await enqueueRunWrite(runId, async () => {
    const store = (await readRunTimelineStore(runId)) ?? createRunTimelineStore(runId);
    store.events.push({
      timestamp: event.timestamp ?? new Date().toISOString(),
      type: event.type,
      title: event.title,
      outcome: event.outcome,
      summary: event.summary,
      details: event.details,
      images: dedupe(
        (event.images ?? collectImagePaths(event.details)).map(resolveImagePath),
      ),
    });
    store.updatedAt = new Date().toISOString();
    await persistRunTimelineStore(store);
  });
};

export const recordRunTimelineEvent = async (input: StructuredRunTimelineEventInput) =>
  appendRunTimelineEvent(input);

export const collectImagePaths = (value: unknown, accumulator: string[] = []): string[] => {
  if (!value || typeof value !== 'object') {
    return accumulator;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectImagePaths(item, accumulator);
    }
    return dedupe(accumulator);
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (
      typeof nestedValue === 'string' &&
      /(screenshot|image|capture).*(path|raw|annotated)|^(path|screenshot_path|screenshot_raw|screenshot_annotated)$/i.test(
        key,
      )
    ) {
      accumulator.push(nestedValue);
      continue;
    }

    collectImagePaths(nestedValue, accumulator);
  }

  return dedupe(accumulator);
};
