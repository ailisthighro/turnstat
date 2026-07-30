import fs from "node:fs";
import { listSessions, parseSession, withCost, slugForCwd } from "./stat.mjs";

// Claude Code `Stop` 훅 본체.
//   응답이 끝날 때마다 「직전 한 턴」의 사용량을 한 줄로 돌려준다.
//
//   ※ UserPromptSubmit 훅과 같은 원칙을 따른다 —
//     exit 2 를 쓰지 않고(그건 응답 종료를 막는다), 어떤 실패에서도 exit 0 으로 빠진다.
//     사용량 표시가 대화를 망가뜨리는 건 도구가 할 짓이 아니다.
//
//   ※ 트랜스크립트는 이 훅이 도는 시점에도 아직 쓰이는 중일 수 있다.
//     마지막 어시스턴트 메시지 1건이 누락될 수 있으므로 이 숫자는 「거의 정확」이지
//     정산치가 아니다. 합계가 필요하면 `turnstat stat` 을 쓴다.

/** 토큰 수를 짧게. 12345 → 12.3k */
export function compact(x) {
  if (x < 1_000) return String(x);
  if (x < 1_000_000) return `${(x / 1_000).toFixed(1)}k`;
  return `${(x / 1_000_000).toFixed(2)}M`;
}

/** 모델 키 → 사람이 읽는 이름. claude-opus-5 → Opus 5 */
export function modelLabel(id) {
  if (!id) return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (!m) return id;
  const [, family, major, minor] = m;
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  return minor ? `${name} ${major}.${minor}` : `${name} ${major}`;
}

/** 비용 표기 — 센트 미만은 자릿수를 늘려야 0.00 으로 뭉개지지 않는다. */
export function usd(c) {
  if (c === null || c === undefined) return null;
  return `$${c < 0.01 ? c.toFixed(4) : c.toFixed(2)}`;
}

/** 턴 하나 → 한 줄. 비용을 모르는 모델이면 그 칸만 뺀다. */
export function formatTurn(turn) {
  const parts = [];
  const label = modelLabel(turn.model);
  if (label) parts.push(label);
  parts.push(`호출 ${turn.calls}`);
  parts.push(`출력 ${compact(turn.usage.output)}`);
  if (turn.usage.cacheRead > 0) parts.push(`캐시읽기 ${compact(turn.usage.cacheRead)}`);
  const cost = usd(turn.cost);
  if (cost) parts.push(cost);
  return `이번 턴: ${parts.join(" · ")}`;
}

/**
 * 읽을 트랜스크립트를 고른다.
 * `transcript_path` 가 오면 그걸 쓰고, 없거나 사라졌으면 cwd 기준 최신 세션으로 되돌아간다.
 */
export function resolveTranscript(payload) {
  const given = payload?.transcript_path;
  if (typeof given === "string" && given && fs.existsSync(given)) return given;
  const cwd = typeof payload?.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
  return listSessions(slugForCwd(cwd))[0]?.file ?? null;
}

export async function runStopHook(stdin = process.stdin, stdout = process.stdout) {
  let raw = "";
  try {
    stdin.setEncoding("utf8");
    for await (const chunk of stdin) raw += chunk;
  } catch {
    return 0;
  }

  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return 0;
  }

  // 이미 Stop 훅으로 이어진 실행이면 다시 찍지 않는다(중복 출력 방지).
  if (payload?.stop_hook_active) return 0;

  try {
    const file = resolveTranscript(payload);
    if (!file) return 0;

    const turns = parseSession(file);
    // 마지막 턴은 아직 usage 가 한 건도 안 붙었을 수 있다. 그 경우 직전 턴이 실제 「방금」이다.
    const turn = [...turns].reverse().find((t) => t.calls > 0);
    if (!turn) return 0;

    const ttl = process.env.TURNSTAT_TTL === "1h" ? "1h" : "5m";
    stdout.write(JSON.stringify({ systemMessage: formatTurn(withCost(turn, ttl)) }));
  } catch {
    return 0; // 트랜스크립트가 깨져도 응답 종료를 방해하지 않는다
  }
  return 0;
}
