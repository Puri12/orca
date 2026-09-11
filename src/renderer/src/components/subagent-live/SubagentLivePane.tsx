import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  useSubagentTranscriptStream,
  type SequencedSubagentTranscriptEvent
} from './use-subagent-transcript-stream'

const FOLLOW_TAIL_SLACK_PX = 24

type LineTone = 'user' | 'assistant' | 'tool' | 'tool-error' | 'meta'

const TONE_CLASS: Record<LineTone, string> = {
  user: 'text-foreground',
  assistant: 'text-foreground/90',
  tool: 'text-muted-foreground',
  'tool-error': 'text-destructive',
  meta: 'text-muted-foreground/70'
}

const TAG_CLASS: Record<LineTone, string> = {
  user: 'text-primary',
  assistant: 'text-foreground/60',
  tool: 'text-muted-foreground/80',
  'tool-error': 'text-destructive',
  meta: 'text-muted-foreground/50'
}

function TranscriptLine({
  tag,
  tone,
  children,
  kind
}: {
  tag: string
  tone: LineTone
  kind: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      data-subagent-live-line={kind}
      className={cn('flex min-w-0 gap-2 px-3 py-0.5 leading-5', TONE_CLASS[tone])}
    >
      <span
        className={cn(
          'w-14 shrink-0 select-none text-right text-[10px] uppercase tracking-wider',
          TAG_CLASS[tone]
        )}
        aria-hidden
      >
        {tag}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{children}</span>
    </div>
  )
}

function renderEvent({ seq, event }: SequencedSubagentTranscriptEvent): React.ReactNode {
  switch (event.kind) {
    case 'session':
      return (
        <TranscriptLine key={seq} kind="session" tag="session" tone="meta">
          {event.sessionId}
          {event.cwd ? ` · ${event.cwd}` : ''}
        </TranscriptLine>
      )
    case 'model-change':
      return (
        <TranscriptLine key={seq} kind="model-change" tag="model" tone="meta">
          {event.provider}/{event.modelId}
        </TranscriptLine>
      )
    case 'user':
      return (
        <TranscriptLine key={seq} kind="user" tag="user" tone="user">
          {event.text}
        </TranscriptLine>
      )
    case 'assistant':
      return (
        <React.Fragment key={seq}>
          {event.text || event.stopReason ? (
            <TranscriptLine kind="assistant" tag="agent" tone="assistant">
              {event.text}
              {event.stopReason ? (
                <span className="ml-2 text-destructive">[{event.stopReason}]</span>
              ) : null}
            </TranscriptLine>
          ) : null}
          {event.toolCalls.map((call, callIndex) => (
            <TranscriptLine key={`${seq}-${callIndex}`} kind="tool-call" tag="tool" tone="tool">
              <span className="text-foreground/80">{call.name}</span>
              {call.input ? ` ${call.input}` : ''}
            </TranscriptLine>
          ))}
        </React.Fragment>
      )
    case 'tool-result':
      return (
        <TranscriptLine
          key={seq}
          kind="tool-result"
          tag={event.isError ? 'error' : 'result'}
          tone={event.isError ? 'tool-error' : 'tool'}
        >
          <span className="text-foreground/80">{event.toolName}</span>
          {event.output ? ` ${event.output}` : ''}
        </TranscriptLine>
      )
    default:
      return null
  }
}

function useFollowTail(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  eventCount: number
): { following: boolean; jumpToTail: () => void } {
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)

  const jumpToTail = useCallback(() => {
    const node = scrollRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
    followingRef.current = true
    setFollowing(true)
  }, [scrollRef])

  // Why: pin to the bottom before paint so a burst of appends never flashes the old tail.
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (node && followingRef.current) {
      node.scrollTop = node.scrollHeight
    }
  }, [eventCount, scrollRef])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) {
      return
    }
    const onScroll = (): void => {
      const atTail = node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_TAIL_SLACK_PX
      if (atTail !== followingRef.current) {
        followingRef.current = atTail
        setFollowing(atTail)
      }
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [scrollRef])

  return { following, jumpToTail }
}

function EmptyState({ title, detail }: { title: string; detail?: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <Radio className="size-7 text-muted-foreground/50" aria-hidden />
      <p className="text-sm text-foreground/90">{title}</p>
      {detail ? <p className="max-w-md text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

/** Terminal-like live log of one omo child's senpi transcript, auto-following the tail. */
export function SubagentLivePane({
  worktreeCwd,
  taskId,
  label
}: {
  worktreeCwd: string
  taskId: string
  label: string
}): React.JSX.Element {
  const stream = useSubagentTranscriptStream(worktreeCwd, taskId)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const { following, jumpToTail } = useFollowTail(scrollRef, stream.events.length)
  const statusLabel =
    stream.phase === 'live'
      ? translate('auto.components.subagentLive.status.live', 'Live')
      : stream.phase === 'missing'
        ? translate('auto.components.subagentLive.status.noTranscript', 'No transcript')
        : stream.phase === 'error'
          ? translate('auto.components.subagentLive.status.error', 'Error')
          : translate('auto.components.subagentLive.status.connecting', 'Connecting…')

  return (
    <div
      data-subagent-live-pane={taskId}
      data-subagent-live-phase={stream.phase}
      className="flex h-full min-h-0 w-full flex-col bg-editor-surface font-mono text-xs"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            stream.phase === 'live' ? 'bg-primary' : 'bg-muted-foreground/40'
          )}
          aria-hidden
        />
        <span className="min-w-0 truncate text-foreground/90" title={label}>
          {label}
        </span>
        <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {taskId}
        </span>
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
          {statusLabel}
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {stream.phase === 'missing' && stream.events.length === 0 ? (
          <EmptyState
            title={translate(
              'auto.components.subagentLive.missing.title',
              'No live transcript for this subagent'
            )}
            detail={translate(
              'auto.components.subagentLive.missing.detail',
              'In-process subagents write no session file. Set task.default_execution_mode to "process" in omo so each child runs as its own senpi process with a tailable transcript.'
            )}
          />
        ) : stream.phase === 'error' && stream.events.length === 0 ? (
          <EmptyState
            title={translate(
              'auto.components.subagentLive.error.title',
              'Could not read the subagent transcript'
            )}
            detail={stream.error ?? undefined}
          />
        ) : (
          <div
            ref={scrollRef}
            data-subagent-live-log
            className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto py-2"
          >
            {stream.events.map(renderEvent)}
          </div>
        )}
        {!following ? (
          <Button
            variant="outline"
            size="xs"
            data-subagent-live-follow
            className="absolute bottom-3 right-4 shadow-floating"
            onClick={jumpToTail}
          >
            <ArrowDownToLine aria-hidden />
            {translate('auto.components.subagentLive.followTail', 'Follow')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
