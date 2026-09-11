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
import { createToolInputDisplay, summarizeToolInput } from '../../shared/native-chat-tool-summary'

const TOOL_OUTPUT_PREVIEW_CHARS = 4_000
const ELLIPSIS = '…'
const PREVIEW_SEPARATOR = ' · '

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}${ELLIPSIS}` : text
}

function parseTimestamp(value: unknown): number | null {
  const parsed = timestampMs(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** First task named by a senpi todo argument tree (`task`, `items[0]`, `list[0].items[0]`). */
function firstTodoItem(value: unknown): string | null {
  if (typeof value === 'string') {
    return extractString(value)
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? firstTodoItem(value[0]) : null
  }
  const record = asRecord(value)
  return record ? (firstTodoItem(record.task ?? record.items ?? record.list) ?? null) : null
}

/** `op · first item` for the senpi todo tool, whose `{op, list|items|task}` shape the shared
 *  summarizer has no key for. */
function todoPreview(record: Record<string, unknown>): string | null {
  const op = extractString(record.op)
  if (!op) {
    return null
  }
  const item = firstTodoItem(record)
  return item ? `${op}${PREVIEW_SEPARATOR}${summarizeToolInput(item)}` : op
}

/** `key · value` pairs for an argument object the shared summarizer would only JSON-encode. */
function entriesPreview(record: Record<string, unknown>): string {
  return summarizeToolInput(
    Object.entries(record)
      .map(([key, value]) =>
        typeof value === 'string' ? value : `${key}=${summarizeToolInput(value)}`
      )
      .join(PREVIEW_SEPARATOR)
  )
}

function toolCall(name: string, args: unknown): SubagentTranscriptToolCall {
  const display = createToolInputDisplay(args)
  const record = asRecord(args)
  const structuredFallback = display.label === summarizeToolInput(args)
  const input =
    record && structuredFallback ? (todoPreview(record) ?? entriesPreview(record)) : display.label
  return { name, input, detail: display.hasDetail ? display.formatDetail() : null }
}

const TEXT_ENVELOPE_PREFIX = '{"text":"'

/** Decode the JSON string literal that starts at `from` (just after its opening quote).
 *  A literal cut off by senpi's output cap decodes up to the cut. */
function decodeLeadingJsonString(output: string, from: number): string | null {
  let end = from
  while (end < output.length && output[end] !== '"') {
    end += output[end] === '\\' ? 2 : 1
  }
  try {
    return JSON.parse(`"${output.slice(from, Math.min(end, output.length))}"`) as string
  } catch {
    return null
  }
}

/** senpi's eval/bash tools return `{"text": …}` envelopes as their text block; show the text.
 *  The envelope may itself be truncated, so a well-formed parse is tried first. */
function unwrapToolResultText(output: string): string {
  if (!output.startsWith('{')) {
    return output
  }
  const record = parseJsonObject(output)
  if (record) {
    return typeof record.text === 'string' ? record.text : output
  }
  return output.startsWith(TEXT_ENVELOPE_PREFIX)
    ? (decodeLeadingJsonString(output, TEXT_ENVELOPE_PREFIX.length) ?? output)
    : output
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
      toolCalls.push(toolCall(extractString(block.name) ?? 'tool', block.arguments))
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
      output: truncate(
        unwrapToolResultText(toolResultOutput(message.content)),
        TOOL_OUTPUT_PREVIEW_CHARS
      ),
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
