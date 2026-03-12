import type { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';

import {
  withDesktopToolEventOrigin,
} from '../tools/desktopObservability';
import {
  captureDesktopObservation,
  type DesktopActionSuccess,
  type DesktopWorkflowObservationRequest,
  desktopActionSuccessSchema,
  desktopWorkflowObservationSchema,
} from '../tools/desktopActionClient';
import { computerUseControlToolId } from '../tools/computerUseWorkerTools';
import {
  type ComputerUseWorkerArtifacts,
  type ComputerUseExecutedAction,
  type ComputerUseExecutionResult,
  type ComputerUseObservation,
  type ComputerUseTodoItem,
  type ComputerUseWorkerControl,
  type ComputerUseWorkerToolCall,
  type ComputerUseWorkerToolResult,
  type ComputerUseWorkerTurn,
  computerUseActionToolIds,
  computerUseExecutedActionSchema,
  computerUseExecutionResultSchema,
  computerUseGroundingArtifactSchema,
  computerUseWorkerControlSchema,
  computerUseWorkerToolCallSchema,
  computerUseWorkerToolResultSchema,
} from './schemas';
import {
  createWorkerTurnRequestContext,
  readTrackedWorkerTurn,
} from './worker-turn-tracker';

type RequestContextLike =
  | RequestContext<Record<string, unknown>>
  | Record<string, unknown>
  | undefined;

type ExecutableTool = {
  execute?: (inputData: unknown, context?: { requestContext?: RequestContextLike }) => Promise<unknown>;
};

type GenerateLike = {
  text?: string;
  toolCalls?: unknown;
  toolResults?: unknown;
};

const actionToolIdSet = new Set<string>(computerUseActionToolIds);

const invokeTool = async <T>(
  tool: ExecutableTool,
  inputData: unknown,
  requestContext?: RequestContextLike,
) => {
  if (!tool.execute) {
    throw new Error('Tool is missing an execute function.');
  }

  return (await tool.execute(inputData, { requestContext })) as T;
};

const compactText = (value: string | null | undefined) => value?.trim() || undefined;

const normalizeAppCode = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (/com\.google\.chrome/i.test(trimmed)) {
    return 'Google Chrome';
  }

  if (/^chrome$/i.test(trimmed)) {
    return 'Google Chrome';
  }

  return trimmed;
};

const buildObservation = (
  result: z.infer<typeof desktopWorkflowObservationSchema>,
): ComputerUseObservation => {
  const captureSpace = result.observation_capture;

  return {
    screenshotRawPath: result.screenshot_raw,
    applicationName: compactText(result.application_name),
    windowTitle: compactText(result.window_title),
    captureMode: result.capture_mode,
    captureSpace:
      captureSpace
        ? {
            displayId: captureSpace.display_id,
            displayIndex: captureSpace.display_index,
            bounds: captureSpace.capture_bounds,
            imageWidth: captureSpace.image_size.width,
            imageHeight: captureSpace.image_size.height,
          }
        : undefined,
  };
};

