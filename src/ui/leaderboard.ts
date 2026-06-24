import { loadRuns, type Run } from "../game/leaderboard.js";

/** Collapsible "Best runs" panel backed by localStorage. */
export class LeaderboardPanel {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "leaderboard";
    this.el.innerHTML = `<h3>Best runs</h3><ol class="lb-list"></ol>`;
    this.list = this.el.querySelector(".lb-list")!;
    this.refresh();
  }

  refresh(highlight?: Run) {
    const runs = loadRuns();
    if (!runs.length) {
      this.list.innerHTML = `<li class="lb-empty">No wins yet — solve one!</li>`;
      return;
    }
    this.list.replaceChildren(
      ...runs.map((r) => {
        const li = document.createElement("li");
        if (highlight && r.date === highlight.date && r.word === highlight.word) li.classList.add("lb-new");
        li.innerHTML =
          `<span class="lb-word">${r.word}</span>` +
          `<span class="lb-score">${r.score}</span>` +
          `<span class="lb-meta">${r.guesses}g${r.hints ? `·${r.hints}h` : ""}</span>`;
        this.list.appendChild(li);
        return li;
      }),
    );
  }
}
