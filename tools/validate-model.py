#!/usr/bin/env python3
"""Validate a drop-in Live2D model for the AMA·DEUS pet.

Checks that a model directory under models/<name>/ is complete and
compatible with the Cubism 5 runtime (moc3) and reports readiness.

Usage:
    python3 tools/validate-model.py <name>            # report only
    python3 tools/validate-model.py <name> --apply    # also patch src/main.js
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / 'models'
MAIN_JS = ROOT / 'src' / 'main.js'

ok = []
warn = []
bad = []


def check(cond, msg, severity='ok'):
    (ok if severity == 'ok' else warn if severity == 'warn' else bad).append(msg)


def main():
    if len(sys.argv) < 2:
        print('usage: python3 tools/validate-model.py <name> [--apply]')
        return 1
    name = sys.argv[1]
    d = MODELS / name
    if not d.is_dir():
        print(f'错误：models/{name}/ 不存在')
        return 1

    # 1. model3.json (Cubism 4/5) or model.json (Cubism 2)
    mj = d / f'{name}.model3.json'
    legacy = d / f'{name}.model.json'
    if mj.exists():
        check(True, f'{name}.model3.json 存在（Cubism 4/5 格式）')
        data = json.loads(mj.read_text(encoding='utf-8'))
        return validate_cubism5(name, d, data)
    if legacy.exists():
        check(True, f'{name}.model.json 存在（Cubism 2 格式）')
        data = json.loads(legacy.read_text(encoding='utf-8'))
        return validate_cubism2(name, d, data)
    check(False, f'缺少 {name}.model3.json 或 {name}.model.json', 'bad')
    print_report(name)
    return 1


def validate_cubism2(name, d, data):
    def have(rel, label):
        p = d / rel
        if p.exists():
            check(True, f'{label}: {rel}')
        else:
            check(False, f'{label} 缺失: {rel}', 'bad')

    moc = data.get('model')
    if moc:
        have(moc, '模型体 moc')
        if not moc.endswith('.moc'):
            check(False, '模型体不是 .moc（Cubism 2）格式', 'bad')
    else:
        check(False, 'model.json 缺少 model 字段', 'bad')

    for i, t in enumerate(data.get('textures', [])):
        have(t, f'贴图[{i}]')

    motions = data.get('motions', {})
    for g, ms in motions.items():
        for m in ms:
            have(m.get('file', ''), f'动作 {g}')
    if not motions:
        check(False, '未定义动作组（角色将是静态的）', 'warn')
    for want in ('idle', 'tap_body'):
        if want not in motions:
            check(False, f'缺少动作组 "{want}"（待机/点击反应不可用）', 'warn')

    for e in data.get('expressions', []):
        have(e.get('file', ''), f'表情 {e.get("name")}')
    if data.get('physics'):
        have(data['physics'], '物理')
    if data.get('pose'):
        have(data['pose'], '姿态')

    areas = data.get('hit_areas', [])
    if areas:
        check(True, f'命中区域: {", ".join(a.get("name", "?") for a in areas)}')
    else:
        check(False, '未定义 hit_areas（点击交互不可用）', 'warn')

    print_report(name)
    return 0 if not bad else 2


def validate_cubism5(name, d, data):
    refs = data.get('FileReferences', {})

    def have(rel, label):
        p = d / rel
        if p.exists():
            check(True, f'{label}: {rel}')
            return True
        check(False, f'{label} 缺失: {rel}', 'bad')
        return False

    # 2. moc (must be moc3 for Cubism 5 runtime)
    moc = refs.get('Moc')
    if moc:
        have(moc, '模型体 Moc')
        if not moc.endswith('.moc3'):
            check(False, 'Moc 不是 .moc3（Cubism 4/5）格式，当前运行时无法加载旧版 .moc', 'warn')
    else:
        check(False, 'FileReferences.Moc 未定义', 'bad')

    # 3. textures
    for i, t in enumerate(refs.get('Textures', [])):
        have(t, f'贴图[{i}]')

    # 4. motions / expressions / physics / pose
    motion_files = set()
    motion_groups = refs.get('Motions', {})
    if isinstance(motion_groups, dict):
        for gname, motions in motion_groups.items():
            for m in motions:
                motion_files.add(m.get('File'))
        missing = [m for m in sorted(motion_files) if not (d / m).exists()]
        if missing:
            for m in missing:
                check(False, f'动作缺失: {m}', 'bad')
        else:
            check(True, f'动作文件 {len(motion_files)} 个齐全（{len(motion_groups)} 组）')
        for want in ('Idle', 'TapBody'):
            if want not in motion_groups:
                check(False, f'缺少动作组 "{want}"（待机/点击反应将不可用）', 'warn')
    else:
        check(False, '未定义任何动作组（角色将是静态的）', 'warn')

    for key, label in (('Expressions', '表情'), ('Physics', '物理'), ('Pose', '姿态'), ('UserData', '用户数据')):
        v = refs.get(key)
        if isinstance(v, str):
            have(v, label)
        elif isinstance(v, list):
            for e in v:
                f = e.get('File') if isinstance(e, dict) else e
                if f:
                    have(f, label)

    # 5. hit areas
    areas = data.get('HitAreas', [])
    if areas:
        names = {a.get('Name') for a in areas}
        check(True, f'命中区域: {", ".join(sorted(names))}')
        if 'Head' not in names and 'Body' not in names:
            check(False, '命中区域未命名 Head/Body，点击反应映射需在 src/main.js 调整', 'warn')
    else:
        check(False, '未定义 HitAreas（点击交互不可用）', 'warn')

    # 6. layout sanity
    lay = data.get('Layout', {})
    check(True, f'Layout: {lay or "（默认）"}')

    print_report(name)

    if '--apply' in sys.argv and not bad:
        content = MAIN_JS.read_text(encoding='utf-8')
        import re
        content = re.sub(
            r"const ModelDir = '\./models/[^']*/'",
            f"const ModelDir = './models/{name}/'",
            content,
        )
        content = re.sub(
            r"const ModelJson = '[^']*'",
            f"const ModelJson = '{name}.model3.json'",
            content,
        )
        MAIN_JS.write_text(content, encoding='utf-8')
        print(f'已写入 src/main.js: ModelDir=./models/{name}/ ModelJson={name}.model3.json')
        print('下一步: npm run build:render && ./run.sh')

    return 0 if not bad else 2


def print_report(name):
    print(f'=== 模型校验: {name} ===')
    for m in ok:
        print(f'  [OK]   {m}')
    for m in warn:
        print(f'  [WARN] {m}')
    for m in bad:
        print(f'  [BAD]  {m}')
    if bad:
        print('结论: 不完整/不兼容，无法上线')
    elif warn:
        print('结论: 可上线，但上述 WARN 功能会缺失')
    else:
        print('结论: READY — 可以上线')


if __name__ == '__main__':
    sys.exit(main())
