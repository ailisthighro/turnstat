// Stop 훅 한 줄 요약 — 포맷이 조용히 깨지는 걸 막는다.
// 의존성 없이 `node test/stop-hook.test.mjs` 로 돌린다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compact, modelLabel, usd, formatTurn, resolveTranscript, runStopHook } from "../src/stop-hook.mjs";

let pass = 0;
const fails = [];

function eq(actual, expected, label) {
  if (actual === expected) pass++;
  else fails.push(`${label}: ${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`);
}

// ── 토큰 축약 ─────────────────────────────────────────────────
eq(compact(0), "0", "compact 0");
eq(compact(999), "999", "compact 경계 아래");
eq(compact(1_000), "1.0k", "compact k 경계");
eq(compact(14_230), "14.2k", "compact k");
eq(compact(1_530_000), "1.53M", "compact M");

// ── 모델 이름 ─────────────────────────────────────────────────
eq(modelLabel("claude-opus-5"), "Opus 5", "modelLabel 메이저만");
eq(modelLabel("claude-haiku-4-5"), "Haiku 4.5", "modelLabel 마이너 포함");
eq(modelLabel("claude-sonnet-4-6"), "Sonnet 4.6", "modelLabel 마이너 포함2");
eq(modelLabel(null), null, "modelLabel null 통과");
// 단가표에 없는 낯선 ID 는 뭉개지 말고 원문 그대로 — 잘못된 이름을 지어내지 않는다.
eq(modelLabel("gpt-5-turbo"), "gpt-5-turbo", "modelLabel 미지 ID 원문 유지");

// ── 비용 표기 ─────────────────────────────────────────────────
eq(usd(1.2678), "$1.27", "usd 센트 이상");
// 센트 미만을 toFixed(2) 로 찍으면 전부 $0.00 이 되어 정보가 사라진다.
eq(usd(0.0031), "$0.0031", "usd 센트 미만");
eq(usd(null), null, "usd 미지 모델");

// ── 한 줄 포맷 ────────────────────────────────────────────────
const turn = (over = {}) => ({
  prompt: "p",
  calls: 26,
  usage: { input: 0, output: 14_230, cacheRead: 1_530_000, cacheWrite: 0 },
  model: "claude-opus-5",
  cost: 1.2678,
  ...over
});

eq(
  formatTurn(turn()),
  "이번 턴: Opus 5 · 호출 26 · 출력 14.2k · 캐시읽기 1.53M · $1.27",
  "formatTurn 기본"
);
// 캐시가 0 이면 칸을 아예 뺀다 — 「캐시읽기 0」은 읽는 사람에게 잡음이다.
eq(
  formatTurn(turn({ usage: { input: 0, output: 500, cacheRead: 0, cacheWrite: 0 } })),
  "이번 턴: Opus 5 · 호출 26 · 출력 500 · $1.27",
  "formatTurn 캐시 0 은 생략"
);
// 단가를 모르는 모델이라도 토큰 수는 보여줘야 한다.
eq(
  formatTurn(turn({ model: null, cost: null })),
  "이번 턴: 호출 26 · 출력 14.2k · 캐시읽기 1.53M",
  "formatTurn 비용 미상"
);

// ── 트랜스크립트 선택 ─────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "turnstat-"));
const fake = path.join(tmp, "session.jsonl");
fs.writeFileSync(
  fake,
  [
    JSON.stringify({ origin: { kind: "human" }, message: { role: "user", content: "이 함수 고쳐줘" } }),
    JSON.stringify({
      message: {
        role: "assistant",
        model: "claude-opus-5",
        usage: { input_tokens: 10, output_tokens: 2_000, cache_read_input_tokens: 50_000 }
      }
    })
  ].join("\n") + "\n",
  "utf8"
);

eq(resolveTranscript({ transcript_path: fake }), fake, "resolveTranscript 주어진 경로 사용");
// 경로가 사라졌으면 cwd 기준 최신 세션으로 되돌아가야 한다(여기선 없는 프로젝트라 null).
eq(
  resolveTranscript({ transcript_path: path.join(tmp, "gone.jsonl"), cwd: path.join(tmp, "nope") }),
  null,
  "resolveTranscript 없는 경로는 폴백"
);

// ── 훅 전체 흐름 ──────────────────────────────────────────────
/** stdin/stdout 을 흉내 내 runStopHook 을 돌리고 쓰인 문자열을 돌려준다. */
async function run(payload) {
  let written = "";
  const stdin = {
    setEncoding() {},
    async *[Symbol.asyncIterator]() {
      yield typeof payload === "string" ? payload : JSON.stringify(payload);
    }
  };
  const code = await runStopHook(stdin, { write: (s) => (written += s) });
  return { code, written };
}

{
  const { code, written } = await run({ transcript_path: fake });
  const ok = code === 0 && JSON.parse(written).systemMessage.includes("Opus 5");
  ok ? pass++ : fails.push(`훅 정상 경로 실패: code=${code} out=${written}`);
}
{
  // stop_hook_active 는 Stop 훅이 이어붙인 실행이라는 뜻 — 같은 줄을 두 번 찍으면 안 된다.
  const { code, written } = await run({ transcript_path: fake, stop_hook_active: true });
  code === 0 && written === "" ? pass++ : fails.push(`stop_hook_active 인데 출력함: ${written}`);
}
{
  // 입력이 깨져도 응답 종료를 막으면 안 된다. 조용히 exit 0.
  const { code, written } = await run("{ 이건 JSON 이 아님");
  code === 0 && written === "" ? pass++ : fails.push(`깨진 입력 처리 실패: code=${code}`);
}
{
  // 사람 발화만 있고 usage 가 하나도 없는 트랜스크립트 → 찍을 게 없으니 조용히 빠진다.
  const empty = path.join(tmp, "empty.jsonl");
  fs.writeFileSync(
    empty,
    JSON.stringify({ origin: { kind: "human" }, message: { role: "user", content: "안녕" } }) + "\n",
    "utf8"
  );
  const { code, written } = await run({ transcript_path: empty });
  code === 0 && written === "" ? pass++ : fails.push(`usage 없는 세션 처리 실패: ${written}`);
}

fs.rmSync(tmp, { recursive: true, force: true });

// ── 결과 ──────────────────────────────────────────────────────
console.log(`\n통과 ${pass} / 실패 ${fails.length}`);
if (fails.length) {
  console.log("");
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("전부 통과\n");
