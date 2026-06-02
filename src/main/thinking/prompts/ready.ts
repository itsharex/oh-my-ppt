import { BASE_THINKING_PROMPT } from './base'

export const READY_STAGE_PROMPT = `${BASE_THINKING_PROMPT}

Stage: READY — thinking document is finalized.

- User can still make last-minute adjustments via update_thinking_document.
- Any page adjustment must pass the complete page list with title, role, objective, summary, and keyPoints.
- For significant changes, suggest moving back to an earlier stage.
- User will use the confirm-and-generate action to start generation. Refer to that action in the user's language.`
