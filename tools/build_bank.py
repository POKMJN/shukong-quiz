# -*- coding: utf-8 -*-
"""数控车工中级考证理论题.doc -> qbank.json

把题库 Word 文档解析成结构化 JSON。

用法：
    python build_bank.py [源文件.docx] [输出.json]
不传参数时，默认读 tools/../source/qbank.docx，写到 data/qbank.json。

前置：.doc 需先另存为 .docx（Word / WPS 均可，或见 README 的转换说明）。

规则：
  * 答案一律照抄原文（题干中的 (X) 括号 或 独立的 答案:X 行），不做任何“纠错”。
  * 只剔除源文件本身残缺、无法作答的条目，并在报告里逐条列出。
"""
import docx, re, json, os, sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'source', 'qbank.docx')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'data', 'qbank.json')

d = docx.Document(SRC)
ps = [p.text.replace('\u00a0', ' ').strip() for p in d.paragraphs]

Q_START   = re.compile(r'^[、,，。;；\s]*题干\s*[:：]')
OPT_SPLIT = re.compile(r'(?=[ABCDabcd]\s*[:：])')
BRACKET   = re.compile(r'[（(][\s_．.]*([A-Da-d])[\s_．.]*[)）]')
ANSWER_L  = re.compile(r'^答案\s*[:：]\s*(.*)$')
OPT_L     = re.compile(r'^[ABCDabcd]\s*[:：]')
TF = {'正确': 0, '错误': 1, '对': 0, '错': 1, '是': 0, '否': 1}


def split_options(line):
    """一行里塞了 A:.. B:.. C:.. D:.. 的情况"""
    out = []
    for part in OPT_SPLIT.split(line):
        part = part.strip().lstrip('\t')
        if not part:
            continue
        m = re.match(r'^([ABCDabcd])\s*[:：]\s*(.*)$', part)
        if m:
            out.append([m.group(1).upper(), m.group(2).strip()])
        elif out:
            out[-1][1] = (out[-1][1] + ' ' + part).strip()
    return out


# ---------- 切块：每个“题干:”开头到下一个“题干:”之前 ----------
blocks, cur = [], None
for t in ps:
    if Q_START.match(t):
        if cur:
            blocks.append(cur)
        cur = [t]
    elif cur is not None:
        cur.append(t)
if cur:
    blocks.append(cur)


def parse(lines):
    stem = Q_START.sub('', lines[0]).strip()
    tf, opts, ans_marks = None, [], []

    m = re.search(r'答案\s*[:：]\s*(\S+)\s*$', stem)
    if m:
        stem = stem[:m.start()].strip()
        v = m.group(1).strip('。.')
        if v in TF:
            tf = TF[v]

    for ln in lines[1:]:
        am = ANSWER_L.match(ln)
        if am:
            v = am.group(1).strip().strip('。.')
            if v in TF:
                tf = TF[v]
            elif re.fullmatch(r'[A-Da-d]', v):
                ans_marks.append(v.upper())
            continue
        if OPT_L.match(ln):
            opts.extend(split_options(ln))
            continue
        if ln.strip():
            if opts:
                opts[-1][1] = (opts[-1][1] + ' ' + ln.strip()).strip()
            else:
                stem += ln.strip()

    # 答案字母：先看括号，再看 答案:X 行，最后看句尾粘着的裸字母
    bracketed = [m.group(1).upper() for m in BRACKET.finditer(stem)]
    stem = BRACKET.sub('', stem).strip()
    if not bracketed and not ans_marks and not tf:
        g = re.search(r'[\u4e00-\u9fff。，、；：？！)）:?!"”]\s*([A-D])\s*[。.．]?\s*$', stem)
        if g:
            bracketed.append(g.group(1))
            stem = stem[:g.start(1)].strip()
    if not bracketed and not ans_marks and not tf:
        g = re.search(r'[（(]\s*([A-Da-d])\s*[)）]?\s*[。.．]?\s*$', stem)
        if g:
            bracketed.append(g.group(1).upper())
            stem = stem[:g.start()].strip()

    letter = ans_marks[-1] if ans_marks else (bracketed[-1] if bracketed else None)
    return stem, opts, tf, letter


