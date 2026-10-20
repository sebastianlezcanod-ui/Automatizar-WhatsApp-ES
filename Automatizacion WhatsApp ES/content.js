/**
 * WA Direct Sender - Content Script
 * Pure client-side WhatsApp Web messaging assistant with no arbitrary limits.
 * Supports: Manual phone lists, Excel (.xlsx, .xls) & CSV upload,
 * dynamic variable tags, and Media/Document attachments with:
 *  1. Self-Chat detection & forwarding (with contact initialization via mandatory text)
 *  2. Direct computer file upload & injection
 *  3. Configurable dispatch sequence (Text First vs Attachment First)
 */

(function () {
  'use strict';

  // Global Dispatch State
  const state = {
    isRunning: false,
    isPaused: false,
    currentIndex: 0,
    queue: [],
    logs: [],
    csvData: null,
    csvHeaders: [],
    delayMin: 5,
    delayMax: 10,
    timerId: null,

    // Country Code Prefix Configuration
    enableCountryCode: true,
    countryCodePrefix: '51',

    // Attachment Configuration
    enableAttachment: false,
    attachmentSource: 'self', // 'self' (Option 1) | 'upload' (Option 2)
    selfChatMedia: null,      // { type: 'image'|'document', thumbUrl, label, desc }
    uploadedFile: null,       // File object when source === 'upload'
    uploadedType: 'image',    // 'image' | 'document'
    attachmentOrder: 'text_first', // 'text_first' | 'attachment_first'
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function waitForElement(selector, timeoutMs = 6000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const startTime = Date.now();
      const interval = setInterval(() => {
        const found = document.querySelector(selector);
        if (found) {
          clearInterval(interval);
          resolve(found);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          resolve(null);
        }
      }, 250);
    });
  }

  // Initialize UI after WhatsApp Web DOM is ready
  function init() {
    if (document.getElementById('wads-launcher-btn')) return;

    createLauncherButton();
    createDrawer();
    loadStoredSettings();
    loadStoredLogs();
  }

  // --- UI Components ---

  function createLauncherButton() {
    const btn = document.createElement('div');
    btn.id = 'wads-launcher-btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
      </svg>
      <span>WA Sender</span>
    `;
    btn.addEventListener('click', toggleDrawer);
    document.body.appendChild(btn);
  }

  function createDrawer() {
    const backdrop = document.createElement('div');
    backdrop.id = 'wads-backdrop';
    backdrop.addEventListener('click', closeDrawer);
    document.body.appendChild(backdrop);

    const drawer = document.createElement('div');
    drawer.id = 'wads-drawer';
    drawer.innerHTML = `
      <div class="wads-header">
        <div class="wads-brand">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          <div class="wads-title">WA Sender Directo</div>
          <span class="wads-badge">Sin Límites</span>
        </div>
        <button class="wads-close-btn" id="wads-close-btn" title="Cerrar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="wads-tabs">
        <button class="wads-tab-btn active" data-tab="manual">Lista Manual</button>
        <button class="wads-tab-btn" data-tab="csv">Subir Excel / CSV</button>
        <button class="wads-tab-btn" data-tab="settings">Registros y Ajustes</button>
      </div>

      <div class="wads-content">
        <!-- Progress Card -->
        <div class="wads-progress-card" id="wads-progress-card">
          <div class="wads-progress-info">
            <span id="wads-progress-text">Progreso: 0 / 0</span>
            <span id="wads-progress-pct">0%</span>
          </div>
          <div class="wads-progress-bar-bg">
            <div class="wads-progress-bar-fill" id="wads-progress-fill"></div>
          </div>
          <div class="wads-live-status" id="wads-live-status">Listo</div>
          <div class="wads-actions" style="margin-top: 10px;">
            <button class="wads-btn wads-btn-secondary" id="wads-pause-btn">Pausar</button>
            <button class="wads-btn wads-btn-danger" id="wads-stop-btn">Detener</button>
          </div>
        </div>

        <!-- Tab 1: Manual List -->
        <div class="wads-tab-panel active" id="wads-tab-manual">
          <div class="wads-form-group">
            <label for="wads-manual-numbers">Números de Teléfono (con código de país)</label>
            <textarea id="wads-manual-numbers" class="wads-textarea" placeholder="ej.&#10;+34612345678&#10;+5215512345678&#10;+573001234567"></textarea>
            <div class="wads-hint">Separa los números con comas o saltos de línea. Incluye siempre el código de país.</div>
          </div>

          <div class="wads-form-group">
            <label for="wads-manual-message">Texto del Mensaje <span style="color: var(--wads-danger);">*Obligatorio</span></label>
            <textarea id="wads-manual-message" class="wads-textarea" style="min-height: 90px;" placeholder="Escribe tu mensaje aquí (obligatorio)..."></textarea>
          </div>

          <!-- Attachment Box Manual -->
          ${renderAttachmentSectionHTML('manual')}

          <div class="wads-actions">
            <button class="wads-btn wads-btn-primary" id="wads-start-manual-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              Iniciar Envío
            </button>
          </div>
        </div>

        <!-- Tab 2: Excel / CSV Upload -->
        <div class="wads-tab-panel" id="wads-tab-csv">
          <div class="wads-form-group">
            <label>Subir Archivo de Contactos (Excel .xlsx, .xls o .csv)</label>
            <div class="wads-dropzone" id="wads-dropzone">
              <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>
              <div class="wads-dropzone-text" id="wads-file-name">Haz clic o arrastra un archivo Excel (.xlsx, .xls) o CSV aquí</div>
              <input type="file" id="wads-csv-input" accept=".xlsx, .xls, .csv" style="display: none;">
            </div>
            <div class="wads-hint" id="wads-csv-status"></div>
          </div>

          <div id="wads-csv-fields-wrapper" style="display: none;">
            <div class="wads-form-group">
              <label for="wads-csv-phone-col">Columna de Número de Teléfono</label>
              <select id="wads-csv-phone-col" class="wads-select"></select>

              <!-- Peru / Country Code Toggle Card -->
              <div class="wads-cc-card active" id="wads-cc-card">
                <div class="wads-cc-info">
                  <div class="wads-cc-title">
                    <span>🇵🇪 Código de país (+51 Perú)</span>
                  </div>
                  <div class="wads-cc-sub">Anteponer +51 automáticamente a cada número</div>
                </div>
                <div class="wads-cc-right">
                  <input type="text" id="wads-cc-prefix" class="wads-cc-input" value="+51" title="Código de país">
                  <div class="wads-switch-wrap">
                    <span class="wads-switch-status on" id="wads-cc-status">SÍ</span>
                    <label class="wads-switch-btn" for="wads-cc-toggle">
                      <input type="checkbox" id="wads-cc-toggle" class="wads-switch-checkbox" checked>
                      <span class="wads-switch-rail">
                        <span class="wads-switch-circle"></span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div id="wads-csv-phone-preview" class="wads-phone-preview-box" style="display: none;"></div>
            </div>

            <div class="wads-form-group">
              <label for="wads-csv-message">Plantilla del Mensaje <span style="color: var(--wads-danger);">*Obligatorio</span></label>
              <textarea id="wads-csv-message" class="wads-textarea" style="min-height: 90px;" placeholder="Hola {Nombre}, adjunto enviamos tu información..."></textarea>
              <div class="wads-hint">Haz clic en una columna para insertarla en tu plantilla:</div>
              <div class="wads-var-chips" id="wads-var-chips"></div>
            </div>

            <!-- Attachment Box CSV -->
            ${renderAttachmentSectionHTML('csv')}

            <div class="wads-actions">
              <button class="wads-btn wads-btn-primary" id="wads-start-csv-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                Iniciar Campaña desde Archivo
              </button>
            </div>
          </div>
        </div>

        <!-- Tab 3: Settings & Logs -->
        <div class="wads-tab-panel" id="wads-tab-settings">
          <div class="wads-form-group">
            <label>Intervalo Aleatorio entre Mensajes (Segundos)</label>
            <div class="wads-delay-row">
              <span>Mín:</span>
              <input type="number" id="wads-delay-min" class="wads-input" value="5" min="2" max="120">
              <span>Máx:</span>
              <input type="number" id="wads-delay-max" class="wads-input" value="10" min="3" max="180">
            </div>
            <div class="wads-hint">Añadir un intervalo natural (ej. 5–15 segundos) ayuda a prevenir la detección automática de spam de WhatsApp.</div>
          </div>

          <div class="wads-form-group" style="margin-top: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label style="margin-bottom: 0;">Registro de Envíos (<span id="wads-log-count">0</span>)</label>
              <div style="display: flex; gap: 6px;">
                <button class="wads-btn wads-btn-secondary" style="padding: 4px 8px; font-size: 11px;" id="wads-export-logs-btn">Exportar CSV</button>
                <button class="wads-btn wads-btn-secondary" style="padding: 4px 8px; font-size: 11px;" id="wads-clear-logs-btn">Limpiar</button>
              </div>
            </div>
            <div class="wads-logs-container">
              <table class="wads-table" id="wads-logs-table">
                <thead>
                  <tr>
                    <th>Teléfono</th>
                    <th>Estado</th>
                    <th>Hora</th>
                  </tr>
                </thead>
                <tbody id="wads-logs-body">
                  <tr><td colspan="3" style="text-align: center; color: var(--wads-text-muted);">Sin registros aún</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(drawer);
    setupEventListeners();
  }

  function renderAttachmentSectionHTML(prefix) {
    return `
      <!-- Bulletproof Clean Toggle Card -->
      <div class="wads-toggle-card" id="wads-toggle-card-${prefix}">
        <div class="wads-toggle-info">
          <div class="wads-toggle-title">
            <svg class="wads-toggle-icon" viewBox="0 0 24 24">
              <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
            </svg>
            <span>Adjuntar Imagen o Documento</span>
          </div>
          <div class="wads-toggle-sub">Comparte archivos multimedia junto con tu mensaje de texto obligatorio</div>
        </div>
        <div class="wads-switch-wrap">
          <span class="wads-switch-status" id="wads-switch-status-${prefix}">NO</span>
          <label class="wads-switch-btn" for="wads-attach-toggle-${prefix}">
            <input type="checkbox" id="wads-attach-toggle-${prefix}" class="wads-switch-checkbox">
            <span class="wads-switch-rail">
              <span class="wads-switch-circle"></span>
            </span>
          </label>
        </div>
      </div>

      <!-- Attachment Configuration Box -->
      <div id="wads-attach-section-${prefix}" class="wads-attach-section" style="display: none;">
        
        <!-- Source Selector: Mutually Exclusive Option Cards -->
        <div class="wads-option-selector-title">Elige la opción de adjunto (Selecciona una):</div>
        <div class="wads-source-cards">
          <!-- Option 1: Self-Chat Forwarding -->
          <div class="wads-source-card active" id="wads-card-self-${prefix}" data-src="self">
            <div class="wads-source-card-header">
              <div class="wads-source-radio">
                <span class="wads-radio-dot"></span>
              </div>
              <div class="wads-source-card-title">Opción 1: Desde Mi Chat (Recomendado)</div>
            </div>
            <div class="wads-source-card-desc">Reenvía archivos enviados a tu chat personal (Tú)</div>
          </div>

          <!-- Option 2: Direct File Upload -->
          <div class="wads-source-card" id="wads-card-upload-${prefix}" data-src="upload">
            <div class="wads-source-card-header">
              <div class="wads-source-radio">
                <span class="wads-radio-dot"></span>
              </div>
              <div class="wads-source-card-title">Opción 2: Subida Directa</div>
            </div>
            <div class="wads-source-card-desc">Adjunta una imagen, video o documento desde tu computadora</div>
          </div>
        </div>

        <!-- Option 1 Subpanel: Self-Chat Detection -->
        <div id="wads-self-panel-${prefix}" class="wads-subpanel">
          <div class="wads-subpanel-instructions">
            <strong>Cómo usar el reenvío desde tu Chat Personal:</strong>
            <ol style="margin: 4px 0 8px 18px; padding: 0;">
              <li>Abre tu chat <em>Mensaje a ti mismo</em> (chat con "Tú").</li>
              <li>Envía o pega tu imagen, video o documento allí.</li>
              <li>Haz clic en <strong>Detectar multimedia de Mi Chat</strong> abajo.</li>
            </ol>
          </div>

          <div style="display: flex; gap: 7px; margin-bottom: 10px; flex-wrap: wrap;">
            <button type="button" class="wads-btn wads-btn-secondary" id="wads-attach-photo-${prefix}" title="Abre tu chat y abre inmediatamente el selector de fotos" style="font-size: 12px; padding: 7px 10px; flex: 1 1 calc(50% - 4px); justify-content: center;">
              📷 Foto / Video
            </button>
            <button type="button" class="wads-btn wads-btn-secondary" id="wads-attach-doc-${prefix}" title="Abre tu chat y abre inmediatamente el selector de documentos" style="font-size: 12px; padding: 7px 10px; flex: 1 1 calc(50% - 4px); justify-content: center;">
              📄 Documento
            </button>
            <button type="button" class="wads-btn wads-btn-secondary" id="wads-detect-btn-${prefix}" title="Escanear chat en busca del último archivo multimedia enviado" style="font-size: 12px; padding: 8px 10px; flex: 1 1 100%; justify-content: center;">
              🔍 Detectar multimedia
            </button>
          </div>

          <div id="wads-detect-status-${prefix}" class="wads-detect-status"></div>

          <!-- Detected Media Preview Card -->
          <div id="wads-self-preview-${prefix}" class="wads-detected-card" style="display: none;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                <div id="wads-self-thumb-${prefix}" class="wads-media-thumb">
                  <span>📷</span>
                </div>
                <div style="overflow: hidden;">
                  <div id="wads-self-title-${prefix}" style="font-size: 13px; font-weight: 600; color: #00a884;">Detectado desde Mi Chat</div>
                  <div id="wads-self-desc-${prefix}" style="font-size: 11px; color: var(--wads-text-muted); text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 220px;">Listo para reenviar a los contactos</div>
                  <div id="wads-self-time-${prefix}" style="font-size: 10.5px; color: #8696a0; margin-top: 2px;"></div>
                </div>
              </div>
              <button type="button" id="wads-clear-self-${prefix}" title="Quitar archivo detectado" class="wads-remove-btn">✕</button>
            </div>
          </div>
        </div>

        <!-- Option 2 Subpanel: Direct Upload -->
        <div id="wads-upload-panel-${prefix}" class="wads-subpanel" style="display: none;">
          <div class="wads-subpanel-instructions">
            Selecciona una imagen, video o documento directamente desde tu dispositivo:
          </div>

          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <button type="button" class="wads-btn wads-btn-secondary" id="wads-pick-media-${prefix}" style="font-size: 12px; padding: 8px 12px;">
              📷 Elegir Imagen / Video
            </button>
            <button type="button" class="wads-btn wads-btn-secondary" id="wads-pick-doc-${prefix}" style="font-size: 12px; padding: 8px 12px;">
              📄 Elegir Documento
            </button>
            <input type="file" id="wads-media-input-${prefix}" accept="image/*,video/*" style="display: none;">
            <input type="file" id="wads-doc-input-${prefix}" accept="*" style="display: none;">
          </div>

          <!-- Uploaded File Preview Card -->
          <div id="wads-upload-card-${prefix}" class="wads-detected-card" style="display: none;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                <div class="wads-media-thumb">
                  <span id="wads-upload-icon-${prefix}" style="font-size: 18px;">📎</span>
                </div>
                <div style="overflow: hidden;">
                  <div id="wads-upload-name-${prefix}" style="font-size: 12.5px; font-weight: 600; color: #00a884; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 220px;"></div>
                  <div id="wads-upload-size-${prefix}" style="font-size: 11px; color: var(--wads-text-muted);"></div>
                </div>
              </div>
              <button type="button" id="wads-remove-upload-${prefix}" title="Quitar archivo" class="wads-remove-btn">✕</button>
            </div>
          </div>
        </div>

        <!-- Dispatch Sequence Order -->
        <div class="wads-sequence-box">
          <div style="font-size: 12px; font-weight: 600; color: var(--wads-text-main); margin-bottom: 6px;">
            Secuencia de Envío <span style="color: var(--wads-danger); font-size: 11px;">(El texto es obligatorio)</span>:
          </div>
          <label class="wads-radio-label">
            <input type="radio" name="wads-order-${prefix}" value="text_first" checked>
            <span>1. Enviar <strong>Texto primero</strong>, luego Adjunto <span style="color: #00a884; font-size: 11px; font-weight: 600;">(Recomendado)</span></span>
          </label>
          <label class="wads-radio-label">
            <input type="radio" name="wads-order-${prefix}" value="attachment_first">
            <span>2. Enviar <strong>Adjunto primero</strong>, luego Texto</span>
          </label>
        </div>
      </div>
    `;
  }

  function setupEventListeners() {
    document.getElementById('wads-close-btn').addEventListener('click', closeDrawer);

    // Tab switching
    document.querySelectorAll('.wads-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.wads-tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.wads-tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`wads-tab-${btn.dataset.tab}`).classList.add('active');
      });
    });

    // Manual start
    document.getElementById('wads-start-manual-btn').addEventListener('click', handleManualStart);

    // CSV input
    const dropzone = document.getElementById('wads-dropzone');
    const fileInput = document.getElementById('wads-csv-input');
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelect();
      }
    });

    // CSV start
    document.getElementById('wads-start-csv-btn').addEventListener('click', handleCsvStart);

    // Pause / Stop
    document.getElementById('wads-pause-btn').addEventListener('click', togglePause);
    document.getElementById('wads-stop-btn').addEventListener('click', () => {
      if (!state.isRunning) {
        document.getElementById('wads-progress-card').classList.remove('active');
      } else {
        abortSending();
      }
    });

    // Delay settings change
    document.getElementById('wads-delay-min').addEventListener('change', (e) => {
      state.delayMin = Math.max(2, parseInt(e.target.value) || 5);
      saveSettings();
    });
    document.getElementById('wads-delay-max').addEventListener('change', (e) => {
      state.delayMax = Math.max(state.delayMin, parseInt(e.target.value) || 10);
      saveSettings();
    });

    // Log buttons
    document.getElementById('wads-export-logs-btn').addEventListener('click', exportLogs);
    document.getElementById('wads-clear-logs-btn').addEventListener('click', clearLogs);

    // Wire up Attachment controls for both 'manual' and 'csv' tabs
    setupAttachmentListeners('manual');
    setupAttachmentListeners('csv');

    // Wire up Country Code Prefix toggle
    setupCountryCodeListeners();
  }

  function formatPhoneNumber(rawPhone, enablePrefix = state.enableCountryCode, prefix = state.countryCodePrefix) {
    let clean = String(rawPhone || '').replace(/\D/g, '');
    if (!clean) return '';
    // If Peruvian number entered with leading 0 (e.g. 0958921873 -> 958921873)
    if (clean.length === 10 && clean.startsWith('0')) {
      clean = clean.slice(1);
    }
    if (enablePrefix) {
      const p = String(prefix || '51').replace(/\D/g, '');
      if (p && !clean.startsWith(p)) {
        clean = p + clean;
      }
    }
    return clean;
  }

  function setupCountryCodeListeners() {
    const card = document.getElementById('wads-cc-card');
    const toggle = document.getElementById('wads-cc-toggle');
    const prefixInput = document.getElementById('wads-cc-prefix');

    if (card) {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.wads-switch-btn') || e.target.closest('#wads-cc-prefix')) return;
        if (toggle) {
          toggle.checked = !toggle.checked;
          state.enableCountryCode = toggle.checked;
          syncCountryCodeUI();
          updatePhoneColumnPreview();
          saveSettings();
        }
      });
    }

    if (toggle) {
      toggle.addEventListener('change', (e) => {
        state.enableCountryCode = e.target.checked;
        syncCountryCodeUI();
        updatePhoneColumnPreview();
        saveSettings();
      });
    }

    if (prefixInput) {
      prefixInput.addEventListener('input', (e) => {
        const digits = e.target.value.replace(/\D/g, '');
        state.countryCodePrefix = digits || '51';
        updatePhoneColumnPreview();
        saveSettings();
      });
      prefixInput.addEventListener('blur', (e) => {
        const digits = e.target.value.replace(/\D/g, '') || '51';
        state.countryCodePrefix = digits;
        e.target.value = '+' + digits;
        updatePhoneColumnPreview();
        saveSettings();
      });
    }
  }

  function syncCountryCodeUI() {
    const card = document.getElementById('wads-cc-card');
    const toggle = document.getElementById('wads-cc-toggle');
    const status = document.getElementById('wads-cc-status');
    const prefixInput = document.getElementById('wads-cc-prefix');

    if (toggle) toggle.checked = state.enableCountryCode;
    if (status) {
      status.textContent = state.enableCountryCode ? 'SÍ' : 'NO';
      status.className = 'wads-switch-status' + (state.enableCountryCode ? ' on' : '');
    }
    if (card) {
      if (state.enableCountryCode) card.classList.add('active');
      else card.classList.remove('active');
    }
    if (prefixInput) {
      const code = state.countryCodePrefix ? `+${state.countryCodePrefix}` : '+51';
      prefixInput.value = code;
    }
  }

  function setupAttachmentListeners(prefix) {
    const card = document.getElementById(`wads-toggle-card-${prefix}`);
    const toggle = document.getElementById(`wads-attach-toggle-${prefix}`);
    const cardSelf = document.getElementById(`wads-card-self-${prefix}`);
    const cardUpload = document.getElementById(`wads-card-upload-${prefix}`);
    const attachPhotoBtn = document.getElementById(`wads-attach-photo-${prefix}`);
    const attachDocBtn = document.getElementById(`wads-attach-doc-${prefix}`);
    const detectBtn = document.getElementById(`wads-detect-btn-${prefix}`);
    const clearSelfBtn = document.getElementById(`wads-clear-self-${prefix}`);

    const mediaBtn = document.getElementById(`wads-pick-media-${prefix}`);
    const docBtn = document.getElementById(`wads-pick-doc-${prefix}`);
    const mediaInput = document.getElementById(`wads-media-input-${prefix}`);
    const docInput = document.getElementById(`wads-doc-input-${prefix}`);
    const removeUploadBtn = document.getElementById(`wads-remove-upload-${prefix}`);

    // Card click toggles the switch
    if (card) {
      card.addEventListener('click', (e) => {
        // If clicking directly on or inside label/input, let native change event handle it
        if (e.target.closest('.wads-switch-btn')) return;
        if (toggle) {
          toggle.checked = !toggle.checked;
          state.enableAttachment = toggle.checked;
          syncAttachmentUI();
        }
      });
    }

    if (toggle) {
      toggle.addEventListener('change', (e) => {
        state.enableAttachment = e.target.checked;
        syncAttachmentUI();
      });
    }

    // Mutually exclusive Option 1 (Self) and Option 2 (Upload)
    if (cardSelf) {
      cardSelf.addEventListener('click', () => {
        state.attachmentSource = 'self';
        syncSourceCards();
      });
    }

    if (cardUpload) {
      cardUpload.addEventListener('click', () => {
        state.attachmentSource = 'upload';
        syncSourceCards();
      });
    }

    if (attachPhotoBtn) {
      attachPhotoBtn.addEventListener('click', () => {
        openSelfChatAndAttachmentMenu(prefix, 'image');
      });
    }

    if (attachDocBtn) {
      attachDocBtn.addEventListener('click', () => {
        openSelfChatAndAttachmentMenu(prefix, 'document');
      });
    }

    // Detect media in self chat
    if (detectBtn) {
      detectBtn.addEventListener('click', () => {
        handleDetectSelfMedia(prefix);
      });
    }

    if (clearSelfBtn) {
      clearSelfBtn.addEventListener('click', () => {
        state.selfChatMedia = null;
        syncAttachmentUI();
      });
    }

    // Direct Upload Handlers
    if (mediaBtn) mediaBtn.addEventListener('click', () => mediaInput.click());
    if (docBtn) docBtn.addEventListener('click', () => docInput.click());

    if (mediaInput) {
      mediaInput.addEventListener('change', () => {
        if (mediaInput.files && mediaInput.files[0]) {
          state.uploadedFile = mediaInput.files[0];
          state.uploadedType = 'image';
          syncAttachmentUI();
        }
      });
    }

    if (docInput) {
      docInput.addEventListener('change', () => {
        if (docInput.files && docInput.files[0]) {
          state.uploadedFile = docInput.files[0];
          state.uploadedType = 'document';
          syncAttachmentUI();
        }
      });
    }

    if (removeUploadBtn) {
      removeUploadBtn.addEventListener('click', () => {
        state.uploadedFile = null;
        syncAttachmentUI();
      });
    }

    // Sequence radio buttons
    document.querySelectorAll(`input[name="wads-order-${prefix}"]`).forEach((radio) => {
      radio.addEventListener('change', (e) => {
        state.attachmentOrder = e.target.value;
        syncAttachmentOrder(e.target.value);
      });
    });
  }

  function syncSourceCards() {
    ['manual', 'csv'].forEach((prefix) => {
      const cardSelf = document.getElementById(`wads-card-self-${prefix}`);
      const cardUpload = document.getElementById(`wads-card-upload-${prefix}`);
      const selfPanel = document.getElementById(`wads-self-panel-${prefix}`);
      const uploadPanel = document.getElementById(`wads-upload-panel-${prefix}`);

      if (state.attachmentSource === 'self') {
        if (cardSelf) cardSelf.classList.add('active');
        if (cardUpload) cardUpload.classList.remove('active');
        if (selfPanel) selfPanel.style.display = 'block';
        if (uploadPanel) uploadPanel.style.display = 'none';
      } else {
        if (cardSelf) cardSelf.classList.remove('active');
        if (cardUpload) cardUpload.classList.add('active');
        if (selfPanel) selfPanel.style.display = 'none';
        if (uploadPanel) uploadPanel.style.display = 'block';
      }
    });
  }

  function syncAttachmentUI() {
    ['manual', 'csv'].forEach((prefix) => {
      const card = document.getElementById(`wads-toggle-card-${prefix}`);
      const toggle = document.getElementById(`wads-attach-toggle-${prefix}`);
      const statusText = document.getElementById(`wads-switch-status-${prefix}`);
      const section = document.getElementById(`wads-attach-section-${prefix}`);

      if (toggle) toggle.checked = state.enableAttachment;
      if (statusText) {
        statusText.textContent = state.enableAttachment ? 'SÍ' : 'NO';
        statusText.className = 'wads-switch-status' + (state.enableAttachment ? ' on' : '');
      }
      if (card) {
        if (state.enableAttachment) card.classList.add('active');
        else card.classList.remove('active');
      }
      if (section) section.style.display = state.enableAttachment ? 'block' : 'none';

      // Self-Chat preview card
      const selfPreview = document.getElementById(`wads-self-preview-${prefix}`);
      const selfTitle = document.getElementById(`wads-self-title-${prefix}`);
      const selfDesc = document.getElementById(`wads-self-desc-${prefix}`);
      const selfTime = document.getElementById(`wads-self-time-${prefix}`);
      const selfThumb = document.getElementById(`wads-self-thumb-${prefix}`);

      if (state.selfChatMedia) {
        if (selfPreview) selfPreview.style.display = 'block';
        if (selfTitle) selfTitle.textContent = state.selfChatMedia.label;
        if (selfDesc) selfDesc.textContent = state.selfChatMedia.desc;
        if (selfTime) selfTime.textContent = state.selfChatMedia.time || '';
        if (selfThumb) {
          if (state.selfChatMedia.thumbUrl) {
            selfThumb.innerHTML = `<img src="${state.selfChatMedia.thumbUrl}" style="width: 100%; height: 100%; object-fit: cover;">`;
          } else {
            selfThumb.innerHTML = `<span style="font-size: 18px;">${state.selfChatMedia.type === 'document' ? '📄' : '📷'}</span>`;
          }
        }
      } else {
        if (selfPreview) selfPreview.style.display = 'none';
      }

      // Direct Upload preview card
      const uploadCard = document.getElementById(`wads-upload-card-${prefix}`);
      const uploadName = document.getElementById(`wads-upload-name-${prefix}`);
      const uploadSize = document.getElementById(`wads-upload-size-${prefix}`);
      const uploadIcon = document.getElementById(`wads-upload-icon-${prefix}`);

      if (state.uploadedFile) {
        if (uploadCard) uploadCard.style.display = 'flex';
        if (uploadName) uploadName.textContent = state.uploadedFile.name;
        if (uploadSize) uploadSize.textContent = formatBytes(state.uploadedFile.size);
        if (uploadIcon) uploadIcon.textContent = state.uploadedType === 'image' ? '📷' : '📄';
      } else {
        if (uploadCard) uploadCard.style.display = 'none';
      }
    });

    syncSourceCards();
  }

  function syncAttachmentOrder(order) {
    ['manual', 'csv'].forEach((prefix) => {
      const radio = document.querySelector(`input[name="wads-order-${prefix}"][value="${order}"]`);
      if (radio) radio.checked = true;
    });
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getSelfPhoneNumber() {
    try {
      // 1. Exact WARocket logic from last-wid and last-wid-md
      const wid = window.localStorage.getItem('last-wid');
      const widMd = window.localStorage.getItem('last-wid-md');
      if (wid) {
        try {
          const parsed = JSON.parse(wid);
          const num = String(parsed).split('@')[0].split(':')[0].replace(/\D/g, '');
          if (num.length >= 7) return num;
        } catch (e) {
          const num = String(wid).split('@')[0].split(':')[0].replace(/\D/g, '');
          if (num.length >= 7) return num;
        }
      }
      if (widMd) {
        try {
          const parsed = JSON.parse(widMd);
          const num = String(parsed).split('@')[0].split(':')[0].replace(/\D/g, '');
          if (num.length >= 7) return num;
        } catch (e) {
          const num = String(widMd).split('@')[0].split(':')[0].replace(/\D/g, '');
          if (num.length >= 7) return num;
        }
      }

      // 2. Scan other localStorage entries for any WhatsApp user JID
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.includes('wid') || k.includes('user') || k.includes('me') || k.includes('remember') || k.includes('session')) {
          const val = localStorage.getItem(k);
          if (val) {
            const match = val.match(/(\d{7,15})(?::\d+)?@c\.us/);
            if (match) return match[1];
          }
        }
      }
    } catch (err) {
      console.warn('[getSelfPhoneNumber error]', err);
    }

    // 3. Fallback: Parse from visible DOM (in WhatsApp Web search results or chat list)
    try {
      const candidates = Array.from(document.querySelectorAll('#side span, #pane-side span, #main header span'));
      for (const el of candidates) {
        const text = el.textContent || '';
        if (
          text.includes('(Tú)') ||
          text.includes('(tú)') ||
          text.includes('(Tu)') ||
          text.includes('(tu)') ||
          text.includes('(You)') ||
          text.includes('(you)') ||
          text.includes('(Você)') ||
          text.includes('(você)')
        ) {
          const digits = text.replace(/\D/g, '');
          if (digits.length >= 7) return digits;
        }
      }
    } catch (err) { }

    return '';
  }

  function isCurrentlyInSelfChat() {
    const header = document.querySelector('#main header');
    if (!header) return false;
    const text = (header.textContent || '').toLowerCase();
    const selfPhone = getSelfPhoneNumber();
    if (
      text.includes('(tú)') ||
      text.includes('(tu)') ||
      text.includes('(you)') ||
      text.includes('(você)') ||
      text.includes('mensaje a ti mismo') ||
      text.includes('mensajes guardados') ||
      text.includes('envíate un mensaje') ||
      text.includes('envía un mensaje a este mismo número') ||
      text.includes('message yourself') ||
      text.includes('mensagens salvas') ||
      text.includes('envie uma mensagem para si') ||
      /\b(tú|tu|you|você)\b/i.test(text) ||
      (selfPhone && selfPhone.length >= 6 && text.includes(selfPhone.slice(-6)))
    ) {
      return true;
    }
    return false;
  }

  function clickSelfChatInList() {
    const sideEl = document.querySelector('#side') || document.querySelector('#pane-side') || document.body;
    const selfPhone = getSelfPhoneNumber();

    // Find all text elements containing "(Tú)", "(You)", "Mensaje a ti mismo", etc.
    const candidates = Array.from(sideEl.querySelectorAll('span, div, p')).filter((el) => {
      if (el.closest('#wads-drawer, #wads-fab')) return false;
      if (el.children.length > 2) return false;
      const t = (el.textContent || '').trim().toLowerCase();
      return (
        t.includes('(tú)') ||
        t.includes('(tu)') ||
        t === 'tú' ||
        t === 'tu' ||
        t.includes('mensaje a ti mismo') ||
        t.includes('mensajes guardados') ||
        t.includes('envíate un mensaje') ||
        t.includes('envía un mensaje a este mismo número') ||
        t.includes('(you)') ||
        t.includes('(você)') ||
        t === 'you' ||
        t === 'você' ||
        t.includes('message yourself') ||
        t.includes('mensagens salvas') ||
        t.includes('envie uma mensagem para si') ||
        (selfPhone && selfPhone.length >= 7 && t.includes(selfPhone.slice(-8)))
      );
    });

    for (const el of candidates) {
      if (el.closest('#wads-drawer, #wads-fab')) continue;
      const row =
        el.closest(
          'div[tabindex="-1"], [data-testid="cell-frame-container"], [data-testid="chat-list-item"], div[role="listitem"], div[role="row"], div[role="button"]'
        ) || el.parentElement;

      if (row && !row.closest('#wads-drawer, #wads-fab')) {
        row.scrollIntoView({ block: 'nearest' });
        row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        row.click();
        return true;
      }
    }
    return false;
  }

  function clearWhatsAppSearch() {
    const clearBtn = document.querySelector(
      '#side button[aria-label*="Cancel"], #side span[data-icon="x-alt"], #side span[data-icon="x"], #side [data-icon="search"]'
    );
    if (clearBtn) {
      (clearBtn.closest('button') || clearBtn).click();
    }
  }

  async function openSelfChat() {
    if (isCurrentlyInSelfChat()) return true;

    // Strategy 1: Check if Self Chat row is currently visible anywhere on the left panel (#side)
    if (clickSelfChatInList()) {
      await sleep(1000);
      if (isCurrentlyInSelfChat()) return true;
    }

    // Strategy 2: Direct URL router navigation (Proven WARocket method)
    const phone = getSelfPhoneNumber();
    if (phone) {
      await navigateToChat(phone, '');
      await sleep(1500);
      if (isCurrentlyInSelfChat()) return true;
    }

    // Strategy 3: Chat search bar (#side) - Search 'Tú' (Spanish), 'Tu', and 'You'
    const searchBox = document.querySelector(
      '#side div[contenteditable="true"], #pane-side div[contenteditable="true"], #side input[role="textbox"]'
    );
    if (searchBox) {
      const searchTerms = ['Tú', 'Tu', 'You'];
      for (const term of searchTerms) {
        searchBox.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, term);
        searchBox.dispatchEvent(new InputEvent('input', { bubbles: true, data: term, inputType: 'insertText' }));
        await sleep(800);

        // In search results view, click the Self-Chat item
        if (clickSelfChatInList()) {
          await sleep(1000);
          if (isCurrentlyInSelfChat()) {
            clearWhatsAppSearch();
            return true;
          }
        }

        // If specific '(Tú)' / '(You)' match didn't trigger, click the first search result in the list
        const firstChat = document.querySelector(
          '#side div[data-testid="chat-list-search-results"] div[tabindex="-1"], #side div[tabindex="-1"], #pane-side div[tabindex="-1"], [data-testid="cell-frame-container"]'
        );
        if (firstChat) {
          firstChat.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          firstChat.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          firstChat.click();
          await sleep(1000);
          if (isCurrentlyInSelfChat()) {
            clearWhatsAppSearch();
            return true;
          }
        }
      }
    }

    return isCurrentlyInSelfChat();
  }

  // --- WhatsApp Native Attachment Menu Trigger ---

  async function openAttachmentMenuInChat(targetType = null) {
    const selectors = [
      '#main footer span[data-icon="plus"]',
      '#main footer span[data-icon="attach-menu-plus"]',
      '#main footer span[data-icon="plus-rounded"]',
      '#main footer span[data-icon="ic-attach-file"]',
      '#main footer [data-testid="clip"]',
      '#main footer [data-testid="attach-menu-plus"]',
      '#main footer button[aria-label*="Attach"]',
      '#main footer button[title*="Attach"]',
      '#main footer button[aria-label*="attach"]',
      '#main footer button[title*="attach"]',
      '#main footer button[aria-label*="Anexar"]',
      '#main footer button[title*="Anexar"]',
      '#main footer button[aria-label*="Adjuntar"]',
      '#main footer button[title*="Adjuntar"]',
      '#main footer div[role="button"][title*="Attach"]',
      '#main footer div[role="button"][aria-label*="Attach"]',
      'span[data-icon="plus"]',
      'span[data-icon="attach-menu-plus"]',
      'span[data-icon="plus-rounded"]',
      'span[data-icon="ic-attach-file"]',
      '[data-testid="clip"]'
    ];

    let plusBtn = null;
    for (let attempt = 0; attempt < 16; attempt++) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          plusBtn = el.closest('button') || el.closest('div[role="button"]') || el.parentElement || el;
          break;
        }
      }
      if (plusBtn) break;
      await sleep(250);
    }

    if (!plusBtn) return false;

    // Click the plus button to open the menu
    plusBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    plusBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    plusBtn.click();
    await sleep(400);

    // If targetType is requested ('image' or 'document'), click that menu item directly (WARocket style)
    if (targetType) {
      for (let attempt = 0; attempt < 8; attempt++) {
        let optionEl = null;
        if (targetType === 'document') {
          optionEl = document.querySelector(
            'ul li span[data-icon="document-page"], ul li span[data-icon="attach-document"], ul li span[data-icon="ic-attach-document"], [aria-label*="Document"], [aria-label*="Documento"], ul li:first-child button, ul li:first-child div[role="button"], #app > div > div > span:nth-child(8) > div > ul li:first-child'
          );
        } else if (targetType === 'image') {
          optionEl = document.querySelector(
            'ul li span[data-icon="attach-image"], ul li span[data-icon="photos"], ul li span[data-icon="camera"], [aria-label*="Photos"], [aria-label*="Fotos"], ul li:nth-child(2) button, ul li:nth-child(2) div[role="button"], #main footer div.copyable-area ul > div > div:nth-child(2) > li, #app > div > div > span:nth-child(8) > div > ul li:nth-child(2)'
          );
        }
        if (optionEl) {
          const btn = optionEl.closest('li, button, div[role="button"]') || optionEl;
          btn.click();
          return true;
        }
        await sleep(250);
      }
    }

    return true;
  }

  let autoDetectTimer = null;

  async function openSelfChatAndAttachmentMenu(prefix, targetType = null) {
    const statusEl = document.getElementById(`wads-detect-status-${prefix}`);
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.className = 'wads-detect-status scanning';
      statusEl.innerHTML = '💬 Navegando a tu chat personal ("Tú")...';
    }

    // 1. Ensure Self-Chat is active
    let inSelf = isCurrentlyInSelfChat();
    if (!inSelf) {
      await openSelfChat();
      await sleep(1000);
      inSelf = isCurrentlyInSelfChat();
    }

    if (!inSelf) {
      if (statusEl) {
        statusEl.className = 'wads-detect-status error';
        statusEl.innerHTML = '⚠️ No se pudo abrir el chat personal automáticamente. Por favor haz clic en tu chat "(Tú)" a la izquierda y vuelve a presionar este botón.';
      }
      return;
    }

    // 2. Trigger WhatsApp Web attachment menu
    if (statusEl) {
      statusEl.innerHTML = targetType === 'image'
        ? '📷 Abriendo selector de Foto/Video en tu chat...'
        : targetType === 'document'
          ? '📄 Abriendo selector de Documentos en tu chat...'
          : '📎 Abriendo opciones de adjunto en tu chat...';
    }

    const clicked = await openAttachmentMenuInChat(targetType);

    if (statusEl) {
      if (clicked) {
        statusEl.className = 'wads-detect-status success';
        if (targetType === 'image') {
          statusEl.innerHTML = '📷 <strong>¡Selector de fotos abierto!</strong> Elige tu foto o video, luego haz clic en Enviar en WhatsApp.<br><span style="font-size: 10.5px; color: #8696a0;">La extensión lo detectará automáticamente una vez enviado, o haz clic en "Detectar multimedia".</span>';
        } else if (targetType === 'document') {
          statusEl.innerHTML = '📄 <strong>¡Selector de documentos abierto!</strong> Elige tu documento, luego haz clic en Enviar en WhatsApp.<br><span style="font-size: 10.5px; color: #8696a0;">La extensión lo detectará automáticamente una vez enviado, o haz clic en "Detectar multimedia".</span>';
        } else {
          statusEl.innerHTML = '📎 <strong>¡Menú de adjuntos abierto!</strong> Elige Foto o Documento en el chat de la izquierda y haz clic en Enviar.<br><span style="font-size: 10.5px; color: #8696a0;">La extensión lo detectará automáticamente una vez enviado, o haz clic en "Detectar multimedia".</span>';
        }
      } else {
        statusEl.className = 'wads-detect-status scanning';
        statusEl.innerHTML = '💬 Ya estás en tu chat personal ("Tú"). Haz clic en el botón <strong>+</strong> junto al cuadro de mensaje a la izquierda para adjuntar tu archivo, luego haz clic en <strong>Detectar multimedia</strong>.';
      }
    }

    // 3. Start auto-detection watcher in the background
    startAutoDetectWatcher(prefix);
  }

  function startAutoDetectWatcher(prefix) {
    if (autoDetectTimer) clearInterval(autoDetectTimer);

    let attempts = 0;
    const maxAttempts = 40; // 40 * 1500ms = 60s

    autoDetectTimer = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts || state.selfChatMedia) {
        clearInterval(autoDetectTimer);
        autoDetectTimer = null;
        return;
      }

      const detection = await detectLastMediaInChat();
      if (detection && detection.success) {
        clearInterval(autoDetectTimer);
        autoDetectTimer = null;

        state.selfChatMedia = {
          type: detection.type,
          thumbUrl: detection.thumbUrl,
          label: detection.label,
          desc: detection.desc,
          time: detection.time,
        };

        const statusEl = document.getElementById(`wads-detect-status-${prefix}`);
        if (statusEl) {
          statusEl.className = 'wads-detect-status success';
          statusEl.innerHTML = `✓ ¡Detectado automáticamente: <strong>${detection.label}</strong>! Listo para la campaña.`;
          setTimeout(() => {
            if (statusEl) statusEl.style.display = 'none';
          }, 4000);
        }

        syncAttachmentUI();
      }
    }, 1500);
  }

  // --- Self-Chat Media Detection ---

  async function handleDetectSelfMedia(prefix) {
    const statusEl = document.getElementById(`wads-detect-status-${prefix}`);
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.className = 'wads-detect-status scanning';
      statusEl.innerHTML = '🔍 Escaneando chat en busca de imágenes, videos y documentos...';
    }

    // Step 1: Check if currently in Self Chat, if not auto-open
    const inSelf = isCurrentlyInSelfChat();
    if (!inSelf) {
      if (statusEl) statusEl.innerHTML = '💬 Navegando a tu chat personal ("Tú")...';
      const opened = await openSelfChat();
      if (opened) {
        await sleep(1500); // Wait for chat messages to mount
      }
    }

    // Step 2: Multi-vector media scan
    const detection = await detectLastMediaInChat();

    if (!detection.success) {
      if (statusEl) {
        statusEl.className = 'wads-detect-status error';
        statusEl.innerHTML = `⚠️ ${detection.message}`;
      }
      return;
    }

    // Step 3: Success!
    if (statusEl) {
      statusEl.className = 'wads-detect-status success';
      statusEl.innerHTML = `✓ ¡Detectado: <strong>${detection.label}</strong>! Listo para la campaña.`;
      setTimeout(() => {
        if (statusEl) statusEl.style.display = 'none';
      }, 4000);
    }

    state.selfChatMedia = {
      type: detection.type,
      thumbUrl: detection.thumbUrl,
      label: detection.label,
      desc: detection.desc,
      time: detection.time,
    };

    syncAttachmentUI();
  }

  function inspectMessageRow(row) {
    if (!row || row.closest('header, footer, [data-testid="chat-avatar"]')) {
      return { isMedia: false };
    }

    // A. Check for Document
    const docIcon = row.querySelector(
      'span[data-icon*="document"], span[data-icon*="doc"], span[data-icon*="pdf"], span[data-icon="download"], span[data-icon="default-document"], [data-testid*="document"], [data-testid="document-bubble"], [data-testid="audio-bubble"]'
    );

    let filename = '';
    // Look for filename in title attribute
    const titleEl = row.querySelector('span[title*="."], div[title*="."]');
    if (titleEl) {
      const t = titleEl.getAttribute('title') || '';
      if (/\.[a-z0-9]{2,5}$/i.test(t.trim())) {
        filename = t.trim();
      }
    }

    // Look for filename in inner text
    if (!filename) {
      const candidates = Array.from(row.querySelectorAll('span, div, p')).filter((e) => e.children.length === 0);
      for (const el of candidates) {
        const txt = (el.textContent || '').trim();
        const m = txt.match(/[\w\-.\s()]+\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z|apk|mp3|wav|ogg)\b/i);
        if (m) {
          filename = m[0];
          break;
        }
      }
    }

    // Check for size info
    let sizeInfo = '';
    const allText = row.textContent || '';
    const sizeMatch = allText.match(/\b\d+(\.\d+)?\s*(KB|MB|GB|B|bytes)\b/i);
    if (sizeMatch) sizeInfo = sizeMatch[0];

    const hasDocForward = !!row.querySelector(
      'span[data-icon*="forward"], [data-testid="forward"], button[aria-label*="Forward"], button[aria-label*="forward"]'
    );

    const isDoc = !!docIcon || !!filename || (!!sizeMatch && hasDocForward) || !!row.querySelector('[data-testid*="document"]');

    if (isDoc) {
      const timeEl = row.querySelector('span[data-testid="msg-time"], .copyable-text [data-testid="msg-time"], span.bubble-time');
      const time = timeEl ? `Enviado: ${timeEl.textContent.trim()}` : '';

      return {
        isMedia: true,
        type: 'document',
        label: filename || 'Archivo de Documento',
        desc: sizeInfo ? `${sizeInfo} · Documento de Mi Chat` : 'Documento de Mi Chat',
        thumbUrl: null,
        time,
        row,
      };
    }

    // B. Check for Image / Video
    const img = row.querySelector('img[src*="blob:"], img[src*="whatsapp.net"], img[src*="data:image"]');
    const video = row.querySelector('video');
    const bgImg = Array.from(row.querySelectorAll('div[style*="blob:"]')).find((d) => d.style.backgroundImage && d.style.backgroundImage.includes('blob:'));

    if (img || video || bgImg) {
      const isVideo = !!video;
      let thumbUrl = null;
      if (img) thumbUrl = img.src;
      else if (bgImg) {
        const m = bgImg.style.backgroundImage.match(/url\(["']?(blob:[^"']+)["']?\)/);
        if (m) thumbUrl = m[1];
      }

      let desc = 'Foto de Mi Chat';
      const captionEl = row.querySelector('span.selectable-text, [data-testid="caption-container"]');
      if (captionEl && captionEl.textContent) {
        desc = `"${captionEl.textContent.trim().substring(0, 35)}..."`;
      }

      const timeEl = row.querySelector('span[data-testid="msg-time"], .copyable-text [data-testid="msg-time"], span.bubble-time');
      const time = timeEl ? `Enviado: ${timeEl.textContent.trim()}` : '';

      return {
        isMedia: true,
        type: isVideo ? 'video' : 'image',
        label: isVideo ? 'Archivo de Video' : 'Foto',
        desc,
        thumbUrl,
        time,
        row,
      };
    }

    // C. Check if this row has a media forward button
    if (hasDocForward) {
      const timeEl = row.querySelector('span[data-testid="msg-time"], span.bubble-time');
      const time = timeEl ? `Enviado: ${timeEl.textContent.trim()}` : '';
      return {
        isMedia: true,
        type: 'media',
        label: 'Elemento Multimedia',
        desc: 'Listo para reenviar desde Mi Chat',
        thumbUrl: null,
        time,
        row,
      };
    }

    return { isMedia: false };
  }

  async function detectLastMediaInChat() {
    const main = document.querySelector('#main, div[data-testid="conversation-panel-wrapper"]');
    if (!main) {
      return { success: false, message: 'Por favor abre un chat de WhatsApp primero.' };
    }

    // Give any lazily-rendered media a moment
    await sleep(250);

    // Get all message rows in conversation panel
    const messageRows = Array.from(main.querySelectorAll(
      'div[data-id], div[data-testid="msg-container"], div.message-out, div.message-in, div[role="row"]'
    )).filter((row) => !row.closest('header, footer'));

    // Scan backwards from newest message to oldest message (ensures recent file is picked!)
    for (let i = messageRows.length - 1; i >= 0; i--) {
      const row = messageRows[i];
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

      const inspection = inspectMessageRow(row);
      if (inspection.isMedia) {
        return {
          success: true,
          type: inspection.type,
          thumbUrl: inspection.thumbUrl,
          label: inspection.label,
          desc: inspection.desc,
          time: inspection.time,
        };
      }
    }

    // Fallback: Check for forward buttons in #main
    const fwdBtns = Array.from(main.querySelectorAll(
      'span[data-icon="forward-chat"], span[data-icon="forward-refreshed"], span[data-icon="forward"], [data-icon="wds-ic-forward-outline"], div[data-testid="forward"]'
    ));
    if (fwdBtns.length > 0) {
      const lastFwd = fwdBtns[fwdBtns.length - 1];
      const row = lastFwd.closest('div[data-id], div[role="row"], div[data-testid="msg-container"], .message-out, .message-in') || lastFwd.parentElement;
      if (row) {
        const inspection = inspectMessageRow(row);
        if (inspection.isMedia) {
          return {
            success: true,
            type: inspection.type,
            thumbUrl: inspection.thumbUrl,
            label: inspection.label,
            desc: inspection.desc,
            time: inspection.time,
          };
        }
      }
    }

    return {
      success: false,
      message: 'No se encontró ninguna imagen, video o documento reciente en este chat. Por favor envía o adjunta tu archivo en el chat a la izquierda y haz clic en Detectar multimedia de nuevo.',
    };
  }

  function openDrawer() {
    const drawer = document.getElementById('wads-drawer');
    const backdrop = document.getElementById('wads-backdrop');
    if (drawer) drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('active');
    updateBannerPanelToggleBtn();
  }

  function closeDrawer() {
    const drawer = document.getElementById('wads-drawer');
    const backdrop = document.getElementById('wads-backdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
    updateBannerPanelToggleBtn();
  }

  function toggleDrawer() {
    const drawer = document.getElementById('wads-drawer');
    if (drawer && drawer.classList.contains('open')) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  function updateBannerPanelToggleBtn() {
    const btn = document.getElementById('wads-banner-panel-btn');
    if (!btn) return;
    const drawer = document.getElementById('wads-drawer');
    const isOpen = drawer && drawer.classList.contains('open');

    if (isOpen) {
      btn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        <span>Minimizar Panel</span>
      `;
      btn.title = 'Minimizar panel de la extensión para ver WhatsApp con claridad';
    } else {
      btn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
        <span>Abrir Panel</span>
      `;
      btn.title = 'Abrir panel de la extensión para ver el progreso y registros';
    }
  }

  // --- File Handling (Excel & CSV) ---

  function handleFileSelect() {
    const input = document.getElementById('wads-csv-input');
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    document.getElementById('wads-file-name').textContent = file.name;
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);

    if (isExcel) {
      if (typeof XLSX === 'undefined') {
        document.getElementById('wads-csv-status').textContent = 'Cargando lector de Excel... Por favor intenta de nuevo en un segundo.';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
          processParsedRows(rawRows, file.name, firstSheetName);
        } catch (err) {
          console.error('[Excel parsing error]', err);
          document.getElementById('wads-csv-status').textContent = 'Error al procesar el archivo Excel: ' + err.message;
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const rows = parseCSV(text);
        processParsedRows(rows, file.name);
      };
      reader.readAsText(file);
    }
  }

  function processParsedRows(rawRows, fileName, sheetName) {
    const cleanRows = rawRows
      .map((r) => (Array.isArray(r) ? r.map((c) => String(c).trim()) : []))
      .filter((r) => r.length > 0 && r.some((c) => c !== ''));

    if (cleanRows.length < 2) {
      document.getElementById('wads-csv-status').textContent = 'El archivo debe contener una fila de encabezados y al menos 1 contacto.';
      return;
    }

    state.csvHeaders = cleanRows[0];
    state.csvData = cleanRows.slice(1);

    const sheetInfo = sheetName ? ` (Hoja: ${sheetName})` : '';
    document.getElementById('wads-csv-status').textContent = `Se cargaron ${state.csvData.length} contactos con ${state.csvHeaders.length} columnas de ${fileName}${sheetInfo}.`;

    populateCsvColumns();
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(field.trim());
        field = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        row.push(field.trim());
        if (row.length > 0 && row.some((f) => f !== '')) {
          rows.push(row);
        }
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
    if (field !== '' || row.length > 0) {
      row.push(field.trim());
      if (row.some((f) => f !== '')) rows.push(row);
    }

    return rows;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updatePhoneColumnPreview() {
    const colSelect = document.getElementById('wads-csv-phone-col');
    const previewEl = document.getElementById('wads-csv-phone-preview');
    if (!colSelect || !previewEl || !state.csvData || state.csvData.length === 0) {
      if (previewEl) previewEl.style.display = 'none';
      return;
    }

    const colIdx = parseInt(colSelect.value, 10);
    const samples = [];
    for (let i = 0; i < state.csvData.length; i++) {
      const val = String(state.csvData[i][colIdx] || '').trim();
      if (val) {
        samples.push(val);
        if (samples.length >= 4) break;
      }
    }

    previewEl.style.display = 'block';

    if (samples.length === 0) {
      previewEl.innerHTML = `<span style="color: var(--wads-text-muted);">No se encontraron datos en esta columna.</span>`;
      return;
    }

    // Check if samples appear to be phone numbers (contains at least 6 digits)
    const hasDigits = samples.some((s) => s.replace(/\D/g, '').length >= 6);
    const badgesHtml = samples.map((s) => {
      const formatted = formatPhoneNumber(s, state.enableCountryCode, state.countryCodePrefix);
      const display = state.enableCountryCode && formatted ? `+${formatted}` : escapeHtml(s);
      return `<span class="wads-preview-badge">${display}</span>`;
    }).join('');
    const moreText = state.csvData.length > 4 ? `<span class="wads-preview-more">... (${state.csvData.length} filas)</span>` : '';
    const warningNotice = !hasDigits
      ? `<div style="color: #ffb74d; font-size: 11px; margin-top: 5px; font-weight: 500;">⚠️ Aviso: Esta columna parece contener texto y no números. Asegúrate de haber seleccionado la columna de teléfonos.</div>`
      : '';

    previewEl.innerHTML = `
      <div class="wads-preview-label">Vista previa (primeros 4 números):</div>
      <div class="wads-preview-badges">
        ${badgesHtml}
        ${moreText}
      </div>
      ${warningNotice}
    `;
  }

  function populateCsvColumns() {
    const colSelect = document.getElementById('wads-csv-phone-col');
    const chipWrapper = document.getElementById('wads-var-chips');
    colSelect.innerHTML = '';
    chipWrapper.innerHTML = '';

    let bestPhoneIdx = 0;
    state.csvHeaders.forEach((header, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${header} (Col. ${idx + 1})`;
      colSelect.appendChild(opt);

      if (/phone|mobile|number|cell|tel|whatsapp/i.test(header)) {
        bestPhoneIdx = idx;
      }

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wads-var-chip';
      chip.textContent = `{${header}}`;
      chip.addEventListener('click', () => {
        const textarea = document.getElementById('wads-csv-message');
        insertVariable(textarea, `{${header}}`);
      });
      chipWrapper.appendChild(chip);
    });

    colSelect.value = bestPhoneIdx;
    colSelect.onchange = updatePhoneColumnPreview;
    updatePhoneColumnPreview();

    document.getElementById('wads-csv-fields-wrapper').style.display = 'block';
  }

  function insertVariable(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    textarea.value = val.substring(0, start) + text + val.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
  }

  // --- Campaign Starters ---

  function handleManualStart() {
    const rawNumbers = document.getElementById('wads-manual-numbers').value;
    const message = document.getElementById('wads-manual-message').value.trim();

    // Mandatory Text Check
    if (!message) {
      alert('¡El texto del mensaje es obligatorio! Por favor ingresa tu mensaje.');
      return;
    }

    // Attachment validation if enabled
    if (state.enableAttachment) {
      if (state.attachmentSource === 'self' && !state.selfChatMedia) {
        alert('El adjunto está activado desde "Mi Chat", pero aún no se ha detectado ningún archivo multimedia.\n\nPor favor abre tu chat personal ("Tú"), envía tu imagen/documento y haz clic en "Detectar multimedia".');
        return;
      }
      if (state.attachmentSource === 'upload' && !state.uploadedFile) {
        alert('El adjunto está activado desde "Subida Directa", pero no hay ningún archivo seleccionado. Por favor elige un archivo o desactiva el adjunto.');
        return;
      }
    }

    const numbers = rawNumbers
      .split(/[\n,;]+/)
      .map((n) => n.replace(/\D/g, ''))
      .filter((n) => n.length >= 7);

    if (numbers.length === 0) {
      alert('Por favor ingresa números de teléfono válidos con código de país.');
      return;
    }

    const queue = numbers.map((phone) => ({ phone, message }));
    startQueue(queue);
  }

  function handleCsvStart() {
    if (!state.csvData || state.csvData.length === 0) {
      alert('Por favor sube primero un archivo Excel o CSV válido.');
      return;
    }

    const phoneColIdx = parseInt(document.getElementById('wads-csv-phone-col').value, 10);
    const template = document.getElementById('wads-csv-message').value.trim();

    // Mandatory Text Check
    if (!template) {
      alert('¡La plantilla del mensaje es obligatoria! Por favor ingresa la plantilla de tu mensaje.');
      return;
    }

    // Attachment validation if enabled
    if (state.enableAttachment) {
      if (state.attachmentSource === 'self' && !state.selfChatMedia) {
        alert('El adjunto está activado desde "Mi Chat", pero aún no se ha detectado ningún archivo multimedia.\n\nPor favor abre tu chat personal ("Tú"), envía tu imagen/documento y haz clic en "Detectar multimedia".');
        return;
      }
      if (state.attachmentSource === 'upload' && !state.uploadedFile) {
        alert('El adjunto está activado desde "Subida Directa", pero no hay ningún archivo seleccionado. Por favor elige un archivo o desactiva el adjunto.');
        return;
      }
    }

    const queue = [];
    state.csvData.forEach((row) => {
      const rawPhone = row[phoneColIdx] || '';
      const cleanPhone = formatPhoneNumber(rawPhone, state.enableCountryCode, state.countryCodePrefix);
      if (cleanPhone.length >= 7) {
        let msg = template;
        state.csvHeaders.forEach((header, idx) => {
          const val = row[idx] || '';
          msg = msg.replaceAll(`{${header}}`, val);
        });
        queue.push({ phone: cleanPhone, message: msg });
      }
    });

    if (queue.length === 0) {
      alert('No se encontraron números de teléfono válidos en la columna seleccionada.');
      return;
    }

    startQueue(queue);
  }

  // --- Dispatch Engine ---

  function startQueue(queue) {
    state.queue = queue;
    state.currentIndex = 0;
    state.isRunning = true;
    state.isPaused = false;

    const progressCard = document.getElementById('wads-progress-card');
    progressCard.classList.add('active');

    const pauseBtn = document.getElementById('wads-pause-btn');
    pauseBtn.style.display = 'inline-flex';
    pauseBtn.textContent = '⏸ Pausar';
    pauseBtn.className = 'wads-btn wads-btn-secondary';

    const stopBtn = document.getElementById('wads-stop-btn');
    stopBtn.textContent = '⏹ Detener';
    stopBtn.className = 'wads-btn wads-btn-danger';

    updateProgressUI();
    showAutomationBanner();
    setStartButtonsState('running');

    processNext();
  }

  async function processNext() {
    if (!state.isRunning) return;

    if (state.isPaused) {
      updateStatus('Pausado. Haz clic en Reanudar para continuar.');
      return;
    }

    if (state.currentIndex >= state.queue.length) {
      finishQueue();
      return;
    }

    const item = state.queue[state.currentIndex];
    const hasAttachment = state.enableAttachment && (state.attachmentSource === 'self' ? !!state.selfChatMedia : !!state.uploadedFile);

    try {
      if (hasAttachment) {
        if (state.attachmentOrder === 'text_first') {
          // ==========================================
          // SEQUENCE 1: TEXT FIRST, THEN ATTACHMENT
          // ==========================================
          updateStatus(`[${state.currentIndex + 1}/${state.queue.length}] 1/2: Enviando texto a +${item.phone}...`);
          await navigateToChat(item.phone, item.message);
          const textOutcome = await waitForSendButtonOrError();

          if (!textOutcome.success) {
            logAttempt(item.phone, textOutcome.reason || 'Fallido', item.message);
          } else {
            // Text successfully sent! Wait 1.5s confirmation buffer
            await sleep(1500);

            // Step 2: Deliver attachment
            if (state.attachmentSource === 'self') {
              updateStatus(`[${state.currentIndex + 1}/${state.queue.length}] 2/2: Reenviando archivo desde Mi Chat a +${item.phone}...`);
              try {
                await forwardMediaFromSelfChat(item.phone);
                logAttempt(item.phone, 'Enviado (Texto + Archivo de Mi Chat)', item.message);
              } catch (fwdErr) {
                console.error('[Forward failed]', fwdErr);
                logAttempt(item.phone, `Enviado (Texto enviado, fallo al reenviar: ${fwdErr.message})`, item.message);
              }
            } else {
              // Direct upload
              updateStatus(`[${state.currentIndex + 1}/${state.queue.length}] 2/2: Adjuntando ${state.uploadedFile.name} a +${item.phone}...`);
              try {
                await sendAttachmentToActiveChat(state.uploadedFile, state.uploadedType);
                logAttempt(item.phone, 'Enviado (Texto + Archivo directo)', item.message);
              } catch (attErr) {
                console.error('[Direct attachment failed]', attErr);
                logAttempt(item.phone, `Enviado (Texto enviado, fallo al adjuntar: ${attErr.message})`, item.message);
              }
            }
          }
        } else {
          // ==========================================
          // SEQUENCE 2: ATTACHMENT FIRST, THEN TEXT
          // ==========================================
          if (state.attachmentSource === 'self') {
            // Forward media first
            updateStatus(`[${state.currentIndex + 1}/${state.queue.length}] 1/2: Reenviando archivo desde Mi Chat a +${item.phone}...`);
            let fwdSuccess = false;
            try {
              await forwardMediaFromSelfChat(item.phone);
              fwdSuccess = true;
            } catch (fwdErr) {
              console.error('[Forward failed]', fwdErr);
            }
            await sleep(1500);

            // Text second
            updateStatus(`[${state.currentIndex + 1}/${state.queue.length}] 2/2: Enviando texto a +${item.phone}...`);
            await navigateToChat(item.phone, item.message);
            const textOutcome = await waitForSendButtonOrError();
            if (fwdSuccess && textOutcome.success) {
              logAttempt(item.phone, 'Enviado (Archivo de Mi Chat + Texto)', item.message);
            } else if (fwdSuccess) {
              logAttempt(item.phone, 'Enviado (Solo archivo)', item.message);
            } else if (textOutcome.success) {
              logAttempt(item.phone, 'Enviado (Solo texto, fallo al reenviar)', item.message);
            } else {
              logAttempt(item.phone, 'Fallido', item.message);
            }
          } else {
            // Direct upload first
            updateStatus(`[${state.currentIndex + 1}/${state.queue.length}] 1/2: Abriendo chat y adjuntando ${state.uploadedFile.name}...`);
            await navigateToChat(item.phone, '');
            const chatReady = await waitForSendButtonOrError(true);

            if (!chatReady.success) {
              logAttempt(item.phone, chatReady.reason || 'Fallido', item.message);
            } else {
              await sleep(1000);
              await sendAttachmentToActiveChat(state.uploadedFile, state.uploadedType);
              await sleep(1500);

              // Text second
              updateStatus(`[${state.currentIndex + 1}/${state.queue.length}] 2/2: Enviando texto a +${item.phone}...`);
              await navigateToChat(item.phone, item.message);
              const textOutcome = await waitForSendButtonOrError();
              logAttempt(item.phone, textOutcome.success ? 'Enviado (Archivo directo + Texto)' : 'Enviado (Solo archivo)', item.message);
            }
          }
        }
      } else {
        // Plain text only
        updateStatus(`[${state.currentIndex + 1}/${state.queue.length}] Enviando texto a +${item.phone}...`);
        await navigateToChat(item.phone, item.message);
        const outcome = await waitForSendButtonOrError();
        logAttempt(item.phone, outcome.success ? 'Enviado' : outcome.reason || 'Fallido', item.message);
      }
    } catch (err) {
      console.error('[WA Sender Error]', err);
      logAttempt(item.phone, 'Error', err.message);
    }

    state.currentIndex++;
    updateProgressUI();

    if (state.currentIndex < state.queue.length && state.isRunning) {
      const delaySec = getRandomDelay(state.delayMin, state.delayMax);
      let remaining = delaySec;
      updateStatus(`Esperando ${remaining}s antes del siguiente mensaje...`);

      state.timerId = setInterval(() => {
        if (!state.isRunning) {
          clearInterval(state.timerId);
          return;
        }
        if (state.isPaused) {
          updateStatus('Pausado. Haz clic en Reanudar para continuar.');
          return;
        }

        remaining--;
        if (remaining > 0) {
          updateStatus(`Esperando ${remaining}s antes del siguiente mensaje...`);
        } else {
          clearInterval(state.timerId);
          processNext();
        }
      }, 1000);
    } else {
      finishQueue();
    }
  }

  function navigateToChat(phone, text) {
    return new Promise((resolve) => {
      const cleanPhone = String(phone).replace(/\D/g, '');
      const textParam = text ? `&text=${encodeURIComponent(text)}` : '';
      // api.whatsapp.com/send is caught by WhatsApp Web's internal SPA router without tab reloading
      const url = `https://api.whatsapp.com/send?phone=${cleanPhone}${textParam}`;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => {
        anchor.remove();
        resolve(true);
      }, 900);
    });
  }

  function waitForSendButtonOrError(forEmptyChat = false) {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 35; // 35 * 500ms = 17.5s max wait

      const interval = setInterval(() => {
        attempts++;

        // 1. Check for Invalid Phone Number Modal
        const modal = document.querySelector('div[data-animate-modal-popup="true"], div[role="dialog"]');
        if (modal) {
          const text = modal.textContent.toLowerCase();
          if (text.includes('invalid') || text.includes('url') || text.includes('not on whatsapp')) {
            clearInterval(interval);
            const okBtn = modal.querySelector('button');
            if (okBtn) okBtn.click();
            return resolve({ success: false, reason: 'Inválido/No está en WhatsApp' });
          }
        }

        // 2. If waiting for an empty chat container to mount
        if (forEmptyChat) {
          const chatActive = document.querySelector(
            'footer div[contenteditable="true"], span[data-icon="plus"], span[data-icon="attach-menu-plus"], [data-testid="clip"]'
          );
          if (chatActive) {
            clearInterval(interval);
            return resolve({ success: true });
          }
        }

        // 3. Check for WhatsApp Send Button
        const sendBtn = document.querySelector(
          'span[data-icon="send"], button span[data-icon="send"], [data-icon="wds-ic-send-filled"], button[aria-label="Send"], button[aria-label="Enviar"]'
        );

        if (sendBtn) {
          clearInterval(interval);
          setTimeout(() => {
            const actualBtn = sendBtn.closest('button') || sendBtn;
            actualBtn.click();
            resolve({ success: true });
          }, 600);
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          resolve({ success: false, reason: 'Tiempo agotado (Chat no cargó)' });
        }
      }, 500);
    });
  }

  // --- Helpers for Simulated Interactions ---

  function triggerHover(el) {
    if (!el) return;
    try {
      const rect = el.getBoundingClientRect();
      const x = Math.max(10, Math.floor(rect.left + rect.width / 2));
      const y = Math.max(10, Math.floor(rect.top + rect.height / 2));
      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        pageX: x + (window.scrollX || 0),
        pageY: y + (window.scrollY || 0),
      };
      ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'].forEach((evtType) => {
        try {
          if (evtType.startsWith('pointer') && typeof PointerEvent !== 'undefined') {
            el.dispatchEvent(new PointerEvent(evtType, eventInit));
          } else {
            el.dispatchEvent(new MouseEvent(evtType, eventInit));
          }
        } catch (_) { }
      });
    } catch (_) { }
  }

  function typeIntoInput(inputEl, text) {
    if (!inputEl) return;
    inputEl.focus();
    if (inputEl.tagName === 'INPUT') {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(inputEl, text);
      } else {
        inputEl.value = text;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false, null);
      if (!text) {
        document.execCommand('delete', false, null);
      } else {
        document.execCommand('insertText', false, text);
      }
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: text ? 'insertText' : 'deleteContentBackward' }));
    }
  }

  // --- Forward Media from Self Chat ---

  async function forwardMediaFromSelfChat(phone) {
    console.log(`[WA Forward] Initiating media forward to +${phone}...`);

    // 1. Ensure we are in Self Chat
    if (!isCurrentlyInSelfChat()) {
      updateStatus(`Cambiando a Mi Chat ("Tú")...`);
      const opened = await openSelfChat();
      if (!opened) {
        console.warn('[WA Forward] openSelfChat returned false, re-checking Self Chat status...');
      }
      // WhatsApp Web takes 2-3s to fetch & render Self Chat messages
      await sleep(2200);
    }

    let main = document.querySelector('#main, div[data-testid="conversation-panel-wrapper"]');
    if (!main) {
      await sleep(1000);
      main = document.querySelector('#main, div[data-testid="conversation-panel-wrapper"]');
    }
    if (!main) throw new Error('WhatsApp chat conversation panel not loaded.');

    // 2. Scroll message panel to the bottom so newest media messages are hydrated by React virtualizer
    const scrollContainer = main.querySelector(
      'div[data-testid="conversation-panel-body"], div.copyable-area > div[tabindex="-1"], div[tabindex="-1"][data-tab="4"], div[tabindex="-1"][data-tab="5"]'
    ) || main;
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight + 50000;
    }
    await sleep(600);

    // 3. Robust Polling Loop to trigger Forward (up to 20 attempts = 10 seconds)
    const forwardSelectors = [
      'span[data-icon="forward-chat"]',
      'span[data-icon="forward-refreshed"]',
      'span[data-icon="forward"]',
      'span[data-icon="wds-ic-forward-outline"]',
      'span[data-icon="wds-ic-forward-filled"]',
      'div[data-testid="forward"]',
      'button[aria-label*="Forward"]',
      'button[aria-label*="forward"]',
      'button[aria-label*="Encaminhar"]',
      'button[aria-label*="Reenviar"]',
      'button[aria-label*="reenviar"]',
      'button[title*="Reenviar"]',
      'div[role="button"][aria-label*="Reenviar"]',
      'div[role="button"][title*="Reenviar"]',
      'div[role="button"][aria-label*="Forward"]',
      'div[role="button"][title*="Forward"]',
      'div[role="button"][title*="Encaminhar"]',
      'div[data-testid="fast-forward-btn"]',
      '[data-testid="msg-container"] > div:nth-child(2) > div:nth-child(2) div[role="button"]'
    ];

    let modalOpened = false;

    for (let attempt = 1; attempt <= 20; attempt++) {
      // Check if forward modal is already open
      const existingModal = document.querySelector(
        'div[data-animate-modal-body="true"], div[role="dialog"], div[data-testid="forward-chat-drawer"], div[data-animate-modal-popup="true"]'
      );
      if (existingModal) {
        modalOpened = true;
        break;
      }

      // Check if multi-select forward toolbar is visible at bottom
      const bottomToolbarFwd = document.querySelector(
        'footer span[data-icon="forward"], footer [data-icon="wds-ic-forward-outline"], div[role="region"] span[data-icon="forward"], footer button[aria-label*="Forward"]'
      );
      if (bottomToolbarFwd) {
        const btn = bottomToolbarFwd.closest('button, div[role="button"]') || bottomToolbarFwd;
        btn.click();
        await sleep(600);
        continue;
      }

      // Find the messages inside #main
      const messageRows = Array.from(main.querySelectorAll(
        'div[data-id], div[data-testid="msg-container"], div.message-out, div.message-in, div[role="row"]'
      )).filter((row) => !row.closest('header, footer'));

      let targetRow = null;
      for (let i = messageRows.length - 1; i >= 0; i--) {
        const row = messageRows[i];
        const inspection = inspectMessageRow(row);
        if (inspection.isMedia) {
          targetRow = row;
          break;
        }
      }
      if (!targetRow && messageRows.length > 0) {
        targetRow = messageRows[messageRows.length - 1];
      }

      if (targetRow) {
        targetRow.scrollIntoView({ block: 'nearest' });
        triggerHover(targetRow);
        const innerBubble = targetRow.querySelector('.copyable-text, [data-testid="msg-container"], [data-testid="image-thumb"], [data-testid="document-bubble"]') || targetRow;
        triggerHover(innerBubble);
        await sleep(150);

        // Attempt Strategy A: Direct quick forward button on media
        let forwardBtn = targetRow.querySelector(forwardSelectors.join(', '));
        if (!forwardBtn) {
          const allFwd = Array.from(main.querySelectorAll(forwardSelectors.join(', ')));
          if (allFwd.length > 0) forwardBtn = allFwd[allFwd.length - 1];
        }

        if (forwardBtn) {
          console.log(`[WA Forward] Found forward button on attempt ${attempt}, clicking...`);
          const clickable = forwardBtn.closest('button, div[role="button"]') || forwardBtn;
          clickable.click();
          await sleep(600);
          continue;
        }

        // Attempt Strategy B: Message Context Menu chevron (down-context)
        if (attempt >= 2) {
          const downContext = targetRow.querySelector(
            'span[data-icon="down-context"], span[data-icon="chevron-down"], [data-testid="down-context"], [data-testid="menu-down"]'
          );
          if (downContext) {
            console.log(`[WA Forward] Clicking context menu chevron on attempt ${attempt}...`);
            (downContext.closest('div[role="button"], button') || downContext).click();
            await sleep(400);

            const menuItems = Array.from(document.querySelectorAll(
              'div[role="application"] div[role="button"], ul[role="menu"] li, div[data-animate-dropdown-item="true"]'
            ));
            const fwdMenuItem = menuItems.find((mi) => {
              const t = (mi.textContent || '').toLowerCase();
              return t.includes('reenviar') || t.includes('forward') || t.includes('encaminhar') || !!mi.querySelector('span[data-icon*="forward"]');
            });
            if (fwdMenuItem) {
              fwdMenuItem.click();
              await sleep(600);
              continue;
            }
          }
        }

        // Attempt Strategy C: Contextmenu right-click event on media
        if (attempt >= 4) {
          const rect = targetRow.getBoundingClientRect();
          targetRow.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: Math.max(10, rect.left + rect.width / 2),
            clientY: Math.max(10, rect.top + rect.height / 2)
          }));
          await sleep(400);

          const menuItems = Array.from(document.querySelectorAll(
            'div[role="application"] div[role="button"], ul[role="menu"] li, div[data-animate-dropdown-item="true"]'
          ));
          const fwdMenuItem = menuItems.find((mi) => {
            const t = (mi.textContent || '').toLowerCase();
            return t.includes('reenviar') || t.includes('forward') || t.includes('encaminhar') || !!mi.querySelector('span[data-icon*="forward"]');
          });
          if (fwdMenuItem) {
            fwdMenuItem.click();
            await sleep(600);
            continue;
          }
        }
      }

      await sleep(400);
    }

    // 4. Wait for Forward popup modal
    const modal = await waitForElement(
      'div[data-animate-modal-body="true"], div[role="dialog"], div[data-testid="forward-chat-drawer"], div[data-animate-modal-popup="true"]',
      7000
    );
    if (!modal) {
      throw new Error('Forward dialog did not open after clicking forward.');
    }
    await sleep(600);

    // 5. Uncheck "My status" helper
    const uncheckStatus = () => {
      const allCheckboxes = Array.from(modal.querySelectorAll(
        'div[role="checkbox"], span[role="checkbox"], [data-testid="checkbox"], input[type="checkbox"]'
      ));
      for (const chk of allCheckboxes) {
        const row = chk.closest('div[role="listitem"], div[role="row"], div[data-testid="cell-frame-container"], div[tabindex="-1"], div[role="button"]') || chk.parentElement;
        const text = (row ? row.textContent : '').trim().toLowerCase();
        if (
          text.includes('mi estado') ||
          text.includes('mis contactos') ||
          text.includes('my status') ||
          text.includes('meu status') ||
          text.includes('my contacts') ||
          text.includes('meus contatos') ||
          (row && !!row.querySelector('[data-icon*="status"], [data-testid*="status"]'))
        ) {
          const isChecked = chk.getAttribute('aria-checked') === 'true' ||
            chk.getAttribute('data-checked') === 'true' ||
            !!chk.querySelector('span[data-icon="checkbox-checked"], span[data-icon="check"], [data-icon*="check"]');
          if (isChecked) {
            console.log('[WA Forward Safety] Unchecked "My status" item');
            chk.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            chk.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            chk.click();
          }
        }
      }
    };

    uncheckStatus();
    await sleep(200);

    // 6. Search for the recipient contact in the Forward modal
    const cleanPhone = String(phone).replace(/\D/g, '');
    const searchInput = modal.querySelector(
      'input[role="textbox"], input.html-input, div[role="textbox"][contenteditable="true"], div[data-lexical-editor="true"], input[placeholder*="Search"]'
    );

    if (searchInput) {
      typeIntoInput(searchInput, cleanPhone);
      await sleep(1000);
    }

    // Helper to get real contact items (strictly excludes "My status")
    const getRealContacts = () => {
      const results = [];

      // Primary: Find all checkboxes in the forward modal
      const checkboxes = Array.from(modal.querySelectorAll(
        'div[role="checkbox"], span[role="checkbox"], [data-testid="checkbox"], input[type="checkbox"]'
      ));

      for (const chk of checkboxes) {
        const row = chk.closest('div[role="listitem"], div[role="row"], div[data-testid="cell-frame-container"], div[tabindex="-1"], div[role="button"]') || chk.parentElement;
        const text = (row ? row.textContent : '').trim().toLowerCase();
        const isStatus = text.includes('mi estado') ||
          text.includes('mis contactos') ||
          text.includes('my status') ||
          text.includes('meu status') ||
          text.includes('my contacts') ||
          text.includes('meus contatos') ||
          (row && !!row.querySelector('[data-icon*="status"], [data-testid*="status"]'));

        if (!isStatus) {
          results.push({ checkbox: chk, row: row || chk, text: text });
        }
      }

      if (results.length > 0) return results;

      // Fallback: Find cell containers if checkboxes weren't directly matched
      const rows = Array.from(modal.querySelectorAll(
        'div[data-testid="cell-frame-container"], div[role="listitem"], div[role="row"], div[data-testid="chat-list-item"]'
      ));

      for (const row of rows) {
        const text = (row.textContent || '').trim().toLowerCase();
        const isStatus = text.includes('mi estado') ||
          text.includes('mis contactos') ||
          text.includes('my status') ||
          text.includes('meu status') ||
          text.includes('my contacts') ||
          text.includes('meus contatos') ||
          !!row.querySelector('[data-icon*="status"], [data-testid*="status"]');

        if (!isStatus && text.length > 0) {
          const chk = row.querySelector('div[role="checkbox"], span[role="checkbox"], [data-testid="checkbox"]') || row;
          results.push({ checkbox: chk, row: row, text: text });
        }
      }

      return results;
    };

    let contacts = getRealContacts();

    // If search by full digits yielded 0 results, try last 10 digits
    if (contacts.length === 0 && searchInput && cleanPhone.length > 10) {
      typeIntoInput(searchInput, cleanPhone.slice(-10));
      await sleep(1000);
      contacts = getRealContacts();
    }

    // If search still yielded 0 results, clear search so Recent Chats show up (where the recipient we just texted is #1!)
    if (contacts.length === 0 && searchInput) {
      typeIntoInput(searchInput, '');
      await sleep(800);
      contacts = getRealContacts();
    }

    if (contacts.length === 0) {
      // Close modal gracefully
      const closeBtn = modal.querySelector('button[aria-label*="Close"], span[data-icon="x"], span[data-icon="x-alt"]');
      if (closeBtn) (closeBtn.closest('button') || closeBtn).click();
      throw new Error(`Could not find contact +${cleanPhone} in Forward list.`);
    }

    // 7. Select the target contact (never My status!)
    const target = contacts[0];
    const chk = target.checkbox;
    const row = target.row;

    const isTargetChecked = () => {
      return chk.getAttribute('aria-checked') === 'true' ||
        chk.getAttribute('data-checked') === 'true' ||
        !!chk.querySelector('span[data-icon="checkbox-checked"], span[data-icon="check"], [data-icon*="check"]') ||
        chk.classList.contains('checked');
    };

    console.log(`[WA Forward] Selecting contact: ${target.text.substring(0, 30)}...`);

    if (!isTargetChecked()) {
      // Dispatch full mouse click sequence on checkbox
      chk.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      chk.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      chk.click();
      await sleep(350);

      // If still not checked, click the row container
      if (!isTargetChecked() && row) {
        row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        row.click();
        await sleep(350);
      }
    }

    // 8. FINAL SAFETY: Ensure "My status" is NOT checked under any circumstances!
    uncheckStatus();
    await sleep(300);

    // 9. Click Send button in Forward modal (with polling across modal & document)
    let sendSuccess = false;
    const sendSelectors = [
      'span[data-icon="send"]',
      'span[data-icon="wds-ic-send-filled"]',
      'span[data-icon="send-light"]',
      'div[data-testid="send"]',
      'button[aria-label="Send"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Enviar"]',
      'div[role="button"][aria-label*="Send"]'
    ];

    for (let sAttempt = 0; sAttempt < 15; sAttempt++) {
      let sendBtn = modal.querySelector(sendSelectors.join(', '));
      if (!sendBtn) {
        sendBtn = document.querySelector(
          'div[data-animate-modal-body="true"] span[data-icon="send"], div[data-animate-modal-body="true"] [data-icon="wds-ic-send-filled"], div[role="dialog"] span[data-icon="send"], div[role="dialog"] [data-icon="wds-ic-send-filled"], div[role="dialog"] button[aria-label*="Send"], div[role="dialog"] button[aria-label*="Enviar"]'
        );
      }

      if (sendBtn) {
        console.log('[WA Forward] Found forward Send button, clicking...');
        const actualBtn = sendBtn.closest('button, div[role="button"]') || sendBtn;
        actualBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        actualBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        actualBtn.click();
        sendSuccess = true;
        break;
      }
      await sleep(400);
    }

    if (!sendSuccess) {
      // Close modal gracefully before throwing
      const closeBtn = modal.querySelector('button[aria-label*="Close"], span[data-icon="x"], span[data-icon="x-alt"]');
      if (closeBtn) (closeBtn.closest('button') || closeBtn).click();
      throw new Error('Send button inside Forward dialog not found.');
    }

    console.log(`[WA Forward] Media forward sent to +${phone} successfully!`);
    await sleep(2500);
    return true;
  }

  // --- Direct Attachment Injection ---

  async function sendAttachmentToActiveChat(file, fileType) {
    let fileInput = null;
    if (fileType === 'image') {
      fileInput = document.querySelector('input[accept*="image"], input[accept*="video"]');
    } else {
      fileInput = document.querySelector('input[accept="*"]');
    }

    if (!fileInput) {
      const plusBtn = document.querySelector(
        'span[data-icon="plus"], span[data-icon="attach-menu-plus"], span[data-icon="plus-rounded"], span[data-icon="ic-attach-file"], [data-testid="clip"]'
      );
      if (plusBtn) {
        (plusBtn.closest('button') || plusBtn).click();
        await sleep(500);
        if (fileType === 'image') {
          fileInput = document.querySelector('input[accept*="image"], input[accept*="video"]');
        } else {
          fileInput = document.querySelector('input[accept="*"]');
        }
      }
    }

    if (!fileInput) {
      const allInputs = document.querySelectorAll('input[type="file"]');
      if (allInputs.length > 0) {
        fileInput = allInputs[allInputs.length - 1];
      }
    }

    if (!fileInput) {
      throw new Error('WhatsApp attachment input could not be found.');
    }

    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    const sendOutcome = await waitForMediaSendButton();
    if (!sendOutcome.success) {
      throw new Error(sendOutcome.reason || 'Failed waiting for media send button');
    }

    await sleep(2500);
    return true;
  }

  function waitForMediaSendButton() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 30; // 30 * 400ms = 12s

      const interval = setInterval(() => {
        attempts++;

        const mediaSendBtn = document.querySelector(
          'div[data-animate-modal-body="true"] span[data-icon="send"], ' +
          'div[data-animate-modal-popup="true"] span[data-icon="send"], ' +
          'div[data-animate-modal-popup="true"] [data-icon="wds-ic-send-filled"], ' +
          '[data-testid="media-viewer-modal"] span[data-icon="send"], ' +
          'span[data-icon="send"], [data-icon="wds-ic-send-filled"], button[aria-label="Send"]'
        );

        if (mediaSendBtn) {
          clearInterval(interval);
          setTimeout(() => {
            (mediaSendBtn.closest('button') || mediaSendBtn).click();
            resolve({ success: true });
          }, 500);
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          resolve({ success: false, reason: 'Media preview timed out' });
        }
      }, 400);
    });
  }

  function togglePause() {
    state.isPaused = !state.isPaused;
    const btn = document.getElementById('wads-pause-btn');
    if (btn) {
      btn.textContent = state.isPaused ? '▶ Reanudar' : '⏸ Pausar';
      btn.className = state.isPaused ? 'wads-btn wads-btn-primary' : 'wads-btn wads-btn-secondary';
    }

    if (state.isPaused) {
      updateStatus('Pausado. Haz clic en Reanudar para continuar.');
      setStartButtonsState('paused');
      updateAutomationBanner();
    } else {
      updateStatus('Reanudando automatización...');
      setStartButtonsState('running');
      updateAutomationBanner();
      if (state.isRunning) {
        processNext();
      }
    }
  }

  function abortSending() {
    state.isRunning = false;
    state.isPaused = false;
    if (state.timerId) clearInterval(state.timerId);
    updateStatus('Campaña cancelada por el usuario.');

    // Update Progress Card buttons dynamically
    const pauseBtn = document.getElementById('wads-pause-btn');
    if (pauseBtn) pauseBtn.style.display = 'none';

    const stopBtn = document.getElementById('wads-stop-btn');
    if (stopBtn) {
      stopBtn.textContent = '✕ Descartar / Reiniciar';
      stopBtn.className = 'wads-btn wads-btn-secondary';
    }

    setStartButtonsState('idle');
    hideAutomationBanner('aborted');
  }

  function finishQueue() {
    state.isRunning = false;
    state.isPaused = false;
    if (state.timerId) clearInterval(state.timerId);
    updateStatus('¡Todos los mensajes fueron procesados!');

    // Update Progress Card buttons dynamically
    const pauseBtn = document.getElementById('wads-pause-btn');
    if (pauseBtn) pauseBtn.style.display = 'none';

    const stopBtn = document.getElementById('wads-stop-btn');
    if (stopBtn) {
      stopBtn.textContent = '✓ Listo / Cerrar Progreso';
      stopBtn.className = 'wads-btn wads-btn-primary';
    }

    setStartButtonsState('idle');
    hideAutomationBanner('finished');
  }

  function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // --- Dynamic Start Buttons Lifecycle ---

  function setStartButtonsState(mode) {
    const manualBtn = document.getElementById('wads-start-manual-btn');
    const csvBtn = document.getElementById('wads-start-csv-btn');
    const buttons = [manualBtn, csvBtn].filter(Boolean);

    if (mode === 'running') {
      const cur = Math.min(state.currentIndex + 1, state.queue.length);
      const total = state.queue.length;
      buttons.forEach((btn) => {
        btn.disabled = true;
        btn.classList.add('wads-btn-running');
        btn.innerHTML = `<span class="wads-spinner-small"></span> ⏳ Enviando (${cur}/${total})...`;
      });
    } else if (mode === 'paused') {
      const cur = Math.min(state.currentIndex + 1, state.queue.length);
      const total = state.queue.length;
      buttons.forEach((btn) => {
        btn.disabled = true;
        btn.classList.remove('wads-btn-running');
        btn.innerHTML = `⏸ Campaña Pausada (${cur}/${total})`;
      });
    } else {
      // Idle / Completed / Aborted
      if (manualBtn) {
        manualBtn.disabled = false;
        manualBtn.classList.remove('wads-btn-running');
        manualBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          Iniciar Envío
        `;
      }
      if (csvBtn) {
        csvBtn.disabled = false;
        csvBtn.classList.remove('wads-btn-running');
        csvBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          Iniciar Campaña desde Archivo
        `;
      }
    }
  }

  // --- Automation Warning Banner ---

  function showAutomationBanner() {
    let banner = document.getElementById('wads-automation-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'wads-automation-banner';
      banner.className = 'wads-automation-banner';
      banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 18px; line-height: 1;">⚠️</span>
          <div class="wads-banner-text">
            <strong id="wads-banner-title">NO TOQUES WHATSAPP:</strong>
            <span id="wads-banner-subtext">La automatización está enviando y reenviando mensajes. Interactuar con WhatsApp puede interrumpir el envío o causar errores.</span>
          </div>
        </div>
        <div class="wads-banner-right">
          <span class="wads-banner-badge" id="wads-banner-badge">0 / 0</span>
          <button class="wads-banner-btn wads-banner-panel-btn" id="wads-banner-panel-btn" type="button" title="Minimizar / Abrir Panel de la Extensión">
            <span>Minimizar Panel</span>
          </button>
          <button class="wads-banner-btn wads-banner-pause" id="wads-banner-pause-btn" type="button" title="Pausar / Reanudar">⏸ Pausar</button>
          <button class="wads-banner-btn wads-banner-stop" id="wads-banner-stop-btn" type="button" title="Detener Automatización">⏹ Detener</button>
        </div>
      `;
      document.body.prepend(banner);

      document.getElementById('wads-banner-panel-btn').addEventListener('click', toggleDrawer);
      document.getElementById('wads-banner-pause-btn').addEventListener('click', togglePause);
      document.getElementById('wads-banner-stop-btn').addEventListener('click', abortSending);
    }

    banner.className = 'wads-automation-banner';
    banner.style.display = 'flex';
    const title = document.getElementById('wads-banner-title');
    const subtext = document.getElementById('wads-banner-subtext');
    const pauseBtn = document.getElementById('wads-banner-pause-btn');
    const panelBtn = document.getElementById('wads-banner-panel-btn');

    if (title) title.textContent = 'NO TOQUES WHATSAPP:';
    if (subtext) subtext.textContent = 'La automatización está enviando y reenviando mensajes. Interactuar con WhatsApp puede interrumpir el envío o causar errores.';
    if (panelBtn) panelBtn.style.display = 'inline-flex';
    if (pauseBtn) {
      pauseBtn.style.display = 'inline-flex';
      pauseBtn.textContent = '⏸ Pausar';
      pauseBtn.classList.remove('resumed');
    }

    updateBannerPanelToggleBtn();
    updateAutomationBanner();
  }

  function updateAutomationBanner() {
    const banner = document.getElementById('wads-automation-banner');
    if (!banner) return;

    const badge = document.getElementById('wads-banner-badge');
    const title = document.getElementById('wads-banner-title');
    const subtext = document.getElementById('wads-banner-subtext');
    const pauseBtn = document.getElementById('wads-banner-pause-btn');

    if (badge) {
      badge.textContent = `${state.currentIndex} / ${state.queue.length}`;
    }

    updateBannerPanelToggleBtn();

    if (state.isPaused) {
      banner.classList.add('paused');
      if (title) title.textContent = '⏸ AUTOMATIZACIÓN PAUSADA:';
      if (subtext) subtext.textContent = 'Ahora puedes usar WhatsApp. Haz clic en Reanudar para continuar con la campaña.';
      if (pauseBtn) {
        pauseBtn.textContent = '▶ Reanudar';
        pauseBtn.classList.add('resumed');
      }
    } else {
      banner.classList.remove('paused');
      if (title) title.textContent = 'NO TOQUES WHATSAPP:';
      if (subtext) subtext.textContent = 'La automatización está enviando y reenviando mensajes. Interactuar con WhatsApp puede interrumpir el envío o causar errores.';
      if (pauseBtn) {
        pauseBtn.textContent = '⏸ Pausar';
        pauseBtn.classList.remove('resumed');
      }
    }
  }

  function hideAutomationBanner(finalState) {
    const banner = document.getElementById('wads-automation-banner');
    if (!banner) return;

    const title = document.getElementById('wads-banner-title');
    const subtext = document.getElementById('wads-banner-subtext');
    const badge = document.getElementById('wads-banner-badge');
    const pauseBtn = document.getElementById('wads-banner-pause-btn');
    const panelBtn = document.getElementById('wads-banner-panel-btn');

    if (pauseBtn) pauseBtn.style.display = 'none';
    if (panelBtn) panelBtn.style.display = 'none';

    if (finalState === 'finished') {
      banner.className = 'wads-automation-banner finished';
      if (title) title.textContent = '✓ AUTOMATIZACIÓN COMPLETADA:';
      if (subtext) subtext.textContent = `Los ${state.queue.length} mensajes fueron procesados exitosamente. Ya puedes usar WhatsApp con normalidad.`;
      if (badge) badge.textContent = `${state.queue.length} / ${state.queue.length}`;
    } else if (finalState === 'aborted') {
      banner.className = 'wads-automation-banner aborted';
      if (title) title.textContent = '⏹ AUTOMATIZACIÓN DETENIDA:';
      if (subtext) subtext.textContent = `Campaña detenida en ${state.currentIndex} de ${state.queue.length} mensajes. Ya puedes usar WhatsApp con normalidad.`;
    }

    setTimeout(() => {
      const b = document.getElementById('wads-automation-banner');
      if (b && b.parentNode) {
        b.remove();
      }
    }, 2800);
  }

  // --- UI Progress & Logs ---

  function updateProgressUI() {
    const total = state.queue.length;
    const current = state.currentIndex;
    const pct = total === 0 ? 0 : Math.round((current / total) * 100);

    document.getElementById('wads-progress-text').textContent = `Progreso: ${current} / ${total}`;
    document.getElementById('wads-progress-pct').textContent = `${pct}%`;
    document.getElementById('wads-progress-fill').style.width = `${pct}%`;

    if (state.isRunning) {
      setStartButtonsState(state.isPaused ? 'paused' : 'running');
      updateAutomationBanner();
    }
  }

  function updateStatus(text) {
    document.getElementById('wads-live-status').textContent = text;
  }

  function logAttempt(phone, status, message) {
    const entry = {
      phone,
      status,
      message: (message || '').substring(0, 40),
      timestamp: new Date().toLocaleTimeString(),
    };

    state.logs.unshift(entry);
    if (state.logs.length > 5000) state.logs.pop();

    renderLogs();
    saveLogs();
  }

  function renderLogs() {
    const tbody = document.getElementById('wads-logs-body');
    document.getElementById('wads-log-count').textContent = state.logs.length;

    if (state.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--wads-text-muted);">Sin registros aún</td></tr>';
      return;
    }

    tbody.innerHTML = state.logs
      .slice(0, 50)
      .map((l) => {
        const statusClass = (l.status.startsWith('Sent') || l.status.startsWith('Enviado')) ? 'wads-status-sent' : 'wads-status-failed';
        return `
          <tr>
            <td>+${l.phone}</td>
            <td class="${statusClass}">${l.status}</td>
            <td>${l.timestamp}</td>
          </tr>
        `;
      })
      .join('');
  }

  function exportLogs() {
    if (state.logs.length === 0) {
      alert('No hay registros para exportar.');
      return;
    }

    const headers = ['Teléfono', 'Estado', 'Mensaje', 'Hora'];
    const rows = state.logs.map((l) => [l.phone, l.status, `"${(l.message || '').replace(/"/g, '""')}"`, l.timestamp]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `WA_Sender_Registros_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function clearLogs() {
    if (confirm('¿Deseas borrar todos los registros?')) {
      state.logs = [];
      renderLogs();
      chrome.storage.local.remove(['wads_logs']);
    }
  }

  function saveLogs() {
    chrome.storage.local.set({ wads_logs: state.logs });
  }

  function loadStoredLogs() {
    chrome.storage.local.get(['wads_logs'], (res) => {
      if (res && Array.isArray(res.wads_logs)) {
        state.logs = res.wads_logs;
        renderLogs();
      }
    });
  }

  function saveSettings() {
    chrome.storage.local.set({
      wads_delay_min: state.delayMin,
      wads_delay_max: state.delayMax,
      wads_enable_country_code: state.enableCountryCode,
      wads_country_code_prefix: state.countryCodePrefix,
    });
  }

  function loadStoredSettings() {
    chrome.storage.local.get(['wads_delay_min', 'wads_delay_max', 'wads_enable_country_code', 'wads_country_code_prefix'], (res) => {
      if (res.wads_delay_min) {
        state.delayMin = res.wads_delay_min;
        document.getElementById('wads-delay-min').value = state.delayMin;
      }
      if (res.wads_delay_max) {
        state.delayMax = res.wads_delay_max;
        document.getElementById('wads-delay-max').value = state.delayMax;
      }
      if (typeof res.wads_enable_country_code !== 'undefined') {
        state.enableCountryCode = res.wads_enable_country_code;
      }
      if (res.wads_country_code_prefix) {
        state.countryCodePrefix = res.wads_country_code_prefix;
      }
      syncCountryCodeUI();
    });
  }

  // Periodic check to inject trigger button once WhatsApp Web interface loads
  const checker = setInterval(() => {
    if (document.querySelector('#app') || document.body) {
      init();
    }
  }, 1000);
})();
