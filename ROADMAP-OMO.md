# ROADMAP: omo를 Orca에 통합하기

> 대상 리포지토리: Orca (`stablyai/orca`, Electron + React 기반 AI 오케스트레이터). Codex/Claude Code/OpenCode/Pi 등 ~35종의 코딩 에이전트를 각자의 git worktree에서 병렬 실행한다.
> 본 문서는 **설계·실행 로드맵**이며, 구현 코드는 포함하지 않는다. 인용된 모든 코드 경로는 클론된 리포지토리에 실재하는 파일로 기계 검증되었다.
> 코드 식별자(심볼/타입/파일)는 영어로, 설명은 한국어로 표기한다.

---

## 0. 개요와 핵심 통찰

### 0.1 요구된 3개 기능
1. **omo를 `pi`와 구별되는 독립 에이전트 종류로 인식** — 현재 omo는 pi-호환(senpi/omp) 계열에 속하고 기본값이 `pi`로 폴백되기 때문에 pi로 오인식된다.
2. **Agent 대시보드** — omo의 background agent들이 어떤 job을 수행 중인지 보여주는 뷰.
3. **omo ChatUI 지원** — Orca의 native-chat 인터페이스로 omo를 구동.

### 0.2 조사로 확정된 현실 (로드맵의 방향을 바꾸는 사실)
- **기능 2·3은 "신규 구축"이 아니라 "기존 인프라 확장"이다.**
  - Agent 대시보드는 이미 실험(experiment) 기능으로 존재한다: `src/renderer/src/components/dashboard/AgentDashboardDrawer.tsx`, `src/renderer/src/components/dashboard-popout/AgentKanbanBoard.tsx`, 스냅샷 빌더 `src/renderer/src/components/dashboard/build-dashboard-snapshot.ts`.
  - native-chat(ChatUI)은 이미 omo의 계열인 `omp`를 지원 대상에 포함한다: `src/shared/native-chat-agent-support.ts`의 `NATIVE_CHAT_SUPPORTED_AGENT_LIST = [claude, openclaude, codex, grok, omp]`.
- **기능 1(identity)이 기능 2·3의 공통 선행 조건이다.**
  - 대시보드 카드는 `agentType`을 키로 렌더링된다(`src/shared/dashboard-snapshot.ts`의 `DashboardCard.agentType`). omo가 독립 종류가 아니면 대시보드에서 omo job이 `pi`로 표시된다.
  - native-chat이 어떤 에이전트를 받아들이는지는 에이전트 종류 집합으로 게이트된다(`src/shared/native-chat-agent-support.ts`). omo를 `TuiAgent` 유니온에 추가해야 admit이 가능하다.

### 0.3 의존성 그래프
```
[기능 1: omo identity]  ← 공통 선행조건
        │
        ├──────────────► [기능 2: Agent 대시보드 — omo background job]
        │
        └──────────────► [기능 3: omo ChatUI (native-chat)]
```
기능 2와 기능 3은 기능 1의 Phase 1(에이전트 등록)이 끝나면 서로 독립적으로 병렬 진행 가능하다.

### 0.4 전 기능 공통 선결 과제 (외부 사실 수집)
로드맵의 여러 작업은 "omo/senpi 런처의 실제 동작"이라는 외부 사실에 의존한다. 구현 착수 전 아래를 **실측**해 픽스처로 고정해야 한다(추측 금지).
- omo 런처가 실행되는 실제 프로세스명 / 진입점(entrypoint) / 설치 바이너리명(예: `omo`, `senpi` 후보).
- omo의 관리 홈 디렉터리 규약과 확장(extension) 로딩 방식(pi의 `PI_CODING_AGENT_DIR` 계약과 동일 여부).
- omo 훅 이벤트 shape와 종료(settlement) 의미(`willContinue` / `agent_settled` 대응 여부).
- omo transcript 파일 경로·포맷(omp 포맷 재사용 가능 여부), 슬래시 커맨드/스킬 문법.

---

## 1. 기능 1 — omo를 pi와 구별되는 독립 에이전트로 인식

### 1.1 현재 상태 (Current state)
Orca에서 에이전트 "종류"는 여러 채널로 나뉘어 등록된다. omo는 그 어느 곳에도 존재하지 않아 pi 계열로 흡수된다.

