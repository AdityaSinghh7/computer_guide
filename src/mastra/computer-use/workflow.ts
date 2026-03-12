import type { RequestContext } from '@mastra/core/request-context';
import { createStep, createWorkflow } from '@mastra/core/workflows';

import { computerUseVerifierAgent } from '../agents/computer-use-verifier-agent';
import { computerUseWorkerAgent } from '../agents/computer-use-worker-agent';
import {
  buildWorkerArtifacts,
  captureObservation,
  createWorkerRequestContext,
  deriveTargetAppFromWorkerTurn,
  extractComputerUseWorkerTurn,
  readWorkerTurnTracking,
} from './action-dispatch';
import { buildVerifierMessages, buildWorkerMessages } from './helpers';
import {
  type ComputerUseControl,
  type ComputerUseHandoff,
  type ComputerUseObservation,
  type ComputerUseResumePayload,
  type ComputerUseStepArtifact,
  type ComputerUseTodoItem,
  type ComputerUseVerification,
  type ComputerUseWorkerControl,
  type ComputerUseWorkerTurn,
  type ComputerUseWorkflowState,
  computerUseControlSchema,
  computerUseHandoffSchema,
  computerUseRequestSchema,
  computerUseResumePayloadSchema,
  computerUseTurnContextSchema,
  computerUseVerificationSchema,
  computerUseWorkflowOutputSchema,
  computerUseWorkflowStateSchema,
  createInitialComputerUseState,
} from './schemas';

type RequestContextLike =
  | RequestContext<Record<string, unknown>>
  | Record<string, unknown>
  | undefined;

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

const toRequestContext = (value: unknown): RequestContextLike =>
  value as Record<string, unknown> | undefined;

const MAX_SCRATCHPAD_LINES = 8;
const runTimelineModulePath = '../observability/runTimeline';

const loadRunTimelineModule = async (): Promise<RunTimelineModule | null> => {
  try {
    return (await import(runTimelineModulePath)) as RunTimelineModule;
  } catch {
    return null;
  }
};

const appendRunTimelineEvent = async (
  runId: string | undefined,
  type: string,
  payload: RunTimelineEventPayload,
) => {
  if (!runId?.trim()) {
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
    // Observability is best-effort and should never block workflow execution.
  }
};

const defaultVerification = (): ComputerUseVerification => ({
  verdict: 'uncertain',
  summary: 'No verification result was returned.',
  shouldContinue: true,
  recoveryAction: 'continue',
});

const normalizeTodoItems = (items: ComputerUseTodoItem[]) => {
  const trimmed = items.slice(0, 8);
  let inProgressSeen = false;
  return trimmed.map(item => {
    if (item.status !== 'in_progress') {
      return item;
    }

    if (!inProgressSeen) {
      inProgressSeen = true;
      return item;
    }

    return {
      ...item,
      status: 'pending' as const,
    };
  });
};

const normalizeScratchpad = (lines: string[]) =>
  lines
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-MAX_SCRATCHPAD_LINES);

const resolveTaskTodo = (control: ComputerUseWorkerControl, current: ComputerUseTodoItem[]) =>
  normalizeTodoItems(control.todoItems.length > 0 ? control.todoItems : current);

const resolveScratchpad = (control: ComputerUseWorkerControl, current: string[]) =>
  normalizeScratchpad(control.scratchpad.length > 0 ? control.scratchpad : current);

const buildFallbackHandoff = ({
  workerTurn,
  verification,
  observationSummary,
}: {
  workerTurn: ComputerUseWorkerTurn;
  verification: ComputerUseVerification | null;
  observationSummary?: string;
}): ComputerUseHandoff => ({
  summary:
    verification?.summary ??
    workerTurn.control.userMessage ??
    workerTurn.control.summary ??
    'The workflow needs user input before it can continue.',
  reason:
    verification?.recoveryReason ??
    verification?.summary ??
    workerTurn.control.summary ??
    'The workflow needs clarification or a manual step.',
  userAction:
    verification?.nextHint ??
    'Tell the assistant what changed, or provide the missing information needed to continue.',
  question:
    verification?.handoff?.question ??
    workerTurn.control.handoff?.question ??
    `What should I do next?${observationSummary ? ` Current view: ${observationSummary}` : ''}`,
});

