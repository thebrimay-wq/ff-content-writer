// One-off screenshot capture for the onboarding modal.
// Run: node scripts/capture-onboarding.mjs   (assumes `npm run dev` on :3003 and playwright installed via npx)
// Outputs JPEGs to public/onboarding/

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const URL = 'http://localhost:3003/'
const OUT = 'public/onboarding'
const VIEWPORT = { width: 1280, height: 820 }
const DPR = 2

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR })
  const page = await context.newPage()

  // 1) Gate — tight crop on the two starting-point cards (live coords measured from app).
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.setItem('ff_help_seen_v1', '1')          // suppress first-visit auto-help
    localStorage.setItem('ff-anthropic-api-key', 'sk-ant-stub')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('text=How do you want to start?')
  await page.screenshot({
    path: `${OUT}/01-gate.jpg`, type: 'jpeg', quality: 85,
    clip: { x: 250, y: 270, width: 780, height: 270 },
  })

  // 2) Sidebar — click "Draft with AI" card to enter the editor.
  //    Crop spans Blank/With AI toggle through the Generate-draft button — every
  //    element the onboarding body references.
  await page.locator('text=Draft with AI').first().click()
  await page.waitForTimeout(400)
  // Seed the topic field so it doesn't show a placeholder, leave Generate button intact.
  await page.evaluate(() => {
    const app = document.querySelector('ff-app')
    if (app) { app.topic = 'How to build your first emergency fund'; app.requestUpdate?.() }
  })
  await page.waitForTimeout(200)
  await page.screenshot({
    path: `${OUT}/02-sidebar.jpg`, type: 'jpeg', quality: 85,
    clip: { x: 8, y: 120, width: 296, height: 620 },
  })

  // 3) Editor — set the Lit component's `output` directly so the editor renders content,
  //    then crop the center canvas.
  await page.evaluate(() => {
    const app = document.querySelector('ff-app')
    if (!app) return
    const md = `# How to build your first emergency fund\n\nAn emergency fund is the cushion that protects you when life surprises you — a sudden car repair, an unexpected medical bill, or a temporary loss of income. The simplest starting goal is one month of essential expenses, saved somewhere you can reach quickly.\n\n## Pick a target you can actually hit\n\nStart with $500. It is small enough to feel possible and large enough to absorb most surprise costs. Once you hit it, double the goal.\n\n## Make it automatic\n\nSet up a recurring transfer the day after payday. Even $20 a week becomes $1,040 by year-end.`
    app.output = md
    app.topic = 'Emergency fund basics'
    app.isDirty = true
    app.requestUpdate?.()
  })
  await page.waitForTimeout(500)
  // 3) Editor — toolbar + title + first paragraph + headings (everything the body refs).
  await page.screenshot({
    path: `${OUT}/03-editor.jpg`, type: 'jpeg', quality: 85,
    clip: { x: 320, y: 50, width: 660, height: 460 },
  })

  // 4) Right rail — Save / Submit actions + the readiness checklist. Stops before tabs.
  await page.evaluate(() => { window.getSelection()?.removeAllRanges() })
  await page.waitForTimeout(200)
  await page.screenshot({
    path: `${OUT}/04-rail.jpg`, type: 'jpeg', quality: 85,
    clip: { x: 985, y: 80, width: 295, height: 470 },
  })

  await browser.close()
  console.log('done — wrote 5 jpegs to', OUT)
}

main().catch((e) => { console.error(e); process.exit(1) })