- `src/shared/tui-agent.ts` — `TuiAgent` 유니온. Orca가 실행할 수 있는 모든 에이전트의 마스터 목록. `pi`, `omp`, `prime-agent`는 있으나 `omo`는 **없음**.
- `src/shared/tui-agent-config.ts` — `TUI_AGENT_CONFIG_SOURCE` 레코드. 에이전트별 `detectCmd` / `detectCmdAliases` / `launchCmd` / `promptInjectionMode`를 정의(빌더가 `launchCmd`·`expectedProcess`를 `detectCmd`로 기본값 처리). pi/omp/prime-agent 항목이 이 패턴의 템플릿.
- `src/shared/pi-agent-kind.ts` — `PiAgentKind = 'pi' | 'omp' | 'prime-agent'`, `isPiCompatibleAgentType`, `detectPiAgentKindFromCommand`. **오인식의 근원**: 명시 감지에 실패하면 `detectPiAgentKindFromCommand`가 `'pi'`를 폴백으로 반환한다. 계열 내 env 매핑(`PRIMARY_AGENT_DIR_ENV_BY_KIND`, `SOURCE_AGENT_DIR_ENV_BY_KIND`)도 여기 있다.
- `src/shared/agent-kind.ts` — `TUI_AGENT_KIND_BY_AGENT`. 모든 `TuiAgent`를 텔레메트리 종류로 매핑(`satisfies Record<TuiAgent, ...>`로 컴파일 타임 exhaustive). 역방향 맵은 자동 파생.
- `src/shared/telemetry-property-schemas.ts` — `AGENT_KIND_VALUES` (닫힌 텔레메트리 enum 배열)와 `agentKindSchema = z.enum(AGENT_KIND_VALUES)`. `pi`/`omp`/`prime-agent`는 있으나 `omo` 없음.
- `src/shared/agent-status-types.ts` — `WellKnownAgentType` 유니온과 `AgentType = WellKnownAgentType | (string & {})`. UI/상태 계층의 에이전트 종류 키.
- `src/shared/agent-process-recognition.ts` — `recognizeAgentProcess`, `recognizeAgentProcessFromCommandLine`, `isExpectedAgentProcess`, `isRecognizedAgentType`. 프로세스명/명령 토큰으로 에이전트를 역추적(exact 정규화명 우선, 최초 등록이 충돌 소유).
- `src/shared/tui-agent-display-names.ts`, `src/shared/agent-type-label.ts` — 표시명/라벨. 키바인딩 액션 생성이 표시명에서 파생.
- `src/shared/tui-agent-selection.ts` — `TUI_AGENT_AUTO_PICK_ORDER`(별도 관리되는 자동 선택 순서).
- 렌더러 표면: `src/renderer/src/lib/agent-catalog.tsx`(로컬라이즈된 피커 항목/아이콘), `src/renderer/src/lib/agent-status.ts`(아이콘 가능 종류), `src/renderer/src/lib/launch-agent-in-new-tab.ts`(탭에 `launchAgent`와 텔레메트리 `agent_kind` 각인).
- 훅/런타임 표면: `src/shared/agent-hook-relay.ts`, `src/shared/agent-hook-listener/source-routing.ts`, `src/shared/agent-hook-listener/provider-dispatch.ts`, `src/shared/agent-hook-listener/providers/pi-family-events.ts`, `src/main/pi/agent-status-runtime-detection-source.ts`, `src/main/pi/titlebar-extension-service.ts`, `src/main/ipc/pty/host-env/pi-agent.ts`.

### 1.2 Gap 분석
- omo 항목이 위 모든 등록 지점에 부재 → 런처가 실행되면 `detectPiAgentKindFromCommand`의 `'pi'` 폴백에 흡수, 또는 `omp`로 오분류.
- 선례: kimi 인식 추가 커밋 `14e0d40e0`은 `src/shared/agent-process-recognition.test.ts`와 `src/shared/tui-agent-config.ts`(= `detectCmd` + `detectCmdAliases`)만 건드렸다. 신규 종류의 최소 인식 템플릿.
- 단, omo는 kimi와 달리 **pi-호환 계열**이라 훅/확장/홈 디렉터리 채널까지 함께 다뤄야 완전한 분리가 된다.

### 1.3 통합 설계 (권장안)
**omo를 독립 `TuiAgent`·텔레메트리 종류·훅 소스·표시 identity로 추가하되, 동시에 `PiAgentKind`의 형제(sibling)로 둔다.** 계열 소속은 "확장/env 프로토콜 공유"를 뜻할 뿐 제품 동일성을 뜻하지 않는다. OMP가 Pi와 분리된 방식을 그대로 따른다(기존 `pi`/`omp`/`prime-agent` ID는 절대 개명·병합하지 않음). 공용 제너레이터/노멀라이저를 재사용하고 별도 훅 서비스를 새로 만들지 않는다.

핵심 원칙(교차 폴백 금지): omo용 source dir이 없더라도 다른 계열(pi/omp)의 dir로 대체하지 않는다 — `src/shared/pi-agent-kind.ts`의 기존 주석 계약과 동일.

### 1.4 단계별 작업 (Phased tasks)

**Phase 1 — 런처 계약 실측 + identity 등록 (S~M)**
1. `src/shared/agent-process-recognition.test.ts`, `src/shared/pi-agent-kind.test.ts` — omo의 실제 명령/프로세스/진입점/홈/prefill을 픽스처(기계 계약)로 기록. 양성(직접/경로/인터프리터) + 음성(프롬프트 텍스트/무관 스크립트) 케이스. 의존: 없음(외부 실측). 검증: pi/omp/prime 기존 출력 불변.
2. 등록 스윕(핵심 편집): `src/shared/tui-agent.ts`(유니온에 `'omo'`), `src/shared/tui-agent-config.ts`(omo 설정 항목 — pi/omp 미러), `src/shared/tui-agent-display-names.ts`, `src/shared/agent-type-label.ts`, `src/shared/agent-status-types.ts`(`WellKnownAgentType`), `src/shared/agent-kind.ts`(`TUI_AGENT_KIND_BY_AGENT`), `src/shared/telemetry-property-schemas.ts`(`AGENT_KIND_VALUES`), `src/shared/tui-agent-selection.ts`, `src/shared/skills-cli-agent-keys.ts`, `src/renderer/src/lib/agent-status.ts`, `src/renderer/src/lib/agent-catalog.tsx`. 의존: 1. 검증: 타입체크 + `agentKindSchema.parse('omo')` 통과 + 정/역 텔레메트리 매핑.
3. 로컬라이즈: `src/renderer/src/i18n/locales/en.json`을 필두로 `src/renderer/src/i18n/locales/ko.json`, `src/renderer/src/i18n/locales/ja.json`, `src/renderer/src/i18n/locales/zh.json`, `src/renderer/src/i18n/locales/es.json`, `src/renderer/src/i18n/locales/fr.json`에 카탈로그 키 추가(OMP/Kimi 이웃 키 구조 답습). 브랜딩 자산은 `src/renderer/src/lib/agent-favicon-assets.ts` 또는 `src/renderer/src/lib/agent-icon-glyphs.tsx` 패턴으로 후속(초기엔 letter-icon 폴백). 의존: 2.
4. 실행 경로: `src/shared/tui-agent-startup.ts`, `src/shared/tui-agent-launch-command.ts`, `src/renderer/src/lib/agent-paste-draft.ts`를 omo로 통과시켜 회귀 확인. 의존: 2. 검증: 피커에서 omo 실행 시 `launchAgent: 'omo'` 유지, positional 프롬프트 제출, draft prefill이 자동 제출되지 않음.

