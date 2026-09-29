import { chromium } from 'playwright';

const BASE = 'http://localhost:5088';
const OUT_DIR = '/tmp/claude-1000/-home-adithya-Desktop-mouse--Copy-/99dc182e-59d5-4f87-a335-8fc9f2f77988/scratchpad/heading-verify';

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const context = await browser.newContext({ permissions: ['microphone'] });
const page = await context.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('#step1NextBtn');
await page.fill('#code', 'HEADINGTEST');
await page.waitForTimeout(100);
await page.click('#step2NextBtn');
await page.click('#beginBtn');

for (let i = 0; i < 9; i += 1) {
    await page.click('#continueBtn');
    await page.waitForTimeout(50);
}
await page.click('#continueBtn');

let watching = true;
(async () => {
    while (watching) {
        const proceedBtn = page.locator('#recoveryProceedBtn');
        if (await proceedBtn.isVisible().catch(() => false) && await proceedBtn.isEnabled().catch(() => false)) {
            await proceedBtn.click({ timeout: 1000 }).catch(() => {});
        }
        await page.waitForTimeout(200);
    }
})();

async function waitForCompletePanel(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await page.locator('#completePanel').isVisible().catch(() => false)) return true;
        await page.waitForTimeout(200);
    }
    return false;
}

const reached = await waitForCompletePanel(200000);
watching = false;
console.log('Reached COMPLETE:', reached);
await page.waitForTimeout(1000);

const heading = await page.locator('#completeHeading').textContent();
console.log('Heading text:', JSON.stringify(heading));
await page.screenshot({ path: `${OUT_DIR}/complete-heading.png`, fullPage: true });

await browser.close();
