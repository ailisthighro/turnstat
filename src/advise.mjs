// 작업을 시작하기 전에 모델·effort 를 추천한다.
//   단, 분석 중 「에이전트가 원리상 끝낼 수 없는 단계」가 섞여 있으면 추천을 접고 그 사실을 먼저 알린다.
//   할 수 없는 작업에 모델을 추천하는 건 틀린 답이다.
//
// 규칙 기반으로 한다 — 매 프롬프트마다 도는 경로라 AI 호출을 넣으면 지연·비용이 상시로 붙는다.

/**
 * 에이전트 범위 밖 — 사람이 직접 해야 끝나는 단계들.
 * `hint` 는 사용자에게 그대로 보여줄 문구다.
 */
export const OUT_OF_SCOPE = [
  {
    id: "dashboard",
    label: "대시보드 조작",
    hint: "웹 대시보드에서 직접 설정해야 합니다",
    re: /(vercel|supabase|cloudflare|netlify|railway|firebase|heroku|aws)[^\n]{0,24}(대시보드|dashboard|콘솔|console|설정|환경\s*변수|env\s*var)|환경\s*변수[^\n]{0,10}(등록|추가|설정|넣|붙)|(add|set|paste|configure)[^\n]{0,20}(env(ironment)?\s*var|secret)[^\n]{0,20}(dashboard|vercel|console)/i
  },
  {
    id: "credentials",
    label: "계정·인증·키 발급",
    hint: "계정에서 직접 발급/등록해야 합니다",
    re: /(api\s*(key|키)|access\s*token|토큰|시크릿|secret\s*key|oauth\s*(앱|app)?|클라이언트\s*(id|시크릿))[^\n]{0,14}(발급|생성|등록|넣|붙|입력)|결제\s*수단|카드\s*등록|(create|generate|issue)[^\n]{0,16}(api\s*key|oauth\s*app|access\s*token)|billing\s*(info|method)/i
  },
  {
    id: "migration",
    label: "DB 마이그레이션 실행",
    hint: "SQL 에디터에서 직접 실행해야 합니다",
    re: /(sql|마이그레이션|migration)[^\n]{0,14}(실행|돌려|돌린|적용|apply|run)|sql\s*에디터|sql\s*editor|(run|apply|execute)[^\n]{0,14}(the\s*)?(migration|sql)/i
  },
  {
    id: "store",
    label: "앱스토어 제출",
    hint: "App Store Connect / Play Console 에서 직접 처리해야 합니다",
    re: /(앱\s*스토어|app\s*store|testflight|play\s*(console|스토어)|심사)[^\n]{0,14}(제출|올리|업로드|등록|신청)|(submit|upload)[^\n]{0,20}(app\s*store|testflight|play\s*console|for\s*review)/i
  },
  {
    id: "dns",
    label: "DNS·도메인",
    hint: "도메인 등록기관에서 직접 변경해야 합니다",
    re: /(dns|네임\s*서버|nameserver|도메인)[^\n]{0,14}(설정|변경|연결|등록|point|update)|(a|cname|txt|mx)\s*(레코드|record)/i
  },
  {
    id: "physical",
    label: "실기기·외부 확인",
    hint: "직접 눈으로 확인해야 합니다",
    re: /(실기기|실제\s*기기|실\s*결제|실제\s*결제)[^\n]{0,14}(테스트|확인|검증)|(메일|이메일|문자|sms)[^\n]{0,12}(수신|도착)\s*확인|(check|verify)[^\n]{0,20}(on\s*(a\s*)?(real|physical)\s*device|received\s*(the\s*)?email)/i
  },
  {
    id: "approval",
    label: "승인·정책 동의",
    hint: "직접 동의/승인해야 합니다",
    re: /(약관|권한|플랜)[^\n]{0,14}(동의|승인|전환|업그레이드)|유료\s*(전환|결제)|(accept|agree\s*to)[^\n]{0,16}(terms|tos)|upgrade[^\n]{0,14}(plan|to\s*pro)/i
  }
];

/** 프롬프트에서 범위 밖 항목을 뽑는다. */
export function detectOutOfScope(prompt) {
  return OUT_OF_SCOPE.filter((r) => r.re.test(prompt));
}

// ── 난이도 판정 ────────────────────────────────────────────────

// 한국어는 조사(을/를/만/도/은/는/이/가)가 끼어들므로 [을를만도은는이가]? 를 넣어 흡수한다.
//   이게 없으면 「이름만 바꿔줘」 같은 흔한 표현을 통째로 놓친다.
const P = "[을를만도은는이가]?";

const HEAVY = new RegExp(
  [
    `리팩터|리팩토링|아키텍처|재설계|설계`,
    `마이그레이션|전면|일괄`,
    `전체${P}\\s*(수정|점검|감사|검토)`,
    `성능\\s*최적화|보안\\s*(감사|점검|검토)`,
    `디버그|디버깅|원인${P}\\s*(파악|찾|분석)`,
    `왜\\s*안\\s*(되|돼)|안\\s*(되는|돼는)\\s*(이유|원인)`,
    // English
    `refactor|architect|redesign|migrat|debug|root\\s*cause`,
    `optimi[sz]e|security\\s*(audit|review)|investigate|why\\s+(is|does|isn't|doesn't)`
  ].join("|"),
  "i"
);