const summarizeObservationForHandoff = (observation: ComputerUseObservation) =>
  [
    observation.applicationName ?? null,
    observation.windowTitle ?? null,
    observation.captureMode,
  ]
    .filter(Boolean)
    .join(' / ');

const recordWorkflowTurnArtifact = async ({
  runId,
  request,
  app,
  artifact,
  workflowStatus,
  recoveryCount,
  recoveryHint,
  handoff,
}: {
  runId: string | undefined;
  request: string;
  app?: string;
  artifact: ComputerUseStepArtifact;
  workflowStatus: ComputerUseWorkflowState['status'];
  recoveryCount: number;
  recoveryHint?: string;
  handoff?: ComputerUseHandoff | null;
}) =>
  appendRunTimelineEvent(runId, 'workflow-turn', {
    request,
    app: app ?? null,
    stepIndex: artifact.stepIndex,
    workflowStatus,
    recoveryCount,
    recoveryHint: recoveryHint ?? null,
    terminationSignal: artifact.terminationSignal,
    taskTodo: artifact.taskTodo,
    scratchpad: artifact.scratchpad,
    handoff: handoff ?? null,
    beforeObservation: artifact.beforeObservation,
    latestWorkerObservation: artifact.latestWorkerObservation,
    afterObservation: artifact.afterObservation,
    executionResult: artifact.executionResult,
    grounding: artifact.grounding,
    verification: artifact.verification,
    workerTurn: {
      text: artifact.workerTurn.text,
      control: artifact.workerTurn.control,
      toolCalls: artifact.workerTurn.toolCalls,
      toolResults: artifact.workerTurn.toolResults,
      executedAction: artifact.workerTurn.executedAction,
    },
  });

const withClearedPendingState = (state: ComputerUseWorkflowState): ComputerUseWorkflowState => ({
  ...state,
  pendingBeforeObservation: null,
  pendingLatestWorkerObservation: null,
  pendingWorkerArtifacts: null,
  pendingWorkerTurn: null,
  pendingGrounding: null,
  pendingExecutionResult: null,
  pendingAfterObservation: null,
  pendingVerification: null,
});

const bootstrapStep = createStep({
  id: 'computer-use-bootstrap',
  description: 'Initialize the workflow state before the first explicit turn.',
  inputSchema: computerUseRequestSchema,
  outputSchema: computerUseControlSchema,
  stateSchema: computerUseWorkflowStateSchema,
  execute: async ({ inputData, runId, setState }) => {
    await setState({
      ...createInitialComputerUseState(inputData.maxIterations),
      workflowRunId: runId,
      maxRecoveryAttempts: inputData.maxRecoveryAttempts,
    });

    return {
      request: inputData.request,
      app: inputData.app,
      maxIterations: inputData.maxIterations,
      maxRecoveryAttempts: inputData.maxRecoveryAttempts,
      continueLoop: true,
    };
  },
});

const prepareTurnStep = createStep({
  id: 'computer-use-prepare-turn',
  description: 'Capture the live desktop state for the next explicit turn.',
  inputSchema: computerUseControlSchema,
  outputSchema: computerUseTurnContextSchema,
  stateSchema: computerUseWorkflowStateSchema,
  execute: async ({ inputData, requestContext, state, setState }) => {
    const beforeObservation = await captureObservation({
      app: inputData.app ?? state.currentObservation?.applicationName,
      requestContext: toRequestContext(requestContext),
    });

    await setState({
      ...withClearedPendingState(state),
      currentObservation: beforeObservation,
      pendingHandoff: null,
      pendingBeforeObservation: beforeObservation,
      pendingLatestWorkerObservation: beforeObservation,
    });

    return {
      request: inputData.request,
      app: inputData.app,
      maxIterations: inputData.maxIterations,
      maxRecoveryAttempts: inputData.maxRecoveryAttempts,
      stepIndex: state.stepIndex + 1,
      beforeObservation,
      workerTurn: null,
      grounding: null,
      executionResult: null,
      afterObservation: null,
      verification: null,
      taskTodo: state.taskTodo,
      scratchpad: state.scratchpad,
      recoveryCount: state.recoveryCount,
      recoveryHint: state.recoveryHint,
      resumeContext: state.resumeContext,
    };
  },
});

