import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";

const fps = Number(process.env.VIDEO_FPS ?? 60);
const width = Number(process.env.VIDEO_WIDTH ?? 2560);
const height = Number(process.env.VIDEO_HEIGHT ?? 1440);
const output = path.resolve(process.env.VIDEO_OUTPUT ?? "output/changeguard-live-agent-footage-1440p60.mp4");
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = process.env.CHANGEGUARD_VIDEO_URL ?? "http://127.0.0.1:5173";
const dataHubUrl = process.env.DATAHUB_UI_URL ?? "http://127.0.0.1:9002";
const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
const outputRoot = path.resolve("output");
const captureRoot = path.resolve("output/live-demo-capture");

if (!output.startsWith(`${outputRoot}${path.sep}`)) throw new Error("Video output escaped the output directory.");
if (!captureRoot.startsWith(`${outputRoot}${path.sep}`)) throw new Error("Capture path escaped the output directory.");
if (process.platform !== "win32") throw new Error("The 1440p60 capture uses Windows Desktop Duplication.");

await mkdir(path.dirname(output), { recursive: true });
await rm(captureRoot, { recursive: true, force: true });
await mkdir(captureRoot, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  executablePath: chrome,
  args: [
    "--disable-notifications",
    "--hide-scrollbars",
    "--no-first-run",
    "--window-position=0,0",
    `--window-size=${width},${height}`,
  ],
});
const page = await browser.newPage({ viewport: null });
const captureLogs = [];

async function fullscreen() {
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
  // Chrome briefly shows its fullscreen hint while Windows retracts the taskbar.
  // Keep both outside the recorded segments.
  await page.waitForTimeout(5000);
  const screen = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  }));
  if (screen.screenWidth !== width || screen.screenHeight !== height) {
    throw new Error(`Desktop is ${screen.screenWidth}x${screen.screenHeight}; expected ${width}x${height}.`);
  }
}

async function addCaptionOverlay() {
  await page.evaluate(() => {
    document.querySelector("#changeguard-video-caption")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "changeguard-video-caption";
    overlay.innerHTML = '<strong></strong><span></span>';
    document.body.appendChild(overlay);
    const style = document.createElement("style");
    style.textContent = `
      #changeguard-video-caption {
        align-items: center;
        background: rgba(18, 28, 24, 0.94);
        bottom: 22px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
        color: #f7faf8;
        display: flex;
        font-family: Arial, sans-serif;
        gap: 18px;
        left: 50%;
        max-width: 1840px;
        min-height: 58px;
        padding: 12px 22px;
        position: fixed;
        transform: translateX(-50%);
        width: max-content;
        z-index: 2147483647;
      }
      #changeguard-video-caption strong {
        color: #b9efcc;
        font-size: 18px;
        letter-spacing: 0;
        white-space: nowrap;
      }
      #changeguard-video-caption span {
        font-size: 20px;
        letter-spacing: 0;
        line-height: 1.3;
      }
    `;
    document.head.appendChild(style);
  });
}

async function caption(label, text) {
  await page.locator("#changeguard-video-caption strong").evaluate((element, value) => { element.textContent = value; }, label);
  await page.locator("#changeguard-video-caption span").evaluate((element, value) => { element.textContent = value; }, text);
}

async function startCapture(name) {
  const destination = path.join(captureRoot, `${name}.mkv`);
  const log = [];
  const encoder = spawn(ffmpegPath, [
    "-y",
    "-f", "lavfi",
    "-i", `ddagrab=framerate=${fps}:output_idx=0:draw_mouse=0`,
    "-an",
    "-c:v", "h264_nvenc",
    "-preset", "p5",
    "-tune", "hq",
    "-rc", "vbr",
    "-cq", "17",
    "-b:v", "0",
    destination,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  encoder.stderr.on("data", (chunk) => log.push(chunk.toString()));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 900);
    encoder.once("error", (error) => { clearTimeout(timer); reject(error); });
    encoder.once("exit", (code) => {
      if (code !== null) {
        clearTimeout(timer);
        reject(new Error(`ffmpeg exited before capture began (${code}).`));
      }
    });
  });
  return { destination, encoder, log };
}

