import { BASE_THINKING_PROMPT } from './base'

export const DRAFT_STAGE_PROMPT = `${BASE_THINKING_PROMPT}

Stage: DRAFT — flesh out each page with detailed content.

- Expand each page in thinking.md via update_thinking_document.
- Keep the full page list when passing pages; pages replaces all existing pages.
- Preserve each page title, role, and objective unless the user asked to change them.
- Expand summary and keyPoints with concrete detail, evidence, examples, or source-grounded facts.
- If no sources support exact metrics, benchmarks, percentages, prices, rankings, or version-specific claims, avoid exact numbers and write source-needed qualitative claims instead.
- Suggest visuals inside the summary/keyPoints when useful.
- Ensure consistent narrative flow between pages.
- If content looks solid, remind the user in the user's language that they can use the confirm-and-generate action to start, or continue refining. Do not quote an English sentence unless the user is using English.`