const workerTurnStep = createStep({
  id: 'computer-use-worker-turn',
  description: 'Let the computer-use worker operate the desktop with real tools for one turn.',
  inputSchema: computerUseTurnContextSchema,
  outputSchema: computerUseTurnContextSchema,
  stateSchema: computerUseWorkflowStateSchema,
  execute: async ({ inputData, state, setState, requestContext }) => {
    const workerRequestContext = createWorkerRequestContext(
      toRequestContext(requestContext),
      inputData.beforeObservation,
    );

    const workerResult = await computerUseWorkerAgent.generate(
      (await buildWorkerMessages({
        task: inputData.request,
        app: inputData.app,
        stepIndex: inputData.stepIndex,
        observation: inputData.beforeObservation,
        artifacts: state.steps,
        taskTodo: inputData.taskTodo,
        scratchpad: inputData.scratchpad,
        recoveryHint: inputData.recoveryHint ?? inputData.resumeContext,
        recoveryCount: inputData.recoveryCount,
      })) as never,
      {
        maxSteps: 6,
        toolCallConcurrency: 1,
        toolChoice: 'auto',
        modelSettings: {
          temperature: 0,
        },
        requestContext: workerRequestContext,
      },
    );

    if ('error' in workerResult && workerResult.error) {
      throw workerResult.error;
    }

    const workerTurn = await extractComputerUseWorkerTurn({
      result: workerResult as { text?: string; toolCalls?: unknown; toolResults?: unknown },
      currentTodo: inputData.taskTodo,
      currentScratchpad: inputData.scratchpad,
      trackedTurn: readWorkerTurnTracking(workerRequestContext),
    });
    const workerArtifacts = buildWorkerArtifacts(workerTurn);

    await setState({
      ...state,
      pendingWorkerArtifacts: workerArtifacts,
      pendingWorkerTurn: workerTurn,
      pendingExecutionResult: workerArtifacts.executionResult,
      pendingGrounding: workerArtifacts.grounding,
    });

    return {
      ...inputData,
      workerTurn,
      executionResult: workerArtifacts.executionResult,
      grounding: workerArtifacts.grounding,
    };
  },
});

const observeAfterActionStep = createStep({
  id: 'computer-use-observe-after-action',
  description: 'Capture the desktop state after the worker turn completes.',
  inputSchema: computerUseTurnContextSchema,
  outputSchema: computerUseTurnContextSchema,
  stateSchema: computerUseWorkflowStateSchema,
  execute: async ({ inputData, requestContext, state, setState }) => {
    const workerArtifacts = state.pendingWorkerArtifacts;
    if (!workerArtifacts) {
      throw new Error('computer-use turn is missing the persisted worker artifacts');
    }

    if (!workerArtifacts.executedAction) {
      await setState({
        ...state,
        pendingAfterObservation: inputData.beforeObservation,
      });

      return {
        ...inputData,
        afterObservation: inputData.beforeObservation,
      };
    }

    const targetApp = deriveTargetAppFromWorkerTurn(
      {
        text: workerArtifacts.text,
        control: workerArtifacts.control,
        toolCalls: workerArtifacts.toolCalls,
        toolResults: workerArtifacts.toolResults,
        executedAction: workerArtifacts.executedAction,
      },
      inputData.beforeObservation.applicationName ?? inputData.app,
    );
    const afterObservation = await captureObservation({
      app: targetApp,
      requestContext: toRequestContext(requestContext),
    });

    await setState({
      ...state,
      pendingAfterObservation: afterObservation,
    });

    return {
      ...inputData,
      afterObservation,
    };
  },
});

