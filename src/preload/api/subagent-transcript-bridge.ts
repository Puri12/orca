import { ipcRenderer } from 'electron'
import type {
  SubagentTranscriptFramePayload,
  SubagentTranscriptReplay
} from '../../shared/subagent-transcript-types'
import type { PreloadApi } from '../api-types'

export const subagentTranscriptApi = {
  subscribe: (args, onFrame) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: SubagentTranscriptFramePayload
    ) => {
      if (payload.subscriptionId === args.subscriptionId) {
        onFrame(payload.frame)
      }
    }
    ipcRenderer.on('subagentTranscript:frame', listener)
    const replay: Promise<SubagentTranscriptReplay> = ipcRenderer.invoke(
      'subagentTranscript:subscribe',
      args
    )
    return {
      replay,
      unsubscribe: () => {
        ipcRenderer.removeListener('subagentTranscript:frame', listener)
        ipcRenderer.send('subagentTranscript:unsubscribe', { subscriptionId: args.subscriptionId })
      }
    }
  }
} satisfies PreloadApi['subagentTranscript']