**Phase 2 — 로컬 훅/홈/env를 통한 omo identity 보존 (M~L)**
5. 계열/env/홈 준비: `src/shared/pi-agent-kind.ts`(유니온·predicate·양 env 맵에 omo 추가, 명시 런치 감지 학습), `src/main/ipc/pty/host-env/pi-agent.ts`, `src/main/ipc/pty/host-env/assembly.ts`, `src/main/pi/titlebar-extension-service.ts`, `src/main/pi/prefill-extension-source.ts`. 의존: 1~2. 검증: `src/main/pi/titlebar-extension-service.test.ts` 확장 — 명시/타입드-셸 준비가 올바른 홈 선택, 타 계열 source 미차용, 훅 비활성/중첩 런치 시 잔여 omo 메타데이터 없음.
6. 런타임 훅 identity: `src/main/pi/agent-status-runtime-detection-source.ts`, `src/main/pi/agent-status-extension-source.ts`, `src/shared/agent-hook-relay.ts`, `src/shared/agent-hook-listener/source-routing.ts`, `src/shared/agent-hook-listener/provider-dispatch.ts`, `src/shared/agent-hook-listener/provider-event-routing.ts`, `src/shared/agent-hook-listener/providers/pi-family-events.ts`, `src/shared/agent-hook-listener/providers/pi-family-tool-fields.ts`. `/hook/omo` 소스 추가 + 무손실 pi-계열 정규화, OMP 전용 동작(예: 즉시 완료 폴백)과 분리. 의존: 5. 검증: `src/main/pi/agent-status-extension-test-harness.ts`·`src/main/pi/agent-status-extension-source.test.ts`·`src/shared/agent-hook-listener-pi-compatible.test.ts`로 최종 `agentType`=omo, `willContinue: true`가 종료로 오인되지 않음(구독 후 이벤트 대기, sleep 금지).
7. 타이틀/표시 identity: `src/shared/synthetic-agent-title.ts`, `src/shared/pi-compatible-synthetic-title.ts`, `src/shared/agent-title-evidence.ts`, `src/shared/terminal-title-agent-type.ts`, `src/shared/foreground-wrapper-agent.ts`, `src/shared/pane-agent-identity-adapter.ts`. (선택) `src/shared/agent-node-entrypoint-identities.ts`에 검증된 omo 진입점 패턴. 의존: 2·6. 검증: 로컬 pane이 훅 전후·idle/working/blocked·턴 완료 후 omo로 표시, wrapper PID 정확, pi가 omo wrapper를 이기지 않음.

**Phase 3 — 원격 패리티 + 릴리스 검증 (M)**
8. 원격/relay: `src/main/ssh/ssh-relay-session.ts`, `src/relay/plugin-overlay.ts`, `src/relay/plugin-overlay-env.ts`, `src/relay/relay-agent-hook-runtime.ts`, `src/relay/wsl-install-plugins-handler.ts`. omo 소스 필드/ack/원격 홈·env/훅 소스 인식. 의존: 5~7. 검증: SSH 실행이 재연결 후 omo 훅 수신·유지, 구버전 relay가 설치를 거짓 ack하거나 pi로 치환하지 않음.
9. (선택) WSL 패리티: `src/main/agent-hooks/wsl-hook-relay-deps.ts`, `src/main/pty/wsl-orca-env.ts`, 조건부 `src/main/pty/omp-shell-wrapper.ts`. 미포함 시 "미지원"을 명시 문서화. 의존: 8.

### 1.5 의존성
- Phase 1이 기능 2·3의 선행 조건. Phase 2~3은 기능 1 내부에서 순차. Phase 1 완료 시점에 기능 2·3 착수 가능.

### 1.6 공수 및 리스크
- 공수: Phase 1 = S~M(등록 스윕, 다수 소파일), Phase 2 = M~L(훅/홈/env 상태기계), Phase 3 = M(원격).
- 리스크 Top 3: (1) omo 런처의 실제 프로세스/홈 규약 미확인 → 픽스처 실측 없이는 인식 불가. (2) pi/omp와의 프로세스명 충돌 → 최초 등록 소유 규칙과 alias 검증 필요. (3) 계열 공유로 OMP 전용 lifecycle(즉시 완료)이 omo에 잘못 상속될 위험 → 계약 테스트로 차단.

---

## 2. 기능 2 — Agent 대시보드 (omo background job 표시)

> **핵심 요건: 서브에이전트(background job) 뷰는 라이브(실시간)로 갱신되어야 한다.** 폴링 루프가 아니라, Orca가 이미 갖춘 store 구독 + agentStatus IPC push + 다이렉트 패치 체인을 그대로 타야 한다. 아래 2.1의 "라이브 갱신 체인"이 그 경로다.

### 2.1 현재 상태 (Current state)
Orca에는 이미 실험 기능으로 Agent 대시보드가 존재하며, **이미 라이브로 갱신된다**. 신규 뷰나 폴링을 만들 필요가 없고, 이 라이브 경로를 **확장**한다.

