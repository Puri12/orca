// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { openSubagentLiveInFloatingWorkspace } from '@/lib/open-subagent-live-in-floating-workspace'
import type { Worktree } from '../../../../../shared/worktree/types'
import { useAppStore } from '@/store'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import LiveAgentsPanel from './LiveAgentsPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/dashboard/use-agent-row-conversation-name', () => ({
  useAgentRowConversationName: () => null
}))
vi.mock('@/components/sidebar/CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownForPane: () => null
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: vi.fn()
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: vi.fn()
}))
vi.mock('@/lib/open-subagent-live-in-floating-workspace', () => ({
  openSubagentLiveInFloatingWorkspace: vi.fn()
}))

const WORKTREE_ID = 'repo-1::/repo/worktrees/omo'
const WORKTREE_PATH = '/repo/worktrees/omo'
const TAB_ID = 'tab-omo'
const PANE_KEY = `${TAB_ID}:11111111-1111-4111-8111-111111111111`
const NOW = 600_000

const tab = {
  id: TAB_ID,
  worktreeId: WORKTREE_ID,
  title: 'omo',
  paneStates: [],
  activePaneId: 0,
  createdAt: 1
} as unknown as TerminalTab

function makeEntry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    paneKey: PANE_KEY,
    tabId: TAB_ID,
    worktreeId: WORKTREE_ID,
    agentType: 'omo',
    state: 'working',
    prompt: 'Build navigation',
    toolName: 'Read',
    toolInput: 'src/router.ts',
    model: 'gpt-6-astra',
    updatedAt: NOW,
    stateStartedAt: NOW - 5_000,
    stateHistory: [],
    subagents: [
      {
        id: 'map',
        description: 'Map shell navigation',
        agentType: 'quick',
        model: 'gpt-6-astra',
        state: 'working',
        startedAt: NOW - 3_000,
        job: {
          taskId: 'task-map',
          lifecycle: 'running',
          currentStep: 'Reading routes'
        }
      },
      {
        id: 'cover',
        description: 'Test coverage',
        agentType: 'quick',
        state: 'idle',
        startedAt: 0,
        job: { lifecycle: 'queued' }
      }
    ],
    ...overrides
  }
}

const jobGraph = {
  runLabel: 'Dependency run',
  waves: [['A'], ['B', 'C']],
  nodes: [
    { nodeId: 'A', taskId: 'task-map', dependsOn: [] },
    { nodeId: 'B', taskId: 'cover', dependsOn: ['A'] },
    {
      nodeId: 'C',
      label: 'Verify evidence',
      dependsOn: ['A', 'B'],
      state: 'queued'
    }
  ]
}

const initialState = useAppStore.getState()
let root: Root | null = null
let container: HTMLDivElement | null = null

function seed(entry: AgentStatusEntry, options: { withWorktreePath?: boolean } = {}): void {
  act(() => {
    useAppStore.setState({
      activeWorktreeId: WORKTREE_ID,
      tabsByWorktree: { [WORKTREE_ID]: [tab] },
      agentStatusByPaneKey: { [PANE_KEY]: entry },
      worktreesByRepo:
        options.withWorktreePath === false
          ? {}
          : {
              'repo-1': [
                { id: WORKTREE_ID, repoId: 'repo-1', path: WORKTREE_PATH } as unknown as Worktree
              ]
            }
    })
  })
}

function click(element: Element | null | undefined): void {
  if (!(element instanceof HTMLElement)) {
    throw new Error('expected an element to click')
  }
  act(() => element.click())
}

function detailLine(host: HTMLElement, rowKey: string, key: string): string | undefined {
  return host
    .querySelector(`[data-live-agent-row="${rowKey}"] [data-live-agent-detail-line="${key}"]`)
    ?.textContent?.trim()
}

function mount(): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <TooltipProvider>
        <LiveAgentsPanel />
      </TooltipProvider>
    )
  })
  return container
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(activateTabAndFocusPane).mockClear()
  vi.mocked(activateAndRevealWorktree).mockClear()
  vi.mocked(openSubagentLiveInFloatingWorkspace).mockClear()
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  root = null
  container?.remove()
  container = null
  useAppStore.setState(initialState, true)
  vi.useRealTimers()
})

