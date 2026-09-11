// Tails one omo child session directory (`<cwd>/.omo/senpi-task/children/<taskId>/sessions/<taskId>`):
// replays the existing turn files in name order, then follows appends to the
// newest file and switches when a later turn file appears.
import { watch, type FSWatcher } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type {
  SubagentTranscriptEvent,
  SubagentTranscriptFrame,
  SubagentTranscriptReplay
} from '../../shared/subagent-transcript-types'
import { parseSenpiTranscriptLine } from './senpi-session-transcript'

const DEFAULT_MISSING_DIR_POLL_MS = 1_000
// Why: fs.watch can miss events on remote/synced filesystems; a slow reconcile poll keeps the tail honest.
const DEFAULT_LIVE_POLL_MS = 1_500
// Why: bound the first paint — a long-running child can accumulate megabytes of tool output.
const DEFAULT_REPLAY_BYTE_CAP = 512 * 1024

export type SubagentTranscriptTailerOptions = {
  worktreeCwd: string
  taskId: string
  onFrame: (frame: SubagentTranscriptFrame) => void
  missingDirPollMs?: number
  livePollMs?: number
  replayByteCap?: number
}

export type SubagentTranscriptTailer = {
  /** Replay what exists on disk and start following. Resolves once the replay is read. */
  start: () => Promise<SubagentTranscriptReplay>
  /** Read anything appended since the last read; serialized with watcher-driven polls. */
  poll: () => Promise<void>
  dispose: () => void
  readonly watching: boolean
}

export function resolveSubagentSessionDir(worktreeCwd: string, taskId: string): string {
  return join(worktreeCwd, '.omo', 'senpi-task', 'children', taskId, 'sessions', taskId)
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

async function listTurnFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith('.jsonl')).sort()
}

