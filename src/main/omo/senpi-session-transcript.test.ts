import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SubagentTranscriptEvent } from '../../shared/subagent-transcript-types'
import { parseSenpiTranscriptLine } from './senpi-session-transcript'

const FIXTURE_DIR = join(__dirname, '__fixtures__', 'child-session-st_01a08fe1')

function fixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
}

function parseFixture(name: string): SubagentTranscriptEvent[] {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8')
    .split('\n')
    .map((line) => parseSenpiTranscriptLine(line))
    .filter((event): event is SubagentTranscriptEvent => event !== null)
}

function ofKind<K extends SubagentTranscriptEvent['kind']>(
  events: readonly SubagentTranscriptEvent[],
  kind: K
): Extract<SubagentTranscriptEvent, { kind: K }>[] {
  return events.filter(
    (event): event is Extract<SubagentTranscriptEvent, { kind: K }> => event.kind === kind
  )
}

describe('parseSenpiTranscriptLine', () => {
  it('parses every committed child-session fixture without throwing', () => {
    const files = fixtureFiles()
    expect(files).toHaveLength(4)
    for (const name of files) {
      const events = parseFixture(name)
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]).toMatchObject({ kind: 'session', cwd: '/private/tmp/omo-procmode2-6L9tfa' })
    }
  })

  it('emits the user prompt, assistant text, tool calls, tool results and model changes in file order', () => {
    const events = parseFixture(fixtureFiles()[3])
    const kinds = events.map((event) => event.kind)
    expect(kinds).toEqual([
      'session',
      'model-change',
      'user',
      'assistant',
      'tool-result',
      'assistant',
      'assistant'
    ])

    expect(ofKind(events, 'model-change')[0]).toEqual({
      kind: 'model-change',
      provider: 'xai',
      modelId: 'grok-4.20-0309-non-reasoning',
      timestamp: expect.any(Number)
    })

    const user = ofKind(events, 'user')[0]
    expect(user.text.startsWith('say s1-start, then run bash: sleep 4 && echo s2-tool-ok')).toBe(
      true
    )

    const [withToolCall, aborted, final] = ofKind(events, 'assistant')
    expect(withToolCall.text.startsWith('> I read this as a quick sequential demo task')).toBe(true)
    expect(withToolCall.toolCalls).toHaveLength(1)
    expect(withToolCall.toolCalls[0].name).toBe('eval')
    expect(withToolCall.toolCalls[0].input).toContain('sleep 4 && echo s2-tool-ok')
    expect(withToolCall.stopReason).toBeNull()
    expect(aborted.stopReason).toBe('aborted')
    expect(final).toEqual({
      kind: 'assistant',
      text: 's3-end',
      toolCalls: [],
      stopReason: null,
      timestamp: expect.any(Number)
    })

    expect(ofKind(events, 'tool-result')[0]).toEqual({
      kind: 'tool-result',
      toolName: 'eval',
      output: 'eval run requires language',
      isError: true,
      timestamp: expect.any(Number)
    })
  })

  it('surfaces an empty assistant turn that ended in error instead of dropping it', () => {
    const events = parseFixture(fixtureFiles()[0])
    expect(ofKind(events, 'assistant')).toEqual([
      {
        kind: 'assistant',
        text: '',
        toolCalls: [],
        stopReason: 'error',
        timestamp: expect.any(Number)
      }
    ])
  })

  it('returns null for malformed, partial, blank and bookkeeping lines without throwing', () => {
    expect(parseSenpiTranscriptLine('')).toBeNull()
    expect(parseSenpiTranscriptLine('   ')).toBeNull()
    expect(parseSenpiTranscriptLine('not json')).toBeNull()
    expect(parseSenpiTranscriptLine('{"type":"message","message":{"role":"assis')).toBeNull()
    expect(parseSenpiTranscriptLine('[1,2,3]')).toBeNull()
    expect(parseSenpiTranscriptLine('{"type":"a-type-from-the-future","id":"x"}')).toBeNull()
    expect(
      parseSenpiTranscriptLine('{"type":"thinking_level_change","thinkingLevel":"max"}')
    ).toBeNull()
    expect(parseSenpiTranscriptLine('{"type":"custom","customType":"pi-rules.scan"}')).toBeNull()
    expect(parseSenpiTranscriptLine('{"type":"message"}')).toBeNull()
    expect(parseSenpiTranscriptLine('{"type":"message","message":{"role":"ghost"}}')).toBeNull()
  })

  it('bounds tool input previews and outputs so a giant record cannot flood the view', () => {
    const hugeArguments = { code: 'x'.repeat(10_000) }
    const assistant = parseSenpiTranscriptLine(
      JSON.stringify({
        type: 'message',
        timestamp: '2026-09-11T09:52:18.871Z',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', name: 'eval', arguments: hugeArguments }]
        }
      })
    )
    expect(assistant?.kind).toBe('assistant')
    if (assistant?.kind !== 'assistant') {
      throw new Error('expected an assistant event')
    }
    expect(assistant.toolCalls[0].input.length).toBeLessThan(600)
    expect(assistant.toolCalls[0].input.endsWith('…')).toBe(true)

    const result = parseSenpiTranscriptLine(
      JSON.stringify({
        type: 'message',
        message: {
          role: 'toolResult',
          toolName: 'bash',
          content: [{ type: 'text', text: 'y'.repeat(20_000) }]
        }
      })
    )
    if (result?.kind !== 'tool-result') {
      throw new Error('expected a tool-result event')
    }
    expect(result.output.length).toBeLessThan(5_000)
    expect(result.isError).toBe(false)
    expect(result.timestamp).toBeNull()
  })

  it('strips carriage returns left by CRLF writers before parsing', () => {
    expect(
      parseSenpiTranscriptLine('{"type":"model_change","provider":"xai","modelId":"grok"}\r')
    ).toEqual({ kind: 'model-change', provider: 'xai', modelId: 'grok', timestamp: null })
  })
})
