"""Load the seventeen reviewed packages into an existing local SQLite database."""

import argparse
import json
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True, help="Existing project SQLite file")
    args = parser.parse_args()
    db = args.db.expanduser().resolve(strict=True)
    if not db.is_file():
        parser.error("数据库路径必须指向现有文件")
    os.environ["EVIDENCE_DB"] = str(db)
    from app import Course, import_course

    root = Path(__file__).resolve().parent / "course-packages"
    packages = [Course.model_validate_json(path.read_text(encoding="utf-8"))
                for path in sorted(root.glob("*.json"))]
    if len(packages) != 17 or any(item.chronic is None for item in packages):
        raise SystemExit("预期十七个专题工作包，请核对解压目录。")
    for item in packages:
        result = import_course(item)
        print(f"{item.chronic.sort_order}. {item.chronic.name} "
              f"{'已存在' if result['duplicate'] else '已导入'} "
              f"[课程 {result['id']}]")
    print(json.dumps({"processed": len(packages)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
