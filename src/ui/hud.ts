import type { GameEngine } from "../game/engine.js";
import type { GuessResult, Scored } from "../game/types.js";
import type { GuessPresenter } from "../viz/presenter.js";
import type { SoundKit } from "../audio/sound.js";
import { recordRun } from "../game/leaderboard.js";
import { LeaderboardPanel } from "./leaderboard.js";

export interface Choice {
  id: string;
  label: string;
}

export interface HUDOptions {
  engine: GameEngine;
  presenter: GuessPresenter;
  sound: SoundKit;
  bodies: Choice[];
  currentBody: string;
  setBody: (id: string) => void;
  mechanics: Choice[];
  currentMechanic: string;
  setMechanic: (id: string) => void;
  /** Open the in-character onboarding "briefing" modal. */
  showGuide: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

const fmt = (n: number, dp = 2) => n.toFixed(dp);

/** Builds and drives the game HUD. */
export class HUD {
  private readonly o: HUDOptions;
  private presenter: GuessPresenter;

  private input!: HTMLInputElement;
  private submitBtn!: HTMLButtonElement;
  private hintBtn!: HTMLButtonElement;
  private revealBtn!: HTMLButtonElement;
  private newBtn!: HTMLButtonElement;
  private bankEl!: HTMLElement;
  private bestEl!: HTMLElement;
  private guessesEl!: HTMLElement;
  private hintsEl!: HTMLElement;
  private resultEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private soundBtn!: HTMLButtonElement;
  private briefingBtn!: HTMLButtonElement;
  private controlsEl!: HTMLElement;
  private bodySel!: HTMLElement;
  private mechSel!: HTMLElement;
  private leaderboard = new LeaderboardPanel();

  private busy = false;
  private resetting = false;
  private toastTimer = 0;

  constructor(options: HUDOptions) {
    this.o = options;
    this.presenter = options.presenter;
  }

  mount(root: HTMLElement) {
    root.replaceChildren();

    const topbar = el("div", "topbar");
    const brand = el("div", "brand", `<h1>Semantic Roulette</h1><small>guess by meaning</small>`);

    const right = el("div", "topbar-right");
    this.briefingBtn = el("button", "pill-btn briefing-btn") as HTMLButtonElement;
    this.briefingBtn.type = "button";
    this.briefingBtn.title = "How to play";
    this.briefingBtn.textContent = "Briefing";
    this.briefingBtn.onclick = () => this.o.showGuide();
    this.soundBtn = el("button", "icon-btn");
    this.soundBtn.title = "Toggle sound";
    this.soundBtn.textContent = "♪";
    this.soundBtn.onclick = () => this.toggleSound();

    const bank = el("div", "stat");
    this.bankEl = el("b", undefined, String(this.o.engine.bank));
    bank.append(this.bankEl, el("span", undefined, "score"));
    const best = el("div", "stat");
    this.bestEl = el("b", undefined, "—");
    best.append(this.bestEl, el("span", undefined, "best"));

    right.append(this.briefingBtn, this.soundBtn, best, bank);
    topbar.append(brand, right);

    // Left column: guesses. Right column: hints + leaderboard.
    this.guessesEl = el("div", "guesses");
    const rightCol = el("div", "rightcol");
    this.hintsEl = el("div", "hints-list");
    rightCol.append(this.hintsEl, this.leaderboard.el);

    this.resultEl = el("div", "result");
    this.toastEl = el("div", "toast");
    this.bannerEl = el("div", "banner");

    const spacer = el("div", "hud-spacer");
    const playarea = el("div", "playarea");
    const form = el("form", "guess-form");
    this.input = el("input", "guess-input") as HTMLInputElement;
    this.input.type = "text";
    this.input.placeholder = "type a word…";
    this.input.autocomplete = "off";
    this.input.autocapitalize = "off";
    this.input.spellcheck = false;
    this.submitBtn = el("button", "pill-btn accent") as HTMLButtonElement;
    this.submitBtn.type = "submit";
    this.submitBtn.textContent = "Guess";
    form.append(this.input, this.submitBtn);
    form.onsubmit = (e) => { e.preventDefault(); void this.onSubmit(); };

    const controls = el("div", "controls");
    this.hintBtn = el("button", "pill-btn") as HTMLButtonElement;
    this.hintBtn.textContent = `Hint (${this.o.engine.hintsRemaining})`;
    this.hintBtn.onclick = () => void this.onHint();
    this.revealBtn = el("button", "pill-btn") as HTMLButtonElement;
    this.revealBtn.textContent = "Give up";
    this.revealBtn.onclick = () => this.onReveal();
    this.newBtn = el("button", "pill-btn") as HTMLButtonElement;
    this.newBtn.textContent = "New word";
    this.newBtn.onclick = () => void this.onNewGame();
    controls.append(this.hintBtn, this.revealBtn, this.newBtn);
    playarea.append(form, controls);
    // Bottom-left dock: deep-space body + reveal-mechanic selectors.
    this.controlsEl = el("div", "scene-controls");
    this.bodySel = this.segmented("Body", this.o.bodies, this.o.currentBody, (id) => {
      if (this.busy) return false;
      this.o.setBody(id);
      return true;
    });
    this.mechSel = this.segmented("Reveal", this.o.mechanics, this.o.currentMechanic, (id) => {
      if (this.busy) return false;
      this.o.setMechanic(id);
      return true;
    });
    this.controlsEl.append(this.bodySel, this.mechSel);

    root.append(topbar, this.guessesEl, rightCol, this.controlsEl, this.resultEl, this.toastEl, spacer, playarea, this.bannerEl);
    this.input.focus();
  }

