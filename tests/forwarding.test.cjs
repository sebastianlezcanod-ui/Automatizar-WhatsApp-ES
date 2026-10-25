// Run with Node.js, Playwright and an installed Google Chrome:
//   node tests/forwarding.test.cjs
// These fixtures never open WhatsApp or send real messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
new vm.Script(source); // Check the entire production script, including untested UI code.
const entry = '  // Periodic check to inject trigger button once WhatsApp Web interface loads';
assert.ok(source.includes(entry));
const fixtureSource = source.replace(entry, `
  window.forwardingTest = {
    findForwardSendButton, sendForwardDialog, isForwardContactChecked,
    forwardMediaFromSelfChat, state, renderLogs,
  };
  return; // Disable extension startup only in this isolated fixture.
${entry}`);

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  let passed = 0;
  async function fixture(html) {
    await page.setContent(html);
    await page.addScriptTag({ content: fixtureSource });
  }
  async function check(name, test) {
    await test();
    passed++;
    console.log(`PASS ${name}`);
  }
  try {
    for (const [name, button] of [
      ['Spanish role button', '<div role="button" aria-label="Enviar">→</div>'],
      ['Spanish native button', '<button aria-label="Enviar">→</button>'],
      ['Spanish title', '<div role="button" title="ENVIAR">→</div>'],
      ['English role button', '<div role="button" aria-label="Send">→</div>'],
      ['Portuguese role button', '<div role="button" aria-label="Encaminhar">→</div>'],
      ['Icon on SVG', '<button><svg data-icon="wds-ic-send-filled"></svg></button>'],
    ]) {
      await check(name, async () => {
        await fixture(`<div role="dialog">${button}</div>`);
        assert.equal(await page.evaluate(() => !!window.forwardingTest.findForwardSendButton(document.querySelector('[role="dialog"]'))), true);
      });
    }

    await check('Footer outside body and replaced React body', async () => {
      await fixture('<div data-animate-modal-popup="true"><div data-animate-modal-body="true"></div><footer><div role="button" aria-label="Enviar">→</div></footer></div>');
      assert.equal(await page.evaluate(() => {
        const original = document.querySelector('[data-animate-modal-body]');
        original.replaceWith(original.cloneNode());
        return window.forwardingTest.findForwardSendButton(original)?.getAttribute('aria-label');
      }), 'Enviar');
    });

    await check('Ignore hidden/disabled controls and chat composer outside dialog', async () => {
      await fixture(`<div id="main"><button aria-label="Enviar">Chat</button></div>
        <div role="dialog">
          <button aria-label="Enviar" disabled>Disabled</button>
          <div role="button" aria-label="Enviar" aria-disabled="true">Disabled</div>
          <button aria-label="Enviar" style="display:none">Hidden</button>
          <button aria-label="Enviar" style="visibility:hidden">Hidden</button>
        </div>`);
      assert.equal(await page.evaluate(() => window.forwardingTest.findForwardSendButton(document.querySelector('[role="dialog"]'))), null);
    });

    await check('Empty checkbox stays unchecked, including native input', async () => {
      await fixture(`<div role="checkbox" aria-checked="false"><span data-icon="checkbox-unchecked"></span></div>
        <div role="checkbox"><span data-icon="checkbox-unchecked"></span></div>
        <input type="checkbox"><input type="checkbox" checked>
        <div role="checkbox"><span data-icon="checkbox-checked"></span></div>`);
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[role="checkbox"], input')].map(window.forwardingTest.isForwardContactChecked)), [false, false, false, true, true]);
    });

    await check('Image forwarding selects recipient once and never selects Mi estado', async () => {
      await fixture(`<div id="main"><header>Mi chat (Tú)</header>
        <div data-id="image-message"><img src="data:image/png;base64,iVBORw0KGgo=" alt="Imagen de prueba">
          <button aria-label="Reenviar" id="forward"><span data-icon="forward-chat"></span></button>
        </div></div>`);
      await page.evaluate(() => {
        window.clicks = { recipient: 0, status: 0, send: 0 };
        document.getElementById('forward').onclick = () => {
          const popup = document.createElement('div');
          popup.dataset.animateModalPopup = 'true';
          popup.innerHTML = `<div data-animate-modal-body="true">
            <div role="listitem">Mi estado<div role="checkbox" aria-checked="false" id="status"><span data-icon="checkbox-unchecked"></span></div></div>
            <div role="listitem">+51900000000<div role="checkbox" aria-checked="false" id="recipient"><span data-icon="checkbox-unchecked"></span></div></div>
          </div><footer><div role="button" aria-label="Enviar" aria-disabled="true" id="send">→</div></footer>`;
          document.body.append(popup);
          document.getElementById('status').onclick = () => { window.clicks.status++; };
          document.getElementById('recipient').onclick = () => {
            window.clicks.recipient++;
            const body = popup.querySelector('[data-animate-modal-body]');
            body.querySelector('#recipient').setAttribute('aria-checked', 'true');
            body.replaceWith(body.cloneNode(true));
            document.getElementById('send').removeAttribute('aria-disabled');
          };
          document.getElementById('send').onclick = () => { window.clicks.send++; popup.remove(); };
        };
      });
      assert.equal(await page.evaluate(() => window.forwardingTest.forwardMediaFromSelfChat('51900000000')), true);
      assert.deepEqual(await page.evaluate(() => window.clicks), { recipient: 1, status: 0, send: 1 });
    });

    await check('Wait for enabled action before clicking', async () => {
      await fixture('<div role="dialog"><button aria-label="Enviar" disabled>Send</button></div>');
      await page.evaluate(() => {
        const button = document.querySelector('button');
        window.sendClicks = 0;
        button.onclick = () => { window.sendClicks++; button.parentElement.remove(); };
        setTimeout(() => { button.disabled = false; }, 500);
      });
      await page.evaluate(() => window.forwardingTest.sendForwardDialog(document.querySelector('[role="dialog"]')));
      assert.equal(await page.evaluate(() => window.sendClicks), 1);
    });

    await check('Missing action reports error and closes with Spanish Cerrar', async () => {
      await fixture('<div role="dialog"><button aria-label="Cerrar">X</button></div>');
      await page.evaluate(() => { document.querySelector('button').onclick = () => document.querySelector('[role="dialog"]').remove(); });
      await assert.rejects(page.evaluate(() => window.forwardingTest.sendForwardDialog(document.querySelector('[role="dialog"]'))), /No se encontró un botón Enviar habilitado/);
      assert.equal(await page.locator('[role="dialog"]').count(), 0);
    });

    await check('A click that leaves dialog open is not reported as success', async () => {
      await fixture('<div role="dialog"><button aria-label="Enviar">Send</button></div>');
      await page.evaluate(() => {
        window.sendClicks = 0;
        document.querySelector('button').onclick = () => { window.sendClicks++; };
      });
      await assert.rejects(page.evaluate(() => window.forwardingTest.sendForwardDialog(document.querySelector('[role="dialog"]'))), /WhatsApp no confirmó el reenvío/);
      assert.equal(await page.evaluate(() => window.sendClicks), 1);
    });

    await check('New and historical partial logs are not green successes', async () => {
      await fixture('<span id="wads-log-count"></span><table><tbody id="wads-logs-body"></tbody></table>');
      assert.deepEqual(await page.evaluate(() => {
        window.forwardingTest.state.logs = [
          'Enviado (Texto + Archivo de Mi Chat)',
          'Parcial (Texto enviado; fallo al reenviar el archivo)',
          'Enviado (Texto enviado, fallo al reenviar: Send button inside Forward dialog not found.)',
          'Enviado (Solo archivo)',
        ].map(status => ({ phone: '51900000000', status, timestamp: '' }));
        window.forwardingTest.renderLogs();
        return [...document.querySelectorAll('#wads-logs-body tr')].map(row => row.children[1].className);
      }), ['wads-status-sent', 'wads-status-failed', 'wads-status-failed', 'wads-status-failed']);
    });
    console.log(`${passed} regression tests passed. No real messages sent.`);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
