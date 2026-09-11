import React, { useCallback } from 'react'
import { Radio } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

/** Open the floating live-output view for one child task; `sessionCwd` is the
 *  parent omo session's real cwd, where that child's transcript lives. */
export type OpenSubagentLive = (taskId: string, label: string, sessionCwd: string | null) => void

export const AGENT_ROW_ICON_BUTTON_CLASS =
  'flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-worktree-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring'

export function stopAgentRowKeyPropagation(e: React.KeyboardEvent): void {
  // Why: the enclosing sidebar list treats Enter/Space as row activation; nested
  // row buttons need those keys to stay local.
  if (e.key === 'Enter' || e.key === ' ') {
    e.stopPropagation()
  }
}

/** Per-row "open live output" action shared by the right Live Agents panel and the
 *  left worktree tree, so both surfaces open the same floating Subagent-Live view. */
export function SubagentLiveOutputButton({
  onOpen,
  className
}: {
  onOpen: () => void
  className?: string
}): React.JSX.Element {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      onOpen()
    },
    [onOpen]
  )
  return (
    <button
      type="button"
      data-live-agent-live-output
      className={cn(AGENT_ROW_ICON_BUTTON_CLASS, className)}
      aria-label={translate(
        'auto.components.right.sidebar.liveAgents.liveOutput',
        'Open live output'
      )}
      title={translate('auto.components.right.sidebar.liveAgents.liveOutput', 'Open live output')}
      onClick={handleClick}
      onKeyDown={stopAgentRowKeyPropagation}
    >
      <Radio className="size-3" aria-hidden />
    </button>
  )
}