  /** A small labelled segmented control. `onPick` may return false to reject. */
  private segmented(title: string, choices: Choice[], current: string, onPick: (id: string) => boolean | void): HTMLElement {
    const wrap = el("div", "segmented");
    wrap.append(el("span", "seg-title", title));
    const row = el("div", "seg-row");
    let active = current;
    for (const c of choices) {
      const b = el("button", "seg-btn") as HTMLButtonElement;
      b.textContent = c.label;
      b.dataset.id = c.id;
      b.setAttribute("aria-pressed", String(c.id === active));
      b.onclick = () => {
        if (onPick(c.id) === false) return;
        active = c.id;
        row.querySelectorAll(".seg-btn").forEach((x) =>
          x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.id === active)));
      };
      row.appendChild(b);
    }
    wrap.appendChild(row);
    return wrap;
  }

  // ---- actions -------------------------------------------------------------

  private async onSubmit() {
    if (this.busy) return;
    const pre = this.o.engine.precheck(this.input.value);
    if (!pre.ok) {
      this.shake();
      this.toast(pre.reason);
      return;
    }
    this.o.sound.unlock();
    this.input.value = "";
    this.hideResult();
    this.setBusy(true);

    this.presenter.beginCycle();
    const { result, assist } = this.o.engine.commit(pre);
    let landed = false;
    try {
      await this.presenter.settle(
        { word: result.word, score: result.score, win: result.win, kind: "guess" },
        () => { landed = true; this.showResult(result); this.renderGuesses(); this.updateStats(); },
      );
    } catch {
      // A reveal mechanic failed/was interrupted — never strand the busy state.
      this.renderGuesses();
      this.updateStats();
      this.setBusy(false);
      this.input.focus();
      return;
    }
    // If the reveal was aborted before its landing callback, still surface the
    // committed guess + stats so the HUD never looks stale.
    if (!landed) { this.renderGuesses(); this.updateStats(); }

    if (result.win) {
      this.onWin(result);
    } else {
      if (assist) this.toast(assist, 2400);
      this.setBusy(false);
      this.input.focus();
    }
  }

  private async onHint() {
    if (this.busy) return;
    const r = this.o.engine.hint();
    if (!r.ok) {
      this.toast(r.reason);
      return;
    }
    this.o.sound.unlock();
    this.setBusy(true);
    this.hintBtn.textContent = `Hint (${r.remaining})`;
    this.presenter.beginCycle();
    let landed = false;
    try {
      await this.presenter.settle(
        { word: r.scored.word, score: r.scored.score, win: false, kind: "hint" },
        () => { landed = true; this.showResult({ ...r.scored, win: false }, true); this.renderHints(); this.updateStats(); },
      );
    } catch {
      /* fall through to finally */
    } finally {
      // Aborted before landing (or threw): still surface the committed hint + stats.
      if (!landed) { this.renderHints(); this.updateStats(); }
      this.setBusy(false);
      if (r.remaining === 0) this.hintBtn.disabled = true;
      this.input.focus();
    }
  }

  private onReveal() {
    if (this.busy || this.o.engine.phase !== "ready") return;
    const word = this.o.engine.reveal();
    this.presenter.revealTarget(word);
    this.endRound(false, word);
  }

  private async onNewGame() {
    // Note: no `busy` guard here — the New-word button is disabled during a
    // reveal, and the banner's "Play again" must work even though endRound left
    // busy=true. A re-entrancy guard prevents overlapping resets.
    if (this.resetting) return;
    this.resetting = true;
    this.setBusy(true);
    this.bannerEl.classList.remove("show");
    this.hideResult();
    await this.presenter.reset();
    this.o.engine.startRound();
    this.guessesEl.replaceChildren();
    this.hintsEl.replaceChildren();
    this.hintBtn.disabled = false;
    this.hintBtn.textContent = `Hint (${this.o.engine.hintsRemaining})`;
    this.setBusy(false);
    this.updateStats();
    this.input.value = "";
    this.input.focus();
    this.resetting = false;
  }

  private onWin(result: GuessResult) {
    const e = this.o.engine;
    const rec = recordRun({
      word: result.word,
      score: e.bank,
      guesses: e.guesses.length,
      hints: e.revealedHints.length,
      date: Date.now(),
    });
    this.leaderboard.refresh(rec.runs[rec.rank - 1]);
    this.endRound(true, result.word, rec.isBest);
  }

  // ---- rendering -----------------------------------------------------------

  private setBusy(b: boolean) {
    this.busy = b;
    this.input.disabled = b;
    this.submitBtn.disabled = b;
    this.hintBtn.disabled = b || this.o.engine.hintsRemaining === 0;
    this.revealBtn.disabled = b;
    this.newBtn.disabled = b;
  }

  private updateStats() {
    this.bankEl.textContent = String(this.o.engine.bank);
    const best = this.o.engine.bestScore;
    this.bestEl.textContent = best > 0 ? fmt(best, 1) : "—";
  }

  private renderGuesses() {
    const sorted = [...this.o.engine.guesses].sort((a, b) => b.score - a.score);
    const best = sorted[0];
    this.guessesEl.replaceChildren(
      ...sorted.map((g) => {
        const row = el("div", "guess-row" + (g === best ? " best" : ""));
        const word = el("span", "word", g.win ? `★ ${g.word}` : g.word);
        const meta = el("div", "meta");
        meta.append(el("span", "rank", g.win ? "found" : `#${g.rank}`), el("span", "score", fmt(g.score, 1)));
        const bar = el("div", "bar");
        const fill = el("i");
        fill.style.width = `${g.score}%`;
        bar.appendChild(fill);
        row.append(word, meta, bar);
        return row;
      }),
    );
  }

  private renderHints() {
    const hints = this.o.engine.revealedHints;
    this.hintsEl.replaceChildren(
      ...hints.map((h: Scored, i) => {
        const row = el("div", "hint-row");
        row.append(
          el("span", "hint-tag", `Hint ${i + 1}`),
          el("span", "hint-word", h.word),
          el("span", "hint-score", fmt(h.score, 1)),
        );
        return row;
      }),
    );
  }

  private showResult(result: GuessResult, isHint = false) {
    this.resultEl.replaceChildren();
    const word = el("div", "word", isHint ? `hint · ${result.word}` : result.word);
    const big = el("div", "big", "0.00");
    const label = el("div", "label", result.label);
    const sub = el("div", "sub", result.win ? "exact match" : `#${result.rank} of ${result.outOf.toLocaleString()}`);
    this.resultEl.append(word, big, label, sub);
    this.resultEl.classList.add("show");
    this.countUp(big, result.score);
  }

  private hideResult() {
    this.resultEl.classList.remove("show");
  }

  private countUp(node: HTMLElement, to: number) {
    const start = performance.now();
    const dur = 620;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = fmt(eased * to, 2);
      if (t < 1) requestAnimationFrame(tick);
      else node.textContent = fmt(to, 2);
    };
    requestAnimationFrame(tick);
  }

  private endRound(won: boolean, word: string, isBest = false) {
    this.setBusy(true);
    const card = el("div", "card");
    const heading = won ? (isBest ? "New best!" : "You found it") : "Revealed";
    card.append(
      el("h2", undefined, heading),
      el("div", "solution", `the word was <b>${word}</b>`),
      el("p", undefined, won
        ? `Solved with ${this.o.engine.bank} points and ${this.o.engine.guesses.length} guesses.`
        : `Closest you got: ${fmt(this.o.engine.bestScore || 0, 1)}/100.`),
    );
    const again = el("button", "pill-btn accent", "Play again");
    again.onclick = () => void this.onNewGame();
    card.appendChild(again);
    this.bannerEl.replaceChildren(card);
    setTimeout(() => this.bannerEl.classList.add("show"), won ? 850 : 300);
  }

  private toggleSound() {
    const muted = !this.o.sound.isMuted;
    this.o.sound.setMuted(muted);
    this.presenter.setMuted(muted);
    this.soundBtn.textContent = muted ? "♪̶" : "♪";
    this.soundBtn.style.opacity = muted ? "0.45" : "1";
  }

  private toast(message: string, ms = 1700) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), ms);
  }

  private shake() {
    this.input.classList.remove("shake");
    void this.input.offsetWidth;
    this.input.classList.add("shake");
  }
}
