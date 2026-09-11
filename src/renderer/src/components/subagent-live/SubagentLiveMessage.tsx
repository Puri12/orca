import React from 'react'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { NativeChatToolLine } from '@/components/native-chat/NativeChatToolRun'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { SubagentTranscriptToolCall } from '../../../../shared/subagent-transcript-types'
import type { SubagentLiveRow, SubagentLiveToolResult } from './subagent-live-rows'

/** One tool call as native chat draws it: `▸ name  preview`, expanding to the arguments.
 *  The label was humanized when the transcript was parsed, so it is handed over as-is. */
function SubagentLiveToolCallLine({
  call
}: {
  call: SubagentTranscriptToolCall
}): React.JSX.Element {
  return (
    <div data-subagent-live-line="tool-call">
      <NativeChatToolLine
        block={{ type: 'tool-call', name: call.name, input: call.input }}
        initiallyExpanded={false}
        inputDisplay={{
          label: call.input,
          hasDetail: call.detail !== null,
          formatDetail: () => call.detail ?? ''
        }}
      />
    </div>
  )
}

/** A result folds to its first line like native chat; an error opens so its
 *  destructive body is visible without a click. */
function SubagentLiveToolResultLine({
  result
}: {
  result: SubagentLiveToolResult['event']
}): React.JSX.Element {
  return (
    <div data-subagent-live-line="tool-result">
      <NativeChatToolLine
        block={{ type: 'tool-result', output: result.output, isError: result.isError }}
        initiallyExpanded={result.isError}
      />
    </div>
  )
}

function stopReasonLabel(stopReason: string): string {
  switch (stopReason) {
    case 'aborted':
      return translate('auto.components.subagentLive.turn.aborted', 'Turn aborted')
    case 'error':
      return translate('auto.components.subagentLive.turn.error', 'Turn ended with an error')
    default:
      return stopReason
  }
}

function SubagentLiveUserRow({ text }: { text: string }): React.JSX.Element {
  return (
    <div data-subagent-live-role="user" className="flex flex-col items-end gap-0.5">
      {/* Same lifted muted bubble as a native-chat prompt, so the two views read alike. */}
      <div
        data-subagent-live-line="user"
        className="max-w-[85%] rounded-lg rounded-tr-sm bg-muted px-3.5 py-2.5 text-sm text-foreground"
      >
        <CommentMarkdown content={text} variant="document" className="text-sm" />
      </div>
    </div>
  )
}

/** Keys for one turn's tool calls: identical calls repeat, so each carries its occurrence
 *  (the same signature scheme NativeChatToolRun uses). */
function toolCallKeys(seq: number, calls: readonly SubagentTranscriptToolCall[]): string[] {
  const seen = new Map<string, number>()
  return calls.map((call) => {
    const signature = `${seq}:${call.name}:${call.input}`
    const occurrence = seen.get(signature) ?? 0
    seen.set(signature, occurrence + 1)
    return `${signature}:${occurrence}`
  })
}

function SubagentLiveAssistantRow({
  row
}: {
  row: Extract<SubagentLiveRow, { kind: 'assistant' }>
}): React.JSX.Element {
  const { event, results, seq } = row
  const hasProse = event.text.length > 0 || event.stopReason !== null
  const hasActivity = event.toolCalls.length > 0 || results.length > 0
  const callKeys = toolCallKeys(seq, event.toolCalls)
  return (
    <div
      data-subagent-live-role="assistant"
      className="max-w-full select-text text-sm leading-relaxed text-foreground"
    >
      {hasProse ? (
        <div data-subagent-live-line="assistant">
          {event.text ? (
            <CommentMarkdown content={event.text} variant="document" className="text-sm" />
          ) : null}
          {event.stopReason ? (
            <div className="text-[11px] text-destructive/80">
              {stopReasonLabel(event.stopReason)}
            </div>
          ) : null}
        </div>
      ) : null}
      {hasActivity ? (
        // Why: the same gap native chat leaves between assistant prose and its tool run.
        <div className={cn(hasProse && 'mt-3')}>
          {event.toolCalls.map((call, index) => (
            <SubagentLiveToolCallLine key={callKeys[index]} call={call} />
          ))}
          {results.map((result) => (
            <SubagentLiveToolResultLine key={result.seq} result={result.event} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SubagentLiveMetaRow({
  row
}: {
  row: Extract<SubagentLiveRow, { kind: 'meta' }>
}): React.JSX.Element {
  const { event } = row
  const label =
    event.kind === 'session'
      ? translate('auto.components.subagentLive.meta.session', 'Session')
      : translate('auto.components.subagentLive.meta.model', 'Model')
  const value =
    event.kind === 'session'
      ? `${event.sessionId}${event.cwd ? ` · ${event.cwd}` : ''}`
      : `${event.provider}/${event.modelId}`
  return (
    <div
      data-subagent-live-line={event.kind}
      className="flex min-w-0 items-baseline justify-center gap-1.5 text-xs text-muted-foreground"
    >
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate font-mono text-[11px]" title={value}>
        {value}
      </span>
    </div>
  )
}

/** One chat row of the Subagent-Live transcript, laid out like a native-chat message. */
export function SubagentLiveMessage({ row }: { row: SubagentLiveRow }): React.JSX.Element {
  switch (row.kind) {
    case 'user':
      return <SubagentLiveUserRow text={row.event.text} />
    case 'assistant':
      return <SubagentLiveAssistantRow row={row} />
    case 'tool-result':
      return <SubagentLiveToolResultLine result={row.event} />
    case 'meta':
      return <SubagentLiveMetaRow row={row} />
  }
}
