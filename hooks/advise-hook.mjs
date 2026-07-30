#!/usr/bin/env node
// Claude Code `UserPromptSubmit` 훅 어댑터.
//   stdin 으로 {prompt, session_id, transcript_path, cwd, ...} 를 받아,
//   판정 결과를 두 채널로 나눠 내보낸다.
//
//   systemMessage      → 사용자에게 보이는 한 줄 (주 채널)
//   additionalContext  → Claude 에게 주입 (사람 몫을 먼저 고지하게 만듦)
//
//   ※ VSCode 확장에서 additionalContext 가 주입되지 않는 이슈가 보고돼 있어
//     (anthropics/claude-code#49063) systemMessage 를 주 채널로 둔다.
//   ※ 절대 exit 2 를 쓰지 않는다 — 그건 프롬프트를 차단하고 「지워버린다」.
//     사용자가 친 글이 날아가는 건 도구가 할 짓이 아니다.

import { analyze, formatForUser, formatForAgent } from "../src/advise.mjs";

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let payload = {};
try {
  payload = JSON.parse(raw || "{}");
} catch {
  // 입력이 깨져도 프롬프트 처리를 방해하지 않는다.
  process.exit(0);
}

const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
if (!prompt.trim()) process.exit(0);

const result = analyze(prompt);
const out = { suppressOutput: true };

const userLine = formatForUser(result);
if (userLine) out.systemMessage = userLine;

const agentNote = formatForAgent(result);
if (agentNote) {
  out.hookSpecificOutput = {
    hookEventName: "UserPromptSubmit",
    // 사양상 상한 10,000자.
    additionalContext: agentNote.slice(0, 9_500)
  };
}

process.stdout.write(JSON.stringify(out));
process.exit(0);