- `src/renderer/src/components/dashboard/AgentDashboardDrawer.tsx` — 인-윈도우 대시보드 드로어(보드 본체).
- `src/renderer/src/components/dashboard-popout/AgentKanbanBoard.tsx`, `src/renderer/src/components/dashboard-popout/AgentKanbanCard.tsx` — 칸반 보드/카드(Needs You/Working/Done/Idle 컬럼). `src/renderer/src/components/dashboard-popout/DashboardPopoutRoot.tsx`는 팝아웃 루트.
- `src/renderer/src/components/dashboard/build-dashboard-snapshot.ts` — 라이브 렌더러 스토어에서 직렬화 스냅샷 도출. 스토어 슬라이스(`agentStatusByPaneKey`, `runtimeAgentOrchestrationByPaneKey`, `retainedAgentsByPaneKey` 등)를 읽어 카드로 평탄화.
- `src/shared/dashboard-snapshot.ts` — `DashboardCard`(필드: `agentType`, `dotState`('working'|'blocked'|'waiting'|'done'|'idle'), `task`, `subagents`, `stateChangedAt`), `DashboardCardSubagent`, `DashboardCardDotState`.
- `src/renderer/src/components/dashboard/dashboard-subagent-cards.ts`, `src/renderer/src/components/sidebar/worktree-subagent-child-rows.ts` — 서브에이전트(자식) 카드/행 생성. background job의 자연스러운 표현 지점.
- `src/shared/agent-status-types.ts` — `AgentType`, 서브에이전트 스냅샷 등 상태 계약.
- `src/shared/orchestration-fleet-projection.ts` — `FleetDurableWorker`(`dispatchId`/`taskId`/`runId`/`parentTaskId`/`workerStage`/`outcome` in_progress|succeeded|failed|...), `FleetTerminalState`. 오케스트레이션 워커(=background job)의 내구 상태 모델.
- 게이팅/진입: `src/renderer/src/components/sidebar/AgentDashboardSidebarHost.tsx`, `src/renderer/src/components/sidebar/AgentDashboardSidebarEntry.tsx`(lazy·experiment-gated), `src/renderer/src/components/sidebar/SidebarNav.tsx`.
- 전송/브리지: `src/preload/api/dashboard-bridge.ts`, `src/main/ipc/dashboard-payload-validation.ts`, `src/renderer/src/components/dashboard-popout/dashboard-agent-status-patch.ts`(다이렉트 패치 경로).
- omo 이벤트 유입: omo는 pi-호환이라 스텝 사이에 milestone 이벤트를 낸다(`isPiCompatibleAgentType`, `src/main/pi/agent-status-handler-source.ts`, `src/main/pi/agent-status-extension-source.ts`). 대시보드는 이 상태 모델을 소비.

**라이브 갱신 체인 (poll 없음, push 기반 — 서브에이전트 뷰가 실시간인 이유):**
- `src/main/startup/main-window-agent-status.ts` → `src/preload/api/agent-status-bridge.ts` → `src/renderer/src/hooks/ipc-events/agent-status-listeners.ts` / `src/renderer/src/hooks/ipc-events/agent-status-ipc-bridge.ts` — main 훅 서버가 상태 변화를 렌더러로 push. `agent-status-ipc-bridge.ts`는 `useAppStore.subscribe(...)`로 매 업데이트마다 발화(폴링 아님).
- `src/renderer/src/hooks/ipc-events/agent-status-event-applicator.ts` — push된 `AgentStatusIpcPayload`를 store에 적용(`createAgentStatusEventApplicator`).
- `src/renderer/src/store/slices/agent-status.ts`, `src/renderer/src/store/slices/agent-status-live-entry-builder.ts` — zustand 슬라이스가 라이브 엔트리를 갱신하며 `agentStatusByPaneKey`를 변경.
- 인-윈도우 드로어(라이브): `src/renderer/src/components/dashboard/useLiveDashboardSnapshot.ts` — `useAppStore((s) => s.agentStatusByPaneKey)` 등을 구독해 상태 ping마다 스냅샷 memo를 재빌드(파일 주석: "rebuilds this memo on every status ping").
- 팝아웃(라이브): `src/renderer/src/components/dashboard/useDashboardPopoutBridge.ts`가 직렬화 스냅샷을 재발행(`src/main/ipc/dashboard-popout.ts`), 팝아웃의 `src/renderer/src/components/dashboard-popout/useDashboardSnapshot.ts`가 이를 구독. **전체 스냅샷 사이의 서브에이전트 행은 `src/renderer/src/components/dashboard-popout/dashboard-agent-status-patch.ts`의 `patchDashboardSnapshotFromAgentStatus`/`patchedSubagents`가 라이브로 패치한다** — 이 지점이 "서브에이전트 뷰 실시간"의 핵심 좌표.

### 2.2 Gap 분석
- 대시보드 카드는 `agentType` 키로 렌더 → omo가 독립 종류가 아니면 job이 pi로 표시(**기능 1 선행**).
- 현재 서브에이전트 표현은 milestone/자식 상태 위주이며, "provider job 인벤토리"(job/task ID·상태·현재 스텝) 계약이 없다 → omo owner가 실행 중인 job 목록을 신뢰성 있게 표현할 필드가 부족.
- 최신값-우선(coalescing) 포스트 슬롯이라 spawn/finish가 유실될 수 있음 → owner가 매 상태 변화마다 전체 roster+revision을 보내야 손실 없음.
- **라이브 뷰 gap**: 라이브 체인 자체는 존재하지만, `patchDashboardSnapshotFromAgentStatus`의 `patchedSubagents`가 현재 기존 자식 필드만 패치한다 → 새 omo job 메타데이터를 라이브로 반영하려면 이 패치 경로와 store 슬라이스가 새 필드를 전파해야 하며, 전체 스냅샷 재빌드를 기다리거나 폴링해서는 안 된다.

