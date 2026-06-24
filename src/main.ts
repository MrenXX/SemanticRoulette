import "./styles/base.css";
import "./styles/loading.css";
import "./styles/hud.css";

import { applyTheme } from "./theme/tokens.js";
import { resolveTheme, DEFAULT_THEME } from "./theme/index.js";
import { VectorStore } from "./game/vectors.js";
import { GameEngine } from "./game/engine.js";
import type { TargetsFile } from "./game/types.js";
import { SoundKit } from "./audio/sound.js";
import { DeepSpaceScene, hasWebGL2 } from "./viz/deepspace.js";
import { BODY_KINDS, BODY_LABELS, type BodyKind } from "./viz/bodies/index.js";
import { MECHANIC_IDS, MECHANIC_LABELS, type MechanicId } from "./viz/reveals/index.js";
import { HUD, type Choice } from "./ui/hud.js";
import { LoadingScreen } from "./ui/loading.js";

const params = () => new URLSearchParams(location.search);
const pref = (key: string, fallback: string): string =>
  params().get(key) || localStorage.getItem(`sr:${key}`) || fallback;
const persist = (key: string, value: string) => {
  try { localStorage.setItem(`sr:${key}`, value); } catch { /* best-effort */ }
  const url = new URL(location.href);
  url.searchParams.set(key, value);
  history.replaceState(null, "", url);
};
/** Drop a stale persisted/URL key (e.g. a removed theme). */
const forget = (key: string) => {
  try { localStorage.removeItem(`sr:${key}`); } catch { /* best-effort */ }
  const url = new URL(location.href);
  if (url.searchParams.has(key)) { url.searchParams.delete(key); history.replaceState(null, "", url); }
};

const bodyChoices: Choice[] = BODY_KINDS.map((k) => ({ id: k, label: BODY_LABELS[k] }));
const mechanicChoices: Choice[] = MECHANIC_IDS.map((m) => ({ id: m, label: MECHANIC_LABELS[m] }));

async function loadTargets(base: string): Promise<TargetsFile> {
  const prefix = base.endsWith("/") ? base : base + "/";
  return fetch(`${prefix}data/targets.json`).then((r) => r.json());
}

async function main() {
  const base = import.meta.env.BASE_URL ?? "/";

  const sceneRoot = document.getElementById("scene-root")!;
  const hudRoot = document.getElementById("hud-root")!;
  const loadingRoot = document.getElementById("loading-root")!;
  const loading = new LoadingScreen(loadingRoot);

  // Deep space is the only world and it requires WebGL2.
  if (!hasWebGL2()) {
    loading.error(
      "This game needs WebGL2. Enable hardware acceleration (or update your browser), then reload.",
      () => location.reload(),
    );
    return;
  }

  const theme = applyTheme(resolveTheme(DEFAULT_THEME));
  // Resolve + sanitize persisted selections (covers stale ink / whitedwarf /
  // gravity-claw values from earlier versions), then re-persist the valid ones.
  let bodyKind = (BODY_KINDS.includes(pref("body", "star") as BodyKind) ? pref("body", "star") : "star") as BodyKind;
  let mechanicId = (MECHANIC_IDS.includes(pref("reveal", "orbital") as MechanicId) ? pref("reveal", "orbital") : "orbital") as MechanicId;
  forget("theme");
  persist("body", bodyKind);
  persist("reveal", mechanicId);

  let store: VectorStore;
  let targetsFile: TargetsFile;
  try {
    [store, targetsFile] = await Promise.all([VectorStore.load(base), loadTargets(base)]);
  } catch (e) {
    loading.error("Couldn't load the word vectors.", () => location.reload());
    throw e;
  }

  const sound = new SoundKit();
  const deep = new DeepSpaceScene(sceneRoot, theme.scene, sound, { body: bodyKind, mechanic: mechanicId });
  deep.start();
  loading.done();

  const engine = new GameEngine(store, targetsFile.targets);
  engine.startRound();

  const setBody = (id: string) => {
    bodyKind = id as BodyKind;
    deep.setBody(bodyKind);
    persist("body", bodyKind);
  };
  const setMechanic = (id: string) => {
    mechanicId = id as MechanicId;
    deep.setMechanic(mechanicId);
    persist("reveal", mechanicId);
  };

  const hud = new HUD({
    engine, presenter: deep, sound,
    bodies: bodyChoices, currentBody: bodyKind, setBody,
    mechanics: mechanicChoices, currentMechanic: mechanicId, setMechanic,
  });
  hud.mount(hudRoot);

  (window as unknown as { __sr: unknown }).__sr = { engine, setBody, setMechanic, hud, deep };
}

void main();
