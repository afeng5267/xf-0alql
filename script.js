/* =========================================================
 * 飞行棋 · 人机对战  (HTML5 Canvas + 原生 JS)
 * 玩家(红) vs AI(蓝), 每方 4 架飞机
 * 规则: 掷到6起飞并可再掷 / 撞机 / 己方色格跳4格 / 4子到终点获胜
 * ========================================================= */

'use strict';

/* ---------- 常量: 棋盘几何 (15×15 网格) ---------- */
const GRID = 15;

// 48 格主跑道(环形), 四段格数 13+12+12+11 = 48
// 段0 下边(红方): row=13, col 1..13          -> idx 0..12
// 段1 右边(装饰): col=13, row 12..1          -> idx 13..24
// 段2 上边(蓝方): row=1,  col 12..1          -> idx 25..36
// 段3 左边(装饰): col=1,  row 2..12          -> idx 37..47
const MAIN_TRACK = (() => {
  const t = [];
  for (let c = 1; c <= 13; c++) t.push([c, 13]);            // 0..12
  for (let r = 12; r >= 1; r--) t.push([13, r]);            // 13..24
  for (let c = 12; c >= 1; c--) t.push([c, 1]);             // 25..36
  for (let r = 2; r <= 12; r++) t.push([1, r]);             // 37..47
  return t;
})();

const TRACK_LEN = MAIN_TRACK.length;      // 48
const GOAL_LEN = 6;                        // 终点跑道 6 格(第 6 格为终点)

const CELL = 40;                          // 每格像素(画布逻辑尺寸 600×600)
const CANVAS_SIZE = GRID * CELL;          // 600

const PLAYERS = {
  red: {
    name: '玩家', color: '#e74c3c', dark: '#c0392b', light: '#fdecea', sub: '#f5b7b1',
    start: 0,                             // 起飞点 = MAIN_TRACK[0]
    base: [[0, 12], [0, 13], [0, 14], [1, 14]],        // 4 个停机位
    goal: [[2, 12], [3, 12], [4, 12], [5, 12], [6, 12], [7, 12]], // 终点跑道(坐标)
    isAI: false, emoji: '🚀'
  },
  blue: {
    name: 'AI', color: '#3498db', dark: '#217dbb', light: '#eaf4fd', sub: '#aed6f1',
    start: 25,                            // 起飞点 = MAIN_TRACK[25]
    base: [[13, 0], [14, 0], [14, 1], [14, 2]],
    goal: [[12, 0], [11, 0], [10, 0], [9, 0], [8, 0], [7, 0]],
    isAI: true, emoji: '🛩️'
  }
};

/* ---------- 游戏状态 ---------- */
const state = {
  turn: 'red',
  dice: null,
  rolling: false,
  moving: false,
  gameOver: false,
  extraRoll: false,        // 掷到 6 可再掷
  selectable: [],          // 当前可移动的棋子 id 列表(玩家选择)
  message: '点击「掷骰子」开始游戏',
  pieces: {},              // key: "red0" 等
  winPlayer: null
};

// piece = { id, player, idx(基地位/主跑道位/终点位), status: 'base'|'track'|'goal'|'done', flying(动画中) }
function resetGame() {
  state.turn = 'red';
  state.dice = null;
  state.rolling = false;
  state.moving = false;
  state.gameOver = false;
  state.extraRoll = false;
  state.selectable = [];
  state.winPlayer = null;
  state.pieces = {};
  for (const p of ['red', 'blue']) {
    for (let i = 0; i < 4; i++) {
      state.pieces[p + i] = { id: p + i, player: p, idx: i, status: 'base' };
    }
  }
  setMessage('玩家回合 🎲 点击「掷骰子」');
  updBadge();
}

/* ---------- 工具 ---------- */
const $ = (sel) => document.querySelector(sel);
const canvas = $('#board');
const ctx = canvas.getContext('2d');

function isRedGoalIdx(rel) { return rel % 12 === 3 || rel % 12 === 7; } // 己方色格(跳跃格)

// 将某玩家的"相对轨道位置" rel(0..47) 转为主跑道数组索引
function trackIdxOf(player, rel) {
  return (PLAYERS[player].start + rel) % TRACK_LEN;
}
// 将主跑道索引转回该玩家的相对位置(用于判断终点入口)
function relOf(player, idx) {
  return ((idx - PLAYERS[player].start) % TRACK_LEN + TRACK_LEN) % TRACK_LEN;
}