### 2.3 통합 설계
현재 보드의 부모-카드 disclosure를 **"Background jobs"**(omo 소유 자식)로 확장한다. 새 top-level 뷰/탭/BrowserWindow/RPC 폴링 루프/별도 채팅을 추가하지 않는다. 패턴: `src/renderer/src/components/dashboard/AgentDashboardDrawer.tsx`, `src/renderer/src/components/dashboard-popout/AgentKanbanBoard.tsx`, `src/preload/api/dashboard-bridge.ts`.
- 자식 행: provider job/task ID, 설명, 명시 상태(queued/running/blocked/waiting/succeeded/failed/cancelled/unknown), 현재 스텝/툴 미리보기, 경과/최근관측, 부모-task 중첩. 활성/주목 job 우선, 완료 tail은 bounded, 생략 개수 노출. headless job은 소유 에이전트의 기존 터미널/reveal 액션으로 열기(가짜 자식 PTY 생성 금지).
- 데이터 계약: `src/shared/agent-status-types.ts`에 optional provider-job 메타데이터 추가(레거시 자식 상태 투영 유지). `src/shared/dashboard-snapshot.ts`의 `DashboardCardSubagent`/인벤토리 요약에 bounded optional 필드 추가.
- **라이브 보존(핵심)**: `src/renderer/src/components/dashboard-popout/dashboard-agent-status-patch.ts`의 `patchedSubagents`를 확장해 새 job 메타데이터를 전체 스냅샷 사이에서 라이브로 패치하고, `src/renderer/src/components/dashboard/useLiveDashboardSnapshot.ts`(인-윈도우)와 `src/renderer/src/components/dashboard-popout/useDashboardSnapshot.ts`(팝아웃) 양 경로가 동일하게 갱신되게 한다. 새 폴링/타이머/RPC 주기적 요청 금지 — 기존 push 구독만 사용.
- 렌더 확장: `src/renderer/src/components/sidebar/worktree-subagent-child-rows.ts`, `src/renderer/src/components/dashboard/dashboard-subagent-cards.ts`, `src/renderer/src/components/dashboard/build-dashboard-snapshot.ts`, `src/renderer/src/components/dashboard-popout/dashboard-agent-status-patch.ts`(동일 clearing/order), `src/renderer/src/components/dashboard-popout/AgentKanbanCard.tsx`(memo 비교·disclosure), `src/renderer/src/components/dashboard-popout/agent-board-filtering.ts`(job 검색).

### 2.4 단계별 작업 (Phased tasks)

**Phase 1 — 증거 계약 확립 (M)**
1. `src/main/pi/agent-status-handler-source.ts`, `src/shared/pi-agent-kind.ts`, `src/main/pi/agent-status-extension-omp-lifecycle.test.ts` — omo 버전의 owner 접근 가능 job 인벤토리/변화 신호를 실측, task/session identity·milestone/최종 이벤트 의미 기록. 의존: 없음(외부 owner-side job API 가용성). 검증: 실제 2-자식 런 1건(milestone+최종 완료) 캡처 후 하네스로 재생, continuation이 완료로 발화하지 않음.
2. `src/shared/agent-status-types.ts`, `src/shared/agent-hook-relay.ts`, `src/shared/agent-hook-listener/providers/pi-family-events.ts`, `src/shared/agent-hook-listener/listener-state.ts` — bounded optional job 메타데이터, owner-인벤토리 revision/completeness, 권위적 empty 의미, 부모/백그라운드 lifecycle folding. equality/picking/digest·pane/session cleanup 갱신. 의존: 1. 검증: `src/shared/agent-hook-listener-pi-compatible.test.ts` 확장(malformed ID/상태, absent vs empty vs truncated, 중복/구 revision, owner-session 교체, 부모 종료+working 자식).

**Phase 2 — 라이브 job 증거 배선/보존 (M~L)**
3. `src/main/pi/agent-status-extension-source.ts`, `src/main/pi/agent-status-handler-source.ts`, `src/main/pi/agent-status-extension-source.test.ts` — 검증된 owner job source 부착, roster seed, revision 포함 전체 스냅샷을 기존 최신값-포스트 슬롯으로 발행, 자식 PID 격리 유지. 의존: 1~2. 검증: 자식 A/B start·A progress·A finish·B wait(훅 요청 고의 지연) 후 해제 시 다음 포스트가 최종 roster 포함(구독 후 트리거, sleep 금지).
4. `src/relay/agent-hook-server.ts`, `src/main/agent-hooks/server/server-ingest-remote.ts`, `src/shared/agent-hook-relay.ts`, `src/renderer/src/store/slices/agent-status-live-entry-builder.ts` — 로컬/relay 정규화·shed/restore·replay·zustand 수용을 통해 메타데이터 보존, 구 revision/세션 재사용이 완료 job을 되살리지 못하게. 기존 IPC/preload는 불변(`src/preload/api/agent-status-bridge.ts`). 의존: 2~3. 검증: `src/relay/agent-hook-integration.test.ts` 확장(empty roster/shed/reconnect replay/contact 손실/새 owner session).

