#!/usr/bin/env node
// 직접 경로로 걸고 싶은 사람을 위한 shim. 본체는 src/hook.mjs 하나뿐이다(중복 구현 금지).
//
// 권장 등록 방식은 이쪽이 아니라 서브커맨드다:
//   "command": "npx -y turnstat hook"
// 경로·셸 변수를 안 써서 Windows(cmd.exe)에서도 동일하게 돈다.
// 이 파일을 경로로 걸 땐 절대 경로를 쓸 것 — $CLAUDE_PROJECT_DIR 은 cmd.exe 에서 확장되지 않는다.

import { runHook } from "../src/hook.mjs";

process.exit(await runHook());