const verifyActionStep = createStep({
  id: 'computer-use-verify-action',
  description: 'Ask the verifier agent whether the worker turn advanced the task.',
  inputSchema: computerUseTurnContextSchema,
  outputSchema: computerUseTurnContextSchema,
  stateSchema: computerUseWorkflowStateSchema,
  execute: async ({ inputData, state, setState }) => {
    const workerArtifacts = state.pendingWorkerArtifacts;
    if (!workerArtifacts) {
      throw new Error('computer-use turn is missing the persisted worker artifacts');
    }

    if (!workerArtifacts.executedAction) {
      return inputData;
    }

    const afterObservation = state.pendingAfterObservation ?? inputData.afterObservation;
    if (!afterObservation) {
      throw new Error('computer-use turn is missing the post-action observation');
    }

    const verifierResult = await computerUseVerifierAgent.generate(
      (await buildVerifierMessages({
        task: inputData.request,
        artifact: {
          stepIndex: inputData.stepIndex,
          beforeObservation: inputData.beforeObservation,
          latestWorkerObservation: state.pendingLatestWorkerObservation ?? inputData.beforeObservation,
          workerTurn: {
            text: workerArtifacts.text,
            control: workerArtifacts.control,
            toolCalls: workerArtifacts.toolCalls,
            toolResults: workerArtifacts.toolResults,
            executedAction: workerArtifacts.executedAction,
          },
          grounding: workerArtifacts.grounding,
          executionResult: workerArtifacts.executionResult,
          afterObservation,
          verification: null,
          taskTodo: inputData.taskTodo,
          scratchpad: inputData.scratchpad,
          terminationSignal: 'continue',
        },
        taskTodo: inputData.taskTodo,
        scratchpad: inputData.scratchpad,
      })) as never,
      {
        structuredOutput: {
          schema: computerUseVerificationSchema,
        },
        modelSettings: {
          temperature: 0,
        },
      },
    );

    if ('error' in verifierResult && verifierResult.error) {
      throw verifierResult.error;
    }

    const verification =
      (verifierResult.object as ComputerUseVerification | undefined) ?? defaultVerification();

    await setState({
      ...state,
      pendingVerification: verification,
    });

    return {
      ...inputData,
      workerTurn: {
        text: workerArtifacts.text,
        control: workerArtifacts.control,
        toolCalls: workerArtifacts.toolCalls,
        toolResults: workerArtifacts.toolResults,
        executedAction: workerArtifacts.executedAction,
      },
      grounding: workerArtifacts.grounding,
      executionResult: workerArtifacts.executionResult,
      afterObservation,
      verification,
    };
  },
});