**Phase 3 — 대시보드 확장 + E2E (M)**
5. `src/shared/dashboard-snapshot.ts`, `src/renderer/src/components/sidebar/worktree-subagent-child-rows.ts`, `src/renderer/src/components/dashboard/dashboard-subagent-cards.ts`, `src/renderer/src/components/dashboard/build-dashboard-snapshot.ts`, `src/main/ipc/dashboard-payload-validation.ts`, `src/renderer/src/components/dashboard-popout/dashboard-agent-status-patch.ts` — job 상세/카운트/freshness를 전체 스냅샷과 다이렉트 패치에 동일 clearing/order로 전파. 의존: 2·4. 검증: `src/renderer/src/components/dashboard/build-dashboard-snapshot.test.ts`, `src/renderer/src/components/dashboard-popout/dashboard-agent-status-patch.test.ts` 확장.
6. `src/renderer/src/components/dashboard-popout/AgentKanbanCard.tsx`, `src/renderer/src/components/dashboard-popout/agent-board-filtering.ts`, 호스트 표면 `src/renderer/src/components/dashboard/AgentDashboardDrawer.tsx`·`src/renderer/src/components/dashboard-popout/DashboardPopoutRoot.tsx` — 활성-우선 job 상세/명시 outcome·stale 라벨/중첩 lineage/overflow, 소유 pane reveal 유지, memo equality·job 검색 갱신. 의존: 5. 검증: `src/renderer/src/components/dashboard-popout/AgentKanbanCard.test.tsx`, `src/renderer/src/components/dashboard-popout/agent-board-filtering.test.ts` 확장.
7. **라이브 갱신 E2E (서브에이전트 뷰가 실시간임을 증명)**: `src/renderer/src/components/dashboard-popout/dashboard-agent-status-patch.test.ts`, `src/renderer/src/components/dashboard/useLiveDashboardSnapshot.test.ts`에 다음 시나리오 추가 — job start 이벤트 적용 후 자식 행이 전체 스냅샷 재빌드 없이 나타나고(patched), 상태 전이(running→succeeded)가 다음 push에서 즉시 반영, 완료 job은 bounded tail로 남고 stale는 stale로 표시. 의존: 5·6. 검증(단위): 이벤트 적용 전후 스냅샷 diff를 검증(구독 신호에 가입 후 트리거, sleep · 고정 대기 금지). **실-표면 검증(렌더링된 Electron 대시보드)**: `AGENTS.md` 규약대로 `ORCA_BACKGROUND_LAUNCH=1`로 백그라운드 실행, `$electron` 스킬 + Playwright CDP로 숨겨진 렌더러 스크린샷을 job start→progress→finish 각 단계에서 캐처해 서브에이전트 행이 새 사용자 액션 없이 갱신되는지 확인(창 포커스 이동 · `show()` 금지).

### 2.5 의존성
- **기능 1 Phase 1**(omo가 독립 `agentType`) 선행. 그 외에는 기능 3과 병렬 가능. 내부적으로 Phase 1 → 2 → 3 순차.
- 라이브 뷰 요건은 Phase 2(push 경로 보존)와 Phase 3 task 5·7(패치/렌더/E2E)에 걸쳐 충족된다 — 별도 트랙이 아니라 기존 push 체인을 닫는 일.
- 외부 의존: omo owner-side job 인벤토리 API 가용성(없으면 owner-side aggregation 콜백/스냅샷 API가 상류 작업으로 필요).

### 2.6 공수 및 리스크
- 공수: Phase 1 = M, Phase 2 = M~L(전송/보존 상태기계), Phase 3 = M(렌더 확장 + 라이브 E2E).
- 리스크 Top 3: (1) omo가 child-process 이벤트만 노출하면 owner-side 집계 API 신설 필요(상류 작업). (2) 최신값-coalescing으로 인한 spawn/finish 유실 → revision 기반 전체 roster 필수. (3) 라이브 패치 누락: `patchedSubagents`가 새 job 필드를 높치면 서브에이전트 뷰가 전체 스냅샷 재빌드 전까지 멈춰 “라이브 감”을 잃음 → Phase 3 task 7 라이브 E2E로 차단.

---

## 3. 기능 3 — omo ChatUI (native-chat) 지원

### 3.1 현재 상태 (Current state)
Orca의 native-chat(ChatUI)은 이미 존재하며 omo의 계열인 `omp`를 transcript 지원 대상으로 포함한다. omo 지원은 대체로 `omp`를 미러링하는 확장이다.

- `src/shared/native-chat-agent-support.ts` — **게이트**. `NATIVE_CHAT_SUPPORTED_AGENT_LIST = [claude, openclaude, codex, grok, omp]`, `isNativeChatSupportedAgent`, `resolveNativeChatTranscriptAgent`(omp 처리), `nativeChatRequiresLocalTranscript`(grok·omp에 true). omo는 **미포함**.
- `src/shared/native-chat-agent-profiles.ts` — `NATIVE_CHAT_AGENT_PROFILES`(codex/claude/openclaude/grok만). `getNativeChatAgentProfile`, `getVerifiedNativeChatCommands`. omp는 프로파일이 없어도 transcript 렌더는 됨(= 프로파일은 선택적).
- transcript 디코더/리더: `src/main/native-chat/transcript-tail-reader.ts`, `src/main/native-chat/transcript-reader.ts`, `src/main/native-chat/transcript-line-decoders-omp.ts`, lifecycle `src/main/native-chat/transcript-turn-lifecycle.ts`.
- 세션 파일 해석: `src/main/native-chat/session-file-resolver.ts`(exact-path-first). 재개 identity는 `src/shared/agent-session-resume.ts` + `src/main/pi/agent-status-extension-source.ts`.
- 라이브 상태/가용성: `src/renderer/src/components/native-chat/native-chat-live-status.ts`, `src/renderer/src/components/native-chat/native-chat-availability.ts`, `src/renderer/src/components/native-chat/use-native-chat-live-session.ts`.
- 입력/커맨드: `src/shared/native-chat-slash-commands.ts`, `src/shared/native-chat-command-envelope.ts`, `src/shared/native-chat-ask.ts`, `src/renderer/src/components/native-chat/use-native-chat-picker-state.ts`, skill 소스 `src/main/skills/skill-discovery-sources.ts`.
- 세션 옵션/모델: `src/shared/agent-session-option-catalog.ts`, `src/shared/agent-model-probe-spec.ts`, `src/renderer/src/components/native-chat/native-chat-pty-session-options.ts`.
- 공용 스트리밍/턴: `src/shared/native-chat-streaming.ts`, `src/shared/native-chat-turn-status.ts`, `src/shared/native-chat-types.ts`.
- 렌더 컴포넌트/브리지: `src/renderer/src/components/native-chat/NativeChatView.tsx`, `src/renderer/src/components/native-chat/NativeChatComposer.tsx`, `src/renderer/src/components/native-chat/NativeChatMessageList.tsx`, `src/preload/api/native-chat-bridge.ts`, `src/main/ipc/native-chat.ts`.

