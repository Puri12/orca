// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardAgentRow as DashboardAgentRowData } from '@/components/dashboard/useDashboardData'
import { TooltipProvider } from '@/components/ui/tooltip'
import { openSubagentLiveInFloatingWorkspace } from '@/lib/open-subagent-live-in-floating-workspace'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { buildSubagentChildRows } from './worktree-subagent-child-rows'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WORKTREE_ID = 'repo-1::/repo/worktrees/omo'
const WORKTREE_PATH = '/repo/worktrees/omo'
const SESSION_CWD = '/repo/worktrees/omo/packages/app'
const TAB_ID = 'tab-omo'
const PANE_KEY = makePaneKey(TAB_ID, '11111111-1111-4111-8111-111111111111')
const tab = { id: TAB_ID, worktreeId: WORKTREE_ID, title: 'omo' } as unknown as TerminalTab

let mockAgents: DashboardAgentRowData[] = []
let mockAgentActivityDisplayMode: 'compact' | 'full' | undefined

function buildMockStoreState(): Record<string, unknown> {
  return {
    agentActivityDisplayMode: mockAgentActivityDisplayMode,
    acknowledgedAgentsByPaneKey: {},
    cacheTimerByKey: {},
    dropAgentStatus: vi.fn(),
    dismissRetainedAgent: vi.fn(),
    acknowledgeAgents: vi.fn(),
    agentSendPopoverTargetMode: null,
    agentStatusByPaneKey: {},
    agentStatusEpoch: 0,
    tabsByWorktree: { [WORKTREE_ID]: [tab] },
    terminalLayoutsByTabId: {},
    ptyIdsByTabId: {},
    runtimePaneTitlesByTabId: {},
    sendPromptToSidebarAgentTarget: vi.fn(),
    getKnownWorktreeById: (worktreeId: string) =>
      worktreeId === WORKTREE_ID ? { id: WORKTREE_ID, path: WORKTREE_PATH } : undefined,
    settings: { promptCacheTimerEnabled: false, promptCacheTtlMs: 60_000 }
  }
}

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(buildMockStoreState()),
    { getState: () => buildMockStoreState() }
  )
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: vi.fn() }))
vi.mock('@/lib/open-subagent-live-in-floating-workspace', () => ({
  openSubagentLiveInFloatingWorkspace: vi.fn()
}))
vi.mock('./useWorktreeAgentRows', () => ({ useWorktreeAgentRows: vi.fn(() => mockAgents) }))
vi.mock('@/hooks/use-now', () => ({ useNow: vi.fn(() => 2000) }))
vi.mock('./focused-agent-row-highlight', () => ({ useFocusedAgentPaneKey: vi.fn(() => null) }))
vi.mock('@/components/dashboard/use-agent-row-conversation-name', () => ({
  useAgentRowConversationName: () => null
}))
vi.mock('./CacheTimer', () => ({ default: () => null, usePromptCacheCountdownForPane: () => null }))

function makeRows(parentOverrides: Partial<AgentStatusEntry> = {}): DashboardAgentRowData[] {
  const parentEntry: AgentStatusEntry = {
    paneKey: PANE_KEY,
    tabId: TAB_ID,
    worktreeId: WORKTREE_ID,
    agentType: 'omo',
    state: 'working',
    prompt: 'Build navigation',
    updatedAt: 1_500,
    stateStartedAt: 1_000,
    stateHistory: [],
    subagents: [
      {
        id: 'map',
        description: 'Map shell navigation',
        agentType: 'quick',
        state: 'working',
        startedAt: 1_200,
        job: { taskId: 'task-map', lifecycle: 'running' }
      }
    ],
    ...parentOverrides
  }
  const rootRow: DashboardAgentRowData = {
    paneKey: PANE_KEY,
    entry: parentEntry,
    tab,
    agentType: 'omo',
    rowSource: 'live',
    state: 'working',
    startedAt: 1_000
  }
  return [rootRow, ...buildSubagentChildRows({ parentEntry, tab, parentIsFresh: true })]
}

let root: Root | null = null
let host: HTMLDivElement | null = null

async function mount(): Promise<HTMLDivElement> {
  const { default: WorktreeCardAgents } = await import('./WorktreeCardAgents')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(
      <TooltipProvider>
        <WorktreeCardAgents worktreeId={WORKTREE_ID} />
      </TooltipProvider>
    )
  })
  return host
}

function rowContaining(container: HTMLElement, rowSelector: string, text: string): HTMLElement {
  const row = [...container.querySelectorAll<HTMLElement>(rowSelector)].find((el) =>
    el.textContent?.includes(text)
  )
  if (!row) {
    throw new Error(`no ${rowSelector} row containing ${JSON.stringify(text)}`)
  }
  return row
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) {
    throw new Error('expected an element to click')
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.mocked(openSubagentLiveInFloatingWorkspace).mockClear()
  vi.mocked(activateAndRevealWorktree).mockClear()
  mockAgentActivityDisplayMode = undefined
  mockAgents = makeRows({ sessionCwd: SESSION_CWD })
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  root = null
  host?.remove()
  host = null
})

describe('WorktreeCardAgents subagent live output', () => {
  it('offers live output only on subagent rows and opens it against the parent session cwd', async () => {
    const container = await mount()

    const rootRow = rowContaining(container, '.compact-agent-row', 'Build navigation')
    expect(rootRow.querySelector('[data-live-agent-live-output]')).toBeNull()
    const childRow = rowContaining(container, '.compact-agent-row', 'Map shell navigation')
    const liveOutput = childRow.querySelector('[data-live-agent-live-output]')
    expect(liveOutput).not.toBeNull()

    await click(liveOutput)
    expect(openSubagentLiveInFloatingWorkspace).toHaveBeenCalledWith({
      worktreeCwd: SESSION_CWD,
      taskId: 'task-map',
      label: 'Map shell navigation'
    })
    // Why: the action must not double as the row click, which jumps to the parent pane.
    expect(activateAndRevealWorktree).not.toHaveBeenCalled()

    await click(childRow)
    expect(activateAndRevealWorktree).toHaveBeenCalledWith(WORKTREE_ID)
    expect(openSubagentLiveInFloatingWorkspace).toHaveBeenCalledTimes(1)
  })

  it('falls back to the known worktree path when the parent reported no session cwd', async () => {
    mockAgents = makeRows()
    const container = await mount()

    const childRow = rowContaining(container, '.compact-agent-row', 'Map shell navigation')
    await click(childRow.querySelector('[data-live-agent-live-output]'))
    expect(openSubagentLiveInFloatingWorkspace).toHaveBeenCalledWith({
      worktreeCwd: WORKTREE_PATH,
      taskId: 'task-map',
      label: 'Map shell navigation'
    })
  })

  it('offers the same action on full-mode rows', async () => {
    mockAgentActivityDisplayMode = 'full'
    const container = await mount()

    const buttons = container.querySelectorAll('[data-live-agent-live-output]')
    expect(buttons).toHaveLength(1)
    // Why: without lineage metadata the full row has no tree role; the row is the nearest activatable ancestor.
    const childRow = buttons[0].closest('.cursor-pointer')
    expect(childRow?.textContent).toContain('Map shell navigation')
    expect(childRow?.textContent).not.toContain('Build navigation')

    await click(buttons[0])
    expect(openSubagentLiveInFloatingWorkspace).toHaveBeenCalledWith({
      worktreeCwd: SESSION_CWD,
      taskId: 'task-map',
      label: 'Map shell navigation'
    })
    expect(activateAndRevealWorktree).not.toHaveBeenCalled()
  })
})