const BROAD = new RegExp(
  [
    `전부|모두|싹\\s*다|일괄`,
    `여러\\s*(파일|곳|군데)|모든\\s*(파일|페이지|컴포넌트|라우트)`,
    `프로젝트\\s*전체|코드베이스`,
    // English
    `all\\s+(files|pages|components|routes)|across\\s+the\\s+(repo|codebase|project)`,
    `every\\s+(file|page|component)|entire\\s+(repo|codebase|project)|codebase[-\\s]?wide`
  ].join("|"),
  "i"
);

const TRIVIAL = new RegExp(
  [
    `오타|주석`,
    `이름${P}\\s*(변경|바꾸|바꿔|수정)|네이밍`,
    `포맷|들여쓰기|정렬`,
    `한\\s*줄|색(깔|상)?${P}\\s*(변경|바꾸|바꿔|수정)`,
    `텍스트${P}\\s*(변경|바꾸|바꿔|수정)|문구${P}\\s*(변경|수정)`,
    // English
    `typo|rename|renaming|comment|formatting|indent|whitespace`,
    `one[-\\s]?liner|change\\s+(the\\s+)?(text|label|color|colour)`
  ].join("|"),
  "i"
);

const QUESTION = new RegExp(
  [
    `(뭐|무엇|어디|어떻게|왜|언제|얼마)[^\\n]{0,20}[?？]`,
    `알려\\s*(줘|주세요)|설명해|찾아\\s*(줘|주세요)|확인해\\s*(줘|주세요)`,
    `(뭐|무엇)(야|임|인가|예요|에요)|맞(나|냐|아)[?？]?$`,
    // English
    `^(what|where|which|how|why|when|who|is|are|does|do|can)\\b[^\\n]{0,60}[?？]`,
    `explain|tell\\s+me|show\\s+me|find\\s+(out|where)`
  ].join("|"),
  "i"
);

/**
 * 모델·effort 추천.
 * @returns {{model:string, effort:string, reason:string}}
 */
export function recommend(prompt) {
  const len = prompt.length;

  if (TRIVIAL.test(prompt) && len < 120) {
    return { model: "Sonnet 5", effort: "low", reason: "단일 파일 · 기계적 변경" };
  }
  if (QUESTION.test(prompt) && !HEAVY.test(prompt) && len < 200) {
    return { model: "Sonnet 5", effort: "low", reason: "조회·설명 요청" };
  }
  if (HEAVY.test(prompt) && BROAD.test(prompt)) {
    return { model: "Opus 5", effort: "xhigh", reason: "다중 파일 · 추론 깊이 필요" };
  }
  if (HEAVY.test(prompt)) {
    return { model: "Opus 5", effort: "high", reason: "추론·탐색 필요" };
  }
  if (BROAD.test(prompt) || len > 400) {
    return { model: "Opus 5", effort: "high", reason: "범위 넓음" };
  }
  return { model: "Sonnet 5", effort: "medium", reason: "범위 제한적" };
}

/**
 * 최종 판정. 범위 밖이 섞이면 추천을 접는다(부분적으로만 걸리면 추천은 살린다).
 * @returns {{blocked:object[], rec:object|null, partial:boolean}}
 */
export function analyze(prompt) {
  const blocked = detectOutOfScope(prompt);
  if (blocked.length === 0) return { blocked, rec: recommend(prompt), partial: false };
  // 코드 작업을 함께 지시했으면 그 부분의 추천은 여전히 쓸모가 있다.
  const hasCodeWork =
    /(코드|파일|컴포넌트|함수|구현|수정|추가|리팩터|버그|테스트)/i.test(prompt) ||
    HEAVY.test(prompt);
  return { blocked, rec: hasCodeWork ? recommend(prompt) : null, partial: hasCodeWork };
}

/** 사용자에게 보여줄 한 줄(또는 여러 줄). */
export function formatForUser({ blocked, rec, partial }) {
  if (blocked.length === 0) {
    return `권장: ${rec.model} / ${rec.effort}   ${rec.reason}`;
  }
  const lines = [
    partial
      ? `⚠ 이 작업엔 에이전트 범위 밖 단계가 섞여 있습니다.`
      : `⚠ 이 작업엔 에이전트 범위 밖 단계가 있습니다. 모델 추천은 생략합니다.`
  ];
  for (const b of blocked) lines.push(`  [사람] ${b.label} — ${b.hint}`);
  if (partial && rec) lines.push(`  [AI]   나머지 코드 작업 → ${rec.model} / ${rec.effort}`);
  lines.push(`  → 위 항목을 먼저 처리하면 중간에 안 막힙니다.`);
  return lines.join("\n");
}

/** Claude 에게 주입할 지시 — 사람 몫을 먼저 고지하게 만든다. */
export function formatForAgent({ blocked }) {
  if (blocked.length === 0) return null;
  const items = blocked.map((b) => `- ${b.label}: ${b.hint}`).join("\n");
  return [
    "이 요청에는 에이전트가 직접 끝낼 수 없는 단계가 포함돼 있습니다:",
    items,
    "",
    "작업을 시작하기 전에, 사용자가 직접 해야 하는 위 항목을 먼저 명확히 알리세요.",
    "그 단계를 대신 했다고 말하거나, 완료된 것처럼 진행하지 마세요."
  ].join("\n");
}
