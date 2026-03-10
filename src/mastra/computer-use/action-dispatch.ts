import { z } from 'zod';

import {
  type DesktopActionSuccess,
  DesktopActionClientError,
  desktopActionSuccessSchema,
  desktopSeeSuccessSchema,
} from '../tools/desktopActionClient';
import {
  openTool,
  seeTool,
  switchApplicationsTool,
  waitTool,
} from '../tools/guiActionTools';
import { computerUseControlToolId } from '../tools/computerUseWorkerTools';
import {
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

type RequestContextLike = Record<string, unknown> | undefined;

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

const isRecoverableWindowMissingError = (error: unknown) =>
  error instanceof DesktopActionClientError &&
  error.code === 'SERVER_UNAVAILABLE' &&
  /window not found|has no windows or dialogs/i.test(error.message);

const buildObservation = (
  result: z.infer<typeof desktopSeeSuccessSchema>,
  options?: {
    summaryPrefix?: string;
  },
): ComputerUseObservation => {
  const uiElements = result.ui_elements.slice(0, 20).map(element => ({
    id: element.id,
    role: element.role,
    label: compactText(element.label),
    title: compactText(element.title),
    actionable: element.is_actionable,
  }));

  const summaryLines = [
    ...(options?.summaryPrefix ? [options.summaryPrefix] : []),
    `Application: ${result.application_name ?? 'unknown'}`,
    `Window: ${result.window_title ?? 'unknown'}`,
    `Capture mode: ${result.capture_mode}`,
    `Elements: ${result.element_count} total, ${result.interactable_count} actionable`,
  ];

  if (uiElements.length > 0) {
    summaryLines.push(
      'Visible elements:',
      ...uiElements.map(element => {
        const text = element.label ?? element.title ?? 'no visible text';
        return `- ${element.id} [${element.role}] ${text}${element.actionable ? ' (actionable)' : ''}`;
      }),
    );
  }

  return {
    snapshotId: result.snapshot_id,
    screenshotRawPath: result.screenshot_raw,
    screenshotAnnotatedPath: result.screenshot_annotated,
    applicationName: compactText(result.application_name),
    windowTitle: compactText(result.window_title),
    captureMode: result.capture_mode,
    elementCount: result.element_count,
    interactableCount: result.interactable_count,
    summaryText: summaryLines.join('\n'),
    uiElements,
  };
};

const ensureAppWindow = async (app: string, requestContext?: RequestContextLike) => {
  const normalizedApp = normalizeAppCode(app);

  try {
    await invokeTool(
      switchApplicationsTool as unknown as ExecutableTool,
      { app_code: normalizedApp },
      requestContext,
    );
  } catch {
    // Switching alone is not sufficient for apps without open windows.
  }

  await invokeTool(
    openTool as unknown as ExecutableTool,
    { app_or_filename: normalizedApp },
    requestContext,
  );

  try {
    await invokeTool(waitTool as unknown as ExecutableTool, { time: 1 }, requestContext);
  } catch {
    // A failed wait should not block the follow-up observation attempt.
  }
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
  try {
    const result = await invokeTool<z.infer<typeof desktopSeeSuccessSchema>>(
      seeTool as unknown as ExecutableTool,
      {
        ...(params.app ? { app: params.app, mode: 'window' } : { mode: 'frontmost' }),
        annotate: false,
      },
      params.requestContext,
    );

    return buildObservation(result);
  } catch (error) {
    if (!params.app || !isRecoverableWindowMissingError(error)) {
      throw error;
    }

    await ensureAppWindow(params.app, params.requestContext);

    try {
      const reopenedResult = await invokeTool<z.infer<typeof desktopSeeSuccessSchema>>(
        seeTool as unknown as ExecutableTool,
        {
          app: normalizeAppCode(params.app),
          mode: 'window',
          annotate: false,
        },
        params.requestContext,
      );

      return buildObservation(reopenedResult, {
        summaryPrefix: `Requested app "${params.app}" had no open windows, so the workflow explicitly reopened or focused it before capturing this observation.`,
      });
    } catch (reopenError) {
      if (!isRecoverableWindowMissingError(reopenError)) {
        throw reopenError;
      }

      const fallbackResult = await invokeTool<z.infer<typeof desktopSeeSuccessSchema>>(
        seeTool as unknown as ExecutableTool,
        {
          mode: 'screen',
          annotate: false,
        },
        params.requestContext,
      );

      return buildObservation(fallbackResult, {
        summaryPrefix: `Requested app "${params.app}" is running but still has no open windows or dialogs after an explicit reopen attempt. This observation is a full-screen fallback so the next action can recover.`,
      });
    }
  }
};

export const extractComputerUseWorkerTurn = async ({
  result,
  currentTodo,
  currentScratchpad,
}: {
  result: GenerateLike;
  currentTodo: ComputerUseTodoItem[];
  currentScratchpad: string[];
}): Promise<ComputerUseWorkerTurn> => {
  const normalizedToolCalls = normalizeWorkerToolCalls(result.toolCalls);
  const resolvedToolResults = await Promise.resolve(result.toolResults);
  const normalizedToolResults = normalizeWorkerToolResults(resolvedToolResults);

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
