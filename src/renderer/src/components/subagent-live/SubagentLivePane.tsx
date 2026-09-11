import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { groupSubagentLiveRows } from './subagent-live-rows'
import { SubagentLiveMessage } from './SubagentLiveMessage'
import { useSubagentTranscriptStream } from './use-subagent-transcript-stream'

const FOLLOW_TAIL_SLACK_PX = 24

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

/** Live chat view of one omo child's senpi transcript, laid out like native chat and
 *  auto-following the tail. */
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
  const rows = useMemo(() => groupSubagentLiveRows(stream.events), [stream.events])
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
      className="flex h-full min-h-0 w-full flex-col bg-background text-sm"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
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
        <span className="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
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
            className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
          >
            {/* Same column and row rhythm as NativeChatMessageList. */}
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
              {rows.map((row) => (
                <SubagentLiveMessage key={row.seq} row={row} />
              ))}
            </div>
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
