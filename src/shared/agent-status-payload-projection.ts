import type { ParsedAgentStatusPayload } from './agent-status-types'

// Why: spreading IPC rows would leak transport identity into client-visible status projections.
export function pickParsedAgentStatusPayload(
  row: ParsedAgentStatusPayload
): ParsedAgentStatusPayload {
  return {
    state: row.state,
    ...(row.workingMode !== undefined ? { workingMode: row.workingMode } : {}),
    prompt: row.prompt,
    ...(row.agentType !== undefined ? { agentType: row.agentType } : {}),
    ...(row.model !== undefined ? { model: row.model } : {}),
    ...(row.toolName !== undefined ? { toolName: row.toolName } : {}),
    ...(row.toolInput !== undefined ? { toolInput: row.toolInput } : {}),
    ...(row.interactivePrompt !== undefined ? { interactivePrompt: row.interactivePrompt } : {}),
    ...(row.lastAssistantMessage !== undefined
      ? { lastAssistantMessage: row.lastAssistantMessage }
      : {}),
    ...(row.lastAssistantMessageIsToolOutput !== undefined
      ? { lastAssistantMessageIsToolOutput: row.lastAssistantMessageIsToolOutput }
      : {}),
    ...(row.interrupted !== undefined ? { interrupted: row.interrupted } : {}),
    ...(row.sessionBoundary !== undefined ? { sessionBoundary: row.sessionBoundary } : {}),
    ...(row.turnCompletedAt !== undefined ? { turnCompletedAt: row.turnCompletedAt } : {}),
    ...(row.subagents !== undefined ? { subagents: row.subagents } : {}),
    ...(row.jobGraph !== undefined ? { jobGraph: row.jobGraph } : {})
  }
}
