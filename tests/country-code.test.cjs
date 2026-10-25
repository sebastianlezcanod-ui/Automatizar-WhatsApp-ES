// Run with Node.js, Playwright and Google Chrome: node tests/country-code.test.cjs
// The production startQueue is intercepted; these tests cannot send messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const entry = '  // Periodic check to inject trigger button once WhatsApp Web interface loads';
assert.ok(source.includes(entry) && source.includes('  function startQueue(queue) {'));
const fixtureSource = source
  .replace('  function startQueue(queue) {', '  function startQueue(queue) { window.testQueue = queue; return;')
  .replace(entry, `window.countryTest = { state, createDrawer, loadStoredSettings }; return;\n${entry}`);

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  try {
    await page.setContent('<html><body></body></html>');
    await page.addStyleTag({ path: path.join(root, 'style.css') });
    await page.evaluate(() => {
      window.savedSettings = {};
      window.chrome = { storage: { local: {
        get: (keys, callback) => callback(window.savedSettings),
        set: values => Object.assign(window.savedSettings, values),
      } } };
    });
    await page.addScriptTag({ content: fixtureSource });
    await page.evaluate(() => {
      window.countryTest.createDrawer();
      document.getElementById('wads-drawer').classList.add('open');
    });
    assert.equal(await page.locator('#wads-cc-toggle-manual').isChecked(), true);
    assert.equal(await page.locator('#wads-cc-prefix-manual').inputValue(), '+51');
    assert.equal(await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      return ids.length === new Set(ids).size;
    }), true);
    console.log('PASS manual toggle defaults to enabled +51 and has unique controls');

    await page.locator('#wads-manual-numbers').fill('956733324; +51 956 733 324\n51956733324, +34 612345678\n0034612345678;0956733324;abc;123');
    await page.locator('#wads-manual-message').fill('Prueba local sin envío');
    await page.locator('#wads-start-manual-btn').click();
    assert.deepEqual(await page.evaluate(() => window.testQueue.map(item => item.phone)), [
      '51956733324', '51956733324', '51956733324', '34612345678', '34612345678', '51956733324',
    ]);
    console.log('PASS manual queue handles local, complete, foreign and invalid numbers');

    await page.locator('label[for="wads-cc-toggle-manual"]').click();
    assert.equal(await page.locator('#wads-cc-toggle-manual').isChecked(), false);
    assert.equal(await page.locator('#wads-cc-toggle').isChecked(), false);
    await page.locator('#wads-manual-numbers').fill('956733324;0956733324;+34612345678');
    await page.locator('#wads-start-manual-btn').click();
    assert.deepEqual(await page.evaluate(() => window.testQueue.map(item => item.phone)), ['956733324', '0956733324', '34612345678']);
    assert.equal(await page.evaluate(() => window.savedSettings.wads_enable_country_code), false);
    console.log('PASS disabled toggle preserves digits and saves the setting');

    await page.locator('label[for="wads-cc-toggle-manual"]').click();
    await page.locator('#wads-cc-prefix-manual').fill('57');
    await page.locator('#wads-manual-numbers').click();
    assert.equal(await page.locator('#wads-cc-prefix-manual').inputValue(), '+57');
    assert.equal(await page.locator('#wads-cc-prefix').inputValue(), '+57');
    await page.locator('#wads-manual-numbers').fill('3001234567;+51956733324');
    await page.locator('#wads-start-manual-btn').click();
    assert.deepEqual(await page.evaluate(() => window.testQueue.map(item => item.phone)), ['573001234567', '51956733324']);
    assert.equal(await page.evaluate(() => window.savedSettings.wads_country_code_prefix), '57');
    console.log('PASS edited code syncs both tabs without changing explicit international numbers');

    await page.evaluate(() => {
      window.savedSettings = { wads_enable_country_code: true, wads_country_code_prefix: '51' };
      window.countryTest.loadStoredSettings();
    });
    assert.equal(await page.locator('#wads-cc-prefix-manual').inputValue(), '+51');
    assert.equal(await page.locator('#wads-cc-toggle-manual').isChecked(), true);
    console.log('PASS saved settings restore the manual toggle and code');
    console.log('5 country-code tests passed. No messages sent.');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
