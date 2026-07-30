# ccpreflight

코딩 에이전트(Claude Code · Codex 등)의 **사용량을 명령 단위로 정산**하고,
**작업을 시작하기 전에 모델·effort를 추천**하는 CLI.

| | 기존 도구 | ccpreflight |
|---|---|---|
| 일·주·월·세션별 토큰/비용 | ✅ `ccusage` | — (중복 안 만듦) |
| **명령 1건당** 토큰/비용 | ❌ 없음 | ✅ |
| 작업 전 모델·effort 추천 | ❌ 없음 | ✅ |

---

## 기능 1 — `stat` : 명령 단위 사용량

`ccusage`는 세션까지만 쪼갠다. **"방금 그 명령 하나에 얼마 썼나"** 는 어디에도 없다.
그런데 로그에는 이미 다 있다 — `~/.claude/projects/<slug>/<session>.jsonl` 의
어시스턴트 메시지마다 `usage`(input / output / cache_read / cache_creation)가 남는다.
사람 발화를 기준선으로 묶으면 명령 단위가 나온다.

실측 예시 (동일 세션의 연속 3개 명령):

```
명령                              API 호출   출력      캐시 읽기
"이게 1차고, 2차 지표는…"            2회     5,702    1,918,370
"얼마만큼의 토큰이 소요됐는지…"        6회     3,512    5,787,775
"1. 무료같은데? 2. …"                3회     4,233    2,905,830
```

여기서 바로 보이는 것: **비용의 대부분이 캐시 읽기**이고, 도구 호출이 많은 명령일수록
맥락을 반복해서 읽어 비싸진다. 세션 총합만 봐서는 절대 안 보인다.

```
$ ccpreflight stat --last 5
$ ccpreflight stat --session <id> --json
$ ccpreflight stat --csv > usage.csv
```

단가표(2026-07 기준, 1M 토큰당):

| 모델 | 입력 | 출력 |
|---|---|---|
| `claude-opus-5` | $5 | $25 |
| `claude-fable-5` | $10 | $50 |
| `claude-sonnet-5` | $3 | $15 |
| `claude-haiku-4-5` | $1 | $5 |

캐시 읽기 ≈ 입력가 × 0.1 / 캐시 쓰기 ≈ × 1.25 (5분 TTL) 또는 × 2.0 (1시간 TTL).
구독제 사용자에게 이 값은 **실청구액이 아니라 "정가로 샀으면 얼마"** 다 — 본전 계산용.

---

## 기능 2 — `advise` : 작업 전 모델·effort 추천

프롬프트를 분석해 실행 **전에** 한 줄 띄운다.

```
$ ccpreflight advise "이 컴포넌트 props 하나 추가하고 타입 맞춰줘"

권장: Sonnet 5 / low     단일 파일 · 기계적 변경
```

```
$ ccpreflight advise "결제 흐름 전체를 훑어서 우회 가능한 경로 찾아줘"

권장: Opus 5 / xhigh     다중 파일 감사 · 추론 깊이 필요
```

판정 축: 변경 파일 수 추정 · 탐색 범위 · 추론 깊이 · 되돌리기 난이도.
**규칙 기반**으로 한다 — 매 프롬프트마다 도는 경로라 AI 호출을 넣으면 지연·비용이 상시로 붙는다.
정밀 분류(Haiku 1회 호출)는 `--deep` opt-in.

### 예외 분기 — 에이전트 범위 밖이면 추천하지 않는다

분석 도중 **에이전트가 원리상 끝낼 수 없는 단계**가 섞여 있으면,
모델을 추천하는 대신 **그 사실을 먼저 알린다.**

```
$ ccpreflight advise "supabase anon 키를 vercel에 붙이고 배포까지"

⚠ 이 작업엔 에이전트 범위 밖 단계가 있습니다. 모델 추천은 생략합니다.

  [사람] Vercel 대시보드 → 환경변수 등록 (SUPABASE_ANON_KEY)
  [사람] 배포 트리거 승인 (프로덕션 배포)

  → 위 2건을 먼저 처리하고 시작하면 중간에 안 막힙니다.
```