const concludeTurnStep = createStep({
  id: 'computer-use-conclude-turn',
  description: 'Persist the turn artifact, retry when useful, or hand back to the user when needed.',
  inputSchema: computerUseTurnContextSchema,
  outputSchema: computerUseControlSchema,
  stateSchema: computerUseWorkflowStateSchema,
  resumeSchema: computerUseResumePayloadSchema,
  suspendSchema: computerUseHandoffSchema,
  execute: async ({ inputData, state, setState, resumeData, suspend }) => {
    const workerArtifacts = state.pendingWorkerArtifacts;
    if (!workerArtifacts) {
      throw new Error('computer-use turn is missing the persisted worker artifacts');
    }
    const workerTurn = {
      text: workerArtifacts.text,
      control: workerArtifacts.control,
      toolCalls: workerArtifacts.toolCalls,
      toolResults: workerArtifacts.toolResults,
      executedAction: workerArtifacts.executedAction,
    };

    const control = workerTurn.control;
    const taskTodo = resolveTaskTodo(control, state.taskTodo);
    const scratchpad = resolveScratchpad(control, state.scratchpad);
    const afterObservation =
      state.pendingAfterObservation ?? inputData.afterObservation ?? inputData.beforeObservation;
    const verification = state.pendingVerification ?? inputData.verification ?? null;
    const latestWorkerObservation =
      state.pendingLatestWorkerObservation ?? inputData.beforeObservation;

    const baseArtifact: ComputerUseStepArtifact = {
      stepIndex: inputData.stepIndex,
      beforeObservation: inputData.beforeObservation,
      latestWorkerObservation,
      workerTurn,
      grounding: workerArtifacts.grounding,
      executionResult: workerArtifacts.executionResult,
      afterObservation,
      verification,
      taskTodo,
      scratchpad,
      terminationSignal: 'continue',
    };

    if (resumeData && state.pendingHandoff) {
      const resumePayload = resumeData as ComputerUseResumePayload;
      if (resumePayload.action === 'abort') {
        await setState({
          ...withClearedPendingState(state),
          status: 'failed',
          currentObservation: afterObservation,
          pendingHandoff: null,
          resumeContext: resumePayload.userResponse,
          latestWorkerObservation,
          finalResponse:
            resumePayload.userResponse ||
            'The computer-use run was stopped after human handoff.',
        });
        await recordWorkflowTurnArtifact({
          runId: state.workflowRunId,
          request: inputData.request,
          app: inputData.app,
          artifact: { ...baseArtifact, terminationSignal: 'failed' },
          workflowStatus: 'failed',
          recoveryCount: state.recoveryCount,
          recoveryHint: resumePayload.userResponse,
          handoff: null,
        });

        return {
          request: inputData.request,
          app: inputData.app,
          maxIterations: inputData.maxIterations,
          maxRecoveryAttempts: inputData.maxRecoveryAttempts,
          continueLoop: false,
        };
      }

      await setState({
        ...withClearedPendingState(state),
        status: 'running',
        currentObservation: afterObservation,
        pendingHandoff: null,
        taskTodo,
        scratchpad,
        recoveryCount: 0,
        recoveryHint: resumePayload.userResponse,
        resumeContext: resumePayload.userResponse,
        latestWorkerObservation,
        finalResponse: undefined,
      });

      return {
        request: inputData.request,
        app: inputData.app,
        maxIterations: inputData.maxIterations,
        maxRecoveryAttempts: inputData.maxRecoveryAttempts,
        continueLoop: true,
      };
    }

    if (control.status === 'done' || control.status === 'cannot_complete') {
      if (control.handoff) {
        const handoff = control.handoff;
        const handoffArtifact = { ...baseArtifact, terminationSignal: 'handoff' } as const;

        await setState({
          ...withClearedPendingState(state),
          status: 'suspended',
          stepIndex: inputData.stepIndex,
          currentObservation: afterObservation,
          taskTodo,
          scratchpad,
          recoveryCount: state.recoveryCount,
          recoveryHint: control.userMessage,
          pendingHandoff: handoff,
          latestWorkerObservation,
          latestWorkerArtifacts: workerArtifacts,
          latestWorkerTurn: workerTurn,
          latestExecutionResult: workerArtifacts.executionResult,
          latestVerification: verification,
          finalResponse: handoff.summary,
          steps: [...state.steps, handoffArtifact],
        });
        await recordWorkflowTurnArtifact({
          runId: state.workflowRunId,
          request: inputData.request,
          app: inputData.app,
          artifact: handoffArtifact,
          workflowStatus: 'suspended',
          recoveryCount: state.recoveryCount,
          recoveryHint: control.userMessage,
          handoff,
        });

        return suspend(handoff, { resumeLabel: 'computer-use-handoff' });
      }

      const terminationSignal: ComputerUseStepArtifact['terminationSignal'] =
        control.status === 'done' ? 'done' : 'failed';
      const status = control.status === 'done' ? 'completed' : 'failed';
      const terminalArtifact: ComputerUseStepArtifact = { ...baseArtifact, terminationSignal };

      await setState({
        ...withClearedPendingState(state),
        status,
        stepIndex: inputData.stepIndex,
        currentObservation: afterObservation,
        taskTodo,
        scratchpad,
        recoveryCount: 0,
        recoveryHint: undefined,
        resumeContext: undefined,
        pendingHandoff: null,
        latestWorkerObservation,
        latestWorkerArtifacts: workerArtifacts,
        latestWorkerTurn: workerTurn,
        latestExecutionResult: workerArtifacts.executionResult,
        latestVerification: verification,
        finalResponse:
          control.userMessage ??
          workerTurn.text ??
          (status === 'completed'
            ? 'The requested computer task appears complete.'
            : 'The requested computer task could not be completed.'),
        steps: [...state.steps, terminalArtifact],
      });
      await recordWorkflowTurnArtifact({
        runId: state.workflowRunId,
        request: inputData.request,
        app: inputData.app,
        artifact: terminalArtifact,
        workflowStatus: status,
        recoveryCount: 0,
        recoveryHint: undefined,
        handoff: null,
      });

      return {
        request: inputData.request,
        app: inputData.app,
        maxIterations: inputData.maxIterations,
        maxRecoveryAttempts: inputData.maxRecoveryAttempts,
        continueLoop: false,
      };
    }

    const effectiveVerification =
      verification ??
      (!workerTurn.executedAction && control.status === 'continue'
        ? {
            verdict: 'failed' as const,
            summary: 'The worker asked to continue without executing a desktop action.',
            shouldContinue: false,
            recoveryAction: 'replan' as const,
            nextHint:
              'Use a GUI tool before continuing, or request handoff if the user must intervene.',
          }
        : defaultVerification());
    const maxReached = inputData.stepIndex >= inputData.maxIterations;
    const wantsRetry =
      (effectiveVerification.recoveryAction === 'retry' ||
        effectiveVerification.recoveryAction === 'replan') &&
      state.recoveryCount < inputData.maxRecoveryAttempts;
    const retryExhausted =
      (effectiveVerification.recoveryAction === 'retry' ||
        effectiveVerification.recoveryAction === 'replan') &&
      state.recoveryCount >= inputData.maxRecoveryAttempts;
    const wantsHandoff =
      effectiveVerification.recoveryAction === 'handoff' ||
      retryExhausted ||
      !!effectiveVerification.handoff ||
      !!control.handoff;

    if (wantsHandoff) {
      const handoff =
        effectiveVerification.handoff ??
        control.handoff ??
        buildFallbackHandoff({
          workerTurn,
          verification: effectiveVerification,
          observationSummary: summarizeObservationForHandoff(afterObservation),
        });
      const handoffArtifact = {
        ...baseArtifact,
        verification: effectiveVerification,
        terminationSignal: 'handoff',
      } as const;

      await setState({
        ...withClearedPendingState(state),
        status: 'suspended',
        stepIndex: inputData.stepIndex,
        currentObservation: afterObservation,
        taskTodo,
        scratchpad,
        recoveryCount: state.recoveryCount,
        recoveryHint: effectiveVerification.nextHint,
        pendingHandoff: handoff,
        latestWorkerObservation,
        latestWorkerArtifacts: workerArtifacts,
        latestWorkerTurn: workerTurn,
        latestExecutionResult: workerArtifacts.executionResult,
        latestVerification: effectiveVerification,
        finalResponse: handoff.summary,
        steps: [...state.steps, handoffArtifact],
      });
      await recordWorkflowTurnArtifact({
        runId: state.workflowRunId,
        request: inputData.request,
        app: inputData.app,
        artifact: handoffArtifact,
        workflowStatus: 'suspended',
        recoveryCount: state.recoveryCount,
        recoveryHint: effectiveVerification.nextHint,
        handoff,
      });

      return suspend(handoff, { resumeLabel: 'computer-use-handoff' });
    }

    if (wantsRetry) {
      const retryArtifact = {
        ...baseArtifact,
        verification: effectiveVerification,
        terminationSignal: 'continue',
      } as const;
      await setState({
        ...withClearedPendingState(state),
        status: 'running',
        stepIndex: inputData.stepIndex,
        currentObservation: afterObservation,
        taskTodo,
        scratchpad,
        recoveryCount: state.recoveryCount + 1,
        recoveryHint:
          effectiveVerification.nextHint ??
          effectiveVerification.recoveryReason ??
          effectiveVerification.summary,
        latestWorkerObservation,
        latestWorkerArtifacts: workerArtifacts,
        latestWorkerTurn: workerTurn,
        latestExecutionResult: workerArtifacts.executionResult,
        latestVerification: effectiveVerification,
        finalResponse: undefined,
        steps: [...state.steps, retryArtifact],
      });
      await recordWorkflowTurnArtifact({
        runId: state.workflowRunId,
        request: inputData.request,
        app: inputData.app,
        artifact: retryArtifact,
        workflowStatus: 'running',
        recoveryCount: state.recoveryCount + 1,
        recoveryHint:
          effectiveVerification.nextHint ??
          effectiveVerification.recoveryReason ??
          effectiveVerification.summary,
        handoff: null,
      });

      return {
        request: inputData.request,
        app: inputData.app,
        maxIterations: inputData.maxIterations,
        maxRecoveryAttempts: inputData.maxRecoveryAttempts,
        continueLoop: true,
      };
    }

    const workflowStatus =
      maxReached
        ? 'failed'
        : effectiveVerification.recoveryAction === 'abort'
          ? 'failed'
          : effectiveVerification.shouldContinue
            ? 'running'
            : effectiveVerification.verdict === 'failed'
              ? 'failed'
              : 'completed';
    const terminationSignal: ComputerUseStepArtifact['terminationSignal'] =
      maxReached
        ? 'max_iterations'
        : workflowStatus === 'running'
          ? 'continue'
          : workflowStatus === 'completed'
            ? 'done'
            : 'failed';

    const finalResponse =
      workflowStatus === 'running'
        ? undefined
        : control.userMessage ??
          workerTurn.text ??
          (maxReached
            ? `I reached the current computer-use step limit of ${inputData.maxIterations} without finishing the task.`
            : effectiveVerification.summary);
    const continuedArtifact = {
      ...baseArtifact,
      verification: effectiveVerification,
      terminationSignal,
    };

    await setState({
      ...withClearedPendingState(state),
      status: workflowStatus,
      stepIndex: inputData.stepIndex,
      currentObservation: afterObservation,
      taskTodo,
      scratchpad,
      recoveryCount: workflowStatus === 'running' ? 0 : state.recoveryCount,
      recoveryHint: workflowStatus === 'running' ? undefined : state.recoveryHint,
      resumeContext: undefined,
      pendingHandoff: null,
      latestWorkerObservation,
      latestWorkerArtifacts: workerArtifacts,
      latestWorkerTurn: workerTurn,
      latestExecutionResult: workerArtifacts.executionResult,
      latestVerification: effectiveVerification,
      finalResponse,
      steps: [...state.steps, continuedArtifact],
    });
    await recordWorkflowTurnArtifact({
      runId: state.workflowRunId,
      request: inputData.request,
      app: inputData.app,
      artifact: continuedArtifact,
      workflowStatus,
      recoveryCount: workflowStatus === 'running' ? 0 : state.recoveryCount,
      recoveryHint: workflowStatus === 'running' ? undefined : state.recoveryHint,
      handoff: null,
    });

    return {
      request: inputData.request,
      app: inputData.app,
      maxIterations: inputData.maxIterations,
      maxRecoveryAttempts: inputData.maxRecoveryAttempts,
      continueLoop: workflowStatus === 'running',
    };
  },
});

