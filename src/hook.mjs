import { analyze, formatForUser, formatForAgent } from "./advise.mjs";

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
  if (!prompt.trim()) return 0;

  let result;
  try {
    result = analyze(prompt);
  } catch {
    return 0; // 분류가 터져도 마찬가지
  }

  const out = { suppressOutput: true };

  const userLine = formatForUser(result);
  if (userLine) out.systemMessage = userLine;

  const agentNote = formatForAgent(result);
  if (agentNote) {
    out.hookSpecificOutput = {
      hookEventName: "UserPromptSubmit",
      additionalContext: agentNote.slice(0, MAX_CONTEXT)
    };
  }

  stdout.write(JSON.stringify(out));
  return 0;
}
