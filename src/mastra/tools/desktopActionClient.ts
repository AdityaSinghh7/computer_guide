import { z } from 'zod';

import { readEnv, readEnvOrDefault } from '../env';
import { getObservabilityRunId, recordDesktopToolEvent } from './desktopObservability';

const desktopServerErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    candidates: z.array(z.string()).optional(),
  }),
});

export const desktopHealthSchema = z.object({
  ok: z.boolean(),
  host: z.string(),
  port: z.number().int().nonnegative(),
});

export const desktopPermissionIdentitySchema = z
  .object({
    display_name: z.string().optional(),
    bundle_identifier: z.string().nullable().optional(),
    executable_path: z.string().optional(),
  })
  .optional();

export const desktopPermissionsSchema = z.object({
  screen_recording: z.boolean(),
  accessibility: z.boolean(),
  apple_script: z.boolean().optional(),
  identity: desktopPermissionIdentitySchema,
});

export const desktopPermissionRequestSchema = z.object({
  permission: z.enum(['accessibility', 'screen_recording']),
  granted: z.boolean(),
  prompt_triggered: z.boolean(),
  message: z.string(),
});

export const resolvedTargetSchema = z
  .object({
    description: z.string(),
    application: z.string().nullable().optional(),
    window: z.string().nullable().optional(),
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

export const desktopActionSuccessSchema = z.object({
  action_id: z.string(),
  ok: z.literal(true),
  message: z.string(),
  resolved_target: resolvedTargetSchema,
  duration_ms: z.number().nonnegative(),
});

export const desktopUiElementSchema = z.object({
  id: z.string(),
  role: z.string(),
  title: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  role_description: z.string().nullable().optional(),
  help: z.string().nullable().optional(),
  identifier: z.string().nullable().optional(),
  is_actionable: z.boolean(),
  keyboard_shortcut: z.string().nullable().optional(),
});

export const desktopSeeSuccessSchema = z.object({
  action_id: z.string(),
  ok: z.literal(true),
  message: z.string(),
  duration_ms: z.number().nonnegative(),
  snapshot_id: z.string(),
  screenshot_raw: z.string(),
  screenshot_annotated: z.string(),
  ui_map: z.string(),
  application_name: z.string().nullable().optional(),
  window_title: z.string().nullable().optional(),
  is_dialog: z.boolean().optional(),
  element_count: z.number().int().nonnegative(),
  interactable_count: z.number().int().nonnegative(),
  capture_mode: z.string(),
  execution_time: z.number().nonnegative().optional(),
  ui_elements: z.array(desktopUiElementSchema),
});

export type DesktopActionSuccess = z.infer<typeof desktopActionSuccessSchema>;
export type DesktopPermissions = z.infer<typeof desktopPermissionsSchema>;
export type DesktopPermissionRequest = z.infer<typeof desktopPermissionRequestSchema>;

export class DesktopActionClientError extends Error {
  code: string;
  status?: number;
  candidates?: string[];

  constructor(message: string, options: { code: string; status?: number; candidates?: string[] }) {
    super(message);
    this.name = 'DesktopActionClientError';
    this.code = options.code;
    this.status = options.status;
    this.candidates = options.candidates;
  }
}

export const getDesktopServerBaseUrl = () => {
  const host = readEnvOrDefault('COMPUTER_GUIDE_DESKTOP_HOST', '127.0.0.1');
  const port = readEnvOrDefault('COMPUTER_GUIDE_DESKTOP_PORT', '47613');
  return `http://${host}:${port}`;
};

export const getDesktopServerToken = () => {
  const token = readEnv('COMPUTER_GUIDE_DESKTOP_TOKEN');
  if (!token) {
    throw new DesktopActionClientError(
      'COMPUTER_GUIDE_DESKTOP_TOKEN is not set. Start the desktop server and export the same bearer token before using GUI tools.',
      { code: 'SERVER_UNAVAILABLE' },
    );
  }
  return token;
};

const formatServerError = (
  error: z.infer<typeof desktopServerErrorSchema>['error'],
  status?: number,
) => {
  const candidateHint =
    error.candidates && error.candidates.length > 0
      ? ` Candidates: ${error.candidates.join(', ')}.`
      : '';

  return new DesktopActionClientError(`${error.message}${candidateHint}`, {
    code: error.code,
    status,
    candidates: error.candidates,
  });
};

const callDesktopJson = async <TOutput>(
  method: 'GET' | 'POST',
  path: string,
  payload: unknown,
  responseSchema: z.ZodSchema<TOutput>,
  options?: {
    toolId?: string;
  },
): Promise<TOutput> => {
  const baseUrl = getDesktopServerBaseUrl();
  const url = `${baseUrl}${path}`;
  const startedAt = Date.now();
  const runId = getObservabilityRunId();
  const toolId = options?.toolId ?? `${method.toLowerCase()}:${path}`;
  let responseStatus: number | undefined;

  try {
    if (method === 'POST') {
      await ensureDesktopPermissionsForPath(path);
    }

    const token = getDesktopServerToken();
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(runId ? { 'x-observability-run-id': runId } : {}),
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(payload ?? {}) } : {}),
    });
    responseStatus = response.status;

    const rawBody = await response.text();
    let parsedBody: unknown = null;
    if (rawBody.length > 0) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        throw new DesktopActionClientError(
          `Desktop action server returned invalid JSON for ${path}.`,
          {
            code: 'SERVER_UNAVAILABLE',
            status: response.status,
          },
        );
      }
    }

    const parsedError = desktopServerErrorSchema.safeParse(parsedBody);
    if (!response.ok || parsedError.success) {
      if (parsedError.success) {
        throw formatServerError(parsedError.data.error, response.status);
      }

      throw new DesktopActionClientError(
        `Desktop action server returned HTTP ${response.status} for ${path}.`,
        {
          code: 'SERVER_UNAVAILABLE',
          status: response.status,
        },
      );
    }

    const parsedSuccess = responseSchema.safeParse(parsedBody);
    if (!parsedSuccess.success) {
      throw new DesktopActionClientError(
        `Desktop action server returned an unexpected success payload for ${path}.`,
        {
          code: 'SERVER_UNAVAILABLE',
          status: response.status,
        },
      );
    }

    await recordDesktopToolEvent({
      timestamp: new Date().toISOString(),
      component: 'mastra-desktop-tool',
      run_id: runId,
      tool_id: toolId,
      path,
      server_url: baseUrl,
      payload,
      outcome: 'success',
      duration_ms: Date.now() - startedAt,
      action_id:
        parsedSuccess.data &&
        typeof parsedSuccess.data === 'object' &&
        parsedSuccess.data !== null &&
        'action_id' in parsedSuccess.data &&
        typeof parsedSuccess.data.action_id === 'string'
          ? parsedSuccess.data.action_id
          : undefined,
      response: parsedSuccess.data,
    });

    return parsedSuccess.data;
  } catch (error) {
    const normalizedError =
      error instanceof DesktopActionClientError
        ? error
        : new DesktopActionClientError(
            `Desktop action server is unavailable at ${url}. Start it with \`npm run desktop-server:start\` and ensure the server is running on loopback.`,
            {
              code: 'SERVER_UNAVAILABLE',
              status: responseStatus,
            },
          );

    await recordDesktopToolEvent({
      timestamp: new Date().toISOString(),
      component: 'mastra-desktop-tool',
      run_id: runId,
      tool_id: toolId,
      path,
      server_url: baseUrl,
      payload,
      outcome: 'error',
      duration_ms: Date.now() - startedAt,
      error: {
        name: normalizedError.name,
        message: normalizedError.message,
        code: normalizedError.code,
        status: normalizedError.status,
        candidates: normalizedError.candidates,
      },
    });

    throw normalizedError;
  }
};

