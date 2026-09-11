const SUBAGENT_LIVE_FILE_ID_PREFIX = 'subagent-live::'

/** Synthetic OpenFile id for a Subagent-Live tab; one tab per child task id. */
export function buildSubagentLiveFileId(taskId: string): string {
  return `${SUBAGENT_LIVE_FILE_ID_PREFIX}${taskId}`
}

export function isSubagentLiveFileId(fileId: string): boolean {
  return fileId.startsWith(SUBAGENT_LIVE_FILE_ID_PREFIX)
}