### 3.2 Gap 분석
- omo가 `NATIVE_CHAT_SUPPORTED_AGENT_LIST`·`resolveNativeChatTranscriptAgent`에 없어 채팅 뷰가 열리지 않음(**기능 1의 `TuiAgent` 등록 선행**).
- omo 전용 transcript 태그·세션 경로 해석 부재. omp 디코더를 재사용할지 여부는 omo 포맷 실측 후 결정.
- multi-step(goal) 에이전트 특성상 "assistant 산출물만으로 완료 오판정" 위험 → live-status 보정 필요.
- 프로파일/슬래시 커맨드/모델 옵션은 omo 실제 문법 검증 전까지 보수적(빈 배열/null)으로 두는 것이 안전.

### 3.3 통합 설계
브리지를 유지하되 identity/포맷/파일시스템 소유를 분리한다.
- `src/shared/native-chat-agent-support.ts`에서 omo를 admit하고 omo용 `NativeChatTranscriptAgent` 태그를 추가. 그 태그를 `src/main/native-chat/transcript-tail-reader.ts`·`src/main/native-chat/transcript-reader.ts`의 기존 omp 디코더(`src/main/native-chat/transcript-line-decoders-omp.ts`)로 라우팅(omo 픽스처 호환 확인 후). 디코더 복제가 아니라 switch arm 추가.
- `src/main/native-chat/session-file-resolver.ts`에 omo id-해석 arm 추가(omo 전용 root 검증 전까지 null 반환, pi/omp root로 폴백 금지).
- 초기엔 omo를 host-local transcript 필요로 표시(omp의 보수적 가용성 정책 유지) — 레거시 Model-A SSH는 그 표면이 실제로 읽을 수 있을 때까지 게이트 유지(`src/renderer/src/components/native-chat/native-chat-availability.ts`, `src/renderer/src/components/native-chat/use-native-chat-live-session.ts`).
- multi-step 안전: `src/renderer/src/components/native-chat/native-chat-live-status.ts`에서 omo에 한해 "assistant-prose-only 완료 복구"를 보류(명시 종료/훅 증거는 보존). 공용 `src/shared/native-chat-streaming.ts`·`src/shared/native-chat-turn-status.ts`는 working 상태를 소비할 뿐이라 omo 분기 불필요.
- 커맨드/스킬은 검증된 것만: 초기 `getNativeChatAgentProfile('omo')`는 omp처럼 null 유지. omo가 `/name`으로 스킬을 부르면 `src/shared/native-chat-agent-profiles.ts`에 Grok 프로파일을 본떠 추가하고 root는 `src/main/skills/skill-discovery-sources.ts`에 추가.

### 3.4 단계별 작업 (Phased tasks)

**Phase 1 — 증거·identity·읽기 가능한 대화 (M)**
1. `src/main/native-chat/transcript-line-decoders.omp.test.ts`, `src/main/pi/agent-status-extension-omp-lifecycle.test.ts` — omo transcript/이벤트 픽스처(redacted) 캡처, 지원 버전·세션 경로·메시지 shape·최종 settlement·스킬/커맨드 문법 기록. 의존: 없음. 검증: 디코더 픽스처가 기대 role/block/id 산출, continuation과 최종 완료 구분.
2. identity 트랙 소비: `src/shared/tui-agent.ts`, `src/shared/tui-agent-config.ts`, `src/shared/agent-status-types.ts`, `src/shared/pi-agent-kind.ts`, `src/main/pi/titlebar-extension-service.ts`, `src/main/pi/agent-status-runtime-detection-source.ts`(= 기능 1과 조율). 의존: 1 + 기능 1. 검증: exhaustive 맵 타입체크, omo 실행 시 의도 pane에 omo-태그 훅.
3. 훅 라우팅: `src/shared/agent-hook-relay.ts`, `src/shared/agent-hook-listener.ts`, `src/shared/agent-hook-listener/provider-dispatch.ts`, `src/shared/agent-hook-listener/provider-event-routing.ts`, `src/shared/agent-hook-listener/providers/pi-family-events.ts`, `src/shared/agent-session-resume.ts`, `src/main/pi/agent-status-extension-source.ts` — omo 활동·persisted exact transcript identity를 기존 훅 전송으로. 의존: 1~2. 검증: 실제 shape 정규화, identity-only 세션 시작·in-process 세션 교체, 잘못된 파일 메타데이터 거부.
4. transcript admit: `src/shared/native-chat-agent-support.ts`, `src/shared/native-chat-agent-support.test.ts`, `src/main/native-chat/session-file-resolver.ts`, `src/main/native-chat/session-file-resolver.test.ts`, `src/main/native-chat/transcript-tail-reader.ts`, `src/main/native-chat/transcript-reader.ts` — omo transcript 태그·디코더 재사용·exact-path 해석, 교차-root 폴백 없이 host-readable 채팅 개시. 의존: 1~3. 검증: full/tail 리더 일치, 가짜 pi/omp root가 omo 경로를 만족하지 못함, 로컬 게이트 open·읽을 수 없는 레거시 SSH 게이트 closed.