const finalizeStep = createStep({
  id: 'computer-use-finalize',
  description: 'Return the workflow result from the accumulated step artifacts.',
  inputSchema: computerUseControlSchema,
  outputSchema: computerUseWorkflowOutputSchema,
  stateSchema: computerUseWorkflowStateSchema,
  execute: async ({ state }) => ({
    workflowRunId: state.workflowRunId,
    status: state.status === 'running' ? 'failed' : state.status,
    finalResponse:
      state.finalResponse ??
      (state.status === 'completed'
        ? 'The computer-use task completed.'
        : 'The computer-use task stopped without a final response.'),
    totalSteps: state.steps.length,
    taskTodo: state.taskTodo,
    scratchpad: state.scratchpad,
    handoff: state.pendingHandoff ?? undefined,
    steps: state.steps,
  }),
});

const computerUseTurnWorkflow = createWorkflow({
  id: 'computerUseTurnWorkflow',
  inputSchema: computerUseControlSchema,
  outputSchema: computerUseControlSchema,
  stateSchema: computerUseWorkflowStateSchema,
})
  .then(prepareTurnStep)
  .then(workerTurnStep)
  .then(observeAfterActionStep)
  .then(verifyActionStep)
  .then(concludeTurnStep)
  .commit();

export const computerUseWorkflow = createWorkflow({
  id: 'computerUseWorkflow',
  inputSchema: computerUseRequestSchema,
  outputSchema: computerUseWorkflowOutputSchema,
  stateSchema: computerUseWorkflowStateSchema,
})
  .then(bootstrapStep)
  .dountil(computerUseTurnWorkflow, async ({ inputData }) => !inputData.continueLoop)
  .then(finalizeStep)
  .commit();
