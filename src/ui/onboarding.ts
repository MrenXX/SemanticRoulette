/**
 * First-visit onboarding "briefing": an in-character modal that teaches the rules
 * in deep-space role-play (help Tom decode the hidden glyph). Shown once (gated by a
 * `sr:onboarded` localStorage flag) and re-openable anytime via the HUD's Briefing
 * button. Self-contained: builds its own DOM under <body>, handles focus-trap, Esc /
 * backdrop / ✕ / CTA dismissal, and restores focus on close.
 */

const STORAGE_KEY = "sr:onboarded";

/** The concise rule lines (mechanic + key numbers). Kept short on purpose. */
const RULES: { lead: string; body: string }[] = [
  {
    lead: "Cast a word",
    body:
      "scored by <em>meaning</em>, not spelling: the nearer in meaning, the tighter its orbit. " +
      "Variants count (<code>oceans</code> → <code>ocean</code>); unknown words are rejected.",
  },
  {
    lead: "Read the heat",
    body:
      "each guess shows a score <code>0–100</code>, a rank, and a reading from " +
      '<span class="heat">Freezing → Boiling</span>. Hotter is closer; <code>100</code> means you found it.',
  },
  {
    lead: "Mind the bank",
    body:
      'you start with <code>1000</code> energy; wrong guess <code class="cost">−10</code>, ' +
      'Hint <code class="cost">−75</code> (max <code>3</code>). A hint reveals a related glyph near the target.',
  },
  {
    lead: "Fly the map",
    body:
      "drag to orbit, wheel to zoom. <strong>Give up</strong> reveals the word; " +
      "<strong>New word</strong> starts a fresh rescue.",
  },
];

export class OnboardingModal {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private lastFocused: HTMLElement | null = null;
  private opened = false;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "onboarding";
    this.root.setAttribute("aria-hidden", "true");

    this.panel = document.createElement("div");
    this.panel.className = "onboarding-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");
    this.panel.setAttribute("aria-labelledby", "onboard-title");
    this.panel.setAttribute("aria-describedby", "onboard-hook");

    const close = document.createElement("button");
    close.type = "button";
    close.className = "onboarding-close";
    close.setAttribute("aria-label", "Close briefing");
    close.textContent = "✕";
    close.onclick = () => this.close();

    this.title = document.createElement("h2");
    this.title.className = "onboarding-title";
    this.title.id = "onboard-title";
    this.title.tabIndex = -1;
    this.title.textContent = "Tom's Solar Glyph Briefing";

    const subtitle = document.createElement("p");
    subtitle.className = "onboarding-subtitle";
    subtitle.textContent = "Name the hidden word. Save the system.";

    const hook = document.createElement("p");
    hook.className = "onboarding-hook";
    hook.id = "onboard-hook";
    hook.innerHTML =
      "The core is failing. Tom has trapped one hidden glyph, a <em>word</em>, inside the " +
      "central body. Name it before the map goes dark.";

    const list = document.createElement("ol");
    list.className = "onboarding-rules";
    for (const r of RULES) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${r.lead}</strong>: ${r.body}`;
      list.appendChild(li);
    }

    const modeTip = document.createElement("p");
    modeTip.className = "onboarding-tip";
    modeTip.innerHTML =
      "Body (Star or Black hole) sets the central object, purely visual. " +
      "Reveal picks the animation: Orbital Roulette (spirals in), Supernova Snap (cosmic blast), or Classic (flicker and settle).";

    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "pill-btn accent onboarding-cta";
    cta.textContent = "Begin the Rescue";
    cta.onclick = () => this.close();

    const caption = document.createElement("p");
    caption.className = "onboarding-caption";
    caption.textContent = "Tom is waiting at the core.";

    this.panel.append(close, this.title, subtitle, hook, list, modeTip, cta, caption);
    this.root.appendChild(this.panel);

    // Backdrop click (outside the panel) closes.
    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root) this.close();
    });

    document.body.appendChild(this.root);
  }

  /** Show only if the player hasn't dismissed the briefing before. */
  maybeShowFirstVisit() {
    let seen = "";
    try { seen = localStorage.getItem(STORAGE_KEY) ?? ""; } catch { seen = ""; }
    if (seen !== "true") this.open();
  }

  open() {
    if (this.opened) return;
    this.opened = true;
    this.lastFocused = (document.activeElement as HTMLElement | null) ?? null;
    this.root.classList.add("show");
    this.root.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", this.onKeydown, true);
    requestAnimationFrame(() => this.title.focus());
  }

  close() {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove("show");
    this.root.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", this.onKeydown, true);
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* best-effort */ }
    // Restore focus to whatever opened it, else hand focus to the guess input.
    const back = this.lastFocused;
    this.lastFocused = null;
    const fallback = document.querySelector<HTMLElement>(".guess-input");
    const target = back && document.contains(back) ? back : fallback;
    target?.focus();
  }

  private onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key !== "Tab") return;
    const f = this.focusable();
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === this.title)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  private focusable(): HTMLElement[] {
    return Array.from(
      this.panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
  }
}
