import { chromium } from "playwright";

const BASE = "http://localhost:4173";
const browser = await chromium.launch({
  headless: true, channel: "msedge", chromiumSandbox: false,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
const out = {};
const CX = 720, CY = 450;
const inputEnabled = () => page.waitForFunction(() => !document.querySelector(".guess-input").disabled, { timeout: 20000 });

// ---- Full game flow on each (kept) mechanic, for both bodies. ----
for (const body of ["star", "blackhole"]) {
  for (const mech of ["orbital", "supernova", "baseline"]) {
    await page.goto(`${BASE}/?body=${body}&reveal=${mech}`, { waitUntil: "load" });
    await page.waitForSelector(".guess-input", { timeout: 60000 });
    await page.evaluate(() => window.__sr.engine.startRound("ocean"));
    await page.fill(".guess-input", "river"); await page.press(".guess-input", "Enter");
    await inputEnabled();
    await page.click(".controls .pill-btn:nth-child(1)"); // hint
    await page.waitForSelector(".hint-row", { timeout: 20000 });
    await inputEnabled();
    await page.fill(".guess-input", "ocean"); await page.press(".guess-input", "Enter"); // win
    await page.waitForFunction(() => document.querySelector(".banner")?.classList.contains("show"), { timeout: 20000 });
    out[`${body}/${mech}`] = await page.evaluate(() => document.querySelector(".banner h2")?.textContent);
    await page.getByText("Play again", { exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".guess-input").disabled && window.__sr.engine.guesses.length === 0, { timeout: 20000 });
  }
}

// ---- Drag-over-centre: a real mouse drag at the canvas centre must rotate the
//      orbit (this is the bug where the HUD swallowed the drag). ----
await page.goto(`${BASE}/?body=star&reveal=orbital`, { waitUntil: "load" });
await page.waitForSelector(".guess-input", { timeout: 60000 });
await page.waitForTimeout(200);
const before = await page.evaluate(() => window.__sr.deep.cameraInfo());
await page.mouse.move(CX, CY);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(CX + i * 22, CY + i * 4); await page.waitForTimeout(8); }
await page.mouse.up();
await page.waitForTimeout(60);
const after = await page.evaluate(() => window.__sr.deep.cameraInfo());
const angBefore = Math.atan2(before.z, before.x), angAfter = Math.atan2(after.z, after.x);
out.dragRotated = Math.abs(angAfter - angBefore) > 0.15;

// ---- Wheel zoom: scrolling changes the orbit distance. ----
await page.waitForTimeout(150);
const zBefore = (await page.evaluate(() => window.__sr.deep.cameraInfo())).dist;
await page.mouse.move(CX, CY);
await page.mouse.wheel(0, 600); // zoom out
await page.waitForTimeout(1000); // let the dolly settle
const zOut = (await page.evaluate(() => window.__sr.deep.cameraInfo())).dist;
await page.mouse.wheel(0, -1200); // zoom in
await page.waitForTimeout(1000);
const zIn = (await page.evaluate(() => window.__sr.deep.cameraInfo())).dist;
out.zoomOut = zOut > zBefore + 1;
out.zoomIn = zIn < zOut - 1;

// ---- No stuck-zoom after a guess: camera must dolly back out, not stay near
//      the centre. ----
await page.goto(`${BASE}/?body=star&reveal=orbital`, { waitUntil: "load" });
await page.waitForSelector(".guess-input", { timeout: 60000 });
await page.evaluate(() => window.__sr.engine.startRound("ocean"));
await page.fill(".guess-input", "river"); await page.press(".guess-input", "Enter");
await inputEnabled();
await page.waitForTimeout(3000); // focus hold expires → return-to-orbit
out.noStuckZoom = (await page.evaluate(() => window.__sr.deep.cameraInfo())).dist > 26;

// ---- Body switching mid-session (star <-> black hole). ----
for (const b of ["blackhole", "star", "blackhole"]) {
  await page.evaluate((bb) => window.__sr.setBody(bb), b);
  await page.waitForTimeout(250);
}
out.bodySwitch = "ok";

// ---- Stale persisted settings (ink / whitedwarf / claw) are sanitized. ----
await page.goto(`${BASE}/?theme=ink&body=whitedwarf&reveal=claw`, { waitUntil: "load" });
await page.waitForSelector(".guess-input", { timeout: 60000 });
out.sanitized = await page.evaluate(() => {
  const p = new URLSearchParams(location.search);
  return { body: p.get("body"), reveal: p.get("reveal"), theme: p.get("theme") };
});

// ---- OOV still works. ----
await page.evaluate(() => window.__sr.engine.startRound("ocean"));
await page.fill(".guess-input", "zxqwlkjhg"); await page.press(".guess-input", "Enter");
await page.waitForTimeout(400);
out.oov = await page.evaluate(() => document.querySelector(".toast")?.textContent);

// ---- STRESS: switch body mid-reveal (must not strand the HUD or throw). ----
await page.goto(`${BASE}/?body=star&reveal=supernova`, { waitUntil: "load" });
await page.waitForSelector(".guess-input", { timeout: 60000 });
await page.evaluate(() => window.__sr.engine.startRound("ocean"));
await page.fill(".guess-input", "river"); await page.press(".guess-input", "Enter");
await page.waitForTimeout(250); // mid-reveal
await page.evaluate(() => window.__sr.setBody("blackhole"));
await inputEnabled(); // must recover, not strand the HUD busy state
out.afterStress = true;
await page.fill(".guess-input", "sea"); await page.press(".guess-input", "Enter");
await inputEnabled();
out.playableAfterStress = await page.evaluate(() => window.__sr.engine.guesses.length >= 1);

// ---- Hints are never effectively duplicated (umbrella previously surfaced both
//      "organisation" AND "organization"). Take every hint; assert all distinct. ----
await page.goto(`${BASE}/?body=star&reveal=baseline`, { waitUntil: "load" });
await page.waitForSelector(".guess-input", { timeout: 60000 });
await page.evaluate(() => window.__sr.engine.startRound("umbrella"));
for (let i = 0; i < 5; i++) {
  const r = await page.evaluate(() => window.__sr.engine.hint());
  if (!r || !r.ok) break;
  await page.waitForTimeout(30);
}
const hintWords = await page.evaluate(() => window.__sr.engine.revealedHints.map((h) => h.word.toLowerCase()));
out.hintWords = hintWords;
out.hintsDistinct = hintWords.length >= 2 && new Set(hintWords).size === hintWords.length;

console.log(JSON.stringify(out, null, 2));
console.log("pageerrors:", errors.length);
for (const e of errors.slice(0, 12)) console.log("  • " + e);
await browser.close();
const mechOk = ["star", "blackhole"].every((b) => ["orbital", "supernova", "baseline"].every((m) => out[`${b}/${m}`]));
const ok = mechOk &&
  out.dragRotated === true && out.zoomOut === true && out.zoomIn === true &&
  out.noStuckZoom === true &&
  out.sanitized?.body === "star" && out.sanitized?.reveal === "orbital" && !out.sanitized?.theme &&
  out.oov?.includes("not in word list") &&
  out.hintsDistinct === true &&
  out.afterStress === true && out.playableAfterStress === true && errors.length === 0;
console.log("RESULT:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
