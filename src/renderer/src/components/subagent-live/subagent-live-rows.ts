import type { SubagentTranscriptEvent } from '../../../../shared/subagent-transcript-types'
import type { SequencedSubagentTranscriptEvent } from './use-subagent-transcript-stream'

type EventOfKind<K extends SubagentTranscriptEvent['kind']> = Extract<
  SubagentTranscriptEvent,
  { kind: K }
>

export type SubagentLiveToolResult = { seq: number; event: EventOfKind<'tool-result'> }

export type SubagentLiveRow =
  | { kind: 'meta'; seq: number; event: EventOfKind<'session'> | EventOfKind<'model-change'> }
  | { kind: 'user'; seq: number; event: EventOfKind<'user'> }
  | {
      kind: 'assistant'
      seq: number
      event: EventOfKind<'assistant'>
      results: SubagentLiveToolResult[]
    }
  | { kind: 'tool-result'; seq: number; event: EventOfKind<'tool-result'> }

/** Chat rows for the transcript. A tool result lands under the assistant turn that
 *  called for it (native-chat parity) instead of floating as its own line; one that
 *  arrives with no such turn keeps its own row. */
export function groupSubagentLiveRows(
  events: readonly SequencedSubagentTranscriptEvent[]
): SubagentLiveRow[] {
  const rows: SubagentLiveRow[] = []
  for (const { seq, event } of events) {
    switch (event.kind) {
      case 'session':
      case 'model-change':
        rows.push({ kind: 'meta', seq, event })
        break
      case 'user':
        rows.push({ kind: 'user', seq, event })
        break
      case 'assistant':
        rows.push({ kind: 'assistant', seq, event, results: [] })
        break
      case 'tool-result': {
        const last = rows.at(-1)
        if (last?.kind === 'assistant' && last.event.toolCalls.length > 0) {
          last.results.push({ seq, event })
        } else {
          rows.push({ kind: 'tool-result', seq, event })
        }
        break
      }
    }
  }
  return rows
}
