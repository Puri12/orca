// senpi session JSONL line → SubagentTranscriptEvent. Pure; tolerant of the
// partial trailing line a live tail can hand it.
import type {
  SubagentTranscriptEvent,
  SubagentTranscriptToolCall
} from '../../shared/subagent-transcript-types'
import {
  asRecord,
  extractString,
  parseJsonObject,
  timestampMs
} from '../ai-vault/session-scanner-values'
import { toolResultOutput } from '../native-chat/transcript-record-blocks'

const TOOL_INPUT_PREVIEW_CHARS = 400
const TOOL_OUTPUT_PREVIEW_CHARS = 4_000
const ELLIPSIS = '…'

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}${ELLIPSIS}` : text
}

function parseTimestamp(value: unknown): number | null {
  const parsed = timestampMs(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toolInputPreview(value: unknown): string {
  if (typeof value === 'string') {
    return truncate(value, TOOL_INPUT_PREVIEW_CHARS)
  }
  if (value === undefined || value === null) {
    return ''
  }
  // Why: a single-key argument object (eval `{code}`, bash `{command}`) reads
  // better as its bare value than as JSON.
  const record = asRecord(value)
  const keys = record ? Object.keys(record) : []
  if (record && keys.length === 1 && typeof record[keys[0]] === 'string') {
    return truncate(record[keys[0]] as string, TOOL_INPUT_PREVIEW_CHARS)
  }
  return truncate(JSON.stringify(value), TOOL_INPUT_PREVIEW_CHARS)
}

function collectContent(content: unknown): {
  text: string
  toolCalls: SubagentTranscriptToolCall[]
} {
  const texts: string[] = []
  const toolCalls: SubagentTranscriptToolCall[] = []
  if (typeof content === 'string') {
    return { text: content, toolCalls }
  }
  if (!Array.isArray(content)) {
    return { text: '', toolCalls }
  }
  for (const item of content) {
    const block = asRecord(item)
    if (!block) {
      continue
    }
    if (block.type === 'text') {
      const text = extractString(block.text)
      if (text) {
        texts.push(text)
      }
    } else if (block.type === 'toolCall') {
      toolCalls.push({
        name: extractString(block.name) ?? 'tool',
        input: toolInputPreview(block.arguments)
      })
    }
  }
  return { text: texts.join('\n'), toolCalls }
}

function parseMessage(
  message: Record<string, unknown>,
  timestamp: number | null
): SubagentTranscriptEvent | null {
  const role = extractString(message.role)
  if (role === 'user') {
    const { text } = collectContent(message.content)
    return text ? { kind: 'user', text, timestamp } : null
  }
  if (role === 'assistant') {
    const { text, toolCalls } = collectContent(message.content)
    const stopReason = extractString(message.stopReason)
    const notable = stopReason === 'error' || stopReason === 'aborted' ? stopReason : null
    // Why: an empty assistant turn is only worth a line when it ended abnormally.
    if (!text && toolCalls.length === 0 && notable === null) {
      return null
    }
    return { kind: 'assistant', text, toolCalls, stopReason: notable, timestamp }
  }
  if (role === 'toolResult') {
    return {
      kind: 'tool-result',
      toolName: extractString(message.toolName) ?? 'tool',
      output: truncate(toolResultOutput(message.content), TOOL_OUTPUT_PREVIEW_CHARS),
      isError: message.isError === true,
      timestamp
    }
  }
  return null
}

export function parseSenpiTranscriptLine(rawLine: string): SubagentTranscriptEvent | null {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
  const record = parseJsonObject(line)
  if (!record) {
    return null
  }
  const timestamp = parseTimestamp(record.timestamp)
  switch (record.type) {
    case 'session': {
      const sessionId = extractString(record.id)
      return sessionId
        ? { kind: 'session', sessionId, cwd: extractString(record.cwd), timestamp }
        : null
    }
    case 'model_change': {
      const provider = extractString(record.provider)
      const modelId = extractString(record.modelId)
      return provider && modelId ? { kind: 'model-change', provider, modelId, timestamp } : null
    }
    case 'message': {
      const message = asRecord(record.message)
      return message ? parseMessage(message, timestamp) : null
    }
    default:
      return null
  }
}