const normalizeWorkerToolCalls = (toolCalls: unknown): ComputerUseWorkerToolCall[] =>
  Array.isArray(toolCalls)
    ? toolCalls.flatMap(toolCall => {
        const parsed = computerUseWorkerToolCallSchema.safeParse(toolCall);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

const normalizeWorkerToolResults = (toolResults: unknown): ComputerUseWorkerToolResult[] =>
  Array.isArray(toolResults)
    ? toolResults.flatMap(toolResult => {
        const parsed = computerUseWorkerToolResultSchema.safeParse(toolResult);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

const buildFallbackControl = ({
  text,
  currentTodo,
  currentScratchpad,
}: {
  text?: string;
  currentTodo: ComputerUseTodoItem[];
  currentScratchpad: string[];
}): ComputerUseWorkerControl => ({
  status: 'continue',
  summary:
    text?.trim() || 'The worker completed the turn without reporting explicit workflow control.',
  userMessage: text?.trim() || undefined,
  todoItems: currentTodo,
  scratchpad: currentScratchpad,
  handoff: null,
});

const buildExecutionResult = (
  toolResult: ComputerUseWorkerToolResult,
  rawResult: DesktopActionSuccess,
): ComputerUseExecutionResult => {
  const parsedExecution = computerUseExecutionResultSchema.safeParse({
    actionId: rawResult.action_id,
    message: rawResult.message,
    durationMs: rawResult.duration_ms,
    artifact: rawResult.artifact,
    raw: rawResult as unknown as Record<string, unknown>,
  });

  if (!parsedExecution.success) {
    throw parsedExecution.error;
  }

  return parsedExecution.data;
};

const deriveExecutedAction = (
  toolResults: ComputerUseWorkerToolResult[],
): ComputerUseExecutedAction | null => {
  for (const toolResult of [...toolResults].reverse()) {
    if (!actionToolIdSet.has(toolResult.toolName)) {
      continue;
    }

    const parsedResult = desktopActionSuccessSchema.safeParse(toolResult.result);
    if (!parsedResult.success) {
      continue;
    }

    const executionResult = buildExecutionResult(toolResult, parsedResult.data);
    const grounding = parsedResult.data.resolved_target
      ? computerUseGroundingArtifactSchema.parse({
          description: parsedResult.data.resolved_target.description,
          application: parsedResult.data.resolved_target.application,
          window: parsedResult.data.resolved_target.window,
          bounds: parsedResult.data.resolved_target.bounds,
        })
      : null;

    return computerUseExecutedActionSchema.parse({
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      toolArgs: toolResult.args,
      executionResult,
      grounding,
    });
  }

  return null;
};

export const captureObservation = async (
  params: {
    app?: string;
    requestContext?: RequestContextLike;
  } = {},
): Promise<ComputerUseObservation> => {
  const normalizedApp = params.app ? normalizeAppCode(params.app) : undefined;
  const request: DesktopWorkflowObservationRequest = {
    mode: 'screen',
    annotate: false,
    ...(normalizedApp ? { app: normalizedApp } : {}),
  };
  const result = await withDesktopToolEventOrigin('workflow-observation', async () =>
    captureDesktopObservation(request),
  );

  return buildObservation(result);
};

export const extractComputerUseWorkerTurn = async ({
  result,
  currentTodo,
  currentScratchpad,
  trackedTurn,
}: {
  result: GenerateLike;
  currentTodo: ComputerUseTodoItem[];
  currentScratchpad: string[];
  trackedTurn?: {
    toolCalls: ComputerUseWorkerToolCall[];
    toolResults: ComputerUseWorkerToolResult[];
  } | null;
}): Promise<ComputerUseWorkerTurn> => {
  const normalizedToolCalls = trackedTurn?.toolCalls ?? normalizeWorkerToolCalls(result.toolCalls);
  const normalizedToolResults =
    trackedTurn?.toolResults ??
    normalizeWorkerToolResults(await Promise.resolve(result.toolResults));

  const controlToolResult = [...normalizedToolResults]
    .reverse()
    .find(toolResult => toolResult.toolName === computerUseControlToolId);
  const parsedControl =
    controlToolResult && computerUseWorkerControlSchema.safeParse(controlToolResult.result).success
      ? computerUseWorkerControlSchema.parse(controlToolResult.result)
      : buildFallbackControl({
          text: result.text,
          currentTodo,
          currentScratchpad,
        });
  const executedAction = deriveExecutedAction(normalizedToolResults);

  return {
    text: result.text?.trim() ?? '',
    control: parsedControl,
    toolCalls: normalizedToolCalls,
    toolResults: normalizedToolResults,
    executedAction,
  };
};

export const buildWorkerArtifacts = (
  workerTurn: ComputerUseWorkerTurn,
): ComputerUseWorkerArtifacts => ({
  text: workerTurn.text,
  control: workerTurn.control,
  toolCalls: workerTurn.toolCalls,
  toolResults: workerTurn.toolResults,
  executedAction: workerTurn.executedAction,
  executionResult: workerTurn.executedAction?.executionResult ?? null,
  grounding: workerTurn.executedAction?.grounding ?? null,
});

export const createWorkerRequestContext = (
  requestContext: RequestContextLike,
  observation: ComputerUseObservation,
) => createWorkerTurnRequestContext(requestContext, observation);

export const readWorkerTurnTracking = (requestContext: RequestContextLike) =>
  readTrackedWorkerTurn(requestContext);

export const deriveTargetAppFromWorkerTurn = (
  workerTurn: ComputerUseWorkerTurn | null,
  fallbackApp?: string,
): string | undefined => {
  if (!workerTurn) {
    return fallbackApp;
  }

  if (workerTurn.control.targetApp) {
    return normalizeAppCode(workerTurn.control.targetApp);
  }

  const toolArgs = workerTurn.executedAction?.toolArgs;
  if (!toolArgs) {
    return fallbackApp;
  }

  const candidate =
    (typeof toolArgs.app === 'string' && toolArgs.app) ||
    (typeof toolArgs.application === 'string' && toolArgs.application) ||
    (typeof toolArgs.app_code === 'string' && toolArgs.app_code) ||
    (typeof toolArgs.app_or_filename === 'string' && toolArgs.app_or_filename) ||
    fallbackApp;

  return typeof candidate === 'string' ? normalizeAppCode(candidate) : fallbackApp;
};
