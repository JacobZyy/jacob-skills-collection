#!/usr/bin/env python3
"""检测本地可用的 Whistle 实例，返回 JSON。"""
import json
import sys
from pathlib import Path

WHISTLE_BASE = Path.home() / '.WhistleAppData'
INSTANCES = {
    'whistle-node': WHISTLE_BASE / '.whistle_client' / '.whistle',
    'whistle-client': WHISTLE_BASE / '.whistle',
}


def check_instance(name: str, path: Path) -> dict | None:
    props = path / 'rules' / 'properties'
    if not props.exists():
        return None
    try:
        data = json.loads(props.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    return {
        'name': name,
        'home': str(path),
        'properties_path': str(props),
        'rules_count': len(data.get('filesOrder', [])),
        'selected_list': data.get('selectedList', []),
        'has_default_rules': bool(data.get('defalutRules', '')),
        'default_rules_length': len(data.get('defalutRules', '')),
    }


def main() -> None:
    instances = []
    for name, path in INSTANCES.items():
        info = check_instance(name, path)
        if info:
            instances.append(info)

    result = {
        'count': len(instances),
        'instances': instances,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if len(instances) == 0:
        print('\n⚠️  未检测到任何 Whistle 实例', file=sys.stderr)
        sys.exit(1)
    elif len(instances) == 1:
        print(f'\n✅ 检测到 1 个实例: {instances[0]["name"]}', file=sys.stderr)
    else:
        print(f'\n⚠️  检测到 {len(instances)} 个实例，需要用户选择', file=sys.stderr)


if __name__ == '__main__':
    main()
