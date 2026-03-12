import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  recordWorkerToolCall,
  recordWorkerToolResult,
} from '../computer-use/worker-turn-tracker';
import {
  callDesktopAction,
  desktopActionSuccessSchema,
  desktopSeeSuccessSchema,
  withObservationCaptureHint,
} from './desktopActionClient';

const createGuiActionResultSchema = () =>
  desktopActionSuccessSchema.extend({
    message: z
      .string()
      .describe('Human-readable status describing the desktop action that was executed.'),
  });

const guiActionResultSchema = createGuiActionResultSchema();

const executeTrackedDesktopAction = async <TResult>(
  toolId: string,
  args: unknown,
  requestContext: unknown,
  run: () => Promise<TResult>,
) => {
  const trackedCall = recordWorkerToolCall(
    requestContext as Record<string, unknown> | undefined,
    toolId,
    args,
  );

  try {
    const result = await run();
    recordWorkerToolResult(
      requestContext as Record<string, unknown> | undefined,
      trackedCall,
      toolId,
      args,
      result,
    );
    return result;
  } catch (error) {
    recordWorkerToolResult(
      requestContext as Record<string, unknown> | undefined,
      trackedCall,
      toolId,
      args,
      {
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
      },
    );
    throw error;
  }
};

export const clickArgsSchema = z.object({
  element_description: z
    .string()
    .describe(
      'Detailed description of the UI element to click. Mention visible text, iconography, relative location, window context, or nearby elements so the grounding model can identify the target visually.',
    ),
  app: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional application name or bundle identifier to target before grounding the element, such as "Google Chrome" or "com.google.Chrome".'),
  num_clicks: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('Number of mouse clicks to perform on the target element. Use 2 for a double-click and larger values only when repeated clicking is intentional.'),
  button_type: z
    .enum(['left', 'middle', 'right'])
    .default('left')
    .describe('Mouse button to use for the click action. Prefer "left" unless the task explicitly requires a context menu or middle-click behavior.'),
  hold_keys: z
    .array(z.string())
    .default([])
    .describe('Optional modifier keys to hold while clicking, such as shift, cmd, ctrl, or alt. Leave empty for a normal click.'),
});

export const clickResultSchema = guiActionResultSchema;

export const clickTool = createTool({
  id: 'click',
  description:
    'Click a specific UI element on screen using vision-based grounding. Use this for buttons, links, controls, tabs, menus, or other clickable targets. Provide the app when known and make the element description visually specific.',
  inputSchema: clickArgsSchema,
  outputSchema: clickResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('click', input, context?.requestContext, () =>
      callDesktopAction(
        '/v1/click',
        withObservationCaptureHint(input, context?.requestContext),
        clickResultSchema,
        { toolId: 'click' },
      ),
    ),
});

export const switchApplicationsArgsSchema = z.object({
  app_code: z
    .string()
    .min(1)
    .describe(
      'Name or short code of an application that is already open, such as "Chrome", "Terminal", or "Slack". Use the identifier most likely to match the app visible in the OS app switcher or dock.',
    ),
});

export const switchApplicationsResultSchema = guiActionResultSchema;

export const switchApplicationsTool = createTool({
  id: 'switch_applications',
  description:
    'Bring an already-open desktop application to the foreground. Use this proactively whenever the user asks about or wants to interact with a specific app that may not already be frontmost.',
  inputSchema: switchApplicationsArgsSchema,
  outputSchema: switchApplicationsResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('switch_applications', input, context?.requestContext, () =>
      callDesktopAction('/v1/switch-application', input, switchApplicationsResultSchema, {
        toolId: 'switch_applications',
      }),
    ),
});

export const openArgsSchema = z
  .object({
    app_or_filename: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Application name, document name, folder name, or explicit file path to open through the operating system. Prefer precise names or paths when multiple matches could exist.',
      ),
    url: z
      .string()
      .trim()
      .url()
      .optional()
      .describe(
        'URL to open directly. Use this for websites or deep links instead of opening a browser and typing into the address bar.',
      ),
    application: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Optional application name, bundle identifier, or app path to use when opening the URL or file. Use this to force a URL to open in a specific browser such as com.google.Chrome.',
      ),
    ensure_window: z
      .boolean()
      .default(false)
      .describe(
        'When opening an application by name, also try to surface a usable window if the app launches or activates without one. Use this for recovery when the workflow knows the target app has no open windows.',
      ),
  })
  .refine(input => Boolean(input.app_or_filename || input.url), {
    message: 'Provide either app_or_filename or url.',
    path: ['app_or_filename'],
  });

export const openResultSchema = guiActionResultSchema;

export const openTool = createTool({
  id: 'open',
  description:
    'Open an application, file, folder, document, or URL using the operating system launcher. Prefer this over typing into a browser address bar when the goal is to open a known URL, and provide application when the URL must open in a specific app like Chrome. When recovering from a missing app window, set ensure_window so the OS launcher also tries to surface a usable window.',
  inputSchema: openArgsSchema,
  outputSchema: openResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('open', input, context?.requestContext, () =>
      callDesktopAction('/v1/open', input, openResultSchema, { toolId: 'open' }),
    ),
});

