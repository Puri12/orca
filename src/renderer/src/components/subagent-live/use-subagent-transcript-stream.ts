import { useEffect, useRef, useState } from 'react'
import type {
  SubagentTranscriptEvent,
  SubagentTranscriptStatus
} from '../../../../shared/subagent-transcript-types'
import { createBrowserUuid } from '@/lib/browser-uuid'

// Why: bound renderer memory for a chatty child; the tail is what the user follows.
const MAX_RETAINED_EVENTS = 2_000

/** One transcript event with a monotonic sequence number, stable across retention trims. */
export type SequencedSubagentTranscriptEvent = {
  seq: number
  event: SubagentTranscriptEvent
}

export type SubagentTranscriptStreamState = {
  phase: 'loading' | 'live' | 'missing' | 'error'
  events: readonly SequencedSubagentTranscriptEvent[]
  error: string | null
}

const INITIAL: SubagentTranscriptStreamState = { phase: 'loading', events: [], error: null }

function retain(
  events: readonly SequencedSubagentTranscriptEvent[]
): readonly SequencedSubagentTranscriptEvent[] {
  return events.length > MAX_RETAINED_EVENTS ? events.slice(-MAX_RETAINED_EVENTS) : events
}

function phaseForStatus(status: SubagentTranscriptStatus): 'live' | 'missing' {
  return status === 'live' ? 'live' : 'missing'
}

/** Subscribe to one child transcript through the preload bridge; resubscribes when the binding changes. */
export function useSubagentTranscriptStream(
  worktreeCwd: string,
  taskId: string
): SubagentTranscriptStreamState {
  const [state, setState] = useState<SubagentTranscriptStreamState>(INITIAL)
  // Why: frames pushed before the replay resolves must land after it, not be lost under it.
  const replayedRef = useRef(false)
  const nextSeqRef = useRef(0)

  useEffect(() => {
    const sequence = (
      events: readonly SubagentTranscriptEvent[]
    ): SequencedSubagentTranscriptEvent[] =>
      events.map((event) => ({ seq: nextSeqRef.current++, event }))
    const api = window.api?.subagentTranscript
    if (!api) {
      setState({ phase: 'error', events: [], error: 'Subagent transcripts are unavailable here' })
      return
    }
    let disposed = false
    replayedRef.current = false
    setState(INITIAL)
    const queued: SequencedSubagentTranscriptEvent[] = []
    const handle = api.subscribe(
      { subscriptionId: createBrowserUuid(), worktreeCwd, taskId },
      (frame) => {
        if (disposed) {
          return
        }
        if (frame.type === 'appended') {
          const appended = sequence(frame.events)
          if (!replayedRef.current) {
            queued.push(...appended)
            return
          }
          setState((current) => ({
            ...current,
            events: retain([...current.events, ...appended])
          }))
        } else if (frame.type === 'status') {
          setState((current) => ({ ...current, phase: phaseForStatus(frame.status), error: null }))
        } else {
          setState((current) => ({ ...current, phase: 'error', error: frame.message }))
        }
      }
    )
    void handle.replay.then(
      (replay) => {
        if (disposed) {
          return
        }
        // Why: replay precedes anything pushed while it was in flight, so number it first.
        const replayed = sequence(replay.events)
        replayedRef.current = true
        setState({
          phase: phaseForStatus(replay.status),
          events: retain([...replayed, ...queued.splice(0)]),
          error: null
        })
      },
      (error: unknown) => {
        if (disposed) {
          return
        }
        replayedRef.current = true
        setState({
          phase: 'error',
          events: [],
          error: error instanceof Error ? error.message : String(error)
        })
      }
    )
    return () => {
      disposed = true
      handle.unsubscribe()
    }
  }, [taskId, worktreeCwd])

  return state
}
