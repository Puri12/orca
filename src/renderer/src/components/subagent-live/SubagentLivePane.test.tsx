// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SubagentTranscriptEvent,
  SubagentTranscriptFrame,
  SubagentTranscriptReplay,
  SubagentTranscriptSubscribeArgs
} from '../../../../shared/subagent-transcript-types'
import { SubagentLivePane } from './SubagentLivePane'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Why: the parser's output for the last committed fixture turn
// (src/main/omo/__fixtures__/child-session-st_01a08fe1, 2026-09-11T09-52-15-763Z_*.jsonl);
// the renderer project cannot import main-process code, so the replay is pinned here.
function fixtureEvents(): SubagentTranscriptEvent[] {
  const timestamp = Date.parse('2026-09-11T09:52:18.871Z')
  return [
    {
      kind: 'session',
      sessionId: '01a08fe1-cf93-7a79-b5a9-c5e9b4bffdfc',
      cwd: '/private/tmp/omo-procmode2-6L9tfa',
      timestamp
    },
    { kind: 'model-change', provider: 'xai', modelId: 'grok-4.20-0309-non-reasoning', timestamp },
    {
      kind: 'user',
      text: 'say s1-start, then run bash: sleep 4 && echo s2-tool-ok, then say s3-end',
      timestamp
    },
    {
      kind: 'assistant',
      text: '> I read this as a quick sequential demo task\n\ns1-start',
      toolCalls: [{ name: 'eval', input: 'tool.bash({ command: "sleep 4 && echo s2-tool-ok" })' }],
      stopReason: null,
      timestamp
    },
    {
      kind: 'tool-result',
      toolName: 'eval',
      output: 'eval run requires language',
      isError: true,
      timestamp
    },
    {
      kind: 'assistant',
      text: '> I read this as',
      toolCalls: [],
      stopReason: 'aborted',
      timestamp
    },
    { kind: 'assistant', text: 's3-end', toolCalls: [], stopReason: null, timestamp }
  ]
}

type SubscribeCall = {
  args: SubagentTranscriptSubscribeArgs
  push: (frame: SubagentTranscriptFrame) => void
  resolveReplay: (replay: SubagentTranscriptReplay) => void
  unsubscribe: ReturnType<typeof vi.fn>
}

const subscribeCalls: SubscribeCall[] = []

function installSubagentTranscriptApi(): void {
  const subscribe = vi.fn(
    (args: SubagentTranscriptSubscribeArgs, onFrame: (frame: SubagentTranscriptFrame) => void) => {
      let resolveReplay: (replay: SubagentTranscriptReplay) => void = () => undefined
      const replay = new Promise<SubagentTranscriptReplay>((resolve) => {
        resolveReplay = resolve
      })
      const unsubscribe = vi.fn()
      subscribeCalls.push({ args, push: onFrame, resolveReplay, unsubscribe })
      return { replay, unsubscribe }
    }
  )
  Object.assign(window, { api: { subagentTranscript: { subscribe } } })
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(props: { worktreeCwd: string; taskId: string; label: string }): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(<SubagentLivePane {...props} />)
  })
  return container
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function lineTexts(host: HTMLElement, kind: string): string[] {
  return [...host.querySelectorAll<HTMLElement>(`[data-subagent-live-line="${kind}"]`)].map(
    (line) => line.textContent?.trim() ?? ''
  )
}

beforeEach(() => {
  subscribeCalls.length = 0
  installSubagentTranscriptApi()
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  root = null
  container?.remove()
  container = null
})

describe('SubagentLivePane', () => {
  it('replays fixture events in order and appends pushed frames live', async () => {
    const host = mount({ worktreeCwd: '/w', taskId: 'st_01a08fe1', label: 'Demo child' })
    expect(subscribeCalls).toHaveLength(1)
    expect(subscribeCalls[0].args).toMatchObject({ worktreeCwd: '/w', taskId: 'st_01a08fe1' })
    expect(
      host.querySelector('[data-subagent-live-phase]')?.getAttribute('data-subagent-live-phase')
    ).toBe('loading')

    await act(async () => {
      subscribeCalls[0].resolveReplay({ status: 'live', events: fixtureEvents() })
    })
    await flush()

    const pane = host.querySelector('[data-subagent-live-pane="st_01a08fe1"]')
    expect(pane?.getAttribute('data-subagent-live-phase')).toBe('live')
    const kinds = [...host.querySelectorAll<HTMLElement>('[data-subagent-live-line]')].map((line) =>
      line.getAttribute('data-subagent-live-line')
    )
    // Why: the last fixture turn is the only one with real output; its order is the contract.
    expect(kinds.slice(-6)).toEqual([
      'user',
      'assistant',
      'tool-call',
      'tool-result',
      'assistant',
      'assistant'
    ])
    expect(lineTexts(host, 'assistant').at(-1)).toContain('s3-end')
    expect(lineTexts(host, 'tool-call')[0]).toContain('eval')
    expect(lineTexts(host, 'tool-call')[0]).toContain('sleep 4 && echo s2-tool-ok')
    expect(lineTexts(host, 'tool-result')[0]).toContain('eval run requires language')
    expect(lineTexts(host, 'model-change')).toContain('modelxai/grok-4.20-0309-non-reasoning')

    act(() => {
      subscribeCalls[0].push({
        type: 'appended',
        events: [
          { kind: 'assistant', text: 'pushed-live', toolCalls: [], stopReason: null, timestamp: 1 }
        ]
      })
    })
    expect(lineTexts(host, 'assistant').at(-1)).toContain('pushed-live')
  })

  it('shows the in-process fallback when no transcript directory exists, then goes live', async () => {
    const host = mount({ worktreeCwd: '/w', taskId: 'st_inproc', label: 'In-process child' })
    await act(async () => {
      subscribeCalls[0].resolveReplay({ status: 'missing', events: [] })
    })
    await flush()

    const pane = host.querySelector('[data-subagent-live-pane="st_inproc"]')
    expect(pane?.getAttribute('data-subagent-live-phase')).toBe('missing')
    expect(pane?.textContent).toContain('No live transcript for this subagent')
    expect(pane?.textContent).toContain('task.default_execution_mode')
    expect(host.querySelector('[data-subagent-live-log]')).toBeNull()

    act(() => {
      subscribeCalls[0].push({ type: 'status', status: 'live' })
      subscribeCalls[0].push({
        type: 'appended',
        events: [{ kind: 'user', text: 'late prompt', timestamp: null }]
      })
    })
    expect(pane?.getAttribute('data-subagent-live-phase')).toBe('live')
    expect(lineTexts(host, 'user')).toEqual(['userlate prompt'])
  })

  it('unsubscribes on unmount and resubscribes when the binding changes', async () => {
    const host = mount({ worktreeCwd: '/w', taskId: 'st_a', label: 'A' })
    await act(async () => {
      subscribeCalls[0].resolveReplay({ status: 'live', events: [] })
    })
    act(() => {
      root?.render(<SubagentLivePane worktreeCwd="/w" taskId="st_b" label="B" />)
    })
    expect(subscribeCalls[0].unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribeCalls).toHaveLength(2)
    expect(subscribeCalls[1].args.taskId).toBe('st_b')
    expect(host.querySelector('[data-subagent-live-pane="st_b"]')).not.toBeNull()

    act(() => root?.unmount())
    root = null
    expect(subscribeCalls[1].unsubscribe).toHaveBeenCalledTimes(1)
  })
})
