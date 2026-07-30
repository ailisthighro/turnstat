import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { normalizeModel, priceUsage } from "./pricing.mjs";

// 코딩 에이전트의 세션 로그(JSONL)를 「명령 1건」 단위로 묶어 토큰·비용을 낸다.
//   ccusage 는 세션까지만 쪼갠다. 그런데 로그에는 어시스턴트 메시지마다 usage 가 남으므로,
//   사람 발화를 기준선으로 삼아 그 뒤 메시지들을 묶으면 명령 단위가 나온다.

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

/** cwd → Claude Code 프로젝트 슬러그. 예: `D:\Site` → `d--Site` */
export function slugForCwd(cwd = process.cwd()) {
  return cwd.replace(/:/g, "-").replace(/[\\/]/g, "-");
}

/** 프로젝트 디렉터리의 세션 파일들을 최신순으로 반환. */
export function listSessions(slug = slugForCwd()) {
  const dir = path.join(PROJECTS_DIR, slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const full = path.join(dir, f);
      return { id: f.replace(/\.jsonl$/, ""), file: full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * 세션 JSONL 하나를 명령 단위로 파싱한다.
 * 사람이 친 발화(origin.kind === "human")를 만나면 새 그룹을 열고,
 * 그 뒤의 어시스턴트 메시지 usage 를 그 그룹에 누적한다.
 *
 * @returns {Array<{prompt:string, calls:number, usage:object, models:Set<string>, at:string|null}>}
 */
export function parseSession(file) {
  const turns = [];
  let cur = null;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // 잘린 마지막 줄 등은 조용히 건너뛴다
    }
    const m = o.message;
    if (!m) continue;

    // 사람 발화 = 새 명령의 시작. 도구 결과로 들어오는 user 메시지는 제외해야 하므로
    // origin.kind 로 판별한다(텍스트 유무만으로 보면 tool_result 까지 잡힌다).
    if (m.role === "user" && o.origin?.kind === "human") {
      const text = Array.isArray(m.content)
        ? (m.content.find((p) => p.type === "text")?.text ?? "")
        : typeof m.content === "string"
          ? m.content
          : "";
      if (text) {
        cur = {
          prompt: text.replace(/\s+/g, " ").trim(),
          calls: 0,
          usage: emptyUsage(),
          models: new Set(),
          at: o.timestamp ?? null
        };
        turns.push(cur);
        continue;
      }
    }

    if (m.usage && cur) {
      cur.calls += 1;
      cur.usage.input += m.usage.input_tokens ?? 0;
      cur.usage.output += m.usage.output_tokens ?? 0;
      cur.usage.cacheRead += m.usage.cache_read_input_tokens ?? 0;
      cur.usage.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
      const model = normalizeModel(m.model);
      if (model) cur.models.add(model);
    }
  }
  return turns;
}

/** 명령 하나에 비용을 붙인다. 여러 모델이 섞였으면 가장 비싼 쪽으로 보수적으로 잡는다. */
export function withCost(turn, ttl = "5m") {
  const models = [...turn.models];
  if (models.length === 0) return { ...turn, model: null, cost: null };
  const priced = models
    .map((mo) => ({ mo, c: priceUsage(turn.usage, mo, ttl) }))
    .filter((x) => x.c !== null)
    .sort((a, b) => b.c - a.c);
  if (priced.length === 0) return { ...turn, model: models[0], cost: null };
  return { ...turn, model: priced[0].mo, cost: priced[0].c };
}

/** 총합 — 표 하단 요약용. */
export function totals(rows) {
  return rows.reduce(
    (acc, r) => {
      acc.calls += r.calls;
      acc.input += r.usage.input;
      acc.output += r.usage.output;
      acc.cacheRead += r.usage.cacheRead;
      acc.cacheWrite += r.usage.cacheWrite;
      acc.cost += r.cost ?? 0;
      return acc;
    },
    { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  );
}
