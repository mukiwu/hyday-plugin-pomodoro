'use strict';

const DEFAULT_DATA = {
  workMinutes: 25,
  breakMinutes: 5,
  completedToday: 0,
  lastDate: null,
};

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
  }

  async onload() {
    await this._loadData();
    this._resetTodayIfNeeded();
    this._remaining = this._data.workMinutes * 60;

    this._handles.push(
      this.app.ui.addStatusBarItem({
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
      }),
    );
  }

  async onunload() {
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    for (const h of this._handles) {
      try {
        h.dispose();
      } catch (e) {
        void e;
      }
    }
    this._handles = [];
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

  _pause() {
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    if (this._render) this._render();
  }

  _reset() {
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
      this.app.ui.showNotice('專心時段結束！休息一下', { type: 'success' });
      this._mode = 'break';
      this._remaining = this._data.breakMinutes * 60;
    } else if (this._mode === 'break') {
      this.app.ui.showNotice('休息結束，下一輪開始', { type: 'info' });
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
    };
    this._render();

    return () => {
      // Keep timer state alive across popover close — just stop rendering.
      this._render = null;
    };
  }
}

module.exports = PomodoroPlugin;
