// 규칙 기반 분류기는 패턴을 하나 고치면 다른 케이스가 조용히 깨진다.
// 의존성 없이 `node test/advise.test.mjs` 로 돌린다.

import { analyze, recommend, detectOutOfScope } from "../src/advise.mjs";

let pass = 0;
const fails = [];

/** 범위 밖 감지 — 걸려야 하는 것 */
function blocks(prompt, id) {
  const hit = detectOutOfScope(prompt).some((b) => b.id === id);
  if (hit) pass++;
  else fails.push(`범위밖[${id}] 미감지: "${prompt}"`);
}

/** 범위 밖 감지 — 걸리면 안 되는 것 (오탐 방지) */
function clean(prompt) {
  const hit = detectOutOfScope(prompt);
  if (hit.length === 0) pass++;
  else fails.push(`오탐(${hit.map((h) => h.id)}): "${prompt}"`);
}

/** 추천 결과 */
function rec(prompt, model, effort) {
  const r = recommend(prompt);
  if (r.model === model && r.effort === effort) pass++;
  else fails.push(`추천 불일치: "${prompt}" → ${r.model}/${r.effort} (기대 ${model}/${effort})`);
}

// ── 범위 밖 감지 ──────────────────────────────────────────────
blocks("supabase anon 키를 vercel 대시보드 환경 변수에 등록해줘", "dashboard");
blocks("환경 변수 등록하고 배포해줘", "dashboard");
blocks("add the env var in the vercel dashboard", "dashboard");
blocks("openai api 키 발급받아서 넣어줘", "credentials");
blocks("create an api key for this", "credentials");
blocks("마이그레이션 SQL 실행해줘", "migration");
blocks("run the migration", "migration");
blocks("앱스토어에 제출해줘", "store");
blocks("submit to app store for review", "store");
blocks("도메인 DNS 설정 변경해줘", "dns");
blocks("CNAME 레코드 추가해줘", "dns");
blocks("실기기에서 테스트 확인해줘", "physical");
blocks("유료 플랜으로 전환해줘", "approval");

// ── 오탐 방지 (에이전트가 실제로 할 수 있는 일) ──────────────
clean("이 컴포넌트에 props 하나 추가해줘");
clean("타입 에러 고쳐줘");
clean("마이그레이션 파일 작성해줘"); // 「작성」은 가능, 「실행」이 불가
clean("환경 변수를 코드에서 참조하도록 수정해줘"); // 참조 코드는 가능
clean("api 키를 하드코딩하지 말고 env 로 빼줘");
clean("테스트 코드 추가해줘");

// ── 추천 ──────────────────────────────────────────────────────
rec("이 함수 이름만 바꿔줘", "Sonnet 5", "low");
rec("오타 하나 고쳐줘", "Sonnet 5", "low");
rec("rename this variable", "Sonnet 5", "low");
rec("이 파일 뭐하는 파일이야?", "Sonnet 5", "low");
rec("결제 흐름 전체를 싹 다 훑어서 리팩터해줘", "Opus 5", "xhigh");
rec("이거 왜 안 되는지 원인 파악해줘", "Opus 5", "high");
rec("debug why the build fails", "Opus 5", "high");
rec("모든 컴포넌트에 로딩 상태 추가해줘", "Opus 5", "high");

// ── 통합: 부분 분리 ───────────────────────────────────────────
{
  const r = analyze("마이그레이션 SQL 실행하고 관련 컴포넌트도 수정해줘");
  if (r.blocked.length > 0 && r.partial && r.rec) pass++;
  else fails.push("부분 분리 실패: 범위밖+코드작업 혼합인데 rec 이 없음");
}
{
  const r = analyze("vercel 대시보드에서 환경 변수만 등록해줘");
  if (r.blocked.length > 0 && !r.partial) pass++;
  else fails.push("순수 범위밖인데 추천을 냈음");
}

// ── 결과 ──────────────────────────────────────────────────────
console.log(`\n통과 ${pass} / 실패 ${fails.length}`);
if (fails.length) {
  console.log("");
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("전부 통과\n");
