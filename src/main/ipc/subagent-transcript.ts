import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type {
  SubagentTranscriptFramePayload,
  SubagentTranscriptReplay,
  SubagentTranscriptSubscribeArgs
} from '../../shared/subagent-transcript-types'
import {
  createSubagentTranscriptTailer,
  type SubagentTranscriptTailer
} from '../omo/subagent-transcript-tailer'

const CHANNEL_SUBSCRIBE = 'subagentTranscript:subscribe'
const CHANNEL_UNSUBSCRIBE = 'subagentTranscript:unsubscribe'
const CHANNEL_FRAME = 'subagentTranscript:frame'

// Why: keyed by (webContents.id, subscriptionId) so one renderer can watch several
// children and a destroyed window releases every directory watcher it owns.
const tailersBySender = new Map<number, Map<string, SubagentTranscriptTailer>>()
const senderCleanupRegistered = new Set<number>()

function teardown(senderId: number, subscriptionId: string): void {
  const bySubId = tailersBySender.get(senderId)
  const tailer = bySubId?.get(subscriptionId)
  if (!tailer || !bySubId) {
    return
  }
  tailer.dispose()
  bySubId.delete(subscriptionId)
  if (bySubId.size === 0) {
    tailersBySender.delete(senderId)
  }
}

function teardownAllForSender(senderId: number): void {
  senderCleanupRegistered.delete(senderId)
  for (const tailer of tailersBySender.get(senderId)?.values() ?? []) {
    tailer.dispose()
  }
  tailersBySender.delete(senderId)
}

function registerSenderCleanup(sender: WebContents): void {
  if (senderCleanupRegistered.has(sender.id)) {
    return
  }
  senderCleanupRegistered.add(sender.id)
  sender.once('destroyed', () => teardownAllForSender(sender.id))
}

function isSubscribeArgs(value: unknown): value is SubagentTranscriptSubscribeArgs {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.subscriptionId === 'string' &&
    typeof record.worktreeCwd === 'string' &&
    record.worktreeCwd.length > 0 &&
    typeof record.taskId === 'string' &&
    record.taskId.length > 0 &&
    // Why: the task id becomes a path segment; never let it climb out of the children dir.
    !/[\\/]|\.\./.test(record.taskId)
  )
}

async function handleSubscribe(
  event: IpcMainInvokeEvent,
  args: unknown
): Promise<SubagentTranscriptReplay> {
  if (!isSubscribeArgs(args)) {
    throw new Error('subagentTranscript:subscribe: invalid arguments')
  }
  const sender = event.sender
  if (sender.isDestroyed()) {
    return { status: 'missing', events: [] }
  }
  const { subscriptionId } = args
  teardown(sender.id, subscriptionId)
  registerSenderCleanup(sender)
  const tailer = createSubagentTranscriptTailer({
    worktreeCwd: args.worktreeCwd,
    taskId: args.taskId,
    onFrame: (frame) => {
      if (sender.isDestroyed()) {
        return
      }
      const payload: SubagentTranscriptFramePayload = { subscriptionId, frame }
      sender.send(CHANNEL_FRAME, payload)
    }
  })
  const bySubId = tailersBySender.get(sender.id) ?? new Map<string, SubagentTranscriptTailer>()
  bySubId.set(subscriptionId, tailer)
  tailersBySender.set(sender.id, bySubId)
  try {
    return await tailer.start()
  } catch (error) {
    teardown(sender.id, subscriptionId)
    throw error
  }
}

/** Test-only: release every live tailer between runs. */
export function clearSubagentTranscriptSubscriptions(): void {
  for (const senderId of Array.from(tailersBySender.keys())) {
    teardownAllForSender(senderId)
  }
  senderCleanupRegistered.clear()
}

export function registerSubagentTranscriptHandlers(): void {
  ipcMain.removeHandler(CHANNEL_SUBSCRIBE)
  ipcMain.handle(CHANNEL_SUBSCRIBE, handleSubscribe)
  ipcMain.on(CHANNEL_UNSUBSCRIBE, (event, args: { subscriptionId?: unknown }) => {
    if (typeof args?.subscriptionId === 'string') {
      teardown(event.sender.id, args.subscriptionId)
    }
  })
}
