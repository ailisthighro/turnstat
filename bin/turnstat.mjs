#!/usr/bin/env node
import { listSessions, parseSession, withCost, totals, slugForCwd } from "../src/stat.mjs";
import { analyze, formatForUser } from "../src/advise.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const n = (x) => x.toLocaleString("en-US");
const usd = (c) => (c === null ? "—" : `$${c < 0.01 ? c.toFixed(4) : c.toFixed(2)}`);

// 한글·CJK 는 터미널에서 2칸을 차지한다. String.padEnd 는 1칸으로 세므로
// 그대로 쓰면 프롬프트에 한글이 섞인 행마다 열이 밀린다. 표시 폭 기준으로 맞춘다.
const dw = (s) => [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
const padR = (s, w) => s + " ".repeat(Math.max(0, w - dw(s)));
const padL = (s, w) => " ".repeat(Math.max(0, w - dw(s))) + s;
/** 표시 폭 기준으로 자른다(말줄임 포함). */
const clip = (s, w) => {
  if (dw(s) <= w) return s;
  let out = "";
  for (const ch of s) {
    if (dw(out) + dw(ch) > w - 1) break;
    out += ch;
  }
  return out + "…";
};

function cmdStat() {
  const ttl = flag("ttl", "5m");
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.error(`세션 로그를 찾지 못했습니다 (프로젝트: ${slugForCwd()})`);
    process.exit(1);
  }
  const wanted = flag("session");
  const target =
    typeof wanted === "string" ? sessions.find((s) => s.id.startsWith(wanted)) : sessions[0];
  if (!target) {
    console.error(`세션을 찾지 못했습니다: ${wanted}`);
    process.exit(1);
  }

  const limit = Number(flag("last", 10)) || 10;
  const rows = parseSession(target.file)
    .map((t) => withCost(t, ttl))
    .slice(-limit);

  if (flag("json")) {
    console.log(
      JSON.stringify(
        { session: target.id, ttl, turns: rows.map((r) => ({ ...r, models: [...r.models] })) },
        null,
        2
      )
    );
    return;
  }
  if (flag("csv")) {
    console.log("prompt,model,calls,input,output,cache_read,cache_write,cost_usd");
    for (const r of rows) {
      const p = `"${r.prompt.slice(0, 60).replace(/"/g, '""')}"`;
      console.log(
        [p, r.model ?? "", r.calls, r.usage.input, r.usage.output, r.usage.cacheRead, r.usage.cacheWrite, r.cost ?? ""].join(",")
      );
    }
    return;
  }

  console.log(`\n세션 ${target.id.slice(0, 8)} · 최근 ${rows.length}개 명령 (캐시 TTL ${ttl})\n`);
  console.log(
    [padR("명령", 34), padL("호출", 5), padL("출력", 9), padL("캐시읽기", 12), padL("비용", 9)].join(" ")
  );
  console.log("-".repeat(73));
  for (const r of rows) {
    console.log(
      [padR(clip(r.prompt, 34), 34), padL(String(r.calls), 5), padL(n(r.usage.output), 9), padL(n(r.usage.cacheRead), 12), padL(usd(r.cost), 9)].join(" ")
    );
  }
  const t = totals(rows);
  console.log("-".repeat(73));
  console.log(
    [padR("합계", 34), padL(String(t.calls), 5), padL(n(t.output), 9), padL(n(t.cacheRead), 12), padL(usd(t.cost), 9)].join(" ")
  );
  console.log(`\n※ 구독제라면 실청구액이 아니라 「정가 환산치」입니다.\n`);
}

function cmdAdvise() {
  const prompt = argv.slice(1).filter((a) => !a.startsWith("--")).join(" ");
  if (!prompt) {
    console.error('사용법: turnstat advise "작업 설명"');
    process.exit(1);
  }
  console.log(formatForUser(analyze(prompt)));
}

switch (cmd) {
  case "stat":
    cmdStat();
    break;
  case "advise":
    cmdAdvise();
    break;
  default:
    console.log(`turnstat — 코딩 에이전트 명령 단위 사용량·사전 판정

  turnstat stat [--last N] [--session ID] [--ttl 5m|1h] [--json] [--csv]
  turnstat advise "작업 설명"
`);
}