**Phase 2 — 안정적 send/continuation/interruption (M)**
5. `src/main/pi/agent-status-handler-source.ts`, `src/main/pi/agent-status-extension-omp-lifecycle.test.ts`, `src/renderer/src/components/native-chat/native-chat-live-status.ts`, `src/renderer/src/components/native-chat/native-chat-live-status.test.ts` — omo 계열 settlement 유지 + prose-only 완료 복구 비활성. 의존: 1~4. 검증: 중간 assistant 응답+continuation+tool 활동이 working=false로 토글되지 않음, 최종 settlement는 됨, 중복 완료가 추가 전이를 만들지 않음.
6. `src/renderer/src/components/native-chat/use-native-chat-pty-composer-send.ts`, `src/renderer/src/components/native-chat/native-chat-runtime-send.ts`, `src/shared/native-chat-ask.ts`, `src/shared/agent-hook-listener/providers/pi-family-events.ts`, `src/renderer/src/components/native-chat/use-native-chat-interactive-send.ts` — 기존 프롬프트/Stop 동작 검증 + 입증된 omo ask/approval 차이만 추가. 의존: 3~5. 검증: 실제 Electron 채팅 composer로 single/multiline 프롬프트 구동, 비-첫 옵션 응답, interrupt 후 즉시 다음 턴, transcript echo가 optimistic echo 하나만 교체·다른 split pane 무수신.

**Phase 3 — 검증된 능력 + 릴리스 체크 (S~M)**
7. `src/shared/native-chat-agent-profiles.ts`, `src/shared/native-chat-agent-profiles.test.ts`, `src/shared/native-chat-slash-commands.ts`, `src/shared/native-chat-slash-commands.test.ts`, `src/main/skills/skill-discovery-sources.ts`, `src/renderer/src/components/native-chat/use-native-chat-picker-state.ts` — 검증된 omo 커맨드만 탑재, 근거 있을 때만 프로파일/스킬 문법·root 추가(없으면 의도적 null-profile 동작 테스트). 의존: 1·4·6. 검증: command/chat/unknown 분류·picker 출처 조정·소스 소유권, 미지원 커맨드가 거짓 성공 마커 미수신.
8. `src/shared/agent-session-option-catalog.ts`, `src/shared/agent-session-option-catalog.test.ts`, `src/shared/agent-model-probe-spec.ts`, `src/renderer/src/components/native-chat/native-chat-pty-session-options.ts` — 지원될 때만 최소 검증 omo 모델/옵션 카탈로그·probe 추가, 검증 불가 시 조작된 값 대신 컨트롤 미표시. 의존: 1·6~7. 검증: 정확한 생성 argv/command.

### 3.5 의존성
- **기능 1**(omo `TuiAgent` 등록)이 admit의 선행. 기능 3의 Phase 1은 기능 1과 조율(공유 파일 편집이 겹치므로 순서 조정 필요). 내부 Phase 1 → 2 → 3 순차.
- 외부 의존: omo transcript 포맷·세션 경로·슬래시/스킬 문법 실측.

### 3.6 공수 및 리스크
- 공수: Phase 1 = M(admit+디코더+해석), Phase 2 = M(라이브 상태/send), Phase 3 = S~M(프로파일/옵션은 대개 선택).
- 리스크 Top 3: (1) omo transcript가 omp 포맷과 다르면 디코더 재사용 불가 → 전용 디코더 필요. (2) multi-step 완료 오판정 → live-status 보정 필수. (3) 슬래시/스킬 문법 미검증 상태로 노출 시 거짓 성공 마커 → 검증 전 빈 배열/null 유지.

---

## 4. 통합 실행 순서 (권장 마일스톤)

1. **M0 — 외부 사실 실측**: omo 런처 프로세스/홈/훅/transcript 픽스처 확보(전 기능 공통 선결).
2. **M1 — 기능 1 Phase 1**(identity 등록): 이 시점부터 기능 2·3 병렬 착수 가능.
3. **M2 — 병렬 트랙**:
   - 트랙 A: 기능 1 Phase 2~3(훅/홈/원격).
   - 트랙 B: 기능 2 Phase 1~3(대시보드 background job) — 기능 1 Phase 2의 훅 identity에 일부 의존.
   - 트랙 C: 기능 3 Phase 1~3(ChatUI) — 기능 1과 공유 파일 편집이 겹치므로 M1 이후, 트랙 A와 편집 순서 조율.
4. **M3 — 통합 검증**: 로컬/원격 실사용 QA, 전 스위트 그린, 릴리스 체크.

> 병렬화 주의: 기능 1·3은 `src/shared/tui-agent.ts`, `src/shared/tui-agent-config.ts`, `src/shared/pi-agent-kind.ts`, `src/main/pi/*`를 공유 편집한다. 동일 파일 동시 편집을 피하려면 M1(기능 1 Phase 1)을 단일 트랙으로 먼저 완료한 뒤 분기할 것.

---

## 5. 부록 — 참고 커밋과 테스트 하네스
- 신규 에이전트 최소 인식 템플릿: 커밋 `14e0d40e0`(kimi) — `src/shared/agent-process-recognition.test.ts` + `src/shared/tui-agent-config.ts`.
- pi-계열 lifecycle/훅 테스트 하네스: `src/main/pi/agent-status-extension-test-harness.ts`, `src/shared/agent-hook-listener-pi-compatible.test.ts`, `src/main/pi/agent-status-extension-omp-lifecycle.test.ts`.
- 대시보드 스냅샷 테스트: `src/renderer/src/components/dashboard/build-dashboard-snapshot.test.ts`, `src/renderer/src/components/dashboard-popout/dashboard-agent-status-patch.test.ts`, `src/renderer/src/components/dashboard-popout/AgentKanbanCard.test.tsx`.
- native-chat 테스트: `src/shared/native-chat-agent-support.test.ts`, `src/main/native-chat/session-file-resolver.test.ts`, `src/renderer/src/components/native-chat/native-chat-live-status.test.ts`.
- 상세 근거(파일:심볼 전체 목록)는 `/Users/puri/AI/PURI/AI/roadmap-research/`의 `01-identity.md`, `02-dashboard.md`, `03-chatui.md` 참조.
