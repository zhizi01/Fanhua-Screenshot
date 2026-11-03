'use strict'
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createStartupNotifier, STARTUP_BODY } = require('../electron/startup-notification.cjs')
const exact = 'Hello，现在繁花有图已经在你的设备中完成了准备，随时可以通过Alt + A 发起截图。在不需要我的时候，我会一直休眠哦~'
class FakeNotification extends EventEmitter {
  static supported = true
  static created = []
  static throwOnShow = false
  static isSupported() { return this.supported }
  constructor(options) { super(); this.options = options; this.shows = 0; this.closed = false; FakeNotification.created.push(this) }
  show() { if (FakeNotification.throwOnShow) throw new Error('OS disabled notifications'); this.shows++ }
  close() { this.closed = true }
}
async function run() {
  assert.equal(STARTUP_BODY, exact)
  let opens = 0
  const errors = []
  const make = () => createStartupNotifier({ Notification: FakeNotification, openSettings: async () => { opens++ }, onError: error => errors.push(error) })
  const normal = make()
  assert.equal(normal.show({ enabled: true, shortcutRegistered: true }), true)
  const notification = FakeNotification.created.at(-1)
  assert.equal(notification.options.title, '繁花有图')
  assert.equal(notification.options.body, exact)
  assert.equal(normal.show({ enabled: true, shortcutRegistered: true }), false)
  assert.equal(notification.shows, 1)
  notification.emit('click'); await new Promise(resolve => setImmediate(resolve)); assert.equal(opens, 1)
  notification.emit('failed', {}, 'delivery failed'); assert.equal(errors.length, 1)
  normal.dispose(); assert.equal(notification.closed, true)
  notification.emit('click'); await new Promise(resolve => setImmediate(resolve)); assert.equal(opens, 1)
  const disabled = make(), before = FakeNotification.created.length
  assert.equal(disabled.show({ enabled: false, shortcutRegistered: true }), false)
  assert.equal(disabled.show({ enabled: true, shortcutRegistered: true }), false)
  assert.equal(FakeNotification.created.length, before, 'Changing a next-start preference must not suddenly display another startup toast')
  FakeNotification.supported = false
  assert.equal(make().show({ enabled: true, shortcutRegistered: true }), false)
  assert.equal(FakeNotification.created.length, before)
  FakeNotification.supported = true
  const unavailable = make()
  assert.equal(unavailable.show({ enabled: true, shortcutRegistered: false }), true)
  const body = FakeNotification.created.at(-1).options.body
  assert(body.includes('Alt + A 暂时无法启用'))
  assert(!body.includes('随时可以通过Alt + A'))
  unavailable.dispose()
  const custom = make()
  assert.equal(custom.show({ enabled: true, shortcutRegistered: true, shortcut: 'Ctrl+Shift+F10' }), true)
  assert.equal(FakeNotification.created.at(-1).options.body, exact.replace('Alt + A', 'Ctrl + Shift + F10'))
  custom.dispose()
  const customUnavailable = make()
  assert.equal(customUnavailable.show({ enabled: true, shortcutRegistered: false, shortcut: 'Super+F11' }), true)
  assert(FakeNotification.created.at(-1).options.body.includes('Win + F11 暂时无法启用'))
  assert(!FakeNotification.created.at(-1).options.body.includes('Alt + A'))
  customUnavailable.dispose()
  FakeNotification.throwOnShow = true
  const failure = make()
  assert.doesNotThrow(() => assert.equal(failure.show({ enabled: true, shortcutRegistered: true }), false))
  assert.equal(errors.length, 2)
  assert.equal(failure.show({ enabled: true, shortcutRegistered: true }), false)
  console.log(JSON.stringify({ exactBody: true, customShortcutInBody: true, customShortcutFailureHonest: true, supportedCheck: true, oncePerStartup: true, disabledPreference: true, shortcutFailureHonest: true, clickOpensSettings: true, notificationFailureNonBlocking: true, noSystemToastShown: true }, null, 2))
}
run().catch(error => { console.error(error); process.exitCode = 1 })
