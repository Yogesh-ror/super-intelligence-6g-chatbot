---
name: chat-ui-accessibility
description: "Use when improving frontend accessibility, keyboard behavior, focus management, screen reader support, or usability in chat UIs and messaging interfaces."
---

# Chat UI Accessibility

Use this skill when you need to improve accessibility and keyboard behavior in a chat interface without changing unrelated app behavior. The goal is to make the chat experience usable for keyboard, screen reader, and low-vision users while preserving the existing product flow.

## Workflow

1. Inspect the chat interaction and its accessibility gaps.
   - Review the message list, composer, input controls, send buttons, status states, and any focus management logic.
   - Identify issues such as missing labels, focus traps, keyboard-only navigation gaps, or poor announcement behavior.

2. Define the correct interaction model.
   - Confirm whether the UI needs standard form semantics, a custom keyboard shortcut, modal behavior, or live region updates.
   - Preserve the app's intended conversation flow while improving usability for assistive technology.

3. Implement accessible, minimal changes.
   - Use semantic controls and meaningful labels for buttons, text inputs, and action elements.
   - Ensure all interactive elements are reachable by keyboard and visible when focused.
   - Make Enter/Shift+Enter behavior clear and intentional for message submission.
   - Add focus management for new messages, loading states, errors, and chat history updates without surprising the user.
   - Avoid introducing focus traps or unexpected jumps in the conversation.

4. Support screen readers and status updates.
   - Use clear accessible names and context for controls.
   - Announce status changes, errors, and response arrival using appropriate live-region patterns when needed.
   - Keep the DOM structure and semantics predictable for assistive technologies.

5. Validate the interaction.
   - Test keyboard-only navigation through the full chat flow.
   - Verify visible focus indicators and focus order.
   - Check that message send, retry, and compose actions remain usable without a mouse.
   - Confirm the interface still works on small screens and in high-contrast or reduced-motion contexts where relevant.

6. Summarize the accessibility improvements.
   - Explain what changed, what was fixed, and which keyboard or assistive-technology behaviors were improved.

## Decision Points

- If the issue is a form control or input problem: improve labels, focus order, and submit behavior first.
- If the issue is focus after a message arrives: manage focus carefully to avoid interrupting a user who is typing or browsing the thread.
- If the issue is a custom widget or message action: ensure it behaves like a button or menu control with accessible semantics.
- If the issue affects announcement behavior: prefer lightweight, truthful live-region updates rather than noisy or repeated alerts.
- If the issue is visual-only: preserve contrast and focus visibility without reducing the chat's clarity or responsiveness.

## Quality Bar

A result is complete when all of the following are true:

- The chat UI is operable by keyboard without a mouse.
- All controls have meaningful labels and clear focus states.
- Focus behavior does not trap users or jump unexpectedly during conversation updates.
- Screen reader users can understand message state, errors, and controls.
- The experience remains usable on mobile and in resized or high-contrast layouts.
- Any assumptions about accessibility are explained in the final summary.

## Output Expectations

When you finish, provide:

- the accessibility issues identified,
- the keyboard and focus improvements implemented,
- the screen-reader or semantic updates made,
- and the validation steps used to confirm the chat remains usable.

This skill is intentionally focused on frontend accessibility and keyboard behavior for chat UIs so the changes remain targeted, practical, and user-centered.
