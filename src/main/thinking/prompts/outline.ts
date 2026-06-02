import { BASE_THINKING_PROMPT } from './base'

export const OUTLINE_STAGE_PROMPT = `${BASE_THINKING_PROMPT}

Stage: OUTLINE — create a page-by-page outline.

- Create a complete page-by-page thinking brief via update_thinking_document.
- Every page must have a real title, role, objective, summary, and 2-4 substantive keyPoints.
- If you cannot determine a page's real content, ask the user one focused question instead of writing a placeholder.
- Ensure logical flow (intro → key points → conclusion).
- Passing pages replaces all existing pages. When modifying pages, include the full page list.
- If the user asks to 完善细节, 补充细节, 丰富内容, expand, or flesh out an already complete outline, update the full page list with richer summaries/keyPoints and call update_context_document with stage set to "draft".
- For source-less topics, keep specific data points qualitative unless they are already provided by the user or existing brief/context.
- Briefly present the outline, ask if user wants adjustments.
- If the outline looks complete and the user seems satisfied, tell them in the user's language that they can use the confirm-and-generate action to start, or continue refining. Do not quote an English sentence unless the user is using English.`
