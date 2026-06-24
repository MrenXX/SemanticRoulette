/** Brief boot overlay. Vectors load fast (~4 MB), so this is short-lived. */
export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly inner: HTMLElement;
  private readonly status: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = "";
    const el = document.createElement("div");
    el.className = "loading";
    el.innerHTML = `
      <div class="loading-inner">
        <h1>Semantic Roulette</h1>
        <p>Guess the hidden word. Every guess lands in a map of meaning and tells
           you how warm you are.</p>
        <div class="loading-track"><div class="loading-fill"></div></div>
        <div class="loading-status">Loading words…</div>
      </div>`;
    root.appendChild(el);
    this.inner = el;
    this.status = el.querySelector(".loading-status")!;
    // Indeterminate-ish fill (load is quick).
    (el.querySelector(".loading-fill") as HTMLElement).style.width = "70%";
  }

  done() {
    (this.inner.querySelector(".loading-fill") as HTMLElement).style.width = "100%";
    this.status.textContent = "Ready";
    this.inner.classList.add("hide");
    setTimeout(() => this.root.replaceChildren(), 450);
  }

  error(message: string, onRetry: () => void) {
    this.status.textContent = message;
    const btn = document.createElement("button");
    btn.className = "pill-btn accent loading-retry";
    btn.textContent = "Retry";
    btn.onclick = onRetry;
    this.inner.querySelector(".loading-inner")!.appendChild(btn);
  }
}