export const typeArgsSchema = z.object({
  element_description: z
    .string()
    .describe(
      'Detailed description of the target input area to focus before typing. Include field label, placeholder, nearby text, or window context so the grounding model can find it visually.',
    ),
  app: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional application name or bundle identifier to target before grounding the field, such as "Google Chrome" or "com.google.Chrome".'),
  text: z
    .string()
    .default('')
    .describe('Exact text to type or paste into the target field. This may be empty when the goal is only to focus a field and optionally submit.'),
  overwrite: z
    .boolean()
    .default(false)
    .describe('Whether existing text in the target field should be selected and replaced before entering the new text.'),
  enter: z
    .boolean()
    .default(false)
    .describe('Whether to press Enter immediately after typing, for example to submit a form, confirm a dialog, or send a message.'),
});

export const typeResultSchema = guiActionResultSchema;

export const typeTool = createTool({
  id: 'type',
  description:
    'Type or paste text into a visually described field using vision-based grounding. Use this for forms, search boxes, editors, chat inputs, and other text entry tasks.',
  inputSchema: typeArgsSchema,
  outputSchema: typeResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('type', input, context?.requestContext, () =>
      callDesktopAction(
        '/v1/type',
        withObservationCaptureHint(input, context?.requestContext),
        typeResultSchema,
        { toolId: 'type' },
      ),
    ),
});

export const dragAndDropArgsSchema = z.object({
  starting_description: z
    .string()
    .min(1)
    .describe(
      'Detailed description of where the drag should begin. Include the source element, item, handle, or screen region to grab.',
    ),
  ending_description: z
    .string()
    .min(1)
    .describe(
      'Detailed description of the drop destination. Include the target container, slot, location, or region where the dragged item should be released.',
    ),
  app: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional application name or bundle identifier to target before grounding the drag source and destination.'),
  hold_keys: z
    .array(z.string())
    .default([])
    .describe('Optional modifier keys to hold during the drag, such as shift, cmd, ctrl, or alt. Leave empty for a standard drag-and-drop gesture.'),
});

export const dragAndDropResultSchema = guiActionResultSchema;

export const dragAndDropTool = createTool({
  id: 'drag_and_drop',
  description:
    'Drag from one visually described UI location to another and then release using vision-based grounding. Use this for moving files, reordering items, resizing panes, or any interaction that requires a click-drag gesture.',
  inputSchema: dragAndDropArgsSchema,
  outputSchema: dragAndDropResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('drag_and_drop', input, context?.requestContext, () =>
      callDesktopAction(
        '/v1/drag',
        withObservationCaptureHint(input, context?.requestContext),
        dragAndDropResultSchema,
        { toolId: 'drag_and_drop' },
      ),
    ),
});

export const scrollArgsSchema = z.object({
  element_description: z
    .string()
    .min(1)
    .describe(
      'Detailed description of the element, window, pane, list, or region that should receive the scroll input.',
    ),
  app: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional application name or bundle identifier to target before grounding the scroll region.'),
  clicks: z
    .number()
    .int()
    .describe(
      'Signed scroll magnitude. Positive values scroll upward and negative values scroll downward. Use larger absolute values when more movement is needed.',
    ),
  shift: z
    .boolean()
    .default(false)
    .describe('Whether to use horizontal scrolling behavior, typically by holding Shift while scrolling.'),
});

export const scrollResultSchema = guiActionResultSchema;

export const scrollTool = createTool({
  id: 'scroll',
  description:
    'Scroll within a visually described UI region or element using vision-based grounding. Use this to reveal off-screen content, move through lists or documents, or perform horizontal scrolling when supported.',
  inputSchema: scrollArgsSchema,
  outputSchema: scrollResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('scroll', input, context?.requestContext, () =>
      callDesktopAction(
        '/v1/scroll',
        withObservationCaptureHint(input, context?.requestContext),
        scrollResultSchema,
        { toolId: 'scroll' },
      ),
    ),
});

export const hotkeyArgsSchema = z.object({
  keys: z
    .array(z.string())
    .min(1)
    .describe(
      'Keyboard shortcut keys to press together, ordered from modifier keys to the final key. Examples include ["cmd", "c"], ["ctrl", "shift", "t"], or ["alt", "tab"].',
    ),
});

export const hotkeyResultSchema = guiActionResultSchema;

export const hotkeyTool = createTool({
  id: 'hotkey',
  description:
    'Press a keyboard shortcut combination simultaneously. Use this for standard OS or application shortcuts such as copy, paste, save, undo, tab switching, or command palette access.',
  inputSchema: hotkeyArgsSchema,
  outputSchema: hotkeyResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('hotkey', input, context?.requestContext, () =>
      callDesktopAction('/v1/hotkey', input, hotkeyResultSchema, { toolId: 'hotkey' }),
    ),
});

