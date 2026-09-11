import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  SubagentTranscriptEvent,
  SubagentTranscriptFrame
} from '../../shared/subagent-transcript-types'
import { parseSenpiTranscriptLine } from './senpi-session-transcript'
import {
  createSubagentTranscriptTailer,
  resolveSubagentSessionDir,
  type SubagentTranscriptTailer
} from './subagent-transcript-tailer'

const FIXTURE_DIR = join(__dirname, '__fixtures__', 'child-session-st_01a08fe1')
const TASK_ID = 'st_01a08fe1'
const FRAME_TIMEOUT_MS = 10_000

let tempRoots: string[] = []
let tailers: SubagentTranscriptTailer[] = []

afterEach(async () => {
  for (const tailer of tailers) {
    tailer.dispose()
  }
  tailers = []
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

async function tempWorktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-subagent-tail-'))
  tempRoots.push(root)
  return root
}

async function seedFixtureSessionDir(worktreeCwd: string): Promise<string[]> {
  const dir = resolveSubagentSessionDir(worktreeCwd, TASK_ID)
  await mkdir(dir, { recursive: true })
  const names = (await readdir(FIXTURE_DIR)).filter((name) => name.endsWith('.jsonl')).sort()
  for (const name of names) {
    await copyFile(join(FIXTURE_DIR, name), join(dir, name))
  }
  return names.map((name) => join(dir, name))
}

async function expectedEvents(files: readonly string[]): Promise<SubagentTranscriptEvent[]> {
  const events: SubagentTranscriptEvent[] = []
  for (const file of files) {
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      const event = parseSenpiTranscriptLine(line)
      if (event) {
        events.push(event)
      }
    }
  }
  return events
}

/** Frames arrive through the tailer callback; each call to `next()` awaits the
 *  next unread frame with a bounded deadline so a broken watcher fails, not hangs. */
function frameQueue(): {
  onFrame: (frame: SubagentTranscriptFrame) => void
  next: () => Promise<SubagentTranscriptFrame>
  received: SubagentTranscriptFrame[]
} {
  const received: SubagentTranscriptFrame[] = []
  const waiters: ((frame: SubagentTranscriptFrame) => void)[] = []
  const buffered: SubagentTranscriptFrame[] = []
  return {
    received,
    onFrame: (frame) => {
      received.push(frame)
      const waiter = waiters.shift()
      if (waiter) {
        waiter(frame)
      } else {
        buffered.push(frame)
      }
    },
    next: () => {
      const ready = buffered.shift()
      if (ready) {
        return Promise.resolve(ready)
      }
      return new Promise<SubagentTranscriptFrame>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('no transcript frame arrived in time')),
          FRAME_TIMEOUT_MS
        )
        waiters.push((frame) => {
          clearTimeout(timer)
          resolve(frame)
        })
      })
    }
  }
}

function assistantLine(text: string): string {
  return `${JSON.stringify({
    type: 'message',
    timestamp: '2026-09-11T10:00:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' }
  })}\n`
}

function sessionHeader(id: string): string {
  return `${JSON.stringify({ type: 'session', version: 3, id, timestamp: 't', cwd: '/w' })}\n`
}

function startTailer(
  worktreeCwd: string,
  onFrame: (frame: SubagentTranscriptFrame) => void,
  options: { missingDirPollMs?: number } = {}
): SubagentTranscriptTailer {
  const tailer = createSubagentTranscriptTailer({
    worktreeCwd,
    taskId: TASK_ID,
    onFrame,
    ...options
  })
  tailers.push(tailer)
  return tailer
}

async function appendedEvents(
  frame: SubagentTranscriptFrame
): Promise<readonly SubagentTranscriptEvent[]> {
  if (frame.type !== 'appended') {
    throw new Error(`expected an appended frame, got ${frame.type}`)
  }
  return frame.events
}

