---
name: angular-chatbot-builder
description: "Use when building or improving an Angular chatbot UI, wiring conversation flows, or connecting a backend response service such as Gemini."
---

# Angular Chatbot Builder

Use this skill when you need to build, improve, or troubleshoot a chatbot experience in an Angular app. The goal is to create a clear, responsive chat interface with a minimal, reliable implementation that matches the project's existing patterns and keeps secrets and provider configuration safe.

## Workflow

1. Inspect the relevant chatbot files first.
   - Review the component, template, styles, nearby tests, and any existing service or API configuration.
   - Determine whether the request is primarily a UI update, a response flow fix, or a new backend provider integration.

2. Clarify scope only when needed.
   - If the product decision affects provider choice, data flow, or external cost, confirm the requirements before implementation.
   - Keep scope narrow and aligned to the chatbot experience unless broader changes are explicitly requested.

3. Implement the smallest viable solution.
   - Follow the Angular patterns already used in the workspace.
   - Preserve accessibility, keyboard support, and mobile usability.
   - Add the appropriate states for empty, loading, error, and response output.
   - Avoid unrelated refactors or unnecessary dependencies.

4. Protect secrets and provider configuration.
   - Never place API keys or credentials in browser code or client bundles.
   - Prefer server-side configuration for external AI providers like Gemini.
   - If no server-side integration exists, build the smallest appropriate backend path instead of writing secrets into app code.
   - Clearly document any local fallback or required setup still needed for real AI responses.

5. Validate with focused checks.
   - Add or update targeted tests for the changed behavior.
   - Run the smallest relevant test or build check that validates the changed workflow.
   - If a provider is added, explain the model, the API cost, and any external dependency requirements before enabling paid usage.

6. Summarize the outcome clearly.
   - Report the files changed and the exact behavior implemented.
   - Explain how the chatbot response flow works and what configuration remains for real AI answers.

## Decision Points

- If the request is mainly UI work: implement the interface, conversation flow, and styling inside the existing chatbot component set.
- If a real answer source is required: prefer a server-side integration and keep API credentials out of the browser.
- If the project already has an API/service path: reuse it rather than creating a new architecture.
- If no integration exists: add only the minimal backend contract needed for the platform to work securely.
- If a provider introduces cost or new dependency: call it out explicitly before enabling it.

## Quality Bar

A result is complete when all of the following are true:

- The chatbot experience matches the project's Angular conventions and styling patterns.
- The change stays within the chatbot feature area and nearby files.
- The UI remains accessible and usable on small screens.
- Any external AI integration keeps credentials server-side and avoids leaks in client code.
- Relevant tests or validation checks are run and the outcome is reported.
- Remaining setup, limits, or costs are clearly explained to the user.

## Output Expectations

When you finish, provide:

- the files changed,
- the implementation summary,
- the answer-generation mechanism,
- any remaining configuration or environment variables required,
- and the focused verification performed.

This skill is intentionally narrow: it helps you build and refine a chatbot in a way that is safe, reusable, and consistent with the workspace without broad, unrelated changes.
