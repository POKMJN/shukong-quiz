# -*- coding: utf-8 -*-
"""data/qbank.json -> android/app/src/main/assets/www/qbank.js

应用把题库以 JS 变量内联加载（window.QBANK=...），而不是运行时 fetch：
WebView 里 file:// 下 fetch 受限，内联可以避开这个问题，也少一次 IO。

用法：
    python make_assets.py
"""
import io, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SRC = os.path.join(ROOT, 'data', 'qbank.json')
DST = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'www', 'qbank.js')

bank = json.load(io.open(SRC, encoding='utf-8'))

with io.open(DST, 'w', encoding='utf-8') as f:
    f.write('window.QBANK=')
    json.dump(bank, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';')

meta = bank['meta']
print('已写入 %s' % DST)
print('  题量 %d（选择 %d / 判断 %d），%d 字节'
      % (meta['total'], meta['single'], meta['judge'], os.path.getsize(DST)))
