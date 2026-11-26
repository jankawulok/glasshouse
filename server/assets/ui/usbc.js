// USB-C choices come from EIM. The hub switch is a separate hardware control.
let usbCUpdating = false;

async function readUsbC() {
  const response = await fetch(api('/api/usb-c'), { cache: 'no-store' });
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || t('usbc.unavailable', 'USB-C details are unavailable.'));
  q('tab-btn-usbc').hidden = !data.available;
  return data;
}

function checkUsbCTab() {
  readUsbC().then(data => {
    if (!data.available && activeTab === 'usbc') showTab('control');
  }).catch(() => {});
}

function renderUsbC(data) {
  const link = data.link;
  q('usbc-status').textContent = !data.available ? t('usbc.unavailable', 'USB-C details are unavailable.')
    : link.issue === 'write' ? t('usbc.write', 'Glasshouse could not restore the USB hub route.') : '';
  q('usbc-video').hidden = !data.inputs.length;
  q('usbc-inputs').innerHTML = data.inputs.map(input => {
    const connection = !input.appId ? t('usbc.noApp', 'webOS has not reported an app for this input.')
      : input.connected === null ? '' : input.connected
      ? t('usbc.connected', 'Connected') : t('usbc.disconnected', 'Disconnected');
    return `<div class="prot-row">
      <div class="prot-main"><div class="prot-title">${esc(input.label)}</div>
      <div class="prot-desc">${esc(connection)}</div></div>
      <button type="button" class="pill" data-usbc-input="${esc(input.key)}"
        ${data.writable && input.appId ? '' : 'disabled'}>${esc(t('usbc.select', 'Select input'))}</button>
    </div>`;
  }).join('');
  q('usbc-hub').hidden = !link.hubAvailable;
  q('usbc-legacy').hidden = !link.legacyWatcher;
  q('usbc-retire').hidden = !link.legacyWatcher;
  q('usbc-retire').disabled = !data.writable;
  q('usbc-mode').value = link.mode;
  q('usbc-mode').disabled = !data.writable || link.legacyWatcher;
  q('usbc-diagnostics').hidden = !data.available;
  const portLines = link.typecPorts.map(port => t('usbc.portRoles',
    '{port}: {dataRole} / {powerRole} / {powerMode}', {
      port: port.port, dataRole: port.dataRole || '—', powerRole: port.powerRole || '—',
      powerMode: port.powerMode || '—'
    }));
  if (link.lastManualValue !== null) portLines.push(t('usbc.lastManual', 'Last manual switch value: {value}', {
    value: link.lastManualValue
  }));
  const signal = link.signal;
  q('usbc-signal').hidden = !signal;
  if (signal) {
    const summary = [t('usbc.timing', '{width} × {height} at {hz} Hz', signal)];
    if (signal.encoding && signal.bits) summary.push(t('usbc.pixel', '{encoding}, {bits}-bit', signal));
    if (signal.colorimetry) summary.push(signal.colorimetry);
    if (signal.range) summary.push(signal.range);
    if (signal.lanes && signal.laneGbps) summary.push(t('usbc.lanes', '{lanes} lanes at {laneGbps} Gbit/s each', signal));
    if (signal.refreshMode) summary.push(signal.fixedRefresh
      ? t('usbc.fixed', 'Fixed refresh rate') : signal.refreshMode);
    q('usbc-signal').textContent = summary.join(' · ');
  }
  q('usbc-receiver-details').hidden = !link.receiver;
  q('usbc-receiver').textContent = link.receiver || '';
  q('usbc-link').hidden = !portLines.length && !!link.receiver;
  q('usbc-link').textContent = portLines.join('\n\n') ||
    t('usbc.noDiagnostics', 'No USB-C receiver or power data was reported.');
}

async function loadUsbC() {
  try { renderUsbC(await readUsbC()); }
  catch (error) { q('usbc-status').textContent = error.message; }
}

async function saveUsbC(patch) {
  if (usbCUpdating) return;
  usbCUpdating = true;
  q('usbc-mode').disabled = q('usbc-retire').disabled = true;
  try {
    const response = await fetch(api('/api/usb-c'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
    });
    const result = await response.json();
    await loadUsbC();
    if (!result.ok) showErr(result.error || t('common.actionFailed', 'Action failed'));
  } catch (error) {
    await loadUsbC();
    showErr(error.message);
  } finally {
    usbCUpdating = false;
  }
}

q('usbc-inputs').addEventListener('click', event => {
  const button = event.target.closest('button[data-usbc-input]');
  if (button) sendCommand('input', button.dataset.usbcInput);
});
q('usbc-mode').addEventListener('change', event => saveUsbC({ mode: event.target.value }));
q('usbc-retire').addEventListener('click', () => saveUsbC({ retireLegacy: true }));
q('usbc-refresh').addEventListener('click', loadUsbC);