describe('createSubagentTranscriptTailer', () => {
  it('resolves the child session directory omo writes in process mode', () => {
    expect(resolveSubagentSessionDir('/w', 'st_1')).toBe(
      join('/w', '.omo', 'senpi-task', 'children', 'st_1', 'sessions', 'st_1')
    )
  })

  it('replays every existing turn file in name order on start', async () => {
    const worktreeCwd = await tempWorktree()
    const files = await seedFixtureSessionDir(worktreeCwd)
    const queue = frameQueue()

    const replay = await startTailer(worktreeCwd, queue.onFrame).start()

    expect(replay.status).toBe('live')
    expect(replay.events).toEqual(await expectedEvents(files))
    expect(replay.events[0]).toMatchObject({
      kind: 'session',
      sessionId: '01a08fe1-bb6f-7384-8918-9a5cab5909c6'
    })
    expect(replay.events.at(-1)).toMatchObject({ kind: 'assistant', text: 's3-end' })
    expect(queue.received).toEqual([])
  })

  it('emits exactly the appended event when the newest turn file grows', async () => {
    const worktreeCwd = await tempWorktree()
    const files = await seedFixtureSessionDir(worktreeCwd)
    const queue = frameQueue()
    await startTailer(worktreeCwd, queue.onFrame).start()

    await appendFile(files.at(-1) ?? '', assistantLine('live-1'))

    expect(await appendedEvents(await queue.next())).toEqual([
      {
        kind: 'assistant',
        text: 'live-1',
        toolCalls: [],
        stopReason: null,
        timestamp: Date.parse('2026-09-11T10:00:00.000Z')
      }
    ])
  })

  it('switches to a newly created turn file and stops reading the previous one', async () => {
    const worktreeCwd = await tempWorktree()
    const files = await seedFixtureSessionDir(worktreeCwd)
    const queue = frameQueue()
    await startTailer(worktreeCwd, queue.onFrame).start()
    const nextTurn = join(
      resolveSubagentSessionDir(worktreeCwd, TASK_ID),
      '2026-09-11T09-52-20-000Z_01a08fe1-ffff-7000-8000-000000000000.jsonl'
    )

    await writeFile(nextTurn, `${sessionHeader('turn-5')}${assistantLine('turn-5-hello')}`)

    const switched: SubagentTranscriptEvent[] = []
    while (!switched.some((event) => event.kind === 'assistant' && event.text === 'turn-5-hello')) {
      switched.push(...(await appendedEvents(await queue.next())))
    }
    expect(switched.map((event) => event.kind)).toEqual(['session', 'assistant'])
    expect(switched[0]).toMatchObject({ kind: 'session', sessionId: 'turn-5' })

    await appendFile(files.at(-1) ?? '', assistantLine('stale-turn-append'))
    await appendFile(nextTurn, assistantLine('turn-5-more'))

    const afterSwitch = await appendedEvents(await queue.next())
    expect(afterSwitch).toEqual([
      expect.objectContaining({ kind: 'assistant', text: 'turn-5-more' })
    ])
  })

  it('holds a partial trailing line until its newline arrives', async () => {
    const worktreeCwd = await tempWorktree()
    const files = await seedFixtureSessionDir(worktreeCwd)
    const queue = frameQueue()
    const tailer = startTailer(worktreeCwd, queue.onFrame)
    await tailer.start()
    const newest = files.at(-1) ?? ''
    const line = JSON.stringify({ type: 'model_change', provider: 'xai', modelId: 'grok-live' })
    const cut = Math.floor(line.length / 2)

    await appendFile(newest, line.slice(0, cut))
    // Why: a direct poll proves the cut line is buffered rather than parsed as garbage.
    await tailer.poll()
    expect(queue.received).toEqual([])

    await appendFile(newest, `${line.slice(cut)}\n`)

    expect(await appendedEvents(await queue.next())).toEqual([
      { kind: 'model-change', provider: 'xai', modelId: 'grok-live', timestamp: null }
    ])
  })

  it('stops reading and emitting after dispose', async () => {
    const worktreeCwd = await tempWorktree()
    const files = await seedFixtureSessionDir(worktreeCwd)
    const queue = frameQueue()
    const tailer = startTailer(worktreeCwd, queue.onFrame)
    await tailer.start()
    expect(tailer.watching).toBe(true)

    tailer.dispose()

    expect(tailer.watching).toBe(false)
    await appendFile(files.at(-1) ?? '', assistantLine('after-dispose'))
    await tailer.poll()
    expect(queue.received).toEqual([])
  })

  it('reports a missing transcript directory and goes live once omo creates it', async () => {
    const worktreeCwd = await tempWorktree()
    const queue = frameQueue()
    const tailer = startTailer(worktreeCwd, queue.onFrame, { missingDirPollMs: 20 })

    const replay = await tailer.start()
    expect(replay).toEqual({ status: 'missing', events: [] })
    expect(tailer.watching).toBe(false)

    const dir = resolveSubagentSessionDir(worktreeCwd, TASK_ID)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, '2026-09-11T09-52-10-607Z_first.jsonl'),
      `${sessionHeader('first')}${assistantLine('hello')}`
    )

    expect(await queue.next()).toEqual({ type: 'status', status: 'live' })
    const events: SubagentTranscriptEvent[] = []
    while (!events.some((event) => event.kind === 'assistant')) {
      events.push(...(await appendedEvents(await queue.next())))
    }
    expect(events).toEqual([
      expect.objectContaining({ kind: 'session', sessionId: 'first' }),
      expect.objectContaining({ kind: 'assistant', text: 'hello' })
    ])
    expect(tailer.watching).toBe(true)
  })
})
