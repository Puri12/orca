// Normalized senpi child-session transcript events for the Subagent-Live view.
// Everything here crosses IPC, so keep it plain JSON.

export type SubagentTranscriptToolCall = {
  name: string
  /** Brief, already-truncated argument preview. */
  input: string
}

export type SubagentTranscriptEvent =
  | { kind: 'session'; sessionId: string; cwd: string | null; timestamp: number | null }
  | { kind: 'user'; text: string; timestamp: number | null }
  | {
      kind: 'assistant'
      text: string
      toolCalls: readonly SubagentTranscriptToolCall[]
      /** Non-null when the turn ended for a reason worth showing (error, aborted). */
      stopReason: string | null
      timestamp: number | null
    }
  | {
      kind: 'tool-result'
      toolName: string
      output: string
      isError: boolean
      timestamp: number | null
    }
  | { kind: 'model-change'; provider: string; modelId: string; timestamp: number | null }

/** Whether a child session transcript directory exists for the subscribed task. */
export type SubagentTranscriptStatus = 'live' | 'missing'

export type SubagentTranscriptSubscribeArgs = {
  /** Renderer-minted id, echoed on every pushed frame. */
  subscriptionId: string
  /** Filesystem path of the workspace the omo pane runs in. */
  worktreeCwd: string
  /** The child's senpi-task id (`job.taskId`). */
  taskId: string
}

export type SubagentTranscriptReplay = {
  status: SubagentTranscriptStatus
  events: SubagentTranscriptEvent[]
}

export type SubagentTranscriptFrame =
  | { type: 'appended'; events: SubagentTranscriptEvent[] }
  | { type: 'status'; status: SubagentTranscriptStatus }
  | { type: 'error'; message: string }

export type SubagentTranscriptFramePayload = {
  subscriptionId: string
  frame: SubagentTranscriptFrame
}
