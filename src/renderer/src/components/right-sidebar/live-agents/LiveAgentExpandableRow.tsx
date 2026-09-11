import React, { useCallback, useMemo, useState } from 'react'
import { ArrowUpRight, ChevronRight, CornerDownRight } from 'lucide-react'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { CompactAgentRow } from '@/components/sidebar/worktree-card-compact-agent-row'
import {
  AGENT_ROW_ICON_BUTTON_CLASS as ROW_ICON_BUTTON_CLASS,
  SubagentLiveOutputButton,
  stopAgentRowKeyPropagation as stopRowKeyPropagation,
  type OpenSubagentLive
} from '@/components/sidebar/subagent-live-output-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import {
  buildCurrentWorkDetail,
  currentWorkSourceFromGraphNode,
  currentWorkSourceFromRow,
  type LiveAgentCurrentWorkLineKey,
  type LiveAgentCurrentWorkSource
} from './live-agent-current-work'
import { dagStatusToDotState, type LiveAgentGraphNode } from './live-agent-sections'

type ActivatePane = (tabId: string, paneKey: string) => void
export type { OpenSubagentLive }

const NUMERIC_DETAIL_LINE_KEYS: ReadonlySet<LiveAgentCurrentWorkLineKey> = new Set([
  'turns',
  'tools',
  'tokensPerSecond',
  'runtime',
  'elapsed'
])

function JumpToPaneButton({ onJump }: { onJump: () => void }): React.JSX.Element {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      onJump()
    },
    [onJump]
  )
  return (
    <button
      type="button"
      data-live-agent-jump
      className={cn(ROW_ICON_BUTTON_CLASS, 'self-start')}
      aria-label={translate(
        'auto.components.right.sidebar.liveAgents.jumpToPane',
        'Jump to agent pane'
      )}
      title={translate('auto.components.right.sidebar.liveAgents.jumpToPane', 'Jump to agent pane')}
      onClick={handleClick}
      onKeyDown={stopRowKeyPropagation}
    >
      <ArrowUpRight className="size-3" aria-hidden />
    </button>
  )
}

function DisclosureButton({ open }: { open: boolean }): React.JSX.Element {
  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        data-live-agent-detail-trigger
        className={ROW_ICON_BUTTON_CLASS}
        aria-label={
          open
            ? translate('auto.components.right.sidebar.liveAgents.hideDetail', 'Hide current work')
            : translate('auto.components.right.sidebar.liveAgents.showDetail', 'Show current work')
        }
        onKeyDown={stopRowKeyPropagation}
      >
        <ChevronRight
          className={cn('size-3 transition-transform duration-150', open && 'rotate-90')}
          aria-hidden
        />
      </button>
    </CollapsibleTrigger>
  )
}

/** Mounted only while open: Radix keeps a hidden content node otherwise, and a
 *  collapsed row should neither hold detail DOM nor rebuild it on every roster tick. */
function CurrentWorkDetail({
  source,
  now
}: {
  source: LiveAgentCurrentWorkSource
  now: number
}): React.JSX.Element {
  const detail = useMemo(() => buildCurrentWorkDetail(source, now), [source, now])
  return (
    <CollapsibleContent
      data-live-agent-detail
      className="flex flex-col gap-1 py-1 pl-5 pr-1 text-[11px] leading-4"
    >
      {!detail.activityReported && (
        <div className="text-muted-foreground/60">
          {translate(
            'auto.components.right.sidebar.liveAgents.noActivity',
            'No current activity reported'
          )}
        </div>
      )}
      {detail.lines.map((line) => (
        <div key={line.key} data-live-agent-detail-line={line.key} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {line.label}
          </span>
          <span
            className={cn(
              'line-clamp-4 break-words text-foreground/90',
              (line.key === 'tool' || line.key === 'model') && 'font-mono text-[10px]',
              NUMERIC_DETAIL_LINE_KEYS.has(line.key) && 'tabular-nums'
            )}
            title={line.value}
          >
            {line.value}
          </span>
        </div>
      ))}
    </CollapsibleContent>
  )
}

