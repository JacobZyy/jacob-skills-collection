#!/usr/bin/env python3
"""向 Whistle 实例的 defalutRules 顶部注入规则，自动去重。"""
import argparse
import json
import re
import sys
from pathlib import Path


def load_default_rules(properties_path: Path) -> str:
    """读取 rules/properties 中的 defalutRules 字段。"""
    data = json.loads(properties_path.read_text())
    return data.get('defalutRules', '')


def save_default_rules(properties_path: Path, rules: str) -> None:
    """保存 defalutRules 回 rules/properties，保留其他字段不变。"""
    data = json.loads(properties_path.read_text())
    data['defalutRules'] = rules
    properties_path.write_text(json.dumps(data, ensure_ascii=False, indent=4))


def extract_pattern_and_op(rule_line: str) -> tuple[str, str] | None:
    """从规则行中提取 pattern 和 operation。

    规则格式: pattern operation1 [operation2 ...] [filters...]
    返回 (pattern, operation) 或 None（无法解析时）。
    """
    stripped = rule_line.strip()
    if not stripped or stripped.startswith('#'):
        return None

    # 去掉注释
    if '#' in stripped:
        # 注意 # 可能在 pattern 里（比如 URL fragment），简单处理：找第一个空格前的 #
        # 更安全的做法：找空格后的 #
        parts = stripped.split()
        cleaned_parts = []
        for p in parts:
            if p.startswith('#'):
                break
            cleaned_parts.append(p)
        stripped = ' '.join(cleaned_parts)

    # 分离 pattern 和 operations
    # pattern 是第一部分，后面是 operations 和 filters
    # 复杂情况: pattern 可能包含空格（如 "www.example.com/path operation"）
    # 简化处理：pattern 是第一个空格之前的内容
    # 但如果 pattern 是带空格的（如正则 /pattern with space/），需要用更复杂逻辑

    # 简单策略：取第一个 "://" 之前的内容作为 pattern
    # 但不一定准确。更可靠：split 后 pattern = parts[0], operations = rest
    parts = stripped.split()
    if len(parts) < 2:
        return None

    pattern = parts[0]
    # 找到第一个操作（包含 :// 的部分）
    for i, part in enumerate(parts[1:], start=1):
        if '://' in part:
            return (pattern, part)
        # 无 :// 但有协议形式的可能是简写（如 bare IP）
        # 对于 host 简写形式 "www.example.com 127.0.0.1"，第二个就是 operation
        if i == 1:
            return (pattern, part)

    return None


def build_dedup_key(rule_line: str) -> str | None:
    """构建去重键：pattern + operation protocol。

    相同 pattern 和相同操作协议（如 file://, proxy://, resBody://）
    的规则视为重复，会被替换。
    """
    parsed = extract_pattern_and_op(rule_line)
    if parsed is None:
        return None
    pattern, operation = parsed
    # 提取协议名（: // 之前的部分）
    protocol = operation.split('://')[0] if '://' in operation else 'host'
    return f'{pattern}|{protocol}'


def get_rule_dedup_keys(rules_text: str) -> dict[str, str]:
    """返回 {dedup_key: original_line} 映射，用于检测重复。"""
    keys = {}
    for line in rules_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        key = build_dedup_key(stripped)
        if key:
            keys[key] = stripped
    return keys


def inject_to_top(rules_text: str, new_rule: str) -> str:
    """将新规则注入到 defalutRules 顶部，自动去重。"""
    existing_keys = get_rule_dedup_keys(rules_text)
    new_key = build_dedup_key(new_rule)

    # 分离顶部空白
    leading = ''
    rest = rules_text
    for i, ch in enumerate(rules_text):
        if ch not in (' ', '\t', '\n', '\r'):
            leading = rules_text[:i]
            rest = rules_text[i:]
            break

    lines = rest.splitlines()
    new_lines = []
    removed = False
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            new_lines.append(line)
            continue
        key = build_dedup_key(stripped)
        if new_key and key == new_key:
            removed = True
            continue  # 移除旧规则
        new_lines.append(line)

    # 新规则放到顶部（在原始 leading whitespace 之后）
    result = leading + new_rule + '\n' + '\n'.join(new_lines)
    return result.rstrip('\n') + '\n', removed


def main() -> None:
    parser = argparse.ArgumentParser(
        description='向 Whistle defalutRules 顶部注入一条规则，自动去重。'
    )
    parser.add_argument(
        '--whistle-home',
        required=True,
        help='Whistle 实例的 .whistle 目录路径',
    )
    parser.add_argument(
        '--rule',
        required=True,
        help='要注入的完整规则行，例如: www.example.com/api file://({"status":"ok"})',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='仅预览，不实际写入',
    )
    parser.add_argument(
        '--json',
        action='store_true',
        help='以 JSON 格式输出结果',
    )
    args = parser.parse_args()

    whistle_home = Path(args.whistle_home).expanduser()
    properties_path = whistle_home / 'rules' / 'properties'

    if not properties_path.exists():
        print(f'错误: 找不到 {properties_path}', file=sys.stderr)
        sys.exit(1)

    new_rule = args.rule.strip()
    if not new_rule:
        print('错误: --rule 不能为空', file=sys.stderr)
        sys.exit(1)

    original_rules = load_default_rules(properties_path)
    updated_rules, was_removed = inject_to_top(original_rules, new_rule)

    if updated_rules.strip() == original_rules.strip():
        result = {
            'status': 'unchanged',
            'message': '规则已存在且内容相同，无需更新',
            'rule': new_rule,
            'whistle_home': str(whistle_home),
        }
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print('No change needed - rule already exists')
            print(f'Rule: {new_rule}')
        return

    if args.dry_run:
        result = {
            'status': 'dry_run',
            'message': '预览模式 — 以下是将注入的规则',
            'rule': new_rule,
            'removed_old': was_removed,
            'whistle_home': str(whistle_home),
        }
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print('=== 预览 ===')
            if was_removed:
                print('(将替换已有同 endpoint 规则)')
            print(f'注入规则: {new_rule}')
            print(f'目标实例: {whistle_home}')
        return

    save_default_rules(properties_path, updated_rules)

    result = {
        'status': 'injected',
        'message': '规则已注入到 defalutRules 顶部',
        'rule': new_rule,
        'removed_old': was_removed,
        'whistle_home': str(whistle_home),
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        if was_removed:
            print('(已替换旧规则)')
        print(f'已注入: {new_rule}')
        print(f'目标: {whistle_home}/rules/properties → defalutRules')


if __name__ == '__main__':
    main()
