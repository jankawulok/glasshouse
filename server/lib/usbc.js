/* The USB-C video input and the USB hub are independent on LG smart monitors. */
var fs = require('fs');
var path = require('path');
var util = require('./util');
var msg = require('./say').msg;

var HUB = '/sys/devices/platform/1805e000.usb_hub/switch_port';
var DPRX = '/sys/class/misc/rtk_dprx';
var TYPEC = '/sys/class/typec';
var LEGACY = '/var/lib/webosbrew/init.d/60-usb-hub-webos';
var LEGACY_PID = '/tmp/usb-hub-webos.pid';

function input(device) {
  if (!device) return null;
  var port = /^USB[-_ ]?C(?:[-_ ]?([1-9][0-9]?))?$/i.exec(String(device.id || ''));
  if (!port) return null;
  var appId = typeof device.appId === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i.test(device.appId)
    ? device.appId : null;
  var label = typeof device.label === 'string' ? device.label.trim() : '';
  var connector = 'USB-C' + (port[1] && port[1] !== '1' ? ' ' + port[1] : '');
  if (!label || /^USB[-_ ]?C(?:[-_ ]?\d+)?$/i.test(label)) label = connector;
  else label = connector + ' (' + label + ')';
  return {
    key: 'usbc' + (port[1] || '1'),
    appId: appId,
    label: label,
    connected: typeof device.connected === 'boolean' ? device.connected : null
  };
}

// Linux lists the selected role in brackets when the port is dual role.
function selectedRole(file) {
  var value = util.readTrimmed(file);
  var selected = /\[([^\]]+)\]/.exec(value || '');
  return selected ? selected[1] : value;
}

function typecPorts() {
  var entries;
  try { entries = fs.readdirSync(TYPEC); } catch (e) { return []; }
  return entries.filter(function (name) { return /^port\d+$/.test(name); }).map(function (name) {
    var dir = path.join(TYPEC, name);
    return {
      port: name,
      partner: fs.existsSync(path.join(TYPEC, name + '-partner')),
      dataRole: selectedRole(path.join(dir, 'data_role')),
      powerRole: selectedRole(path.join(dir, 'power_role')),
      powerMode: util.readTrimmed(path.join(dir, 'power_operation_mode'))
    };
  });
}

function legacyPid() {
  var pid = util.readTrimmed(LEGACY_PID);
  if (!/^[1-9][0-9]*$/.test(pid || '')) return null;
  var args = util.readTrimmed('/proc/' + pid + '/cmdline');
  if (!args) return null;
  var argv = args.split('\u0000');
  return argv.indexOf(LEGACY) !== -1 && argv.indexOf('--watch') !== -1 ? Number(pid) : null;
}

function create(stateFile, allowControl) {
  var timer = null;
  var issue = null;
  var mode = 'automatic';
  try {
    if (JSON.parse(fs.readFileSync(stateFile, 'utf8')).mode === 'webos') mode = 'webos';
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('usb-c: could not read USB hub policy: ' + e.message);
  }

  function apply() {
    if (legacyPid() || fs.existsSync(LEGACY)) {
      issue = 'legacy';
      return;
    }
    try {
      // switch_port echoes the last manual value even after Realtek changes
      // the route in its source and DP Alt Mode callbacks.
      fs.writeFileSync(HUB, '1\n');
      issue = null;
    } catch (e) {
      issue = 'write';
    }
  }

  function start() {
    if (!timer) {
      timer = setInterval(apply, 1000);
      timer.unref();
    }
  }

  function setMode(value) {
    if (value !== 'automatic' && value !== 'webos') {
      return { ok: false, error: msg('srv.usbc.badMode', 'Expected a USB hub mode') };
    }
    if (!fs.existsSync(HUB)) return { ok: false, error: msg('srv.usbc.noHub', 'USB hub control is unavailable') };
    if (fs.existsSync(LEGACY) || legacyPid()) {
      return { ok: false, error: msg('srv.usbc.legacy', 'Move the previous boot hook and stop its watcher first') };
    }
    try {
      if (value === 'webos') {
        apply();
        if (issue) return { ok: false, error: msg('srv.usbc.write', 'Could not set the USB hub route') };
      }
      util.writeJsonAtomic(stateFile, { mode: value }, 384);
      mode = value;
      if (mode === 'webos') start();
      else {
        clearInterval(timer);
        timer = null;
        issue = null;
      }
    } catch (e) {
      return { ok: false, error: msg('srv.usbc.save', 'Could not save the USB hub policy') };
    }
    return { ok: true };
  }

  function retireLegacy() {
    if (!fs.existsSync(HUB)) return { ok: false, error: msg('srv.usbc.noHub', 'USB hub control is unavailable') };
    var hook = util.readTrimmed(LEGACY);
    var saved = path.join(path.dirname(path.dirname(LEGACY)), '60-usb-hub-webos.before-glasshouse');
    if (hook && (hook.indexOf(LEGACY_PID) === -1 || hook.indexOf(HUB) === -1 ||
                 hook.indexOf('/tmp/usb-hub-webos.lock') === -1 || fs.existsSync(saved))) {
      return { ok: false, error: msg('srv.usbc.legacyManual', 'Move the previous boot hook manually. Its contents or backup need attention.') };
    }
    try {
      if (hook) fs.renameSync(LEGACY, saved);
      var pid = legacyPid();
      if (pid) process.kill(pid, 'SIGTERM');
    } catch (e) {
      if (e.code !== 'ESRCH') return { ok: false, error: msg('srv.usbc.retireFailed', 'Could not retire the previous USB hub watcher') };
    }
    return { ok: true };
  }

  if (allowControl && mode === 'webos') {
    apply();
    start();
  }
  return {
    setMode: setMode,
    retireLegacy: retireLegacy,
    status: function () {
      return {
        hubAvailable: fs.existsSync(HUB),
        legacyWatcher: fs.existsSync(LEGACY) || !!legacyPid(),
        mode: mode,
        issue: issue,
        lastManualValue: util.readTrimmed(HUB),
        receiver: util.readTrimmed(path.join(DPRX, 'status')) ||
          util.readTrimmed('/sys/devices/platform/dprx/status'),
        typecPorts: typecPorts()
      };
    }
  };
}

module.exports = { create: create, input: input };