# ---------- 归类规则（按优先级，先命中先归类）----------
RULES = OrderedDict([
    ('职业道德与素养', '道德 敬业 诚信 荣辱 职业 劳动法 劳动合同 加班 团队 服务群众 奉献 廉洁 公道 素质 遵纪 人生价值 责任 权利人'),
    ('安全文明生产',   '安全 操作规程 文明生产 环境保护 消防 防护用品 劳保 劳动保护 事故 隐患 现场管理 三过滤 设备管理 着装'),
    ('机械制图与公差', '视图 投影 剖视 剖面 零件图 装配图 尺寸标注 公差 粗糙度 形位 基准 表面粗糙 符号 图纸 技术要求 主视图 轴测 球半径 公称直径'),
    ('金属材料与热处理', '材料 合金 不锈钢 铝合金 铸铁 碳钢 45钢 塑料 陶瓷 淬火 退火 回火 正火 渗碳 调质 硬度 晶粒 火花 导热 切削液'),
    ('钳工与电工基础', '钳工 划线 锯削 锉削 钻孔 攻丝 铰孔 电流 电压 电阻 电路 直流 交流 触点 开关设备 电容器 电感器 PLC 熔断器 电池 灯泡'),
    ('测量与检验',     '量具 卡尺 千分尺 百分表 千分表 塞规 量规 检验 读数 游标 角度尺 杠杆表 内径 深度尺 检测 测量'),
    ('数控编程与操作', '数控 编程 程序 指令 刀补 补偿 子程序 宏程序 坐标系 对刀 面板 循环 G0 G1 G2 G3 G4 G7 G9 M0 M3 M5 S功能 F功能 T功能 转速 进给速度 绝对 相对 模态'),
    ('机床结构与维护', '机床 主轴 导轨 丝杠 皮带 齿轮 润滑 保养 维护 故障 报警 电控 液压 气压 气动 电气 继电器 电动机 变压器 万用表 传动 轴承 变速箱 尾座 刀架 阀'),
    ('车削工艺与刀具', '车削 车刀 刀具 切削 进给 背吃刀 装夹 卡盘 顶尖 细长轴 偏心 薄壁 套类 螺纹 蜗杆 圆锥 台阶 余量 前角 后角 主偏角 刃倾角 锥度'),
])


def classify(stem):
    for name, kws in RULES.items():
        if any(k in stem for k in kws.split()):
            return name
    return '综合'


# ---------- 组装 ----------
rows, dropped = [], []
for lines in blocks:
    stem, opts, tf, letter = parse(lines)

    if tf is not None:
        if not stem:
            dropped.append(('无题干', lines[0][:60]))
            continue
        rows.append({'type': 'judge', 'stem': stem, 'opts': ['正确', '错误'], 'answer': tf})
        continue

    if len(opts) < 2:
        dropped.append(('源文件无选项', stem[:60]))
        continue

    letters = [o[0] for o in opts]
    if len(set(letters)) != 4:
        dropped.append(('选项不齐', stem[:60]))
        continue
    texts = [o[1] for o in opts]
    if any(not t for t in texts):
        dropped.append(('选项为空', stem[:60]))
        continue
    if letter is None or letter not in letters:
        dropped.append(('源文件无答案', stem[:60]))
        continue
    # 源文件里选项被打碎成无意义音节的题目（仅此 1 道：der / ber / ke / 巴bar）
    if sum(1 for t in texts if re.fullmatch(r'[a-z]{1,3}', t)) >= 2:
        dropped.append(('选项损坏', stem[:60]))
        continue

    rows.append({'type': 'single', 'stem': stem, 'opts': texts, 'answer': letters.index(letter)})


# ---------- 去重（题干相同视为同一题，保留首次出现的答案）----------
def norm(s):
    return re.sub(r'[\s，。、,.;；:：()（）"“”\'’?？!！\-_]', '', s)


seen, uniq, dups, conflicts = {}, [], 0, []
for r in rows:
    k = norm(r['stem'])
    if k in seen:
        dups += 1
        if seen[k]['answer'] != r['answer'] or seen[k]['opts'] != r['opts']:
            conflicts.append({'stem': r['stem'],
                              'kept': seen[k]['opts'][seen[k]['answer']],
                              'other': r['opts'][r['answer']]})
        continue
    seen[k] = r
    uniq.append(r)

for i, r in enumerate(uniq, 1):
    r['id'] = i
    r['cat'] = classify(r['stem'])

meta = {
    'name': '数控车工（中级）考证理论题库',
    'total': len(uniq),
    'single': sum(1 for r in uniq if r['type'] == 'single'),
    'judge': sum(1 for r in uniq if r['type'] == 'judge'),
    'cats': list(RULES) + ['综合'],
}
json.dump({'meta': meta, 'questions': uniq}, open(OUT, 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))

print('题目总数: %d  (选择 %d / 判断 %d)' % (len(uniq), meta['single'], meta['judge']))
print('按分类:', Counter(r['cat'] for r in uniq).most_common())
print('剔除完全重复 %d 条；其中同一题干答案不一致 %d 条:' % (dups, len(conflicts)))
for c in conflicts:
    print('   -', c['stem'][:58], '| 保留:', c['kept'][:22], '| 另有:', c['other'][:22])
print('源文件缺陷、无法使用 %d 条:' % len(dropped))
for reason, stem in dropped:
    if reason != '源文件无选项':
        print('   - [%s] %s' % (reason, stem))
print('   - [源文件无选项] %d 条（文档后半段“题干+答案文本”的残缺副本，题干与正题完全相同，不重复计入）'
      % sum(1 for r, _ in dropped if r == '源文件无选项'))
print('写出:', OUT, os.path.getsize(OUT), 'bytes')
