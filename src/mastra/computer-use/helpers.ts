import { readFile } from 'node:fs/promises';

import type {
  ComputerUseObservation,
  ComputerUseStepArtifact,
  ComputerUseTodoItem,
} from './schemas';
import { computerUseActionToolIds } from './schemas';

const toDataUrl = async (path: string) => {
  const data = await readFile(path);
  return `data:image/png;base64,${data.toString('base64')}`;
};

const formatRecentArtifacts = (artifacts: ComputerUseStepArtifact[]) =>
  artifacts
    .slice(-5)
    .map(artifact =>
      [
        `Step ${artifact.stepIndex}`,
        `Worker summary: ${artifact.workerTurn.control.summary}`,
        `Action: ${artifact.workerTurn.executedAction?.toolName ?? 'none'}`,
        `Execution: ${artifact.executionResult?.message ?? 'none'}`,
        `Verification: ${artifact.verification?.summary ?? 'none'}`,
      ].join('\n'),
    )
    .join('\n\n');

const formatTodo = (items: ComputerUseTodoItem[]) =>
  items.length === 0
    ? 'none'
    : items
        .map(item => `- [${item.status}] ${item.content}${item.note ? ` (${item.note})` : ''}`)
        .join('\n');

const availableActionHints = [
  'click: click a visible control or menu item',
  'switch_applications: bring a named app to the front',
  'open: open a URL, app, file, or folder directly',
  'type: focus a visible text field and enter text',
  'drag_and_drop: drag from one visible point to another',
  'scroll: scroll inside a visible region',
  'hotkey: send a keyboard shortcut',
  'hold_and_press: hold modifier keys while pressing others',
  'wait: pause briefly when the UI is already changing',
  'Use the provided workflow-owned observation as the source of truth for this turn; you cannot refresh it during the same turn.',
].join('\n');

const actionArgHints = [
  'click args: { "element_description": "visible label or control description", "app"?: "Google Chrome", "num_clicks"?: 1, "button_type"?: "left"|"right"|"middle", "hold_keys"?: [] }',
  'type args: { "element_description": "visible field description", "app"?: "Google Chrome", "text": "exact text", "overwrite"?: true|false, "enter"?: true|false }',
  'open args: { "url": "https://...", "application"?: "Google Chrome" } or { "app_or_filename": "Google Chrome" }',
  'switch_applications args: { "app_code": "Google Chrome" }',
  'scroll args: { "element_description": "visible region", "app"?: "Google Chrome", "clicks": -3, "shift"?: false }',
  'Never use snapshot_id, element_id, id, or element in GUI tool arguments.',
].join('\n');

const formatObservationContext = (observation: ComputerUseObservation) =>
  [
    observation.applicationName ? `Visible app: ${observation.applicationName}` : null,
    observation.windowTitle ? `Visible window: ${observation.windowTitle}` : null,
    `Capture mode: ${observation.captureMode}`,
  ]
    .filter(Boolean)
    .join('\n');

export const buildWorkerMessages = async ({
  task,
  app,
  stepIndex,
  observation,
  artifacts,
  taskTodo = [],
  scratchpad = [],
  recoveryHint,
  recoveryCount = 0,
}: {
  task: string;
  app?: string;
  stepIndex: number;
  observation: ComputerUseObservation;
  artifacts: ComputerUseStepArtifact[];
  taskTodo?: ComputerUseTodoItem[];
  scratchpad?: string[];
  recoveryHint?: string;
  recoveryCount?: number;
}) => [
  {
    role: 'user',
    content: [
      {
        type: 'image',
        image: await toDataUrl(observation.screenshotRawPath),
        mimeType: 'image/png',
      },
      {
        type: 'text',
        text: [
          `Task: ${task}`,
          `Preferred app: ${app ?? observation.applicationName ?? 'unknown'}`,
          `Current step: ${stepIndex}`,
          `Available GUI tools: ${computerUseActionToolIds.join(', ')}`,
          `Turn contract: use the desktop tools directly when action is needed. The provided workflow-owned observation remains authoritative for the entire turn, and you cannot refresh it mid-turn. Before you finish the turn, call computer_use_control exactly once with status, summary, todoItems, scratchpad, and an optional handoff. After that tool call, return one short plain-language update for the user.`,
          `Tool guidance:\n${availableActionHints}`,
          `Argument guidance:\n${actionArgHints}`,
          `Task todo:\n${formatTodo(taskTodo)}`,
          `Scratchpad:\n${scratchpad.length > 0 ? scratchpad.map(item => `- ${item}`).join('\n') : 'none'}`,
          `Recovery context: ${recoveryHint ? `${recoveryHint} (attempt ${recoveryCount})` : 'none'}`,
          formatObservationContext(observation),
          artifacts.length > 0 ? `Recent history:\n${formatRecentArtifacts(artifacts)}` : 'Recent history: none yet.',
        ].join('\n\n'),
      },
    ],
  },
];

export const buildVerifierMessages = async ({
  task,
  artifact,
  taskTodo = [],
  scratchpad = [],
}: {
  task: string;
  artifact: ComputerUseStepArtifact;
  taskTodo?: ComputerUseTodoItem[];
  scratchpad?: string[];
}) => [
  {
    role: 'user',
    content: [
      {
        type: 'image',
        image: await toDataUrl(artifact.beforeObservation.screenshotRawPath),
        mimeType: 'image/png',
      },
      {
        type: 'image',
        image: await toDataUrl(artifact.afterObservation.screenshotRawPath),
        mimeType: 'image/png',
      },
      {
        type: 'text',
        text: [
          `Task: ${task}`,
          `Worker summary: ${artifact.workerTurn.control.summary}`,
          `Worker text: ${artifact.workerTurn.text || 'none'}`,
          `Executed tool: ${artifact.workerTurn.executedAction?.toolName ?? 'none'}`,
          `Task todo:\n${formatTodo(taskTodo)}`,
          `Scratchpad:\n${scratchpad.length > 0 ? scratchpad.map(item => `- ${item}`).join('\n') : 'none'}`,
          `Before observation:\n${formatObservationContext(artifact.beforeObservation)}`,
          `After observation:\n${formatObservationContext(artifact.afterObservation)}`,
          `Execution message: ${artifact.executionResult?.message ?? 'none'}`,
        ].join('\n\n'),
      },
    ],
  },
];