export const callDesktopAction = async <TOutput>(
  path: string,
  payload: unknown,
  responseSchema: z.ZodSchema<TOutput>,
  options?: {
    toolId?: string;
  },
): Promise<TOutput> => callDesktopJson('POST', path, payload, responseSchema, options);

export const getDesktopServerHealth = async () =>
  callDesktopJson('GET', '/v1/health', null, desktopHealthSchema, { toolId: 'desktop_health' });

export const getDesktopPermissions = async () =>
  callDesktopJson('GET', '/v1/permissions', null, desktopPermissionsSchema, {
    toolId: 'desktop_permissions',
  });

export const requestDesktopAccessibilityPermission = async () =>
  callDesktopJson(
    'POST',
    '/v1/permissions/request-accessibility',
    {},
    desktopPermissionRequestSchema,
    { toolId: 'desktop_request_accessibility' },
  );

export const requestDesktopScreenRecordingPermission = async () =>
  callDesktopJson(
    'POST',
    '/v1/permissions/request-screen-recording',
    {},
    desktopPermissionRequestSchema,
    { toolId: 'desktop_request_screen_recording' },
  );

export type DesktopPermissionPreflight = {
  serverReachable: boolean;
  health?: z.infer<typeof desktopHealthSchema>;
  permissions?: DesktopPermissions;
  accessibilityRequest?: DesktopPermissionRequest;
  screenRecordingRequest?: DesktopPermissionRequest;
  warning?: string;
};

