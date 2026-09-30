# Created: 2026-09-29 18:58
"""`.env`의 OPENROUTER_API_KEY를 읽어 config.js를 생성한다.

사용법:  py build_config.py
결과:    config.js  ->  window.DIARY_CONFIG = { apiKey: "..." };
키 값은 화면에 출력하지 않는다. config.js는 키를 담고 있으니 공유/커밋하지 말 것.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_PATH = HERE / ".env"
OUT_PATH = HERE / "config.js"
KEY_NAME = "OPENROUTER_API_KEY"


def read_env(path):
    values = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name.startswith("export "):
            name = name[len("export "):].strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[name] = value
    return values


def main():
    if not ENV_PATH.exists():
        print(f"[오류] {ENV_PATH.name} 파일이 없습니다.", file=sys.stderr)
        return 1
    key = read_env(ENV_PATH).get(KEY_NAME, "").strip()
    if not key:
        print(f"[오류] .env에 {KEY_NAME} 값이 비어 있습니다.", file=sys.stderr)
        return 1
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    content = (
        f"/* Created: {stamp} — build_config.py가 자동 생성. 직접 수정하지 말고 공유/커밋하지 마세요. */\n"
        f"window.DIARY_CONFIG = {{ apiKey: {json.dumps(key)} }};\n"
    )
    OUT_PATH.write_text(content, encoding="utf-8")
    print(f"[완료] {OUT_PATH.name} 생성 (키 길이 {len(key)}자, 값은 출력하지 않음)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
