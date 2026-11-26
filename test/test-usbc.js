// Strict ES5, like the monitor's server.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var usbC = require('../server/lib/usbc');
var telemetry = require('../server/lib/telemetry');
var controls = require('../server/lib/controls');

var device = { id: 'USB-C_1', label: 'PC', connected: true, appId: 'com.webos.app.usbc1' };
telemetry.init({ luna: function (uri, params, cb) {
  if (uri !== 'com.webos.service.eim/getAllInputStatus') return cb(null);
  cb({ devices: [{ id: 'HDMI_1' }, device, { id: 'USB_1' }] });
} });
controls.init({
  config: { allowControl: true },
  clearLunaCache: function () {},
  telemetry: telemetry,
  luna: function (uri, params, cb) {
    assert.strictEqual(uri, 'com.webos.applicationManager/launch');
    assert.deepEqual(params, { id: device.appId });
    cb({ returnValue: true });
  }
});
telemetry.refreshInputNames(function (inputs) {
  assert.deepEqual(inputs, { hdmi1: 'HDMI 1', usbc1: 'USB-C (PC)' });
  assert.strictEqual(telemetry.inputKey(device.appId), 'usbc1');
});
assert.strictEqual(usbC.input({ id: 'USB_1' }), null);
assert.strictEqual(usbC.input({ id: 'USB-C_1' }).appId, null);
var launched = false;
controls.doControl('input', 'usbc1', function (result) { launched = result.ok; });
assert.strictEqual(launched, true);
controls.doControl('input', 'usbc2', function (result) { assert.strictEqual(result.ok, false); });

var writes = 0;
var restoreRoute = null;
var persisted = '{}';
var file = '/var/lib/tvweb/usb-c.json';
var hub = '/sys/devices/platform/1805e000.usb_hub/switch_port';
var mock = {
  exports: {},
  require: function (name) {
    if (name === 'fs') return {
      existsSync: function (key) { return key === hub || key === '/sys/class/typec/port0-partner'; },
      readdirSync: function () { return ['port0', 'port0-partner']; },
      readFileSync: function () { return persisted; },
      writeFileSync: function (key, data) {
        assert.strictEqual(key, hub);
        assert.strictEqual(data, '1\n');
        writes++;
      }
    };
    if (name === './util') return {
      readTrimmed: function (key) {
        if (key === hub) return '1';
        if (key === '/sys/class/misc/rtk_dprx/status') return 'DisplayPort receiver status';
        if (key === '/sys/class/typec/port0/power_role') return 'source [sink]';
        if (key === '/sys/class/typec/port0/data_role') return 'host [device]';
        return null;
      },
      writeJsonAtomic: function (key, value) {
        assert.strictEqual(key, file);
        persisted = JSON.stringify(value);
      }
    };
    return name === 'path' ? path : require('../server/lib/say');
  },
  setInterval: function (fn, delay) {
    assert.strictEqual(delay, 1000);
    restoreRoute = fn;
    return { unref: function () {} };
  },
  clearInterval: function () { restoreRoute = null; }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/lib/usbc.js'), 'utf8'), { module: mock,
  require: mock.require, setInterval: mock.setInterval, clearInterval: mock.clearInterval });
var policy = mock.exports.create(file, true);
assert.strictEqual(policy.setMode('webos').ok, true);
var beforeSwitch = writes;
assert.strictEqual(policy.status().lastManualValue, '1');
assert.strictEqual(policy.status().receiver, 'DisplayPort receiver status');
assert.strictEqual(policy.status().typecPorts[0].powerRole, 'sink');
assert.strictEqual(policy.status().typecPorts[0].dataRole, 'device');
restoreRoute();
assert.strictEqual(writes, beforeSwitch + 1, 'a cached 1 must never suppress the restore');
assert.strictEqual(mock.exports.create(file, false).status().mode, 'webos');
assert.strictEqual(policy.setMode('automatic').ok, true);
assert.strictEqual(restoreRoute, null);
assert.strictEqual(persisted, '{"mode":"automatic"}');
console.log('USB-C input discovery, launch and hub policy passed.');