// 棋子当前位置的棋盘格坐标
function pieceCoord(piece) {
  const P = PLAYERS[piece.player];
  if (piece.status === 'base') {
    return P.base[piece.idx];
  }
  if (piece.status === 'track') {
    return MAIN_TRACK[trackIdxOf(piece.player, piece.idx)];
  }
  if (piece.status === 'goal') {
    return P.goal[piece.idx];
  }
  return null; // done: 到达终点, 不再绘制(或画在终点外)
}

/* ---------- 绘制 ---------- */
function cellCenter([c, r]) {
  return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
}

function drawBoard() {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // 底色
  ctx.fillStyle = '#fdf6e3';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // 网格背景线(装饰)
  ctx.strokeStyle = '#efe6cf';
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, CANVAS_SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(CANVAS_SIZE, i * CELL); ctx.stroke();
  }

  // 主跑道格子
  for (let i = 0; i < TRACK_LEN; i++) {
    const [c, r] = MAIN_TRACK[i];
    // 分段着色: 红段 0..11 / 蓝段 25..36 / 其他装饰段
    let fill = '#f9f0d8';
    let isJump = false;
    if (i < 12) { fill = '#fdecea'; isJump = (i === 3 || i === 7); }
    else if (i >= 25 && i < 37) { fill = '#eaf4fd'; isJump = (i === 28 || i === 32); }
    else if (i >= 12 && i < 24) { fill = '#f1f6e8'; }
    else { fill = '#f0f4e8'; }

    ctx.fillStyle = fill;
    ctx.strokeStyle = '#d5c9a8';
    ctx.lineWidth = 1.5;
    roundRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4, 6);
    ctx.fill();
    ctx.stroke();

    // 跳跃格标记
    if (isJump) {
      ctx.fillStyle = i < 12 ? 'rgba(231,76,60,0.25)' : 'rgba(52,152,219,0.25)';
      roundRect(c * CELL + 3, r * CELL + 3, CELL - 6, CELL - 6, 5);
      ctx.fill();
      const { x, y } = cellCenter([c, r]);
      ctx.fillStyle = i < 12 ? '#c0392b' : '#217dbb';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('★', x, y);
    }
  }

  // 四角区域
  drawCornerBase('red');     // 左下
  drawCornerBase('blue');    // 右上
  drawCornerDeco(0);         // 左上
  drawCornerDeco(1);         // 右下

  // 中心装饰
  drawCenter();

  // 终点跑道
  drawGoal('red');
  drawGoal('blue');

  // 飞机
  drawPieces();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCornerBase(player) {
  const P = PLAYERS[player];
  const [x0, y0] = player === 'red' ? [0, 12] : [12, 0];
  // 基地底色块(3×3 区域)
  ctx.fillStyle = P.light;
  ctx.strokeStyle = P.color;
  ctx.lineWidth = 2.5;
  roundRect(x0 * CELL + 4, y0 * CELL + 4, CELL * 3 - 8, CELL * 3 - 8, 12);
  ctx.fill();
  ctx.stroke();

  // 写玩家名
  ctx.fillStyle = P.dark;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cx = x0 * CELL + CELL * 1.5, cy = y0 * CELL + CELL * 1.5;
  ctx.fillText(player === 'red' ? '玩家' : 'AI', cx, cy - 8);

  // 停机位圆槽
  for (const [c, r] of P.base) {
    const { x, y } = cellCenter([c, r]);
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = P.color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawCornerDeco(kind) {
  // 左上 / 右下 装饰角
  const [x0, y0] = kind === 0 ? [0, 0] : [9, 9];
  ctx.fillStyle = '#f3ead3';
  ctx.strokeStyle = '#e0d3ae';
  ctx.lineWidth = 1.5;
  roundRect(x0 * CELL + 4, y0 * CELL + 4, CELL * 3 - 8, CELL * 3 - 8, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#b8a97f';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('飞行棋', x0 * CELL + CELL * 1.5, y0 * CELL + CELL * 1.5);
}

function drawCenter() {
  const c = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };
  ctx.beginPath();
  ctx.arc(c.x, c.y, 52, 0, Math.PI * 2);
  ctx.fillStyle = '#f5ecd6';
  ctx.fill();
  ctx.strokeStyle = '#d9cba6';
  ctx.lineWidth = 2;
  ctx.stroke();

  const colors = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db'];
  colors.forEach((col, i) => {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(c.x + Math.cos(a) * 26, c.y + Math.sin(a) * 26, 11, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });
}

function drawGoal(player) {
  const P = PLAYERS[player];
  P.goal.forEach(([c, r], i) => {
    ctx.fillStyle = i === GOAL_LEN - 1 ? P.color : P.light;
    ctx.strokeStyle = P.dark;
    ctx.lineWidth = 2;
    roundRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4, 7);
    ctx.fill();
    ctx.stroke();
    if (i === GOAL_LEN - 1) {
      const { x, y } = cellCenter([c, r]);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('终', x, y);
    }
  });
}

function drawPieces() {
  for (const key in state.pieces) {
    const piece = state.pieces[key];
    const coord = pieceCoord(piece);
    if (!coord) continue;
    const P = PLAYERS[piece.player];
    // 如果该棋子可被选择, 加光圈
    const selectable = state.selectable.includes(piece.id) && !state.moving;
    const { x, y } = cellCenter(coord);

    if (selectable) {
      ctx.beginPath();
      ctx.arc(x, y, 19, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245,158,11,0.45)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 19, 0, Math.PI * 2);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 机身
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = P.color;
    ctx.fill();
    ctx.strokeStyle = P.dark;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 高光
    ctx.beginPath();
    ctx.arc(x - 4, y - 5, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();

    // 序号
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(piece.idx + 1), x, y + 0.5);
    ctx.restore();
  }
}

/* ---------- 动画: 飞机沿格子平滑移动 ---------- */
const animPx = { active: false, piece: null, pathPx: [], step: 0, timer: 0, onDone: null, finalCoord: null };

function startPxAnimation(piece, pathPx, isStepMove, cb, finalCoord) {
  state.moving = true;
  animPx.active = true;
  animPx.piece = piece;
  animPx.pathPx = pathPx;
  animPx.step = 0;
  animPx.timer = 0;
  animPx.onDone = cb;
  animPx.finalCoord = finalCoord;
}

function tickPxAnimation(dt) {
  if (!animPx.active) return;
  const interval = 0.055; // 像素段间隔(秒)
  animPx.timer += dt;
  while (animPx.timer >= interval) {
    animPx.timer -= interval;
    animPx.step++;
    if (animPx.step >= animPx.pathPx.length) {
      animPx.active = false;
      state.moving = false;
      const pc = animPx.piece;
      const cb = animPx.onDone;
      animPx.piece = null; animPx.pathPx = []; animPx.onDone = null;
      drawBoard();
      if (cb) cb(pc);
      return;
    }
    drawBoard();
  }
}

/* RAF 主循环 */
let lastTs = 0;
function rafLoop(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.1);
  lastTs = ts;
  tickPxAnimation(dt);
  requestAnimationFrame(rafLoop);
}
requestAnimationFrame(rafLoop);

/* ---------- 骰子 & 移动逻辑 ---------- */
function rollDice() {
  state.dice = 1 + Math.floor(Math.random() * 6);
  const diceEl = $('#dice');
  diceEl.textContent = state.dice;
  diceEl.classList.remove('rolling');
  void diceEl.offsetWidth; // 重启动画
  diceEl.classList.add('rolling');
  soundDice();
  return state.dice;
}

function pieceCount(player) {
  const n = PLAYERS[player].name;
  let base = 0, track = 0, goal = 0, done = 0;
  for (let i = 0; i < 4; i++) {
    const s = state.pieces[player + i].status;
    if (s === 'base') base++;
    else if (s === 'track') track++;
    else if (s === 'goal') goal++;
    else done++;
  }
  return { base, track, goal, done };
}

// 计算某棋子掷 dice 后能否走, 返回走法类型或 null
function moveTypeOf(piece, dice) {
  const s = piece.status;
  if (s === 'done') return null;
  if (s === 'base') {
    return dice === 6 ? 'launch' : null;
  }
  if (s === 'track') {
    const newRel = piece.idx + dice;
    if (newRel <= TRACK_LEN - 1) return 'track';            // 还在主跑道
    if (newRel <= TRACK_LEN - 1 + GOAL_LEN) return 'track-goal'; // 进入终点
    return null;                                            // 超过终点, 不能走
  }
  if (s === 'goal') {
    const newIdx = piece.idx + dice;
    if (newIdx <= GOAL_LEN - 1) return 'goal';              // 终点内前进
    return null;                                            // 超过终点
  }
  return null;
}

function canMoveList(player, dice) {
  const list = [];
  for (let i = 0; i < 4; i++) {
    const piece = state.pieces[player + i];
    const t = moveTypeOf(piece, dice);
    if (t) list.push({ piece, type: t });
  }
  return list;
}

/* ---------- 执行一次走子(含动画) ---------- */
function runMove(player, dice, piece, type, done) {
  const P = PLAYERS[player];
  const fromCoord = pieceCoord(piece);

  // 计算路径(主跑道格坐标序列 + 终点坐标)
  const path = [];       // 依次经过的格子坐标(含起点)
  path.push(fromCoord);

  // 1) 基础移动
  if (type === 'launch') {
    piece.idx = 0;
    piece.status = 'track';
    path.push(MAIN_TRACK[trackIdxOf(player, 0)]);
  } else if (type === 'track') {
    piece.idx += dice;
    path.push(MAIN_TRACK[trackIdxOf(player, piece.idx)]);
  } else if (type === 'track-goal') {
    const goalPos = piece.idx + dice - TRACK_LEN;
    piece.idx = goalPos;
    piece.status = goalPos === GOAL_LEN - 1 ? 'done' : 'goal';
    if (piece.status === 'goal') path.push(P.goal[goalPos]);
    else path.push(P.goal[GOAL_LEN - 1]);
  } else if (type === 'goal') {
    piece.idx += dice;
    if (piece.idx >= GOAL_LEN - 1) { piece.idx = GOAL_LEN - 1; piece.status = 'done'; }
    path.push(P.goal[piece.idx]);
  }

  // 2) 落地检查: 撞机 (仅主跑道, 且目标未进终点)
  let bumpedPiece = null;
  if (piece.status === 'track') {
    const idx = trackIdxOf(player, piece.idx);
    for (const opp of ['red', 'blue']) {
      if (opp === player) continue;
      for (let i = 0; i < 4; i++) {
        const op = state.pieces[opp + i];
        if (op.status === 'track' && trackIdxOf(opp, op.idx) === idx) {
          bumpedPiece = op;
          op.status = 'base';
          op.idx = i;
          break;
        }
      }
    }
  }

  // 3) 跳跃检查 (己方色格, 在主跑道上)
  let jumped = false;
  if (piece.status === 'track' && isRedGoalIdx(piece.idx)) {
    // 跳 4 格
    const jumpTo = piece.idx + 4;
    if (jumpTo <= TRACK_LEN - 1) {
      piece.idx = jumpTo;
      path.push(MAIN_TRACK[trackIdxOf(player, piece.idx)]);
    } else {
      const goalPos = jumpTo - TRACK_LEN;
      piece.idx = goalPos;
      piece.status = goalPos === GOAL_LEN - 1 ? 'done' : 'goal';
      path.push(P.goal[Math.min(goalPos, GOAL_LEN - 1)]);
    }
    jumped = true;
    // 跳跃落点再检查撞机
    if (piece.status === 'track') {
      const idx = trackIdxOf(player, piece.idx);
      for (const opp of ['red', 'blue']) {
        if (opp === player) continue;
        for (let i = 0; i < 4; i++) {
          const op = state.pieces[opp + i];
          if (op.status === 'track' && trackIdxOf(opp, op.idx) === idx) {
            bumpedPiece = op;
            op.status = 'base';
            op.idx = i;
            break;
          }
        }
      }
    }
  }

  // 构造动画路径(像素级)
  const pxPath = [];
  for (let i = 0; i < path.length; i++) {
    const pt = cellCenter(path[i]);
    if (i === 0) pxPath.push(pt);
    else {
      const prev = cellCenter(path[i - 1]);
      // 插值出中间点, 看起来是连续移动
      const steps = 2;
      for (let s = 1; s <= steps; s++) {
        pxPath.push({
          x: prev.x + (pt.x - prev.x) * (s / steps),
          y: prev.y + (pt.y - prev.y) * (s / steps)
        });
      }
    }
  }

  const doEnd = () => {
    if (bumpedPiece) {
      soundBump();
      setMessage(`💥 ${PLAYERS[bumpedPiece.player].name}的飞机被撞回基地!`);
      // 被撞飞机简单弹一下(不单独动画, 直接重绘)
      drawBoard();
      setTimeout(() => finishMove(player, dice, piece, jumped, done), 350);
    } else if (jumped) {
      soundJump();
      setMessage(`🦘 跳到己方颜色格, 前进 4 格!`);
      drawBoard();
      setTimeout(() => finishMove(player, dice, piece, jumped, done), 350);
    } else {
      finishMove(player, dice, piece, jumped, done);
    }
  };

  startPxAnimation(piece, pxPath, true, doEnd);
}

function finishMove(player, dice, piece, jumped, done) {
  drawBoard();
  done(player, piece, jumped);
}

/* ---------- 回合结算 ---------- */
function endMove(player, dice, piece, jumped) {
  // 胜利判断
  if (pieceCount(player).done === 4) {
    state.gameOver = true;
    state.winPlayer = player;
    soundWin();
    drawBoard();
    showWin(player);
    return;
  }
  // 掷到 6 可再掷一次(未用过额外机会)
  if (dice === 6 && !state.extraRoll) {
    state.extraRoll = true;
    setMessage(`${PLAYERS[player].name} 掷到 6 🎯 再掷一次!`);
    setTimeout(() => beginPlayerRoll(player), 600);
    return;
  }
  // 切换回合
  switchTurn();
}

function switchTurn() {
  state.extraRoll = false;
  state.selectable = [];
  if (state.turn === 'red') {
    state.turn = 'blue';
    setMessage('AI 回合 🤖 思考中…');
    updBadge();
    setTimeout(() => aiTurn(), 800);
  } else {
    state.turn = 'red';
    setMessage('玩家回合 🎲 点击「掷骰子」');
    updBadge();
  }
  drawBoard();
}

/* ---------- 玩家回合 ---------- */
function beginPlayerRoll(player) {
  if (state.gameOver) return;
  state.rolling = true;
  $('#rollBtn').disabled = true;
  const dice = rollDice();
  const list = canMoveList(player, dice);

  if (list.length === 0) {
    setMessage(`掷出 ${dice} 😕 没有棋子可走。`);
    setTimeout(() => finishNoMove(player, dice), 800);
    return;
  }
  if (list.length === 1) {
    const { piece, type } = list[0];
    setMessage(`掷出 ${dice} — 自动走子。`);
    updBadge();
    setTimeout(() => {
      state.selectable = [];
      runMove(player, dice, piece, type, endMove);
    }, 500);
    return;
  }
  // 多个可走: 玩家选择
  state.selectable = list.map(x => x.piece.id);
  setMessage(`掷出 ${dice} 👆 点击要移动的飞机。`);
  drawBoard();
}

function finishNoMove(player, dice) {
  if (dice === 6 && !state.extraRoll) {
    state.extraRoll = true;
    setMessage('掷到 6 🎯 但没有棋子可走, 再掷一次。');
    setTimeout(() => beginPlayerRoll(player), 800);
    return;
  }
  switchTurn();
}

/* 玩家点击棋盘选择棋子 */
canvas.addEventListener('click', (e) => {
  if (state.gameOver || state.moving || state.rolling) return;
  if (state.turn !== 'red' || state.selectable.length === 0) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_SIZE / rect.width;
  const scaleY = CANVAS_SIZE / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;

  for (const id of state.selectable) {
    const piece = state.pieces[id];
    const coord = pieceCoord(piece);
    if (!coord) continue;
    const pt = cellCenter(coord);
    const dist = Math.hypot(mx - pt.x, my - pt.y);
    if (dist < 21) {
      state.selectable = [];
      const dice = state.dice;
      const type = moveTypeOf(piece, dice);
      if (type) runMove('red', dice, piece, type, endMove);
      return;
    }
  }
});

/* ---------- AI 回合 ---------- */
function aiTurn() {
  if (state.gameOver) return;
  state.rolling = true;
  updBadge();
  setTimeout(() => {
    const dice = rollDice();
    const list = canMoveList('blue', dice);
    if (list.length === 0) {
      setMessage(`AI 掷出 ${dice} 🤖 没有棋子可走。`);
      setTimeout(() => finishNoMove('blue', dice), 800);
      return;
    }
    // 简单启发式选子
    const chosen = chooseAIMove(list, dice);
    setMessage(`AI 掷出 ${dice} 🤖 走子中…`);
    setTimeout(() => {
      runMove('blue', dice, chosen.piece, chosen.type, endMove);
    }, 600);
  }, 900);
}

function chooseAIMove(list, dice) {
  let best = null, bestScore = -Infinity;
  for (const mv of list) {
    let score = 0;
    const piece = mv.piece;
    // 起飞
    if (mv.type === 'launch') score += 30;
    // 到达终点
    if (mv.type === 'track-goal' && piece.idx + dice - TRACK_LEN === GOAL_LEN - 1) score += 120;
    // 进入终点
    if (mv.type === 'track-goal') score += 60;
    // 前进越远越好
    if (mv.type === 'track') score += piece.idx + dice;
    if (mv.type === 'goal') score += piece.idx + dice + 50;
    // 能否撞机
    if (wouldBump(piece, dice)) score += 100;
    // 能否跳跃
    if (wouldJump(piece, dice)) score += 40;
    // 基地里子越多, 越倾向起飞
    if (mv.type === 'launch') score += pieceCount('blue').base * 5;
    if (score > bestScore) { bestScore = score; best = mv; }
  }
  return best || list[Math.floor(Math.random() * list.length)];
}

function wouldBump(piece, dice) {
  if (piece.status !== 'track' && piece.status !== 'base') return false;
  let rel;
  if (piece.status === 'base') {
    if (dice !== 6) return false;
    rel = 0;
  } else {
    const nr = piece.idx + dice;
    if (nr > TRACK_LEN - 1) return false;
    rel = nr;
  }
  const idx = trackIdxOf(piece.player, rel);
  const opp = piece.player === 'red' ? 'blue' : 'red';
  for (let i = 0; i < 4; i++) {
    const op = state.pieces[opp + i];
    if (op.status === 'track' && trackIdxOf(opp, op.idx) === idx) return true;
  }
  return false;
}

function wouldJump(piece, dice) {
  if (piece.status !== 'track') return false;
  const nr = piece.idx + dice;
  if (nr > TRACK_LEN - 1) return false;
  return isRedGoalIdx(nr);
}

/* ---------- 音效 (Web Audio) ---------- */
let audioCtx = null;
function ac() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(freq, dur, type = 'triangle', gain = 0.12, when = 0) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type; o.frequency.value = freq;
  const t0 = c.currentTime + when;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function soundDice() { tone(220, 0.06, 'square', 0.08); tone(330, 0.06, 'square', 0.08, 0.07); }
function soundTick() { tone(660, 0.04, 'sine', 0.05); }
function soundJump() { tone(520, 0.1); tone(780, 0.1, 'triangle', 0.1, 0.09); }
function soundBump() { tone(140, 0.16, 'sawtooth', 0.14); tone(90, 0.2, 'sawtooth', 0.1, 0.08); }
function soundWin() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.13));
}