describe('LiveAgentsPanel', () => {
  it('renders the live root agent with its current activity and flat subagent rows', () => {
    seed(makeEntry())
    const host = mount()

    const section = host.querySelector(`[data-live-agent-section="${PANE_KEY}"]`)
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain('Build navigation')
    expect(section?.textContent).toContain('Read')
    expect(section?.textContent).toContain('src/router.ts')
    expect(section?.textContent).toContain('Map shell navigation')
    expect(section?.textContent).toContain('Test coverage')
    expect(host.querySelector('[data-live-agent-wave]')).toBeNull()
    expect(host.querySelector('[aria-label="Working"]')).not.toBeNull()
  })

  it('groups jobGraph nodes by wave with dependency annotations and updates live', () => {
    seed(makeEntry({ jobGraph }))
    const host = mount()

    const waves = [...host.querySelectorAll<HTMLElement>('[data-live-agent-wave]')]
    expect(waves.map((wave) => wave.getAttribute('aria-label'))).toEqual(['Wave 1', 'Wave 2'])
    expect(waves[0].querySelectorAll('[data-live-agent-node]')).toHaveLength(1)
    expect(waves[1].querySelectorAll('[data-live-agent-node]')).toHaveLength(2)
    expect(host.textContent).toContain('Dependency run')

    const nodeA = host.querySelector('[data-live-agent-node="A"]')
    expect(nodeA?.textContent).toContain('Map shell navigation')
    expect(nodeA?.textContent).toContain('Reading routes')
    expect(nodeA?.querySelector('[data-live-agent-depends-on]')).toBeNull()

    const nodeC = host.querySelector('[data-live-agent-node="C"]')
    expect(nodeC?.textContent).toContain('Verify evidence')
    expect(nodeC?.querySelector('[data-live-agent-depends-on]')?.textContent).toContain(
      'depends on Map shell navigation, Test coverage'
    )
    expect(nodeC?.querySelector('[aria-label="Idle"]')).not.toBeNull()

    act(() => {
      useAppStore.setState({
        agentStatusByPaneKey: {
          [PANE_KEY]: makeEntry({
            jobGraph,
            updatedAt: NOW + 1_000,
            subagents: [
              {
                id: 'map',
                description: 'Map shell navigation',
                agentType: 'quick',
                model: 'gpt-6-astra',
                state: 'idle',
                startedAt: NOW - 3_000,
                job: {
                  taskId: 'task-map',
                  lifecycle: 'succeeded',
                  currentStep: 'Routes mapped'
                }
              }
            ]
          })
        }
      })
    })
    const updatedNodeA = host.querySelector('[data-live-agent-node="A"]')
    expect(updatedNodeA?.textContent).toContain('Routes mapped')
    expect(updatedNodeA?.querySelector('[aria-label="Done"]')).not.toBeNull()
  })

  it('expands a root row on click into its live current work and keeps it live', () => {
    seed(
      makeEntry({
        lastAssistantMessage: 'Mapped 12 routes so far',
        stateStartedAt: NOW - 5 * 60_000
      })
    )
    const host = mount()

    const row = host.querySelector<HTMLElement>(`[data-live-agent-row="${PANE_KEY}"]`)
    expect(row).not.toBeNull()
    expect(row?.querySelector('[data-live-agent-detail]')).toBeNull()
    expect(host.textContent).not.toContain('Mapped 12 routes so far')
    const trigger = row?.querySelector('[data-live-agent-detail-trigger]')
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')

    click(row?.querySelector('.compact-agent-row'))

    expect(trigger?.getAttribute('aria-expanded')).toBe('true')
    expect(row?.querySelector('[data-live-agent-detail]')).not.toBeNull()
    expect(detailLine(host, PANE_KEY, 'tool')).toBe('ToolRead: src/router.ts')
    expect(detailLine(host, PANE_KEY, 'message')).toBe('Latest messageMapped 12 routes so far')
    expect(detailLine(host, PANE_KEY, 'model')).toBe('Modelgpt-6-astra')
    expect(detailLine(host, PANE_KEY, 'state')).toBe('StateWorking')
    expect(detailLine(host, PANE_KEY, 'elapsed')).toBe('Elapsed5m')
    expect(activateTabAndFocusPane).not.toHaveBeenCalled()

    act(() => {
      useAppStore.setState({
        agentStatusByPaneKey: {
          [PANE_KEY]: makeEntry({
            toolName: 'Edit',
            toolInput: 'src/nav.ts',
            lastAssistantMessage: 'Routes mapped; wiring the shell',
            lastAssistantMessageIsToolOutput: true,
            updatedAt: NOW + 1_000,
            stateStartedAt: NOW - 5 * 60_000
          })
        }
      })
    })
    expect(detailLine(host, PANE_KEY, 'tool')).toBe('ToolEdit: src/nav.ts')
    expect(detailLine(host, PANE_KEY, 'message')).toBe('Tool outputRoutes mapped; wiring the shell')

    click(trigger)
    expect(row?.querySelector('[data-live-agent-detail]')).toBeNull()
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps pane activation reachable from the jump control without expanding', () => {
    seed(makeEntry())
    const host = mount()
    const row = host.querySelector<HTMLElement>(`[data-live-agent-row="${PANE_KEY}"]`)

    click(row?.querySelector('[data-live-agent-jump]'))

    expect(activateAndRevealWorktree).toHaveBeenCalledWith(WORKTREE_ID)
    expect(activateTabAndFocusPane).toHaveBeenCalledWith(
      TAB_ID,
      '11111111-1111-4111-8111-111111111111',
      { flashFocusedPane: true }
    )
    expect(row?.querySelector('[data-live-agent-detail]')).toBeNull()

    // Why: the synthetic subagent key carries a NUL separator, which a CSS attribute selector can't spell.
    const child = [...host.querySelectorAll<HTMLElement>('[data-live-agent-row]')].find(
      (el) => el.getAttribute('data-live-agent-row') === `${PANE_KEY}\u0000subagent:map`
    )
    click(child?.querySelector('[data-live-agent-jump]'))
    expect(activateTabAndFocusPane).toHaveBeenCalledTimes(2)
    expect(activateTabAndFocusPane).toHaveBeenLastCalledWith(
      TAB_ID,
      '11111111-1111-4111-8111-111111111111',
      { flashFocusedPane: true }
    )
  })

  it('expands jobGraph node rows and shows the empty copy for a node with nothing reported', () => {
    seed(makeEntry({ jobGraph }))
    const host = mount()

    click(host.querySelector('[data-live-agent-node="A"] [data-live-agent-detail-trigger]'))
    expect(detailLine(host, 'A', 'step')).toBe('StepReading routes')
    expect(detailLine(host, 'A', 'model')).toBe('Modelgpt-6-astra')
    expect(detailLine(host, 'A', 'state')).toBe('StateWorking')
    expect(detailLine(host, 'A', 'elapsed')).toBe('Elapsednow')

    click(host.querySelector('[data-live-agent-node="A"] [data-live-agent-jump]'))
    expect(activateTabAndFocusPane).toHaveBeenCalledWith(
      TAB_ID,
      '11111111-1111-4111-8111-111111111111',
      { flashFocusedPane: true }
    )

    const nodeC = host.querySelector<HTMLElement>('[data-live-agent-node="C"]')
    click(nodeC?.querySelector('[data-live-agent-jump]'))
    expect(activateTabAndFocusPane).toHaveBeenCalledTimes(2)
    click(nodeC?.querySelector('[data-live-agent-detail-trigger]'))
    expect(nodeC?.querySelector('[data-live-agent-detail]')?.textContent).toContain(
      'No current activity reported'
    )
    expect(detailLine(host, 'C', 'state')).toBe('StateIdle')
  })

  it('renders the run stats a finished child reported when its row is expanded', () => {
    const runStats = { turns: 12, toolCalls: 34, tokensPerSecond: 40, runtimeMs: 5000 }
    seed(
      makeEntry({
        jobGraph: {
          nodes: [
            { nodeId: 'A', taskId: 'task-map', dependsOn: [] },
            { nodeId: 'B', taskId: 'task-cover', dependsOn: ['A'], state: 'completed', runStats }
          ]
        },
        subagents: [
          {
            id: 'map',
            description: 'Map shell navigation',
            agentType: 'quick',
            state: 'idle',
            startedAt: NOW - 3_000,
            job: { taskId: 'task-map', lifecycle: 'succeeded', runStats }
          }
        ]
      })
    )
    const host = mount()

    click(host.querySelector('[data-live-agent-node="A"] [data-live-agent-detail-trigger]'))
    const nodeA = host.querySelector('[data-live-agent-node="A"] [data-live-agent-detail]')
    expect(nodeA?.textContent).not.toContain('No current activity reported')
    expect(detailLine(host, 'A', 'turns')).toBe('Turns12')
    expect(detailLine(host, 'A', 'tools')).toBe('Tool calls34')
    expect(detailLine(host, 'A', 'tokensPerSecond')).toBe('Tok/s40')
    expect(detailLine(host, 'A', 'runtime')).toBe('Runtime5.0s')
    expect(detailLine(host, 'A', 'state')).toBe('StateDone')

    // Why: a node omo has not started in the roster still shows the stats the graph carries.
    click(host.querySelector('[data-live-agent-node="B"] [data-live-agent-detail-trigger]'))
    expect(detailLine(host, 'B', 'turns')).toBe('Turns12')
    expect(detailLine(host, 'B', 'runtime')).toBe('Runtime5.0s')
  })

  it('shows the empty state when the active workspace has no reporting agents', () => {
    act(() => {
      useAppStore.setState({
        activeWorktreeId: WORKTREE_ID,
        tabsByWorktree: {},
        agentStatusByPaneKey: {}
      })
    })
    const host = mount()
    expect(host.textContent).toContain('No agents are reporting in this workspace')
  })

  it('opens the floating Subagent-Live view bound to the child task and workspace path', () => {
    seed(makeEntry({ jobGraph }))
    const host = mount()

    // Why: the root omo pane has no child task id, so it must not offer live output.
    const rootRow = host.querySelector<HTMLElement>(`[data-live-agent-row="${PANE_KEY}"]`)
    expect(rootRow?.querySelector('[data-live-agent-live-output]')).toBeNull()

    click(host.querySelector('[data-live-agent-node="A"] [data-live-agent-live-output]'))
    expect(openSubagentLiveInFloatingWorkspace).toHaveBeenCalledWith({
      worktreeCwd: WORKTREE_PATH,
      taskId: 'task-map',
      label: 'Map shell navigation'
    })
    expect(activateTabAndFocusPane).not.toHaveBeenCalled()

    // Why: a node the DAG never bound to a task has no transcript to tail.
    expect(
      host.querySelector('[data-live-agent-node="C"] [data-live-agent-live-output]')
    ).toBeNull()
  })

  it('prefers entry.sessionCwd over worktree path for live output (RED->GREEN)', () => {
    const REAL_CWD = '/real/session/cwd'
    seed({
      ...makeEntry({ jobGraph }),
      sessionCwd: REAL_CWD
    })
    const host = mount()

    click(host.querySelector('[data-live-agent-node="A"] [data-live-agent-live-output]'))
    expect(openSubagentLiveInFloatingWorkspace).toHaveBeenCalledWith({
      worktreeCwd: REAL_CWD,
      taskId: 'task-map',
      label: 'Map shell navigation'
    })

    // without sessionCwd falls back
    act(() => root?.unmount())
    root = null
    container?.remove()
    seed(makeEntry({ jobGraph }))
    const host2 = mount()
    click(host2.querySelector('[data-live-agent-node="A"] [data-live-agent-live-output]'))
    expect(openSubagentLiveInFloatingWorkspace).toHaveBeenLastCalledWith({
      worktreeCwd: WORKTREE_PATH,
      taskId: 'task-map',
      label: 'Map shell navigation'
    })
  })

  it('offers live output on flat subagent rows and hides it when the workspace path is unknown', () => {
    seed(makeEntry())
    const host = mount()
    const child = [...host.querySelectorAll<HTMLElement>('[data-live-agent-row]')].find(
      (el) => el.getAttribute('data-live-agent-row') === `${PANE_KEY}\u0000subagent:map`
    )
    click(child?.querySelector('[data-live-agent-live-output]'))
    expect(openSubagentLiveInFloatingWorkspace).toHaveBeenCalledWith({
      worktreeCwd: WORKTREE_PATH,
      taskId: 'task-map',
      label: 'Map shell navigation'
    })

    act(() => root?.unmount())
    root = null
    container?.remove()
    seed(makeEntry(), { withWorktreePath: false })
    const rehost = mount()
    expect(rehost.querySelector('[data-live-agent-live-output]')).toBeNull()
  })
})