**왜 이 분기가 필요한가**: 지금 에이전트들은 못 하는 일이 섞여 있어도
그냥 "Sonnet high 추천해요" 를 내뱉고 시작한다. 그리고 한참 진행한 뒤에야
"Vercel 대시보드에서 환경변수를 넣어주세요" 가 튀어나온다.
**할 수 없는 작업에 모델을 추천하는 건 틀린 답이다.** 추천을 접고 범위를 밝히는 게 맞다.

감지 대상:

| 분류 | 예 |
|---|---|
| 대시보드 조작 | Vercel 환경변수, Supabase 설정, Cloudflare 토글 |
| 계정·인증 | OAuth 앱 생성, API 키 발급, 결제수단 등록 |
| DB 마이그레이션 실행 | SQL 에디터에서 운영자가 직접 실행하는 정책인 경우 |
| 스토어 제출 | App Store Connect 제출, 심사 메모, 스크린샷 업로드 |
| DNS·도메인 | 네임서버, 레코드 변경 |
| 물리·외부 확인 | 실기기 테스트, 결제 실제 청구 확인, 수신 메일 확인 |
| 승인·정책 | 약관 동의, 권한 승인, 유료 플랜 전환 |

부분적으로만 걸리면 **가능한 부분의 추천은 그대로 내고**, 불가능한 단계만 따로 표시한다.

---

---

## 훅으로 자동 실행

`advise` 를 프롬프트 제출 시점에 자동으로 물리려면 `UserPromptSubmit` 훅에 건다.

```json
// .claude/settings.json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx -y turnstat hook",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### ⚠️ `$CLAUDE_PROJECT_DIR` 를 쓰지 말 것 (Windows 에서 조용히 죽는다)

공식 문서는 훅 경로에 `$CLAUDE_PROJECT_DIR` 접두사를 권하지만, **Windows 셸은 cmd.exe 라
`$VAR` 를 확장하지 않는다.** 확장되지 않은 문자열이 그대로 넘어가 `The system cannot find
the path specified` 로 훅이 죽고, 훅 실패는 조용해서 알아채기 어렵다
([#24710](https://github.com/anthropics/claude-code/issues/24710)).

그래서 `turnstat hook` 을 **서브커맨드**로 뒀다 — 경로도 셸 변수도 안 쓰므로 3개 OS 에서 동일하게 돈다.

npm 설치 전(로컬 개발 중)이라면 절대 경로를 쓴다:

```json
// Windows
"command": "node D:\\turnstat\\bin\\turnstat.mjs hook"

// macOS / Linux
"command": "node /path/to/turnstat/bin/turnstat.mjs hook"
```

채널을 둘로 나눈다:

| 채널 | 대상 | 내용 |
|---|---|---|
| `systemMessage` | **사용자** | 추천 한 줄, 또는 범위 밖 고지 |
| `additionalContext` | **Claude** | "이 단계는 사람 몫이니 먼저 알려라" |

**exit 2 는 쓰지 않는다.** 그건 프롬프트를 차단하고 **지워버린다** — 사용자가 친 글이
날아가는 건 도구가 할 짓이 아니다. 입력이 깨지거나 프롬프트가 비어도 항상 exit 0 으로 빠진다.

> ⚠️ `additionalContext` 가 VSCode 확장에서 주입되지 않는 이슈가 보고돼 있다
> ([#49063](https://github.com/anthropics/claude-code/issues/49063)). CLI 에선 정상.
> 그래서 사용자 고지는 `systemMessage` 를 주 채널로 쓴다.

---

## 개발

```bash
node bin/turnstat.mjs stat --last 10
node bin/turnstat.mjs advise "작업 설명"
npm test          # 분류 규칙 회귀 테스트
```

규칙 기반 분류기는 패턴 하나를 고치면 다른 케이스가 조용히 깨진다.
`test/advise.test.mjs` 가 감지·오탐·추천을 고정해 둔다 — **규칙을 늘릴 때마다 반드시 돌릴 것.**

## 상태

`stat` · `advise` · 훅 어댑터 동작. 실 세션 로그로 검증 완료.

- [ ] 훅을 실제 세션에 물려 VSCode 에서 `systemMessage` 표시 확인
- [ ] 분류 규칙 확장 (현재 한국어 위주 + 영어 기본형)
- [ ] npm 배포 (`turnstat` 가용 여부 확인)

## 라이선스

MIT (예정)
