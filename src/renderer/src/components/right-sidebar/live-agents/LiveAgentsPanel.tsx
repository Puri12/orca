import React, { useCallback, useMemo } from 'react'
import { Radio } from 'lucide-react'
import { useWorktreeAgentRows } from '@/components/sidebar/useWorktreeAgentRows'
import { useFocusedAgentPaneKey } from '@/components/sidebar/focused-agent-row-highlight'
import { useNow } from '@/hooks/use-now'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { openSubagentLiveInFloatingWorkspace } from '@/lib/open-subagent-live-in-floating-workspace'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useActiveWorktreeId } from '@/store/selectors'
import { useAppStore } from '@/store'
import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import {
  LiveAgentCompactRow,
  LiveAgentGraphNodeRow,
  type OpenSubagentLive
} from './LiveAgentExpandableRow'
import {
  buildLiveAgentSections,
  type LiveAgentSection,
  type LiveAgentWave
} from './live-agent-sections'

function activateAgentPane(worktreeId: string, tabId: string, paneKey: string): void {
  const parsed = parsePaneKey(paneKey)
  if (!parsed || parsed.tabId !== tabId) {
    return
  }
  activateAndRevealWorktree(worktreeId)
  activateTabAndFocusPane(tabId, parsed.leafId, { flashFocusedPane: true })
}

function WaveGroup({
  wave,
  now,
  onJump,
  onOpenSubagentLive
}: {
  wave: LiveAgentWave
  now: number
  onJump: () => void
  onOpenSubagentLive?: OpenSubagentLive
}) {
  return (
    <div
      role="list"
      aria-label={wave.label}
      data-live-agent-wave={wave.key}
      className="flex flex-col"
    >
      <div className="flex items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{wave.label}</span>
        <span className="text-muted-foreground/60">{wave.nodes.length}</span>
      </div>
      <div className="worktree-agent-lineage-children flex flex-col gap-0.5">
        {wave.nodes.map((graphNode) => (
          <LiveAgentGraphNodeRow
            key={graphNode.node.id}
            graphNode={graphNode}
            now={now}
            onJump={onJump}
            onOpenSubagentLive={onOpenSubagentLive}
          />
        ))}
      </div>
    </div>
  )
}

function AgentSection({
  section,
  now,
  onActivate,
  onOpenSubagentLive,
  focusedPaneKey
}: {
  section: LiveAgentSection
  now: number
  onActivate: (tabId: string, paneKey: string) => void
  onOpenSubagentLive?: OpenSubagentLive
  focusedPaneKey: string | null
}) {
  const { root, children, waves, runLabel } = section
  // Why: jobGraph nodes run inside the root's session, so their pane is the root's.
  const jumpToRoot = useCallback(
    () => onActivate(root.tab.id, root.paneKey),
    [onActivate, root.paneKey, root.tab.id]
  )
  return (
    <section
      data-live-agent-section={root.paneKey}
      className="flex flex-col gap-0.5 border-b border-border/40 px-2 py-1.5"
    >
      <LiveAgentCompactRow
        agent={root}
        now={now}
        onActivate={onActivate}
        isFocusedPane={root.paneKey === focusedPaneKey}
      />
      {waves ? (
        <div className="flex flex-col gap-1 pl-3">
          {runLabel ? (
            <div
              className="truncate px-1 text-[11px] leading-4 text-muted-foreground/80"
              title={runLabel}
            >
              {runLabel}
            </div>
          ) : null}
          {waves.map((wave) => (
            <WaveGroup
              key={wave.key}
              wave={wave}
              now={now}
              onJump={jumpToRoot}
              onOpenSubagentLive={onOpenSubagentLive}
            />
          ))}
        </div>
      ) : children.length > 0 ? (
        <div className="worktree-agent-lineage-children flex flex-col gap-0.5 pl-3">
          {children.map((child) => (
            <LiveAgentCompactRow
              key={child.paneKey}
              agent={child}
              now={now}
              onActivate={onActivate}
              onOpenSubagentLive={onOpenSubagentLive}
              isFocusedPane={child.paneKey === focusedPaneKey}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

/** Right-sidebar panel: the active workspace's live agents, with omo job graphs grouped by wave. */
export default function LiveAgentsPanel(): React.JSX.Element {
  const worktreeId = useActiveWorktreeId()
  const rows = useWorktreeAgentRows(worktreeId ?? '', worktreeId !== null)
  const focusedPaneKey = useFocusedAgentPaneKey(worktreeId ?? '')
  const sections = useMemo(() => buildLiveAgentSections(rows), [rows])
  const now = useNow(30_000, sections.length > 0)
  const onActivate = useCallback(
    (tabId: string, paneKey: string) => {
      if (worktreeId) {
        activateAgentPane(worktreeId, tabId, paneKey)
      }
    },
    [worktreeId]
  )
  // Why: prefer hook-reported sessionCwd (omo real cwd for transcripts); fallback to worktree path for older builds. The agent status entry for the pane is already read in that panel (reuse for jobGraph/subagents).
  const worktreeCwd = useAppStore((state) => {
    if (!worktreeId) {
      return null
    }
    const entry = Object.values(state.agentStatusByPaneKey).find(
      (e) => e.worktreeId === worktreeId || e.paneKey.includes(worktreeId)
    )
    return entry?.sessionCwd ?? state.getKnownWorktreeById(worktreeId)?.path ?? null
  })
  const onOpenSubagentLive = useMemo<OpenSubagentLive | undefined>(
    () =>
      worktreeCwd
        ? (taskId, label) => openSubagentLiveInFloatingWorkspace({ worktreeCwd, taskId, label })
        : undefined,
    [worktreeCwd]
  )

  if (!worktreeId) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center text-muted-foreground">
        <Radio size={32} className="mb-3 opacity-50" />
        <p className="text-sm">
          {translate(
            'auto.components.right.sidebar.PortsPanel.c1b115c375',
            'No workspace selected'
          )}
        </p>
      </div>
    )
  }

  return (
    <div
      data-live-agents-panel
      className={cn('flex h-full flex-col overflow-y-auto scrollbar-sleek')}
      data-compact-agent-list="true"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {translate('auto.components.right.sidebar.liveAgents.title', 'Live agents')}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/60">{rows.length}</span>
      </div>
      {sections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center text-muted-foreground">
          <Radio size={32} className="mb-3 opacity-50" />
          <p className="text-sm">
            {translate(
              'auto.components.right.sidebar.liveAgents.empty',
              'No agents are reporting in this workspace'
            )}
          </p>
        </div>
      ) : (
        sections.map((section) => (
          <AgentSection
            key={section.root.paneKey}
            section={section}
            now={now}
            onActivate={onActivate}
            onOpenSubagentLive={onOpenSubagentLive}
            focusedPaneKey={focusedPaneKey}
          />
        ))
      )}
    </div>
  )
}
