import type { PiAgentKind } from '../../shared/pi-agent-kind'

export function getPiAgentStatusRuntimeDetectionSourceLines(kind: PiAgentKind): string[] {
  if (kind === 'prime-agent') {
    return [
      `const CONFIGURED_HOOK_PATH = '/hook/${kind}'`,
      '',
      'function isOmpRuntime(): boolean {',
      '  return false',
      '}',
      '',
      'function resolveHookPath(_ompRuntime: boolean): string {',
      '  return CONFIGURED_HOOK_PATH',
      '}'
    ]
  }

  return [
    'function processName(value: unknown): string {',
    "  return String(value || '').split(/[\\\\/]/).pop()?.toLowerCase() || ''",
    '}',
    '',
    `const CONFIGURED_HOOK_PATH = '/hook/${kind}'`,
    'let cachedOmpRuntime: boolean | null = null',
    '',
    'function isOmoRuntime(): boolean {',
    "  if (CONFIGURED_HOOK_PATH === '/hook/omo') return true",
    "  if (CONFIGURED_HOOK_PATH !== '/hook/pi') return false",
    "  if (process.env.OMO_NATIVE === '1') return true",
    '  return [process.title, process.env._, process.argv[1], process.argv[0]].some((value) =>',
    "    ['omo', 'senpi'].includes(processName(value).replace(/\\.(?:js|sh|cmd|exe|bat)$/, ''))",
    '  )',
    '}',
    '',
    // Why: omo uses Pi settlement signals rather than OMP's immediate agent_end contract.
    'function isOmpRuntime(): boolean {',
    '  if (cachedOmpRuntime !== null) return cachedOmpRuntime',
    "  if (CONFIGURED_HOOK_PATH === '/hook/omp') {",
    '    cachedOmpRuntime = true',
    '    return true',
    '  }',
    '  const executableNames = [',
    '    processName(process.title),',
    '    processName(process.env._),',
    '    processName(process.argv[1]),',
    '    processName(process.argv[0])',
    '  ]',
    '  cachedOmpRuntime = executableNames.some((name) =>',
    "    ['omp', 'omp.js', 'omp.sh', 'omp.cmd', 'omp.exe', 'omp.bat'].includes(name)",
    '  )',
    '  return cachedOmpRuntime',
    '}',
    '',
    'function resolveHookPath(ompRuntime: boolean): string {',
    '  // Why: runtime detection keeps a bare-shell OMP launch from reporting as Pi.',
    "  if (isOmoRuntime()) return '/hook/omo'",
    "  if (ompRuntime) return '/hook/omp'",
    '  return CONFIGURED_HOOK_PATH',
    '}'
  ]
}
