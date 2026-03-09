import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const buildGuiActionStubMessage = (toolId: string) =>
  `The ${toolId} tool is currently a stub. It accepts validated inputs and records the requested GUI action, but it does not manipulate the desktop yet.`;

const createGuiActionResultSchema = <TInputSchema extends z.ZodTypeAny>(
  inputSchema: TInputSchema,
) =>
  z.object({
    implemented: z
      .literal(false)
      .describe('This GUI automation tool is currently stubbed and does not execute the action yet.'),
    message: z
      .string()
      .describe('Human-readable status explaining that the action was recorded but not executed.'),
    requested_action: inputSchema.describe(
      'Echo of the validated action payload for downstream logging, testing, or future implementation.',
    ),
  });

export const clickArgsSchema = z.object({
  element_description: z
    .string()
    .describe(
      'Detailed description of the UI element to click. Mention visible text, iconography, relative location, window context, or nearby elements so the target can be identified unambiguously.',
    ),
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

export const clickResultSchema = createGuiActionResultSchema(clickArgsSchema);

export const clickTool = createTool({
  id: 'click',
  description:
    'Click a specific UI element on screen. Use this for buttons, links, controls, tabs, menus, or other clickable targets after describing the element clearly enough to distinguish it from similar items.',
  inputSchema: clickArgsSchema,
  outputSchema: clickResultSchema,
  execute: async input => ({
    implemented: false,
    message: buildGuiActionStubMessage('click'),
    requested_action: input,
  }),
});

export const switchApplicationsArgsSchema = z.object({
  app_code: z
    .string()
    .min(1)
    .describe(
      'Name or short code of an application that is already open, such as "Chrome", "Terminal", or "Slack". Use the identifier most likely to match the app visible in the OS app switcher or dock.',
    ),
});

export const switchApplicationsResultSchema = createGuiActionResultSchema(
  switchApplicationsArgsSchema,
);

export const switchApplicationsTool = createTool({
  id: 'switch_applications',
  description:
    'Bring an already-open desktop application to the foreground. Use this when the target app is already running and you want to switch focus without launching a new instance.',
  inputSchema: switchApplicationsArgsSchema,
  outputSchema: switchApplicationsResultSchema,
  execute: async input => ({
    implemented: false,
    message: buildGuiActionStubMessage('switch_applications'),
    requested_action: input,
  }),
});

export const openArgsSchema = z.object({
  app_or_filename: z
    .string()
    .min(1)
    .describe(
      'Application name, document name, folder name, or explicit file path to open through the operating system. Prefer precise names or paths when multiple matches could exist.',
    ),
});

export const openResultSchema = createGuiActionResultSchema(openArgsSchema);

export const openTool = createTool({
  id: 'open',
  description:
    'Open an application, file, folder, or document using the operating system launcher. Use this instead of manually navigating the desktop when the goal is simply to open something known by name or path.',
  inputSchema: openArgsSchema,
  outputSchema: openResultSchema,
  execute: async input => ({
    implemented: false,
    message: buildGuiActionStubMessage('open'),
    requested_action: input,
  }),
});

export const typeArgsSchema = z.object({
  element_description: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Detailed description of the target input area to focus before typing. Include field label, placeholder, nearby text, or window context. Use null only when text should be entered into the currently focused field.',
    ),
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

export const typeResultSchema = createGuiActionResultSchema(typeArgsSchema);

export const typeTool = createTool({
  id: 'type',
  description:
    'Type or paste text into a target field or the currently focused input. Use this for forms, search boxes, editors, chat inputs, and any other text entry task.',
  inputSchema: typeArgsSchema,
  outputSchema: typeResultSchema,
  execute: async input => ({
    implemented: false,
    message: buildGuiActionStubMessage('type'),
    requested_action: input,
  }),
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
  hold_keys: z
    .array(z.string())
    .default([])
    .describe('Optional modifier keys to hold during the drag, such as shift, cmd, ctrl, or alt. Leave empty for a standard drag-and-drop gesture.'),
});

export const dragAndDropResultSchema = createGuiActionResultSchema(dragAndDropArgsSchema);

export const dragAndDropTool = createTool({
  id: 'drag_and_drop',
  description:
    'Drag from one described UI location to another and then release. Use this for moving files, reordering items, resizing panes, or any interaction that requires a click-drag gesture.',
  inputSchema: dragAndDropArgsSchema,
  outputSchema: dragAndDropResultSchema,
  execute: async input => ({
    implemented: false,
    message: buildGuiActionStubMessage('drag_and_drop'),
    requested_action: input,
  }),
});

export const scrollArgsSchema = z.object({
  element_description: z
    .string()
    .min(1)
    .describe(
      'Detailed description of the element, window, pane, list, or region that should receive the scroll input.',
    ),
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

export const scrollResultSchema = createGuiActionResultSchema(scrollArgsSchema);

export const scrollTool = createTool({
  id: 'scroll',
  description:
    'Scroll within a specific UI region or element. Use this to reveal off-screen content, move through lists or documents, or perform horizontal scrolling when supported.',
  inputSchema: scrollArgsSchema,
  outputSchema: scrollResultSchema,
  execute: async input => ({
    implemented: false,
    message: buildGuiActionStubMessage('scroll'),
    requested_action: input,
  }),
});

export const hotkeyArgsSchema = z.object({
  keys: z
    .array(z.string())
    .min(1)
    .describe(
      'Keyboard shortcut keys to press together, ordered from modifier keys to the final key. Examples include ["cmd", "c"], ["ctrl", "shift", "t"], or ["alt", "tab"].',
    ),
});

export const hotkeyResultSchema = createGuiActionResultSchema(hotkeyArgsSchema);

export const hotkeyTool = createTool({
  id: 'hotkey',
  description:
    'Press a keyboard shortcut combination simultaneously. Use this for standard OS or application shortcuts such as copy, paste, save, undo, tab switching, or command palette access.',
  inputSchema: hotkeyArgsSchema,
  outputSchema: hotkeyResultSchema,
  execute: async input => ({
    implemented: false,
    message: buildGuiActionStubMessage('hotkey'),
    requested_action: input,
  }),
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

export const holdAndPressResultSchema = createGuiActionResultSchema(holdAndPressArgsSchema);

export const holdAndPressTool = createTool({
  id: 'hold_and_press',
  description:
    'Hold one or more keys and then press another sequence of keys while they remain held. Use this for multi-step keyboard gestures that are more specific than a single hotkey combination.',
  inputSchema: holdAndPressArgsSchema,
  outputSchema: holdAndPressResultSchema,
  execute: async input => ({
    implemented: false,
    message: buildGuiActionStubMessage('hold_and_press'),
    requested_action: input,
  }),
});

export const waitArgsSchema = z.object({
  time: z
    .number()
    .min(0)
    .describe(
      'Number of seconds to wait before the next action. Use this to allow UI transitions, file loading, network activity, or asynchronous application state changes to complete.',
    ),
});

export const waitResultSchema = createGuiActionResultSchema(waitArgsSchema);

export const waitTool = createTool({
  id: 'wait',
  description:
    'Pause execution for a specific amount of time. Use this when the interface needs time to update before another GUI action should happen.',
  inputSchema: waitArgsSchema,
  outputSchema: waitResultSchema,
  execute: async input => ({
    implemented: false,
    message: buildGuiActionStubMessage('wait'),
    requested_action: input,
  }),
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
};
