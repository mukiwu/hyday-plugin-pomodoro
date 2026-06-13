'use strict';

const DEFAULT_DATA = {
  workMinutes: 25,
  breakMinutes: 5,
  completedToday: 0,
  lastDate: null,
  // 提示音循環播放直到使用者手動關閉（而不是響一下就停）。
  keepRingingUntilDismissed: false,
  // 計時結束時把 Hyday 視窗強制帶到最前景並聚焦。
  focusWindowOnEnd: false,
};

// 循環響鈴時，兩響之間的間隔（毫秒）。
const RING_INTERVAL_MS = 1500;

class PomodoroPlugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this._handles = [];
    this._data = { ...DEFAULT_DATA };
    this._mode = 'idle';
    this._remaining = 0;
    this._timerId = null;
    this._render = null;
    this._audioCtx = null;
    // 循環響鈴的計時器；非 null 代表正在持續響鈴、等待使用者關閉。
    this._ringIntervalId = null;
    // addStatusBarItem 的 handle，用來在面板關著時把它叫開（露出停止響鈴鈕）。
    this._statusBarItem = null;
  }

  async onload() {
    await this._loadData();
    this._resetTodayIfNeeded();
    this._remaining = this._data.workMinutes * 60;

    this._statusBarItem = this.app.ui.addStatusBarItem({
      id: 'pomodoro',
      label: 'Pomodoro',
      icon: 'timer',
      position: 'navBar',
      order: 5,
      badge: () => (this._mode === 'idle' ? undefined : 1),
      panel: {
        width: 280,
        maxHeight: 360,
        mount: (container, close) => this._mount(container, close),
      },
    });
    this._handles.push(this._statusBarItem);
  }

  async onunload() {
    this._stopRinging();
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    if (this._audioCtx) {
      try { void this._audioCtx.close(); } catch (e) { void e; }
      this._audioCtx = null;
    }
    for (const h of this._handles) {
      try {
        h.dispose();
      } catch (e) {
        void e;
      }
    }
    this._handles = [];
    this._statusBarItem = null;
  }

  async _loadData() {
    const stored = await this.app.storage.load();
    if (stored && typeof stored === 'object') {
      this._data = { ...DEFAULT_DATA, ...stored };
    }
  }

  async _saveData() {
    await this.app.storage.save(this._data);
  }

  _resetTodayIfNeeded() {
    const today = new Date().toISOString().slice(0, 10);
    if (this._data.lastDate !== today) {
      this._data.completedToday = 0;
      this._data.lastDate = today;
    }
  }

  _format(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return m + ':' + s;
  }

  _start() {
    // _start runs in a user-gesture context (button click), the only safe
    // place to: (1) unlock AudioContext for later beep, (2) request
    // Notification permission without surprising the user.
    this._unlockAudio();
    this._requestNotificationPermission();
    // Starting the next phase is an explicit acknowledgement — kill any ringing.
    this._stopRinging();

    if (!this._timerId && this._mode === 'idle') {
      this._mode = 'work';
      this._remaining = this._data.workMinutes * 60;
    }
    if (this._timerId) clearInterval(this._timerId);
    this._timerId = setInterval(() => {
      this._remaining -= 1;
      if (this._remaining <= 0) {
        this._onPhaseEnd();
      }
      if (this._render) this._render();
    }, 1000);
    if (this._render) this._render();
  }

  _unlockAudio() {
    if (this._audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this._audioCtx = new Ctx();
      // Some browsers create the context in 'suspended'; resume needs gesture.
      if (this._audioCtx.state === 'suspended') {
        void this._audioCtx.resume();
      }
    } catch (e) {
      void e;
    }
  }

  _requestNotificationPermission() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      try {
        void Notification.requestPermission();
      } catch (e) {
        void e;
      }
    }
  }

  _playBeep(highPitch) {
    if (!this._audioCtx) return;
    try {
      const ctx = this._audioCtx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = highPitch ? 1000 : 800;
      // 比舊版更響、更長：音量 0.6（原 0.25）、持續 ~0.9s（原 0.45s）。
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.6, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.9);
    } catch (e) {
      void e;
    }
  }

  // 一次完整的「叮咚」提示：低音 + 高音兩響，比單響更明顯。
  _playChime() {
    this._playBeep(false);
    setTimeout(() => this._playBeep(true), 260);
  }

  // 開始循環響鈴，直到 _stopRinging() 被呼叫。多次呼叫不會疊加。
  _startRinging() {
    this._stopRinging();
    this._playChime();
    this._ringIntervalId = setInterval(() => this._playChime(), RING_INTERVAL_MS);
    // 「停止響鈴」鈕只畫在面板裡。持續響鈴常發生在使用者不在桌前、面板關著時，
    // 只要開始循環響鈴就把面板展開，讓停止鈕看得到也按得到——
    // 跟「叫到最前面」(focusWindowOnEnd) 解耦，否則只開響鈴沒開聚焦時會找不到停止鈕。
    this._openPanel();
  }

  // 把番茄鐘面板（status bar popover）叫開。面板關著時才有意義；handle 沒接好就靜默略過。
  _openPanel() {
    try {
      if (this._statusBarItem && typeof this._statusBarItem.openPanel === 'function') {
        this._statusBarItem.openPanel();
      }
    } catch (e) {
      void e;
    }
  }

  // 停止循環響鈴。任何使用者操作（開始下一階段／暫停／重置／點面板）都會走到這。
  _stopRinging() {
    if (this._ringIntervalId) {
      clearInterval(this._ringIntervalId);
      this._ringIntervalId = null;
    }
  }

  _sendNativeNotification(title, body) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, {
        body,
        silent: true, // we play our own beep
      });
      // Auto-close after 10s in case OS doesn't.
      setTimeout(() => {
        try { n.close(); } catch (e) { void e; }
      }, 10000);
    } catch (e) {
      void e;
    }
  }

  // 把 Hyday 主視窗帶到最前景並聚焦（時間到時可選自動跳前台）。
  _focusAppWindow() {
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (api && typeof api.focusWindow === 'function') {
        void api.focusWindow();
      }
    } catch (e) {
      void e;
    }
  }

  _notify(title, body, type) {
    // 1) In-app toast — sticky so the user sees it after returning from another app
    this.app.ui.showNotice(title + ' — ' + body, { type, duration: 0 });
    // 2) System native notification — visible even when Hyday isn't focused
    this._sendNativeNotification(title, body);
    // 3) Audible alert — either a single chime, or a loop until the user dismisses it.
    if (this._data.keepRingingUntilDismissed) {
      this._startRinging();
    } else {
      this._playChime();
    }
    // 4) Optionally yank the app window to the foreground so the user can't miss it.
    if (this._data.focusWindowOnEnd) {
      this._focusAppWindow();
    }
  }

  _pause() {
    this._stopRinging();
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    if (this._render) this._render();
  }

  _reset() {
    this._stopRinging();
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    this._mode = 'idle';
    this._remaining = this._data.workMinutes * 60;
    if (this._render) this._render();
  }

  _onPhaseEnd() {
    if (this._timerId) clearInterval(this._timerId);
    this._timerId = null;
    if (this._mode === 'work') {
      this._resetTodayIfNeeded();
      this._data.completedToday = (this._data.completedToday || 0) + 1;
      void this._saveData();
      this._notify('Pomodoro 完成', '專心時段結束！休息 ' + this._data.breakMinutes + ' 分鐘。', 'success');
      this._mode = 'break';
      this._remaining = this._data.breakMinutes * 60;
    } else if (this._mode === 'break') {
      this._notify('休息結束', '回到工作，下一輪開始。', 'info');
      this._mode = 'work';
      this._remaining = this._data.workMinutes * 60;
    }
  }

  _mount(container, _close) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.gap = '14px';
    container.style.padding = '20px 16px';

    const phaseEl = document.createElement('div');
    phaseEl.style.fontFamily = 'monospace';
    phaseEl.style.fontSize = '13px';
    phaseEl.style.textTransform = 'uppercase';
    phaseEl.style.letterSpacing = '0.1em';
    phaseEl.style.color = 'var(--foreground-muted, #6b7280)';
    container.appendChild(phaseEl);

    const timerEl = document.createElement('div');
    timerEl.style.fontFamily = 'monospace';
    timerEl.style.fontSize = '56px';
    timerEl.style.fontWeight = '600';
    timerEl.style.color = 'var(--foreground, #111827)';
    timerEl.style.lineHeight = '1';
    container.appendChild(timerEl);

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';
    container.appendChild(buttons);

    const makeBtn = (label, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.padding = '6px 14px';
      b.style.fontSize = '13px';
      b.style.borderRadius = '6px';
      b.style.cursor = 'pointer';
      if (primary) {
        b.style.background = 'var(--foreground, #111827)';
        b.style.color = 'var(--background, white)';
        b.style.border = '1px solid transparent';
      } else {
        b.style.background = 'transparent';
        b.style.color = 'var(--foreground, #111827)';
        b.style.border = '1px solid var(--border, #d1d5db)';
      }
      return b;
    };

    const startBtn = makeBtn('開始', true);
    const pauseBtn = makeBtn('暫停', false);
    const resetBtn = makeBtn('重置', false);
    buttons.appendChild(startBtn);
    buttons.appendChild(pauseBtn);
    buttons.appendChild(resetBtn);
    startBtn.addEventListener('click', () => this._start());
    pauseBtn.addEventListener('click', () => this._pause());
    resetBtn.addEventListener('click', () => this._reset());

    // 循環響鈴時才出現的「停止響鈴」按鈕，給使用者一個明確的關閉入口。
    const stopRingBtn = makeBtn('停止響鈴', true);
    stopRingBtn.style.display = 'none';
    container.appendChild(stopRingBtn);
    stopRingBtn.addEventListener('click', () => {
      this._stopRinging();
      if (this._render) this._render();
    });

    const stats = document.createElement('div');
    stats.style.fontSize = '13px';
    stats.style.color = 'var(--foreground-muted, #6b7280)';
    container.appendChild(stats);

    const divider = document.createElement('div');
    divider.style.width = '100%';
    divider.style.height = '1px';
    divider.style.background = 'var(--border-subtle, #e5e7eb)';
    divider.style.margin = '4px 0';
    container.appendChild(divider);

    const settings = document.createElement('div');
    settings.style.display = 'flex';
    settings.style.gap = '12px';
    settings.style.fontSize = '13px';
    settings.style.color = 'var(--foreground-muted, #6b7280)';
    container.appendChild(settings);

    const makeNumberInput = (label, key, min, max) => {
      const wrap = document.createElement('label');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '4px';
      const lab = document.createElement('span');
      lab.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.value = String(this._data[key]);
      input.style.width = '64px';
      input.style.padding = '4px 6px';
      input.style.fontSize = '13px';
      input.style.borderRadius = '6px';
      input.style.border = '1px solid var(--border, #d1d5db)';
      input.style.background = 'var(--background, white)';
      input.style.color = 'var(--foreground, #111827)';
      input.style.outline = 'none';
      input.addEventListener('change', () => {
        const next = Math.max(min, Math.min(max, Number(input.value) || min));
        this._data[key] = next;
        void this._saveData();
        if (this._mode === 'idle') {
          this._remaining = this._data.workMinutes * 60;
        }
        if (this._render) this._render();
      });
      wrap.appendChild(lab);
      wrap.appendChild(input);
      return wrap;
    };

    settings.appendChild(makeNumberInput('專心 (分)', 'workMinutes', 1, 120));
    settings.appendChild(makeNumberInput('休息 (分)', 'breakMinutes', 1, 60));

    const options = document.createElement('div');
    options.style.display = 'flex';
    options.style.flexDirection = 'column';
    options.style.gap = '8px';
    options.style.width = '100%';
    options.style.fontSize = '13px';
    options.style.color = 'var(--foreground-muted, #6b7280)';
    container.appendChild(options);

    const makeCheckbox = (label, key) => {
      const wrap = document.createElement('label');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '8px';
      wrap.style.cursor = 'pointer';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!this._data[key];
      input.style.cursor = 'pointer';
      input.style.outline = 'none';
      input.addEventListener('change', () => {
        this._data[key] = input.checked;
        void this._saveData();
      });
      const lab = document.createElement('span');
      lab.textContent = label;
      wrap.appendChild(input);
      wrap.appendChild(lab);
      return wrap;
    };

    options.appendChild(makeCheckbox('提示音持續到手動關閉', 'keepRingingUntilDismissed'));
    options.appendChild(makeCheckbox('時間到時把視窗叫到最前面', 'focusWindowOnEnd'));

    this._render = () => {
      phaseEl.textContent =
        this._mode === 'idle' ? 'Ready' : this._mode === 'work' ? 'Focus' : 'Break';
      timerEl.textContent = this._format(Math.max(0, this._remaining));
      stats.textContent = '今日已完成 ' + (this._data.completedToday || 0) + ' 顆番茄';
      const running = !!this._timerId;
      startBtn.textContent = running ? '進行中…' : this._mode === 'idle' ? '開始' : '繼續';
      startBtn.disabled = running;
      startBtn.style.opacity = running ? '0.6' : '1';
      pauseBtn.disabled = !running;
      pauseBtn.style.opacity = running ? '1' : '0.5';
      stopRingBtn.style.display = this._ringIntervalId ? 'block' : 'none';
    };
    this._render();

    return () => {
      // Keep timer state alive across popover close — just stop rendering.
      this._render = null;
    };
  }
}

module.exports = PomodoroPlugin;
