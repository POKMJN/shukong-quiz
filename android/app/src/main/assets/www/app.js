/* 数控车工考证刷题 - 应用逻辑 */
(function () {
  'use strict';

  var STORE_KEY = 'skq_v1';
  var DB = null;          // 题库
  var BY_ID = {};         // id -> question

  /* ============================================================
   *  工具
   * ============================================================ */
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* 2026-09-15 19:41 */
  function fmtDate(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60);
    return m < 1 ? sec + ' 秒' : m + ' 分 ' + (sec % 60) + ' 秒';
  }

  var LETTERS = ['A', 'B', 'C', 'D'];

  /* ============================================================
   *  触感反馈 (Haptic Vibration)
   * ============================================================ */
  var Haptic = {
    play: function (type) {
      try {
        if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === 'function') {
          window.AndroidBridge.vibrate(type || 'light');
          return;
        }
      } catch (e) {}
      try {
        if (navigator.vibrate) {
          if (type === 'error') navigator.vibrate([40, 50, 40]);
          else if (type === 'success') navigator.vibrate(25);
          else navigator.vibrate(15);
        }
      } catch (e) {}
    }
  };

  /* ============================================================
   *  持久化
   * ============================================================ */
  var Store = {
    data: null,

    load: function () {
      try {
        this.data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      } catch (e) { this.data = {}; }
      if (!this.data.rec) this.data.rec = {};
      if (!this.data.fav) this.data.fav = {};
      if (!this.data.exams) this.data.exams = [];
      if (!this.data.wrongs) {
        this.data.wrongs = {};
        for (var k in this.data.rec) {
          if (this.isCorrect(k) === false) {
            this.data.wrongs[k] = true;
          }
        }
      }
      return this.data;
    },

    save: function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); }
      catch (e) { Toast.show('存储空间不足，记录可能未保存'); }
    },

    reset: function () {
      this.data = { rec: {}, fav: {}, exams: [], wrongs: {} };
      this.save();
    },

    /* 记录一次作答：pick 为【原始题库选项下标】，对错由题库答案现算 */
    mark: function (qid, pick) {
      this.data.rec[qid] = pick;
      var q = BY_ID[qid];
      if (q && pick !== undefined && pick !== null) {
        if (pick !== q.answer) {
          this.addWrong(qid);
        }
      }
      this.save();
    },

    addWrong: function (qid) {
      if (!this.data.wrongs) this.data.wrongs = {};
      this.data.wrongs[qid] = true;
      this.save();
    },

    removeWrong: function (qid) {
      if (this.data.wrongs && this.data.wrongs[qid]) {
        delete this.data.wrongs[qid];
        this.save();
      }
    },

    isWrong: function (qid) {
      return !!(this.data.wrongs && this.data.wrongs[qid]);
    },

    /* 是否已作答 */
    answered: function (qid) {
      return this.data.rec[qid] !== undefined && this.data.rec[qid] !== null;
    },

    /* 该题是否答对（未作答返回 null） */
    isCorrect: function (qid) {
      if (!this.answered(qid)) return null;
      var q = BY_ID[qid];
      return q ? this.data.rec[qid] === q.answer : null;
    },

    /* 已作答的题数 / 答对数 */
    counts: function () {
      var ids = Object.keys(this.data.rec), ok = 0;
      for (var i = 0; i < ids.length; i++) if (this.isCorrect(ids[i])) ok++;
      return { done: ids.length, ok: ok };
    },

    wrongIds: function () {
      if (!this.data.wrongs) return [];
      var out = [];
      for (var k in this.data.wrongs) if (this.data.wrongs[k]) out.push(+k);
      return out.sort(function (a, b) { return a - b; });
    },

    favIds: function () {
      var out = [];
      for (var k in this.data.fav) if (this.data.fav[k]) out.push(+k);
      return out.sort(function (a, b) { return a - b; });
    },

    isFav: function (qid) { return !!this.data.fav[qid]; },

    toggleFav: function (qid) {
      if (this.data.fav[qid]) delete this.data.fav[qid];
      else this.data.fav[qid] = true;
      this.save();
      return !!this.data.fav[qid];
    }
  };

  /* ============================================================
   *  Toast / Modal
   * ============================================================ */
  var Toast = {
    timer: null,
    show: function (msg, ms) {
      var el = $('toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this.timer);
      this.timer = setTimeout(function () { el.classList.remove('show'); }, ms || 1700);
    }
  };

  var Modal = {
    cb: null,
    ask: function (title, text, okText, cb) {
      $('modal-title').textContent = title;
      $('modal-text').innerHTML = text;
      $('modal-ok').textContent = okText || '确定';
      this.cb = cb;
      $('modal-mask').classList.add('open');
    },
    close: function () { $('modal-mask').classList.remove('open'); this.cb = null; }
  };

  /* ============================================================
   *  答题卡抽屉
   * ============================================================ */
  var Cards = {
    render: null,
    open: function (renderFn) {
      if (renderFn) this.render = renderFn;
      if (this.render) this.render($('card-grid'));
      $('card-mask').classList.add('open');
      $('card-drawer').classList.add('open');
    },
    close: function () {
      $('card-mask').classList.remove('open');
      $('card-drawer').classList.remove('open');
    }
  };

  /* ============================================================
   *  屏幕切换
   * ============================================================ */
  var Nav = {
    current: 'home',
    stack: [],
    _lastBackTime: 0,
    goto: function (name, replace) {
      if (!replace && this.current && this.current !== name) {
        this.stack.push(this.current);
      }
      var cur = document.querySelector('.screen.active');
      if (cur) cur.classList.remove('active');
      var next = $('screen-' + name);
      if (next) next.classList.add('active');
      var sc = next && next.querySelector('.scroll');
      if (sc) sc.scrollTop = 0;
      this.current = name;
      if (name === 'home') Home.render();
      else if (name === 'list') List.render();
      else if (name === 'stats') Stats.render();
      else if (name === 'exam-setup') ExamSetup.renderHistory();
    },
    /* Android 返回键与统一返回上一级菜单 */
    back: function () {
      if ($('card-drawer') && $('card-drawer').classList.contains('open')) { Cards.close(); return true; }
      if ($('modal-mask') && $('modal-mask').classList.contains('open')) { Modal.close(); return true; }
      if (this.current === 'exam') { Exam.confirmQuit(); return true; }
      if (window.Practice && Practice._autoNextTimer) {
        clearTimeout(Practice._autoNextTimer);
        Practice._autoNextTimer = null;
      }
      if (this.stack.length > 0) {
        var prev = this.stack.pop();
        while (prev === this.current && this.stack.length > 0) {
          prev = this.stack.pop();
        }
        if (prev && prev !== this.current) {
          var cur = document.querySelector('.screen.active');
          if (cur) cur.classList.remove('active');
          var next = $('screen-' + prev);
          if (next) next.classList.add('active');
          var sc = next && next.querySelector('.scroll');
          if (sc) sc.scrollTop = 0;
          this.current = prev;

          if (prev === 'home') Home.render();
          else if (prev === 'list') List.render();
          else if (prev === 'stats') Stats.render();
          else if (prev === 'exam-setup') ExamSetup.renderHistory();

          return true;
        }
      }
      if (this.current !== 'home') {
        this.goto('home', true);
        Home.render();
        return true;
      }
      // 首页双击返回防误触退出
      var now = Date.now();
      if (now - this._lastBackTime < 2000) {
        return false;
      }
      this._lastBackTime = now;
      Toast.show('再按一次退出应用');
      return true;
    }
  };

  /* ============================================================
   *  首页
   * ============================================================ */
  var Home = {
    goto: function (name) {
      if (name === 'wrong' || name === 'fav') { List.open(name); return; }
      if (name === 'stats') { Stats.render(); Nav.goto('stats'); return; }
      if (name === 'home') {
        Nav.stack = [];
        Nav.goto('home', true);
        this.render();
        return;
      }
      Nav.goto(name);
      if (name === 'exam-setup') ExamSetup.renderHistory();
    },

    render: function () {
      var c = Store.counts();
      var total = DB.questions.length;
      $('st-total').textContent = total;
      $('st-done').textContent = Math.round(c.done / total * 100) + '%';
      $('st-rate').textContent = c.done ? Math.round(c.ok / c.done * 100) + '%' : '—';
      $('prog-txt').textContent = '已练习 ' + c.done + ' / ' + total + ' 题';
      $('prog-bar').style.width = (c.done / total * 100) + '%';
      $('foot-total').textContent = total;
      $('wrong-sub').textContent = Store.wrongIds().length
        ? '当前有 ' + Store.wrongIds().length + ' 道待攻克' : '集中攻克做错的题目';
      $('fav-sub').textContent = Store.favIds().length
        ? '已收藏 ' + Store.favIds().length + ' 道题' : '标记重点题目随时复看';

      // 分类
      var byCat = {}, order = DB.meta.cats;
      DB.questions.forEach(function (q) { byCat[q.cat] = (byCat[q.cat] || 0) + 1; });
      var html = '';
      order.forEach(function (cat) {
        if (!byCat[cat]) return;
        html += '<button class="cat-row" onclick="Home.startPractice(\'order\',\'' + esc(cat) + '\')">' +
          '<span class="dot"></span>' +
          '<span class="nm">' + esc(cat) + '<em>' + byCat[cat] + ' 题</em></span>' +
          '<span class="arrow">›</span></button>';
      });
      $('cat-list').innerHTML = html;
    },

    startPractice: function (mode, cat) {
      var ids;
      if (mode === 'random') ids = shuffle(DB.questions.map(function (q) { return q.id; }));
      else ids = DB.questions.filter(function (q) { return !cat || q.cat === cat; })
        .map(function (q) { return q.id; });
      if (!ids.length) { Toast.show('该分类暂无题目'); return; }
      Practice.begin(ids, mode === 'random' ? '随机练习' : (cat ? cat : '基础练习'), mode, !!cat);
    },

    confirmReset: function () {
      Modal.ask('清空练习记录', '将删除所有答题记录、错题本和收藏，且无法恢复。确定继续吗？', '清空',
        function () {
          Store.reset();
          Home.render();
          Toast.show('已清空');
        });
    }
  };

  /* ============================================================
   *  练习
   * ============================================================ */
  var Practice = {
    ids: [],
    idx: 0,
    title: '',
    mode: 'order',
    fromCat: false,
    type: 'quiz', // 'quiz' (做题模式) | 'recite' (背题模式)
    sessionAnswers: {}, // 当前练习会话的作答状态（退出后清空，重新进入即为崭新未答状态）
    _slideDir: null,
    _autoNextTimer: null,

    switchType: function (t) {
      if (this.type === t) return;
      this.type = t;
      var btnQ = $('tab-mode-quiz'), btnR = $('tab-mode-recite');
      if (btnQ) btnQ.classList.toggle('active', t === 'quiz');
      if (btnR) btnR.classList.toggle('active', t === 'recite');
      this.render();
    },

    begin: function (ids, title, mode, fromCat, isInspect, startIdx) {
      if (this._autoNextTimer) {
        clearTimeout(this._autoNextTimer);
        this._autoNextTimer = null;
      }
      this.ids = ids;
      this.idx = startIdx || 0;
      this.title = title;
      this.mode = mode;
      this.fromCat = !!fromCat;
      this.type = (mode === 'random') ? 'quiz' : (isInspect ? 'recite' : 'quiz');
      this.sessionAnswers = {}; // 每次进入练习全新重置作答状态
      this._slideDir = null;
      $('p-title').textContent = title;

      // 基础练习（order）与错题本（wrong/snapshot）内置切换条，随机练习纯做题
      var toolbar = document.querySelector('.practice-toolbar');
      var showToolbar = (mode === 'order' || mode === 'wrong' || mode === 'snapshot');
      if (toolbar) {
        toolbar.style.display = showToolbar ? 'flex' : 'none';
      }

      var btnQ = $('tab-mode-quiz'), btnR = $('tab-mode-recite');
      if (btnQ && btnR) {
        if (mode === 'wrong' || mode === 'snapshot') {
          btnQ.innerHTML = '📝 答题模式';
          btnR.innerHTML = '🔍 检查模式';
        } else {
          btnQ.innerHTML = '📝 做题模式';
          btnR.innerHTML = '📖 背题模式';
        }
        btnQ.classList.toggle('active', this.type === 'quiz');
        btnR.classList.toggle('active', this.type === 'recite');
      }

      Nav.goto('practice');
      this.render();
    },

    exit: function () {
      if (this._autoNextTimer) {
        clearTimeout(this._autoNextTimer);
        this._autoNextTimer = null;
      }
      this.sessionAnswers = {}; // 退出后自动清空当前作答状态
      Nav.back();
    },

    cur: function () { return BY_ID[this.ids[this.idx]]; },

    render: function () {
      var q = this.cur();
      if (!q) return;
      var isJudge = q.type === 'judge';
      var isRecite = (this.type === 'recite');
      var userPick = this.sessionAnswers[q.id];
      var answered = (userPick !== undefined);

      $('p-sub').textContent = (this.idx + 1) + ' / ' + this.ids.length;
      $('p-prev').toggleAttribute('disabled', this.idx === 0);
      $('p-next').textContent = this.idx === this.ids.length - 1 ? '完成' : '下一题';
      $('p-fav').textContent = Store.isFav(q.id) ? '★' : '☆';
      $('p-fav').style.color = Store.isFav(q.id) ? '#ea8a1b' : '';

      var html = '<div class="qhead">' +
        '<span class="tag">' + (isJudge ? '判断题' : '单选题') + '</span>' +
        '<span class="tag gray">' + esc(q.cat) + '</span>';
      if (isRecite) {
        html += '<span class="tag violet">' + ((this.mode === 'wrong' || this.mode === 'snapshot') ? '🔍 检查模式' : '📖 背题模式') + '</span>';
      } else if (answered) {
        html += '<span class="tag ' + (userPick === q.answer ? 'ok">✓ 回答正确' : 'err">✗ 回答错误') + '</span>';
      }
      html += '</div>';

      html += '<div class="stem">' + esc(q.stem) + '</div>';
      html += '<div class="opts">';
      q.opts.forEach(function (text, i) {
        var cls = 'opt';
        var key = isJudge ? (i === 0 ? '√' : '×') : LETTERS[i];
        if (isRecite) {
          if (i === q.answer) cls += ' is-correct';
          else cls += ' dim';
        } else if (answered) {
          if (i === q.answer) cls += ' is-correct';
          else if (i === userPick) cls += ' picked-wrong';
          else cls += ' dim';
        }
        html += '<button class="' + cls + '"' +
          ((isRecite || answered) ? ' disabled' : ' onclick="Practice.pick(' + i + ')"') + '>' +
          '<span class="key">' + key + '</span>' +
          '<span class="txt">' + esc(text) + '</span></button>';
      });
      html += '</div>';

      if (isRecite || answered) {
        var ok = isRecite ? true : (userPick === q.answer);
        html += '<div class="analysis">' +
          '<div class="verdict ' + (ok ? 'ok">✓ ' + (isRecite ? '标准答案' : '回答正确') : 'err">✗ 回答错误') + '</div>' +
          '<div class="row"><span class="k">正确答案</span><span class="v ok">' +
            (isJudge ? '' : LETTERS[q.answer] + '、') + esc(q.opts[q.answer]) + '</span></div>';
        if (!isRecite && !ok) {
          html += '<div class="row"><span class="k">你的答案</span><span class="v err">' +
            (isJudge ? '' : LETTERS[userPick] + '、') + esc(q.opts[userPick]) + '</span></div>';
        }
        html += '<div class="row"><span class="k">所属分类</span><span class="v">' + esc(q.cat) + '</span></div>';

        if (Practice.mode === 'wrong' || Store.isWrong(q.id)) {
          html += '<div style="margin-top:12px;text-align:right">' +
            '<button class="remove-wrong-btn" onclick="Practice.removeWrong(' + q.id + ')">🗑️ 移出错题本</button>' +
          '</div>';
        }
        html += '</div>';
      }

      var pBody = $('p-body');
      pBody.innerHTML = html;
      if (this._slideDir) {
        var animCls = this._slideDir === 'right' ? 'slide-in-right' : 'slide-in-left';
        pBody.classList.remove('slide-in-right', 'slide-in-left');
        void pBody.offsetWidth;
        pBody.classList.add(animCls);
        this._slideDir = null;
      }
      document.querySelector('#screen-practice .scroll').scrollTop = 0;
    },

    pick: function (i) {
      if (this.type === 'recite') return;
      var q = this.cur();
      if (this.sessionAnswers[q.id] !== undefined) return;

      if (this._autoNextTimer) {
        clearTimeout(this._autoNextTimer);
        this._autoNextTimer = null;
      }

      this.sessionAnswers[q.id] = i;
      Store.mark(q.id, i); // 持久化答题并更新错题本
      this.render();

      var isCorrect = (i === q.answer);
      if (isCorrect) {
        Haptic.play('success');
      } else {
        Haptic.play('error');
      }

      if (this.mode === 'wrong' && isCorrect) {
        Toast.show('回答正确！');
      }

      // 普通练习模式（order）和随机练习（random），以及错题本答题（wrong）：答对等待0.5秒自动跳转到下一题
      if (isCorrect && (this.mode === 'order' || this.mode === 'random' || this.mode === 'wrong')) {
        var self = this;
        this._autoNextTimer = setTimeout(function () {
          self._autoNextTimer = null;
          self.step(1);
        }, 500);
      }
    },

    step: function (d, isSwipe) {
      if (this._autoNextTimer) {
        clearTimeout(this._autoNextTimer);
        this._autoNextTimer = null;
      }
      var n = this.idx + d;
      if (n < 0) {
        if (isSwipe) Toast.show('已经是第一题了');
        return;
      }
      if (n >= this.ids.length) {
        var c = Store.counts();
        Modal.ask('本组练习完成',
          '共 ' + this.ids.length + ' 题。当前累计已练 ' + c.done + ' 题，总正确率 ' +
          (c.done ? Math.round(c.ok / c.done * 100) : 0) + '%。',
          '返回上一级', function () { Nav.back(); });
        return;
      }
      this._slideDir = d > 0 ? 'right' : 'left';
      this.idx = n;
      this.render();
    },

    removeWrong: function (qid) {
      var q = BY_ID[qid];
      if (!q) return;
      Haptic.play('light');
      Store.removeWrong(qid);
      Toast.show('已移出错题本');
      var at = this.ids.indexOf(qid);
      if (at >= 0 && this.mode === 'wrong') {
        this.ids.splice(at, 1);
        if (!this.ids.length) {
          Toast.show('已无剩余错题');
          Nav.back();
          return;
        }
        if (this.idx >= this.ids.length) this.idx = this.ids.length - 1;
      }
      this.render();
    },

    toggleFav: function () {
      var q = this.cur();
      var on = Store.toggleFav(q.id);
      Haptic.play('light');
      Toast.show(on ? '已加入收藏' : '已取消收藏');
      this.render();
    },

    openCard: function () {
      var self = this;
      Cards.open(function (grid) {
        var h = '';
        self.ids.forEach(function (id, i) {
          var cls = '';
          if (self.type === 'recite') {
            cls = 'ok';
          } else {
            var ans = self.sessionAnswers[id];
            if (ans !== undefined) {
              var q = BY_ID[id];
              cls = (ans === q.answer) ? 'ok' : 'err';
            }
          }
          if (i === self.idx) cls += ' cur';
          h += '<button class="' + cls.trim() + '" onclick="Practice.jump(' + i + ')">' + (i + 1) + '</button>';
        });
        grid.innerHTML = h;
      });
    },

    jump: function (i) {
      if (this._autoNextTimer) {
        clearTimeout(this._autoNextTimer);
        this._autoNextTimer = null;
      }
      this._slideDir = null;
      this.idx = i;
      Cards.close();
      this.render();
    }
  };

  /* ============================================================
   *  模拟考试
   * ============================================================ */
  var ExamSetup = {
    paper: 'std',        // 'std' 标准卷 | 'custom' 自定义卷
    count: 50,
    minutes: 90,
    scope: 'all',

    /* 标准卷构成依据《车工国家职业技能标准（2018年版）》对应的中级理论卷结构：
       单项选择 第1~80题 + 判断 第81~100题，每题1分，满分100分，60分及格。
       国标另规定理论知识考试时间不少于 90 分钟。 */
    STD: { single: 80, judge: 20, minutes: 90 },

    init: function () {
      var self = this;
      this.setChip = function (id, v) {
        var box = $(id);
        if (!box) return;
        box.querySelectorAll('.chip').forEach(function (c) {
          c.classList.toggle('on', c.dataset.v === String(v));
        });
      };

      var bind = function (id, key, isNum) {
        var box = $(id);
        if (!box) return;
        box.addEventListener('click', function (e) {
          var b = e.target.closest('.chip');
          if (!b) return;
          box.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); });
          b.classList.add('on');
          self[key] = isNum ? +b.dataset.v : b.dataset.v;
          if (key === 'paper') self.onPaperChange();
          self.render();
        });
      };
      bind('set-paper', 'paper', false);
      bind('set-count', 'count', true);
      bind('set-time', 'minutes', true);
      bind('set-scope', 'scope', false);

      this.render();
    },

    /* 切换试卷类型时，时长跟着回到该类型的常用值 */
    onPaperChange: function () {
      if (this.paper === 'std') {
        this.minutes = this.STD.minutes;
        this.setChip('set-time', this.STD.minutes);
      } else {
        this.minutes = 45;
        this.setChip('set-time', 45);
      }
    },

    /* 预览卡片：说清这张卷子多少题、怎么配分 */
    render: function () {
      var std = this.paper === 'std';
      var rowC = $('row-count'), rowS = $('row-scope');
      if (rowC) rowC.style.display = std ? 'none' : '';
      if (rowS) rowS.style.display = std ? 'none' : '';

      var box = $('paper-preview');
      if (!box) return;

      if (std) {
        var S = this.STD;
        box.innerHTML =
          '<div style="font-size:14px;font-weight:600;margin-bottom:10px">标准卷构成</div>' +
          '<div class="kv-grid" style="margin-bottom:12px">' +
            '<div><b>' + S.single + '</b><span>单项选择题</span></div>' +
            '<div><b>' + S.judge + '</b><span>判断题</span></div>' +
            '<div><b>' + (S.single + S.judge) + '</b><span>合计题数</span></div>' +
          '</div>' +
          '<div style="font-size:12.8px;color:var(--text-2);line-height:1.7">' +
            '按真实试卷结构出卷：单选第 1~' + S.single + ' 题、判断第 ' + (S.single + 1) +
            '~' + (S.single + S.judge) + ' 题，每题 1 分，满分 100 分。<br>' +
            '建议时长 ' + S.minutes + ' 分钟（国家职业技能标准要求理论考试不少于 90 分钟）。' +
          '</div>';
      } else {
        var scopeTxt = this.scope === 'single' ? '仅选择题'
                     : (this.scope === 'judge' ? '仅判断题' : '全部题目');
        box.innerHTML =
          '<div style="font-size:14px;font-weight:600;margin-bottom:10px">自定义卷构成</div>' +
          '<div style="font-size:12.8px;color:var(--text-2);line-height:1.7">' +
            '从「' + scopeTxt + '」中随机抽取 <b style="color:var(--text)">' + this.count +
            '</b> 题，满分 100 分，每题约 ' + (100 / this.count).toFixed(1) + ' 分。<br>' +
            '适合日常练手，题量与真实试卷不同。' +
          '</div>';
      }
    },

    start: function () {
      var picked, kind;
      if (this.paper === 'std') {
        var S = this.STD;
        var singles = [], judges = [];
        DB.questions.forEach(function (q) {
          if (q.type === 'single') singles.push(q.id);
          else if (q.type === 'judge') judges.push(q.id);
        });
        var ns = Math.min(S.single, singles.length);
        var nj = Math.min(S.judge, judges.length);
        if (ns < S.single || nj < S.judge) Toast.show('题库题量不足，已按实际题量出卷');
        // 保持与真实试卷一致的分段顺序：先单选，后判断
        picked = shuffle(singles).slice(0, ns).concat(shuffle(judges).slice(0, nj));
        kind = '标准卷';
      } else {
        var pool = DB.questions.filter(function (q) {
          if (this.scope === 'single') return q.type === 'single';
          if (this.scope === 'judge') return q.type === 'judge';
          return true;
        }, this);
        if (pool.length < this.count) {
          Toast.show('该范围只有 ' + pool.length + ' 题，已按实际题量出卷');
        }
        picked = shuffle(pool.map(function (q) { return q.id; }))
                    .slice(0, Math.min(this.count, pool.length));
        kind = '自定义卷';
      }
      Exam.begin(picked, this.minutes * 60, kind);
    },

    renderHistory: function () {
      var h = Store.data.exams;
      var box = $('exam-history');
      if (!h.length) { box.innerHTML = ''; return; }
      var html = '<div class="section-title">最近考试记录</div>';
      h.slice(0, 8).forEach(function (e, idx) {
        var pass = e.score >= 60;
        html += '<div class="card history-card" onclick="ExamSetup.viewHistory(' + idx + ')" style="margin-bottom:10px;padding:14px;cursor:pointer">' +
          '<div style="display:flex;align-items:center;gap:14px">' +
            '<div style="text-align:center;flex:none;width:62px">' +
              '<div style="font-size:24px;font-weight:800;color:' + (pass ? 'var(--ok)' : 'var(--err)') + '">' + e.score + '</div>' +
              '<div style="font-size:11px;color:var(--text-3)">分</div>' +
            '</div>' +
            '<div style="flex:1;font-size:12.8px;color:var(--text-2);line-height:1.6">' +
              '<div style="font-weight:600;color:var(--text)">' + (e.kind || '模拟考试') + ' · ' + esc(e.date) + '</div>' +
              '<div>共 ' + e.total + ' 题 · 对 ' + e.ok + ' 题 / 错 ' + e.bad + ' 题 · 用时 ' + fmtDur(e.used) + '</div>' +
            '</div>' +
            '<span class="tag ' + (pass ? 'ok">及格' : 'err">不及格') + '</span>' +
          '</div>' +
          '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--brand)">' +
            '<span>' + (e.bad ? '⚠️ 包含 ' + e.bad + ' 道错题待复盘' : '✨ 全部答对，表现优秀') + '</span>' +
            '<span>查看答卷详情与错题 →</span>' +
          '</div>' +
        '</div>';
      });
      box.innerHTML = html;
    },

    viewHistory: function (idx) {
      var e = Store.data.exams[idx];
      if (!e) return;
      if (e.paper && e.picks) {
        Result.render(e, e.paper, e.picks, false);
      } else {
        Modal.ask('提示', '该次考试为旧版本记录，未保存题目快照。请进行一次新的模拟考试，新考试均可随时查看错题与答卷。', '我知道了', function () {});
      }
    }
  };

  var Exam = {
    paper: [],       // {qid, opts:[显示文本], orig:[每个显示项对应的题库原始下标], answer:int(显示下标)}
    idx: 0,
    picks: {},       // 卷面题序 -> 选中的【显示下标】
    remain: 0,
    timer: null,
    startedAt: 0,
    total: 0,
    kind: '模拟考试',
    _slideDir: null,

    begin: function (ids, seconds, kind) {
      var self = this;
      this.kind = kind || '模拟考试';
      this._slideDir = null;
      this.paper = ids.map(function (id) {
        var q = BY_ID[id];
        // 选择题打乱选项；判断题的"正确/错误"保持原序
        if (q.type === 'single') {
          var order = shuffle([0, 1, 2, 3]);
          return {
            qid: id,
            opts: order.map(function (i) { return q.opts[i]; }),
            orig: order,
            answer: order.indexOf(q.answer)
          };
        }
        return {
          qid: id, opts: q.opts.slice(),
          orig: [0, 1], answer: q.answer
        };
      });
      this.idx = 0;
      this.picks = {};
      this.total = ids.length;
      this.remain = seconds;
      this.startedAt = Date.now();
      clearInterval(this.timer);
      this.timer = setInterval(function () { self.tick(); }, 1000);
      $('e-sub').textContent = '1 / ' + this.total;
      $('e-kind').textContent = this.kind;
      Nav.goto('exam');
      this.render();
      this.tick();
    },

    tick: function () {
      this.remain--;
      var t = $('e-timer');
      t.textContent = fmtTime(this.remain);
      t.classList.toggle('warn', this.remain <= 300);
      if (this.remain <= 0) {
        clearInterval(this.timer);
        Toast.show('考试时间到，自动交卷');
        this.finish(true);
      }
    },

    cur: function () { return this.paper[this.idx]; },

    render: function () {
      var p = this.cur();
      if (!p) return;
      var q = BY_ID[p.qid];
      var isJudge = q.type === 'judge';
      var picked = this.picks[this.idx];
      var isLast = (this.idx === this.total - 1);

      $('e-sub').textContent = (this.idx + 1) + ' / ' + this.total;
      $('e-prev').toggleAttribute('disabled', this.idx === 0);
      
      var nextBtn = $('e-next');
      if (nextBtn) {
        if (isLast) {
          nextBtn.textContent = '交卷';
          nextBtn.classList.add('submit-state');
          nextBtn.onclick = function () { Exam.confirmSubmit(); };
        } else {
          nextBtn.textContent = '下一题';
          nextBtn.classList.remove('submit-state');
          nextBtn.onclick = function () { Exam.step(1); };
        }
      }

      var html = '<div class="qhead">' +
        '<span class="tag">' + (isJudge ? '判断题' : '单选题') + '</span>' +
        '<span class="tag gray">' + esc(q.cat) + '</span></div>';
      html += '<div class="stem">' + esc(q.stem) + '</div><div class="opts">';
      p.opts.forEach(function (text, i) {
        var cls = 'opt' + (picked === i ? ' picked' : '');
        var key = isJudge ? (i === 0 ? '√' : '×') : LETTERS[i];
        html += '<button class="' + cls + '" onclick="Exam.pick(' + i + ')">' +
          '<span class="key">' + key + '</span><span class="txt">' + esc(text) + '</span></button>';
      });
      html += '</div>';

      var eBody = $('e-body');
      eBody.innerHTML = html;
      if (this._slideDir) {
        var animCls = this._slideDir === 'right' ? 'slide-in-right' : 'slide-in-left';
        eBody.classList.remove('slide-in-right', 'slide-in-left');
        void eBody.offsetWidth;
        eBody.classList.add(animCls);
        this._slideDir = null;
      }
      document.querySelector('#screen-exam .scroll').scrollTop = 0;
    },

    pick: function (i) {
      this.picks[this.idx] = i;
      Haptic.play('light');
      this.render();
    },

    step: function (d, isSwipe) {
      var n = this.idx + d;
      if (n < 0) {
        if (isSwipe) Toast.show('已经是第一题了');
        return;
      }
      if (n >= this.total) {
        if (isSwipe) {
          Toast.show('已是最后一题，检查完毕请点击「交卷」');
        } else {
          this.confirmSubmit();
        }
        return;
      }
      this._slideDir = d > 0 ? 'right' : 'left';
      this.idx = n;
      this.render();
    },

    openCard: function () {
      var self = this;
      Cards.open(function (grid) {
        var h = '';
        for (var i = 0; i < self.total; i++) {
          h += '<button class="' + (self.picks[i] !== undefined ? 'done' : '') +
            (i === self.idx ? ' cur' : '') + '" onclick="Exam.jump(' + i + ')">' + (i + 1) + '</button>';
        }
        grid.innerHTML = h;
      });
    },

    jump: function (i) {
      this._slideDir = null;
      this.idx = i;
      Cards.close();
      this.render();
    },

    confirmQuit: function () {
      var self = this;
      Modal.ask('退出考试', '退出后本次作答不会计分，确定退出吗？', '退出',
        function () { clearInterval(self.timer); Home.goto('home'); });
    },

    confirmSubmit: function () {
      var self = this;
      var blank = this.total - Object.keys(this.picks).length;
      if (blank === 0) {
        Modal.ask('确认交卷', '本次考试共 ' + this.total + ' 题已全部作答完成。<br>确定现在提交试卷并查看成绩吗？', '交卷',
          function () { self.finish(false); });
      } else {
        Modal.ask('确认交卷', '还有 <b style="color:var(--err)">' + blank + '</b> 道题未作答，未作答将按 0 分计。<br>确定交卷吗？', '交卷',
          function () { self.finish(false); });
      }
    },

    finish: function (timeout) {
      clearInterval(this.timer);
      var ok = 0, used = Math.round((Date.now() - this.startedAt) / 1000);
      this.paper.forEach(function (p, i) {
        if (Exam.picks[i] === p.answer) ok++;
      });
      var bad = this.total - ok;
      var score = Math.round(ok / this.total * 100);

      // 计入练习记录：把卷面显示下标换算回题库原始下标
      this.paper.forEach(function (p, i) {
        var pick = Exam.picks[i];
        Store.mark(p.qid, pick === undefined ? -1 : p.orig[pick]);
      });

      var rec = {
        id: Date.now(),
        date: fmtDate(new Date()),
        total: this.total, ok: ok, bad: bad, score: score, used: used,
        kind: this.kind,
        paper: this.paper.map(function (p) {
          return { qid: p.qid, opts: p.opts, orig: p.orig, answer: p.answer };
        }),
        picks: Object.assign({}, this.picks)
      };
      Store.data.exams.unshift(rec);
      Store.data.exams = Store.data.exams.slice(0, 30);
      Store.save();

      Result.render(rec, this.paper, this.picks, timeout);
    }
  };

  /* ============================================================
   *  成绩页
   * ============================================================ */
  var Result = {
    render: function (rec, paper, picks, timeout) {
      var pass = rec.score >= 60;
      var cls = rec.score >= 85 ? 'pass' : (pass ? 'pass' : 'fail');
      var avg = (rec.used / rec.total).toFixed(1);
      var blank = 0;
      paper.forEach(function (p, i) { if (picks[i] === undefined) blank++; });

      var html = '<div class="result-hero ' + cls + '">' +
        '<div class="score">' + rec.score + '<small> 分</small></div>' +
        '<div class="verdict-txt">' + (pass ? (rec.score >= 85 ? '成绩优秀，继续保持' : '恭喜通过') : '未达及格线') + '</div>' +
        '<div class="sub">' + esc(rec.date) + (timeout ? ' · 计时结束自动交卷' : '') + '</div>' +
      '</div>';

      html += '<div class="wrap" style="margin-top:-24px;position:relative;z-index:2">' +
        '<div class="kv-grid">' +
          '<div><b style="color:var(--ok)">' + rec.ok + '</b><span>答对</span></div>' +
          '<div><b style="color:var(--err)">' + rec.bad + '</b><span>答错</span></div>' +
          '<div><b>' + fmtDur(rec.used) + '</b><span>用时</span></div>' +
        '</div>';

      html += '<div class="card" style="margin-top:14px;font-size:13.5px;color:var(--text-2);line-height:1.9">' +
        (rec.kind ? '<b style="color:var(--text)">' + esc(rec.kind) + '</b>，' : '') +
        '本次共 ' + rec.total + ' 题，正确率 <b style="color:var(--text)">' + rec.score + '%</b>，' +
        '平均每题 ' + avg + ' 秒' + (blank ? '，其中 ' + blank + ' 题未作答' : '') + '。<br>' +
        '按《车工国家职业技能标准（2018 年版）》，理论知识考试实行百分制，' +
        '<b style="color:var(--text)">60 分（含）以上合格</b>；' +
        '且理论与技能操作须<b style="color:var(--text)">各自</b>达到 60 分才算整体合格。' +
      '</div>';

      html += '<div style="height:18px"></div>';
      if (rec.bad) {
        html += '<button class="btn danger" style="height:50px;font-size:16px;margin-bottom:10px" ' +
          'onclick="Result.review()">查看错题（' + rec.bad + '）</button>';
      }
      html += '<div style="display:flex;gap:10px">' +
        '<button class="btn" style="height:48px" onclick="Home.goto(\'exam-setup\')">再考一次</button>' +
        '<button class="btn primary" style="height:48px" onclick="Home.goto(\'home\')">返回首页</button>' +
      '</div><div style="height:30px"></div></div>';

      $('r-body').innerHTML = html;
      this._paper = paper;
      this._picks = picks;
      Nav.goto('result');
    },

    review: function () {
      var picks = this._picks, ids = [];
      this._paper.forEach(function (p, i) {
        if (picks[i] !== p.answer) ids.push(p.qid);
      });
      List.openIds(ids, '本次考试错题');
    }
  };

  /* ============================================================
   *  错题本 / 收藏
   * ============================================================ */
  var List = {
    mode: 'wrong',
    ids: [],
    title: '',

    open: function (mode) {
      this.mode = mode;
      this.ids = mode === 'wrong' ? Store.wrongIds() : Store.favIds();
      this.title = mode === 'wrong' ? '错题本' : '我的收藏';
      Nav.goto('list');
      this.render();
    },

    openIds: function (ids, title) {
      this.mode = 'snapshot';
      this.ids = ids;
      this.title = title;
      Nav.goto('list');
      this.render();
    },

    render: function () {
      $('l-title').textContent = this.title;
      var act = $('l-action');
      act.textContent = this.ids.length ? '▶' : '';
      act.style.visibility = this.ids.length ? 'visible' : 'hidden';

      if (!this.ids.length) {
        $('l-body').innerHTML = '<div class="empty"><div class="ico">' +
          (this.mode === 'fav' ? '⭐' : '📭') + '</div><p>' +
          (this.mode === 'fav' ? '还没有收藏任何题目' :
            (this.mode === 'snapshot' ? '本次考试全部答对，没有错题' : '还没有错题，继续保持')) +
          '</p></div>';
        return;
      }

      var html = '';
      if (this.mode === 'wrong') {
        html += '<div class="card" style="margin-bottom:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-size:13.5px;font-weight:600;color:var(--text)">待攻克错题</span>' +
          '<span style="font-size:12.5px;color:var(--brand);font-weight:600">共 ' + this.ids.length + ' 题</span>' +
        '</div>' +
        '<button class="btn primary" style="width:100%;height:46px;margin-bottom:14px;font-size:15px" onclick="List.doAction()">' +
          '📝 开始复习错题（' + this.ids.length + ' 题）' +
        '</button>';
      } else if (this.mode === 'snapshot') {
        html += '<button class="btn primary" style="width:100%;height:46px;margin-bottom:14px;font-size:15px" onclick="List.doAction()">' +
          '🔍 查看全部考试错题（' + this.ids.length + ' 题）' +
        '</button>';
      } else {
        html += '<div style="font-size:12.5px;color:var(--text-3);padding:0 2px 12px">' +
          '共 ' + this.ids.length + ' 题 · 点击题目可查看详情</div>';
      }

      var self = this;
      this.ids.forEach(function (id) {
        var q = BY_ID[id];
        if (!q) return;
        html += '<button class="list-item" onclick="List.view(' + id + ')">' +
          '<div class="li-stem">' + esc(q.stem) + '</div>' +
          '<div class="li-meta">' +
            '<span class="tag">' + (q.type === 'judge' ? '判断' : '单选') + '</span>' +
            '<span>' + esc(q.cat) + '</span>' +
            (Store.isFav(id) ? '<span style="color:#ea8a1b">★</span>' : '') +
            (Store.isWrong(id) ? '<span class="tag err">错题</span>' : '') +
          '</div></button>';
      });
      $('l-body').innerHTML = html;
    },

    view: function (id) {
      var startIdx = this.ids.indexOf(id);
      if (startIdx < 0) startIdx = 0;
      var isInspect = (this.mode === 'snapshot');
      Practice.begin(this.ids.concat(), this.title, this.mode, false, isInspect, startIdx);
    },

    doAction: function () {
      if (!this.ids.length) return;
      var isInspect = (this.mode === 'snapshot');
      Practice.begin(this.ids.concat(), this.title, this.mode, false, isInspect, 0);
    }
  };

  /* ============================================================
   *  统计
   * ============================================================ */
  var Stats = {
    render: function () {
      var c = Store.counts(), total = DB.questions.length;
      var h = '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:10px">' +
          '<b>整体进度</b><span style="color:var(--text-3)">' + c.done + ' / ' + total + ' 题</span></div>' +
        '<div class="bar"><i style="width:' + (c.done / total * 100) + '%"></i></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:14px;font-size:13.5px;color:var(--text-2)">' +
          '<span>已答对 <b style="color:var(--ok)">' + c.ok + '</b> 题</span>' +
          '<span>答错 <b style="color:var(--err)">' + (c.done - c.ok) + '</b> 题</span>' +
          '<span>正确率 <b style="color:var(--text)">' + (c.done ? Math.round(c.ok / c.done * 100) : 0) + '%</b></span>' +
        '</div></div>';

      // 分类掌握度
      h += '<div class="section-title">分类掌握情况</div><div class="card">';
      var byCat = {};
      DB.questions.forEach(function (q) {
        if (!byCat[q.cat]) byCat[q.cat] = { n: 0, done: 0, ok: 0 };
        byCat[q.cat].n++;
        if (Store.answered(q.id)) {
          byCat[q.cat].done++;
          if (Store.isCorrect(q.id) === true) byCat[q.cat].ok++;
        }
      });
      DB.meta.cats.forEach(function (cat) {
        var s = byCat[cat];
        if (!s) return;
        var pct = s.n ? Math.round(s.done / s.n * 100) : 0;
        var rate = s.done ? Math.round(s.ok / s.done * 100) : 0;
        h += '<div style="padding:11px 0;border-bottom:1px solid var(--line)">' +
          '<div style="display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:7px">' +
            '<span>' + esc(cat) + '</span>' +
            '<span style="color:var(--text-3);font-size:12px">' + s.done + '/' + s.n +
              (s.done ? ' · 正确率 ' + rate + '%' : '') + '</span></div>' +
          '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
      });
      h += '</div>';

      // 考试记录
      var exams = Store.data.exams;
      h += '<div class="section-title">考试记录</div>';
      if (!exams.length) {
        h += '<div class="card" style="text-align:center;color:var(--text-3);font-size:13.5px;padding:26px">暂无考试记录</div>';
      } else {
        var scores = exams.map(function (e) { return e.score; });
        var best = Math.max.apply(null, scores);
        var avgS = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
        h += '<div class="card" style="margin-bottom:12px"><div class="kv-grid">' +
          '<div><b>' + exams.length + '</b><span>考试次数</span></div>' +
          '<div><b style="color:var(--ok)">' + best + '</b><span>最高分</span></div>' +
          '<div><b>' + avgS + '</b><span>平均分</span></div></div></div>';
        exams.slice(0, 10).forEach(function (e) {
          h += '<div class="card" style="margin-bottom:9px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;font-size:13px">' +
            '<span style="color:var(--text-2)">' + esc(e.date) + '</span>' +
            '<span><b style="font-size:16px;color:' + (e.score >= 60 ? 'var(--ok)' : 'var(--err)') + '">' + e.score + '</b>' +
            '<span style="color:var(--text-3);font-size:12px"> 分 · ' + e.total + '题</span></span></div>';
        });
      }

      h += '<div style="height:30px"></div>';
      $('s-body').innerHTML = h;
    }
  };

  /* ============================================================
   *  左右滑动切题手势绑定（支持触屏滑动与 PC 鼠标拖拽）
   * ============================================================ */
  function bindSwipeNavigation(containerEl, onNext, onPrev) {
    if (!containerEl) return;
    var startX = 0, startY = 0, startTime = 0;
    var isSwiping = false;

    function handleStart(cx, cy) {
      if ($('card-drawer').classList.contains('open') ||
          $('card-mask').classList.contains('open') ||
          $('modal-mask').classList.contains('open')) {
        isSwiping = false;
        return;
      }
      startX = cx;
      startY = cy;
      startTime = Date.now();
      isSwiping = true;
    }

    function handleMove(cx, cy) {
      if (!isSwiping) return;
      var dx = cx - startX;
      var dy = cy - startY;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
        isSwiping = false;
      }
    }

    function handleEnd(cx, cy) {
      if (!isSwiping) return;
      isSwiping = false;
      var dt = Date.now() - startTime;
      if (dt > 800) return;
      var dx = cx - startX;
      var dy = cy - startY;
      var absX = Math.abs(dx);
      var absY = Math.abs(dy);
      if (absX >= 45 && absX > absY * 1.3) {
        if (dx < 0) {
          if (onNext) onNext();
        } else {
          if (onPrev) onPrev();
        }
      }
    }

    // 触控事件 (移动设备)
    containerEl.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      handleStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    containerEl.addEventListener('touchmove', function (e) {
      if (!isSwiping || e.touches.length !== 1) return;
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    containerEl.addEventListener('touchend', function (e) {
      if (!e.changedTouches || !e.changedTouches.length) return;
      handleEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    }, { passive: true });

    // 鼠标事件 (桌面浏览器预览友好，按住左键左右拖动即可切题)
    containerEl.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      handleStart(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', function (e) {
      if (!isSwiping) return;
      handleMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', function (e) {
      if (!isSwiping) return;
      handleEnd(e.clientX, e.clientY);
    });
  }

  /* ============================================================
   *  每日密码 / 云端控制 (AccessControl)
   * ============================================================ */
  var AccessControl = {
    cfg: null,
    today: function () {
      var d = new Date();
      var m = String(d.getMonth() + 1);
      if (m.length < 2) m = '0' + m;
      var day = String(d.getDate());
      if (day.length < 2) day = '0' + day;
      return d.getFullYear() + '-' + m + '-' + day;
    },
    fetchConfig: function (cb) {
      var urls = [
        'https://cdn.jsdelivr.net/gh/POKMJN/shukong-quiz@main/access_control.json?t=' + Date.now(),
        'https://raw.githubusercontent.com/POKMJN/shukong-quiz/main/access_control.json?t=' + Date.now(),
        'access_control.json?t=' + Date.now()
      ];
      var idx = 0;
      var done = false;
      function tryNext() {
        if (done) return;
        if (idx >= urls.length) {
          done = true;
          var cached = null;
          try { cached = JSON.parse(localStorage.getItem('skq_access_cfg') || 'null'); } catch (e) {}
          cb(cached || { enabled: false });
          return;
        }
        var url = urls[idx++];
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 2500;
        xhr.onload = function () {
          if (done) return;
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              var data = JSON.parse(xhr.responseText);
              done = true;
              try { localStorage.setItem('skq_access_cfg', JSON.stringify(data)); } catch (e) {}
              cb(data);
            } catch (e) {
              tryNext();
            }
          } else {
            tryNext();
          }
        };
        xhr.onerror = function () { if (!done) tryNext(); };
        xhr.ontimeout = function () { if (!done) tryNext(); };
        try { xhr.send(); } catch (e) { tryNext(); }
      }
      tryNext();
    },
    init: function (onReady) {
      var self = this;
      var todayStr = self.today();
      var lockEl = $('lock-screen');
      var cardEl = $('lock-card');
      var inputEl = $('lock-input');
      var btnEl = $('lock-btn');
      var toggleBtn = $('lock-toggle-pwd');
      var noticeEl = $('lock-notice');
      var statusEl = $('lock-status');

      if (!lockEl) {
        if (onReady) onReady();
        return;
      }

      if (toggleBtn && inputEl) {
        toggleBtn.onclick = function () {
          if (inputEl.type === 'password') {
            inputEl.type = 'text';
            toggleBtn.textContent = '🔒';
          } else {
            inputEl.type = 'password';
            toggleBtn.textContent = '👁️';
          }
        };
      }

      self.fetchConfig(function (cfg) {
        self.cfg = cfg || {};
        var isEnabled = !!self.cfg.enabled;
        var requiredPwd = String(self.cfg.password || '').trim();
        var noticeText = self.cfg.notice || '今日学习密码请向指导老师获取';

        if (noticeEl) noticeEl.textContent = noticeText;

        if (!isEnabled || !requiredPwd) {
          lockEl.style.display = 'none';
          if (onReady) onReady();
          return;
        }

        var lastUnlockedDate = localStorage.getItem('skq_unlocked_date');
        var lastUnlockedPwd = localStorage.getItem('skq_unlocked_pwd');
        if (lastUnlockedDate === todayStr && lastUnlockedPwd === requiredPwd) {
          lockEl.style.display = 'none';
          if (onReady) onReady();
          return;
        }

        // 需要输入密码
        lockEl.style.display = 'flex';
        var l = $('loading');
        if (l) {
          l.classList.add('hide');
          setTimeout(function () { l.style.display = 'none'; }, 200);
        }

        function submit() {
          var val = (inputEl.value || '').trim();
          if (!val) {
            statusEl.textContent = '请输入今日密码';
            statusEl.className = 'lock-status';
            shake();
            return;
          }
          if (val === requiredPwd) {
            statusEl.textContent = '验证成功，正在进入...';
            statusEl.className = 'lock-status ok';
            try {
              localStorage.setItem('skq_unlocked_date', todayStr);
              localStorage.setItem('skq_unlocked_pwd', requiredPwd);
            } catch (e) {}
            setTimeout(function () {
              lockEl.classList.add('fade-out');
              setTimeout(function () {
                lockEl.style.display = 'none';
                lockEl.classList.remove('fade-out');
                if (onReady) onReady();
              }, 300);
            }, 250);
          } else {
            statusEl.textContent = '密码错误，请核对后重试';
            statusEl.className = 'lock-status';
            shake();
            inputEl.value = '';
            inputEl.focus();
          }
        }

        function shake() {
          if (cardEl) {
            cardEl.classList.remove('shake');
            void cardEl.offsetWidth;
            cardEl.classList.add('shake');
          }
        }

        if (btnEl) btnEl.onclick = submit;
        if (inputEl) {
          inputEl.onkeydown = function (e) {
            if (e.key === 'Enter') submit();
          };
          setTimeout(function () { inputEl.focus(); }, 300);
        }
      });
    }
  };

  /* ============================================================
   *  启动
   * ============================================================ */
  function boot() {
    if (!window.QBANK) {
      $('loading').innerHTML = '<div style="text-align:center;padding:30px;font-size:14px">题库加载失败</div>';
      return;
    }
    DB = window.QBANK;
    DB.questions.forEach(function (q) { BY_ID[q.id] = q; });
    Store.load();

    // 事件绑定
    $('modal-ok').addEventListener('click', function () {
      var cb = Modal.cb;
      Modal.close();
      if (cb) cb();
    });
    $('modal-cancel').addEventListener('click', function () { Modal.close(); });

    var el = $('e-timer');
    document.addEventListener('click', function (ev) {
      // 考试页答题卡入口：长按顶栏或双击题号区域
    });

    // 考试页支持答题卡：覆盖 ☰ 行为
    var navTitle = document.querySelector('#screen-exam .navbar');
    navTitle.addEventListener('dblclick', function () { Exam.openCard(); });

    // 左右滑动手势绑定：练习页与考试页均支持滑动切题
    bindSwipeNavigation($('screen-practice'),
      function () { Practice.step(1, true); },
      function () { Practice.step(-1, true); }
    );
    bindSwipeNavigation($('screen-exam'),
      function () { Exam.step(1, true); },
      function () { Exam.step(-1, true); }
    );

    ExamSetup.init();
    Home.render();
    Nav.goto('home', true);

    // 每日密码鉴权与加载动画隐藏
    AccessControl.init(function () {
      var l = $('loading');
      if (l) {
        l.classList.add('hide');
        setTimeout(function () { l.style.display = 'none'; }, 320);
      }
    });
  }

  // 暴露给 HTML
  window.Home = Home;
  window.Practice = Practice;
  window.Exam = Exam;
  window.ExamSetup = ExamSetup;
  window.List = List;
  window.Stats = Stats;
  window.Result = Result;
  window.Cards = Cards;
  window.Toast = Toast;
  window.Nav = Nav;
  window.Store = Store;
  window.AccessControl = AccessControl;
  window.Haptic = Haptic;

  // Android 返回键支持
  window.__onBackPressed = function () {
    var lockEl = $('lock-screen');
    var isLocked = lockEl && (lockEl.style.display === 'flex' || (lockEl.style.display !== 'none' && lockEl.offsetWidth > 0));
    if (isLocked) {
      return false;
    }
    return Nav.back();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