const accessibilityProtectedPaths = new Set([
  '/v1/click',
  '/v1/switch-application',
  '/v1/type',
  '/v1/drag',
  '/v1/scroll',
  '/v1/hotkey',
  '/v1/hold-and-press',
]);

const screenRecordingProtectedPaths = new Set(['/v1/see']);

export const preflightDesktopPermissions = async (options?: {
  requestAccessibilityIfMissing?: boolean;
  requestScreenRecordingIfMissing?: boolean;
}): Promise<DesktopPermissionPreflight> => {
  try {
    const health = await getDesktopServerHealth();
    let permissions = await getDesktopPermissions();
    let accessibilityRequest: DesktopPermissionRequest | undefined;
    let screenRecordingRequest: DesktopPermissionRequest | undefined;

    if (!permissions.accessibility && options?.requestAccessibilityIfMissing) {
      accessibilityRequest = await requestDesktopAccessibilityPermission();
      permissions = await getDesktopPermissions();
    }

    if (!permissions.screen_recording && options?.requestScreenRecordingIfMissing) {
      screenRecordingRequest = await requestDesktopScreenRecordingPermission();
      permissions = await getDesktopPermissions();
    }

    return {
      serverReachable: true,
      health,
      permissions,
      accessibilityRequest,
      screenRecordingRequest,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      serverReachable: false,
      warning: message,
    };
  }
};

const ensureDesktopPermissionsForPath = async (path: string) => {
  const needsAccessibility = accessibilityProtectedPaths.has(path);
  const needsScreenRecording = screenRecordingProtectedPaths.has(path);
  if (!needsAccessibility && !needsScreenRecording) {
    return;
  }

  const preflight = await preflightDesktopPermissions({
    requestAccessibilityIfMissing: needsAccessibility,
    requestScreenRecordingIfMissing: needsScreenRecording,
  });

  if (!preflight.serverReachable) {
    throw new DesktopActionClientError(
      preflight.warning ??
        `Desktop action server is unavailable at ${getDesktopServerBaseUrl()}. Start it with \`npm run desktop-server:start\`.`,
      { code: 'SERVER_UNAVAILABLE' },
    );
  }

  const permissions = preflight.permissions;
  if (!permissions) {
    throw new DesktopActionClientError('Desktop permission status could not be determined.', {
      code: 'SERVER_UNAVAILABLE',
    });
  }

  if (needsAccessibility && !permissions.accessibility) {
    throw new DesktopActionClientError('Accessibility permission is required', {
      code: 'PERMISSION_DENIED',
      status: 403,
    });
  }

  if (needsScreenRecording && !permissions.screen_recording) {
    throw new DesktopActionClientError('Screen Recording permission is required', {
      code: 'PERMISSION_DENIED',
      status: 403,
    });
  }
};
