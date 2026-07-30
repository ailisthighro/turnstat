import fs from "node:fs";
import path from "node:path";
import { analyze, formatForUser, formatForAgent } from "./advise.mjs";

// 진단용 흔적. 훅은 실패해도 조용해서 「돌았는지조차」 알 수 없다.
//   TURNSTAT_TRACE 에 파일 경로가 있거나 프로젝트에 .turnstat-trace 파일이 있으면 한 줄씩 남긴다.
//   추적 자체가 훅을 죽이면 안 되므로 모든 실패를 삼킨다.
function trace(line) {
  try {
    const explicit = process.env.TURNSTAT_TRACE;
    const marker = path.join(process.cwd(), ".turnstat-trace");
    const target = explicit || (fs.existsSync(marker) ? marker : null);
    if (!target) return;
    fs.appendFileSync(target, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    /* 무시 */
  }
}

// Claude Code `UserPromptSubmit` 훅 본체.
//   stdin 으로 {prompt, session_id, transcript_path, cwd, ...} 를 받아 두 채널로 나눠 내보낸다.
//
//   systemMessage      → 사용자에게 보이는 한 줄 (주 채널)
//   additionalContext  → Claude 에게 주입 (사람 몫을 먼저 고지하게 만듦)
//
//   ※ VSCode 확장에서 additionalContext 가 주입되지 않는 이슈가 보고돼 있어
//     (anthropics/claude-code#49063) systemMessage 를 주 채널로 둔다.
//   ※ 절대 exit 2 를 쓰지 않는다 — 그건 프롬프트를 차단하고 「지워버린다」.
//     사용자가 친 글이 날아가는 건 도구가 할 짓이 아니다.
//   ※ 어떤 실패에서도 exit 0 으로 빠진다. 훅이 프롬프트를 막으면 안 된다.

const MAX_CONTEXT = 9_500; // 사양상 additionalContext 상한 10,000자

export async function runHook(stdin = process.stdin, stdout = process.stdout) {
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
    return 0; // 입력이 깨져도 프롬프트 처리를 방해하지 않는다
  }

  const prompt = typeof payload?.prompt === "string" ? payload.prompt : "";
  trace(`fired cwd=${payload?.cwd ?? "?"} prompt=${JSON.stringify(prompt.slice(0, 60))}`);
  if (!prompt.trim()) return 0;

  let result;
  try {
    result = analyze(prompt);
  } catch {
    return 0; // 분류가 터져도 마찬가지
  }

  // suppressOutput 은 쓰지 않는다.
  //   「stdout 을 transcript 에서 숨긴다」는 옵션인데, 이걸 켜면 systemMessage 까지 함께
  //   묻힐 수 있다. 우리는 raw text 가 아니라 JSON 만 내보내므로 숨길 stdout 자체가 없다.
  const out = {};

  const userLine = formatForUser(result);
  if (userLine) out.systemMessage = userLine;

  const agentNote = formatForAgent(result);
  if (agentNote) {
    out.hookSpecificOutput = {
      hookEventName: "UserPromptSubmit",
      additionalContext: agentNote.slice(0, MAX_CONTEXT)
    };
  }

  const json = JSON.stringify(out);
  trace(`out ${json.slice(0, 200)}`);
  stdout.write(json);
  return 0;
}