export const holdAndPressArgsSchema = z.object({
  hold_keys: z
    .array(z.string())
    .min(1)
    .describe('Keys to hold down continuously while the secondary key sequence is pressed. These are typically modifiers such as shift, cmd, ctrl, or alt.'),
  press_keys: z
    .array(z.string())
    .min(1)
    .describe('Keys to press in order while the hold_keys remain held. Use this when the sequence is not a single simultaneous shortcut.'),
});

export const holdAndPressResultSchema = guiActionResultSchema;

export const holdAndPressTool = createTool({
  id: 'hold_and_press',
  description:
    'Hold one or more keys and then press another sequence of keys while they remain held. Use this for multi-step keyboard gestures that are more specific than a single hotkey combination.',
  inputSchema: holdAndPressArgsSchema,
  outputSchema: holdAndPressResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('hold_and_press', input, context?.requestContext, () =>
      callDesktopAction('/v1/hold-and-press', input, holdAndPressResultSchema, {
        toolId: 'hold_and_press',
      }),
    ),
});

export const waitArgsSchema = z.object({
  time: z
    .number()
    .min(0)
    .describe(
      'Number of seconds to wait before the next action. Use this to allow UI transitions, file loading, network activity, or asynchronous application state changes to complete.',
    ),
});

export const waitResultSchema = guiActionResultSchema;

export const waitTool = createTool({
  id: 'wait',
  description:
    'Pause execution for a specific amount of time. Use this when the interface needs time to update before another GUI action should happen.',
  inputSchema: waitArgsSchema,
  outputSchema: waitResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('wait', input, context?.requestContext, () =>
      callDesktopAction('/v1/wait', input, waitResultSchema, { toolId: 'wait' }),
    ),
});

export const seeArgsSchema = z.object({
  app: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Optional application name to target for capture, such as "Google Chrome" or "Safari". Leave empty to capture the frontmost UI by default.',
    ),
  window_title: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Optional window title substring to narrow the capture to a specific app window when the application has multiple windows.',
    ),
  mode: z
    .enum(['frontmost', 'window', 'screen'])
    .optional()
    .describe(
      'Capture mode. Use frontmost for the focused window, window when app/window_title is provided, or screen for a full-screen capture.',
    ),
  path: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional file path where the raw screenshot should be saved.'),
  annotate: z
    .boolean()
    .default(false)
    .describe('Whether to generate an annotated screenshot with element IDs overlaid.'),
});

export const seeResultSchema = desktopSeeSuccessSchema;

export const seeTool = createTool({
  id: 'see',
  description:
    'Capture the current macOS UI state and return a screenshot plus detected UI elements. Use this to inspect what is on screen or debug why a vision-grounded action failed. When the user asks about a specific app, prefer targeting that app or switching to it first instead of describing whatever app is currently frontmost.',
  inputSchema: seeArgsSchema,
  outputSchema: seeResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('see', input, context?.requestContext, () =>
      callDesktopAction('/v1/see', input, seeResultSchema, { toolId: 'see' }),
    ),
});

export const screenshotArgsSchema = z.object({
  app: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional application name to capture, such as "Google Chrome".'),
  window_title: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional window title substring to capture a specific app window.'),
  mode: z
    .enum(['frontmost', 'window', 'screen'])
    .optional()
    .describe('Capture mode. Use screen for a full display screenshot or frontmost/window for focused app captures.'),
  path: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional file path where the screenshot should be saved.'),
  annotate: z
    .boolean()
    .default(false)
    .describe('Whether to overlay element IDs on the screenshot.'),
});

export const screenshotResultSchema = desktopSeeSuccessSchema;

export const screenshotTool = createTool({
  id: 'screenshot',
  description:
    'Capture a screenshot of the current desktop or a targeted app/window. Use this when you need a saved image of the UI, or when you want a screenshot plus the same element metadata returned by see. When the user asks about a specific app, prefer targeting that app or switching to it first before capturing.',
  inputSchema: screenshotArgsSchema,
  outputSchema: screenshotResultSchema,
  execute: (input, context) =>
    executeTrackedDesktopAction('screenshot', input, context?.requestContext, () =>
      callDesktopAction(
        '/v1/see',
        {
          ...input,
        },
        screenshotResultSchema,
        { toolId: 'screenshot' },
      ),
    ),
});

export const guiActionTools = {
  click: clickTool,
  switch_applications: switchApplicationsTool,
  open: openTool,
  type: typeTool,
  drag_and_drop: dragAndDropTool,
  scroll: scrollTool,
  hotkey: hotkeyTool,
  hold_and_press: holdAndPressTool,
  wait: waitTool,
  see: seeTool,
  screenshot: screenshotTool,
};