/* ---------- UI ---------- */
function setMessage(msg) {
  state.message = msg;
  const box = $('#statusBox');
  box.innerHTML = msg.replace(/玩家/g, '<span class="red">玩家</span>')
                     .replace(/AI/g, '<span class="blue">AI</span>');
}
function updBadge() {
  const b = $('#turnBadge');
  if (state.gameOver) {
    b.textContent = '游戏结束';
    b.className = 'turn-badge';
  } else if (state.turn === 'red') {
    b.textContent = '🔴 玩家回合';
    b.className = 'turn-badge red-turn';
  } else {
    b.textContent = '🔵 AI 回合';
    b.className = 'turn-badge blue-turn';
  }
}
function showWin(player) {
  const win = player === 'red';
  $('#winTitle').textContent = win ? '🎉 你赢了!' : '🤖 AI 获胜';
  $('#winMsg').textContent = win ? '太棒了, 四架飞机全部到达终点!' : '再接再厉, 再挑战一局吧!';
  $('#overlay').hidden = false;
  updBadge();
}

/* ---------- 事件绑定 ---------- */
$('#rollBtn').addEventListener('click', () => {
  if (state.gameOver || state.moving || state.rolling) return;
  if (state.turn === 'red') beginPlayerRoll('red');
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    $('#rollBtn').click();
  }
});
const restart = () => { $('#overlay').hidden = true; resetGame(); drawBoard(); };
$('#restartBtn').addEventListener('click', restart);
$('#againBtn').addEventListener('click', restart);

/* ---------- 启动 ---------- */
resetGame();
drawBoard();
