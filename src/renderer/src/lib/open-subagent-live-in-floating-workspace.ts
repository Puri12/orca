import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import type { AppState } from '@/store/types'
import { useAppStore } from '@/store'
import { TOGGLE_FLOATING_TERMINAL_EVENT } from './floating-terminal'
import { isFloatingWorkspacePanelVisible } from './floating-workspace-terminal-actions'
import { buildSubagentLiveFileId } from './subagent-live-file-id'

export type OpenSubagentLiveArgs = {
  worktreeCwd: string
  taskId: string
  label: string
}

type SubagentLiveStore = Pick<AppState, 'activeGroupIdByWorktree' | 'openFile'>

/** Open (or focus) the floating Subagent-Live tab bound to one child transcript. */
export function openSubagentLiveInFloatingWorkspace(
  args: OpenSubagentLiveArgs,
  store: SubagentLiveStore = useAppStore.getState()
): string {
  const id = buildSubagentLiveFileId(args.taskId)
  const fileId = store.openFile(
    {
      filePath: id,
      relativePath: args.label,
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      language: 'plaintext',
      mode: 'subagent-live',
      runtimeEnvironmentId: null,
      subagentLive: { worktreeCwd: args.worktreeCwd, taskId: args.taskId, label: args.label }
    },
    {
      preview: false,
      targetGroupId: store.activeGroupIdByWorktree[FLOATING_TERMINAL_WORKTREE_ID],
      suppressActiveRuntimeFallback: true
    }
  )
  // Why: the panel owns its open flag in React state; the toggle event is the only outside handle.
  if (typeof document !== 'undefined' && !isFloatingWorkspacePanelVisible(document)) {
    window.dispatchEvent(new Event(TOGGLE_FLOATING_TERMINAL_EVENT))
  }
  return fileId
}
