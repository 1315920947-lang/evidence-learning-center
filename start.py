"""Run the preloaded site on the local computer."""

import os
import secrets
from pathlib import Path

import uvicorn


def main():
    root = Path(__file__).resolve().parent
    os.chdir(root)
    os.environ.setdefault("EVIDENCE_DB", str(root / "data" / "evidence.sqlite3"))
    if not os.environ.get("EVIDENCE_ADMIN_TOKEN"):
        os.environ["EVIDENCE_ADMIN_TOKEN"] = secrets.token_urlsafe(24)
        print(
            "本次运行的学习中心与导入口令："
            + os.environ["EVIDENCE_ADMIN_TOKEN"],
            flush=True,
        )
    print("本机访问地址：http://127.0.0.1:8000", flush=True)
    uvicorn.run("app:app", host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