async function stopCapture(capture) {
  capture.encoder.stdin.write("q\n");
  const [code] = await once(capture.encoder, "close");
  const logText = capture.log.join("");
  captureLogs.push(logText);
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}.\n${logText.slice(-2000)}`);
}

async function hold(seconds) {
  await page.waitForTimeout(seconds * 1000);
}

async function show(locator, seconds, label, text) {
  await caption(label, text);
  const target = Math.max(0, await locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY - 18));
  await page.evaluate(async ({ destination, duration }) => {
    const start = window.scrollY;
    const started = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        const progress = Math.min(1, (now - started) / duration);
        const eased = 1 - (1 - progress) ** 3;
        window.scrollTo(0, start + (destination - start) * eased);
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }, { destination: target, duration: 900 });
  await hold(Math.max(0, seconds - 0.9));
}

const segments = [];
try {
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.locator(".proposal-panel").waitFor();
  await fullscreen();
  await addCaptionOverlay();
  await caption("PROPOSE", "Rename country_code to market_code against synthetic local metadata.");

  const proposalCapture = await startCapture("01-proposal");
  segments.push(proposalCapture.destination);
  await hold(3);
  await page.locator(".run-button").click();
  await caption("VERIFY", "Read schema and lineage through the official DataHub MCP server.");
  await hold(2);
  await stopCapture(proposalCapture);

  await page.locator(".passport").waitFor({ state: "visible", timeout: 360_000 });
  await page.locator(".passport-header").scrollIntoViewIfNeeded();

  const analysisCapture = await startCapture("02-analysis");
  segments.push(analysisCapture.destination);
  await show(page.locator(".passport-header"), 5, "DECIDE", "Transparent policy scoring remains authoritative over the final verdict.");
  await show(page.locator(".impact-section"), 7, "TRACE", "Column-aware downstream impact is grounded in the retrieved DataHub graph.");
  await show(page.locator(".synthesis-section"), 9, "REASON", "A local model sees only bounded evidence; every cited asset and owner is validated.");
  await show(page.locator(".plan-section"), 8, "PLAN", "A reversible five-phase rollout follows dependency order and explicit gates.");
  await show(page.locator(".validation-section"), 8, "CHECK", "ChangeGuard generates review-ready SQL but never executes warehouse queries.");
  await show(page.locator(".evidence-section"), 8, "PROVE", "The trail records real MCP reads, model synthesis, and the stricter-only policy guard.");
  await show(page.locator(".publish-bar"), 4, "WRITE BACK", "save_document is available only after explicit private-mode authorization.");

  await page.locator(".publish-bar button").click();
  await page.getByText("Decision record saved", { exact: true }).waitFor({ timeout: 60_000 });
  await caption("RECEIPT", "DataHub returned a real Decision document URN.");
  await hold(6);
  const receiptText = await page.locator(".publish-bar").innerText();
  const documentUrn = receiptText.match(/urn:li:document:[A-Za-z0-9-]+/)?.[0];
  if (!documentUrn) throw new Error("The live DataHub document URN was not visible in the publish receipt.");
  await stopCapture(analysisCapture);

  await page.goto(`${dataHubUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#username").fill(process.env.DATAHUB_DEMO_USERNAME ?? "datahub");
  await page.locator("#password").fill(process.env.DATAHUB_DEMO_PASSWORD ?? "datahub");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await page.waitForTimeout(3500);
  await page.goto(`${dataHubUrl}/document/${encodeURIComponent(documentUrn)}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Rename country_code to market_code in commerce.public.customers", exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await addCaptionOverlay();
  await caption("DURABLE MEMORY", "The final change passport is stored as a Decision inside DataHub.");

  const documentCapture = await startCapture("03-datahub-document");
  segments.push(documentCapture.destination);
  await hold(10);
  await stopCapture(documentCapture);
} finally {
  await browser.close();
}

const concatList = path.join(captureRoot, "segments.txt");
await writeFile(concatList, segments.map((segment) => `file '${segment.replaceAll("'", "'\\''")}'`).join("\n"));
const joiner = spawn(ffmpegPath, [
  "-y",
  "-f", "concat",
  "-safe", "0",
  "-i", concatList,
  "-an",
  "-c", "copy",
  "-movflags", "+faststart",
  output,
], { stdio: "inherit" });
const [joinCode] = await once(joiner, "close");
if (joinCode !== 0) throw new Error(`ffmpeg concat exited with code ${joinCode}.`);

await writeFile(path.join(captureRoot, "capture.log"), captureLogs.join("\n\n--- segment ---\n\n"));
console.log(`Captured native ${width}x${height} ${fps}fps ChangeGuard footage at ${output}`);
