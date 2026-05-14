#!/usr/bin/env python3
"""
从 ZAPI 接口文档获取接口详情，输出 JSON。
用法:
  python3 zapi_fetch.py --token <token> --interface-id <id>[,<id2>,...]
  python3 zapi_fetch.py --token <token> --interface-id <id>
"""

import json
import sys
from typing import Any, Optional
from urllib import error, parse, request

ZAPI_ORIGIN = "https://zapi.zhuanspirit.com"


def http_json(url: str) -> Any:
    req = request.Request(url)
    try:
        with request.urlopen(req, timeout=20) as resp:
            text = resp.read().decode("utf-8")
            return json.loads(text) if text else None
    except error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(text)
        except Exception:
            data = text[:300]
        raise RuntimeError(f"HTTP {exc.code}: {json.dumps(data, ensure_ascii=False)}") from exc


def fetch_interface(interface_id: str, token: str) -> dict:
    url = f"{ZAPI_ORIGIN}/api/interface/get?id={interface_id}&token={token}"
    data = http_json(url)
    if data.get("errcode") != 0:
        raise RuntimeError(f"zapi 返回错误: {json.dumps(data, ensure_ascii=False)}")
    detail = data.get("data", {})
    return {
        "id": detail.get("_id"),
        "title": detail.get("title"),
        "method": detail.get("method"),
        "path": detail.get("path"),
        "status": detail.get("status"),
        "project_id": detail.get("project_id"),
        "catid": detail.get("catid"),
        "desc": detail.get("desc", ""),
        "req_body_type": detail.get("req_body_type"),
        "req_body_other": detail.get("req_body_other", ""),
        "req_params": detail.get("req_params", []),
        "req_query": detail.get("req_query", []),
        "req_headers": detail.get("req_headers", []),
        "res_body": detail.get("res_body", ""),
        "res_body_is_json_schema": detail.get("res_body_is_json_schema", False),
        "zapiUrl": f"{ZAPI_ORIGIN}/project/{detail.get('project_id')}/interface/api/{detail.get('_id')}",
    }


def parse_args(argv: list[str]) -> dict:
    args: dict = {}
    i = 0
    while i < len(argv):
        tok = argv[i]
        if tok.startswith("--"):
            key = tok[2:]
            nxt = argv[i + 1] if i + 1 < len(argv) else None
            if nxt is None or nxt.startswith("--"):
                args[key] = True
                i += 1
            else:
                args[key] = nxt
                i += 2
        else:
            i += 1
    return args


def main() -> None:
    argv = sys.argv[1:]
    args = parse_args(argv)

    token = str(args.get("token", "")).strip()
    if not token:
        print(json.dumps({"error": "缺少 --token 参数"}), file=sys.stderr)
        sys.exit(1)

    interface_ids_raw = str(args.get("interface-id", "")).strip()
    if not interface_ids_raw:
        print(json.dumps({"error": "缺少 --interface-id 参数"}), file=sys.stderr)
        sys.exit(1)

    interface_ids = [i.strip() for i in interface_ids_raw.split(",") if i.strip()]
    results = []
    for iid in interface_ids:
        try:
            results.append(fetch_interface(iid, token))
        except RuntimeError as exc:
            results.append({"id": iid, "error": str(exc)})

    print(json.dumps(results if len(results) > 1 else results[0], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
