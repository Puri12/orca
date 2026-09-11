import type {
  SubagentTranscriptFrame,
  SubagentTranscriptReplay,
  SubagentTranscriptSubscribeArgs
} from '../../shared/subagent-transcript-types'

export type SubagentTranscriptApi = {
  /** Start tailing one child session directory. Resolves with the bounded replay of what
   *  is already on disk; later frames arrive through `onFrame` until `unsubscribe` runs. */
  subscribe: (
    args: SubagentTranscriptSubscribeArgs,
    onFrame: (frame: SubagentTranscriptFrame) => void
  ) => { replay: Promise<SubagentTranscriptReplay>; unsubscribe: () => void }
}