/** Root or flat child row: the row body toggles the detail, the arrow jumps to the pane. */
export function LiveAgentCompactRow({
  agent,
  now,
  onActivate,
  onOpenSubagentLive,
  isFocusedPane
}: {
  agent: DashboardAgentRow
  now: number
  onActivate: ActivatePane
  onOpenSubagentLive?: OpenSubagentLive
  isFocusedPane: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen((value) => !value), [])
  const jump = useCallback(
    // Why: subagent rows have no pane of their own; they jump to the parent that spawned them.
    () => onActivate(agent.tab.id, agent.activationPaneKey ?? agent.paneKey),
    [agent.activationPaneKey, agent.paneKey, agent.tab.id, onActivate]
  )
  const source = useMemo(() => currentWorkSourceFromRow(agent), [agent])
  const taskId = agent.job?.taskId
  // Why: a synthetic subagent row stores the child's description as its prompt.
  const openLive = useCallback(() => {
    if (taskId) {
      onOpenSubagentLive?.(taskId, agent.entry.prompt || taskId, agent.entry.sessionCwd ?? null)
    }
  }, [agent.entry.prompt, agent.entry.sessionCwd, onOpenSubagentLive, taskId])
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-live-agent-row={agent.paneKey}
      className="flex min-w-0 flex-col"
    >
      <div className="flex min-w-0 items-center gap-0.5">
        <DisclosureButton open={open} />
        <div className="min-w-0 flex-1">
          <CompactAgentRow
            agent={agent}
            now={now}
            onActivate={toggle}
            isFocusedPane={isFocusedPane}
            cacheTimerActive={false}
          />
        </div>
        {taskId && onOpenSubagentLive ? (
          <SubagentLiveOutputButton onOpen={openLive} className="self-start" />
        ) : null}
        <JumpToPaneButton onJump={jump} />
      </div>
      {open && <CurrentWorkDetail source={source} now={now} />}
    </Collapsible>
  )
}

/** A jobGraph node under a wave header; the whole row body is the disclosure trigger. */
export function LiveAgentGraphNodeRow({
  graphNode,
  now,
  onJump,
  onOpenSubagentLive,
  sessionCwd
}: {
  graphNode: LiveAgentGraphNode
  now: number
  onJump: () => void
  onOpenSubagentLive?: OpenSubagentLive
  /** The root session's cwd: jobGraph nodes run inside it, so their transcripts live there. */
  sessionCwd: string | null
}): React.JSX.Element {
  const { node, dependsOnLabels } = graphNode
  const taskId = graphNode.taskId
  const openLive = useCallback(() => {
    if (taskId) {
      onOpenSubagentLive?.(taskId, node.label, sessionCwd)
    }
  }, [node.label, onOpenSubagentLive, sessionCwd, taskId])
  const [open, setOpen] = useState(false)
  const source = useMemo(() => currentWorkSourceFromGraphNode(graphNode), [graphNode])
  const dotState = dagStatusToDotState(node.status)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      role="listitem"
      data-live-agent-node={node.id}
      data-live-agent-row={node.id}
      className="worktree-agent-lineage-child-row flex min-w-0 flex-col rounded-sm px-1 py-1 text-[11px] leading-none text-muted-foreground worktree-agent-row-hover"
    >
      <div className="flex min-w-0 items-start gap-1">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-live-agent-detail-trigger
            className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
            onKeyDown={stopRowKeyPropagation}
          >
            <span className="flex h-4 min-w-0 items-center gap-1">
              <AgentStateDot state={dotState} size="sm" tooltipSide="left" />
              <span className="min-w-0 flex-1 truncate text-foreground/90" title={node.label}>
                {node.label}
              </span>
              {source.model && (
                <span
                  className="min-w-0 max-w-24 truncate font-mono text-[10px] text-muted-foreground/70"
                  title={source.model}
                >
                  {source.model}
                </span>
              )}
              {source.startedAt > 0 ? (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                  {formatShortTimeAgo(source.startedAt, now)}
                </span>
              ) : null}
            </span>
            {source.currentStep ? (
              <span
                className="block truncate pl-4 text-[11px] leading-4 text-muted-foreground/80"
                title={source.currentStep}
              >
                {source.currentStep}
              </span>
            ) : (
              <span className="block pl-4 text-[11px] leading-4 text-muted-foreground/60">
                {agentStateLabel(dotState)}
              </span>
            )}
            {dependsOnLabels.length > 0 && (
              <span
                data-live-agent-depends-on
                className="flex min-w-0 items-center gap-1 pl-4 text-[10px] leading-4 text-muted-foreground/70"
              >
                <CornerDownRight className="size-2.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {translate(
                    'auto.components.right.sidebar.liveAgents.dependsOn',
                    'depends on {{value0}}',
                    { value0: dependsOnLabels.join(', ') }
                  )}
                </span>
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        {taskId && onOpenSubagentLive ? (
          <SubagentLiveOutputButton onOpen={openLive} className="self-start" />
        ) : null}
        <JumpToPaneButton onJump={onJump} />
      </div>
      {open && <CurrentWorkDetail source={source} now={now} />}
    </Collapsible>
  )
}