/** Read `[from, end)` of a file; a short read (file truncated) returns what was there. */
async function readRange(filePath: string, from: number, end: number): Promise<Buffer> {
  if (end <= from) {
    return Buffer.alloc(0)
  }
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(end - from)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

type LineCursor = {
  decoder: StringDecoder
  pending: string
}

function newCursor(): LineCursor {
  return { decoder: new StringDecoder('utf8'), pending: '' }
}

/** Feed bytes through the cursor; complete lines become events, the trailing partial line waits. */
function consumeChunk(cursor: LineCursor, chunk: Buffer): SubagentTranscriptEvent[] {
  cursor.pending += cursor.decoder.write(chunk)
  const events: SubagentTranscriptEvent[] = []
  let newline = cursor.pending.indexOf('\n')
  while (newline !== -1) {
    const event = parseSenpiTranscriptLine(cursor.pending.slice(0, newline))
    if (event) {
      events.push(event)
    }
    cursor.pending = cursor.pending.slice(newline + 1)
    newline = cursor.pending.indexOf('\n')
  }
  return events
}

export function createSubagentTranscriptTailer(
  options: SubagentTranscriptTailerOptions
): SubagentTranscriptTailer {
  const dir = resolveSubagentSessionDir(options.worktreeCwd, options.taskId)
  const missingDirPollMs = options.missingDirPollMs ?? DEFAULT_MISSING_DIR_POLL_MS
  const livePollMs = options.livePollMs ?? DEFAULT_LIVE_POLL_MS
  const replayByteCap = options.replayByteCap ?? DEFAULT_REPLAY_BYTE_CAP

  let disposed = false
  let watcher: FSWatcher | null = null
  let missingTimer: NodeJS.Timeout | null = null
  let liveTimer: NodeJS.Timeout | null = null
  let currentFile: string | null = null
  let offset = 0
  let cursor = newCursor()
  let pollChain: Promise<void> = Promise.resolve()

  function emit(frame: SubagentTranscriptFrame): void {
    if (!disposed) {
      options.onFrame(frame)
    }
  }

  function clearTimers(): void {
    if (missingTimer) {
      clearInterval(missingTimer)
      missingTimer = null
    }
    if (liveTimer) {
      clearInterval(liveTimer)
      liveTimer = null
    }
  }

  function detachWatcher(): void {
    watcher?.close()
    watcher = null
  }

  /** Bind fs.watch on the directory; false when the directory is not watchable right now. */
  function attachWatcher(): boolean {
    if (watcher || disposed) {
      return watcher !== null
    }
    let next: FSWatcher
    try {
      next = watch(dir, { persistent: false }, () => {
        void poll()
      })
    } catch {
      return false
    }
    next.on('error', () => {
      if (watcher === next) {
        detachWatcher()
        enterMissing(true)
      }
    })
    watcher = next
    if (!liveTimer) {
      liveTimer = setInterval(() => void poll(), livePollMs)
      liveTimer.unref()
    }
    return true
  }

  /** Wait for the directory to (re)appear. `announce` pushes the transition; start() returns it instead. */
  function enterMissing(announce: boolean): void {
    if (disposed) {
      return
    }
    detachWatcher()
    clearTimers()
    currentFile = null
    offset = 0
    cursor = newCursor()
    if (announce) {
      emit({ type: 'status', status: 'missing' })
    }
    missingTimer = setInterval(() => {
      void stat(dir).then(
        () => {
          if (disposed || !missingTimer) {
            return
          }
          clearInterval(missingTimer)
          missingTimer = null
          if (attachWatcher()) {
            emit({ type: 'status', status: 'live' })
            void poll()
          }
        },
        () => undefined
      )
    }, missingDirPollMs)
    missingTimer.unref()
  }

  /** Read `filePath` from `offset` to its current end, advancing the cursor. */
  async function drainCurrent(): Promise<SubagentTranscriptEvent[]> {
    if (!currentFile) {
      return []
    }
    const filePath = join(dir, currentFile)
    const size = (await stat(filePath)).size
    if (size < offset) {
      // Why: a rewritten (shrunk) turn file is unreadable from the old offset; restart from its head.
      offset = 0
      cursor = newCursor()
    }
    const chunk = await readRange(filePath, offset, size)
    offset += chunk.length
    return consumeChunk(cursor, chunk)
  }

  async function readAppended(): Promise<SubagentTranscriptEvent[]> {
    const files = await listTurnFiles(dir)
    const newest = files.at(-1) ?? null
    const events: SubagentTranscriptEvent[] = []
    if (newest !== currentFile) {
      // Why: a new turn file means the previous turn is complete; flush its tail before switching.
      events.push(...(await drainCurrent()))
      currentFile = newest
      offset = 0
      cursor = newCursor()
    }
    events.push(...(await drainCurrent()))
    return events
  }

  async function runPoll(): Promise<void> {
    if (disposed || !watcher) {
      return
    }
    try {
      const events = await readAppended()
      if (events.length > 0) {
        emit({ type: 'appended', events })
      }
    } catch (error) {
      if (isEnoent(error)) {
        enterMissing(true)
        return
      }
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  function poll(): Promise<void> {
    pollChain = pollChain.then(runPoll, runPoll)
    return pollChain
  }

  /** Replay existing files newest-first under the byte cap, then parse in chronological order. */
  async function replayExisting(): Promise<SubagentTranscriptEvent[]> {
    const files = await listTurnFiles(dir)
    const selected: { name: string; from: number; size: number }[] = []
    let budget = replayByteCap
    for (const name of files.toReversed()) {
      const size = (await stat(join(dir, name))).size
      if (size <= budget) {
        selected.unshift({ name, from: 0, size })
        budget -= size
        continue
      }
      if (selected.length === 0) {
        selected.unshift({ name, from: size - budget, size })
      }
      break
    }
    const events: SubagentTranscriptEvent[] = []
    for (const [index, file] of selected.entries()) {
      const isNewest = index === selected.length - 1
      const fileCursor = isNewest ? cursor : newCursor()
      let chunk = await readRange(join(dir, file.name), file.from, file.size)
      if (file.from > 0) {
        // Why: a mid-file start lands inside a record; drop up to the first newline.
        const firstNewline = chunk.indexOf(0x0a)
        chunk = firstNewline === -1 ? Buffer.alloc(0) : chunk.subarray(firstNewline + 1)
      }
      events.push(...consumeChunk(fileCursor, chunk))
      if (isNewest) {
        currentFile = file.name
        offset = file.size
      }
    }
    return events
  }

  return {
    async start() {
      if (!attachWatcher()) {
        enterMissing(false)
        return { status: 'missing', events: [] }
      }
      try {
        return { status: 'live', events: await replayExisting() }
      } catch (error) {
        if (isEnoent(error)) {
          enterMissing(false)
          return { status: 'missing', events: [] }
        }
        throw error
      }
    },
    poll,
    dispose() {
      disposed = true
      clearTimers()
      detachWatcher()
    },
    get watching() {
      return watcher !== null
    }
  }
}
