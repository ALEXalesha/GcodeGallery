// Закон Алексея «без кнопки не печатает» - на поддельном принтере и на подставной отправке.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');
const { opts } = require('../support/seed');
const { Printing, gcodeFor, remoteNameFor } = require('../../src/core/printing');
const { startFakePrinter } = require('../support/fake-printer');

const FIX = path.join(__dirname, '..', 'fixtures');
const ORCA = path.join(FIX, 'orca.gcode');

test('law: random sequences of upload / print / arm calls start a print only with a fresh token for the same file, at most once per token', async () => {
  const op = fc.record({
    kind: fc.constantFrom('upload', 'print', 'arm', 'print-stolen', 'print-forged', 'print-other-file', 'print-late'),
    file: fc.constantFrom(ORCA, path.join(FIX, 'elegoo.gcode')),
  });
  await fc.assert(fc.asyncProperty(fc.array(op, { maxLength: 25 }), async (ops) => {
    let now = 1000;
    const calls = [];
    const p = new Printing({ send: async (o) => { calls.push(o.start); return { ok: true, started: o.start }; }, now: () => now, ttlMs: 60000, confirm: async () => true });
    let lastToken = null, lastFile = null, expected = 0;
    const used = new Set();
    for (const o of ops) {
      if (o.kind === 'arm') { lastToken = await p.arm(o.file); lastFile = o.file; continue; }
      if (o.kind === 'upload') { await p.run({ file: o.file, host: 'h' }); continue; }
      let token = lastToken, file = lastFile || o.file;
      if (o.kind === 'print-forged') token = 'f'.repeat(32);
      if (o.kind === 'print-other-file') file = file === ORCA ? path.join(FIX, 'elegoo.gcode') : ORCA;
      if (o.kind === 'print-late') now += 61000;
      const ok = token && !used.has(token) && o.kind !== 'print-forged' && o.kind !== 'print-other-file' && o.kind !== 'print-late';
      if (token) used.add(token);
      if (o.kind === 'print-stolen' || o.kind === 'print' || o.kind === 'print-forged' || o.kind === 'print-other-file' || o.kind === 'print-late') {
        try { await p.run({ file, host: 'h', start: true, token }); assert.ok(ok, 'started without a valid token: ' + o.kind); expected++; } catch (e) { assert.strictEqual(e.code, 'no-button'); assert.ok(!ok, 'valid token refused'); }
      }
      if (o.kind === 'print-late') now -= 61000;
    }
    assert.strictEqual(calls.filter((s) => s === true).length, expected);
  }), opts(200));
});

test('fake printer: upload without the button - the file is there, not a single start command; with the button - exactly one', async () => {
  const fake = await startFakePrinter();
  try {
    const p = new Printing({ confirm: async () => true });
    const r = await p.run({ file: ORCA, host: fake.host });
    assert.strictEqual(r.started, false);
    assert.strictEqual(fake.commands(128).length, 0);
    await assert.rejects(p.run({ file: ORCA, host: fake.host, start: true }), (e) => e.code === 'no-button');
    await assert.rejects(p.run({ file: ORCA, host: fake.host, start: true, token: 'x' }), (e) => e.code === 'no-button');
    assert.strictEqual(fake.commands(128).length, 0);
    const token = await p.arm(ORCA);
    const ok = await p.run({ file: ORCA, host: fake.host, start: true, token });
    assert.strictEqual(ok.started, true);
    assert.strictEqual(fake.commands(128).length, 1);
    await assert.rejects(p.run({ file: ORCA, host: fake.host, start: true, token }), (e) => e.code === 'no-button');
    assert.strictEqual(fake.commands(128).length, 1, 'the same token never starts twice');
    assert.ok(fake.commands(128)[0].data.Filename.endsWith('orca.gcode') || /orca/.test(fake.commands(128)[0].data.Filename));
  } finally { await fake.close(); }
});

test('what goes to the printer: .gcode as is, .gcode.3mf - its first plate, .bgcode / models - refused; safe names', () => {
  assert.deepStrictEqual(gcodeFor(ORCA), fs.readFileSync(ORCA));
  const plate = gcodeFor(path.join(FIX, 'bambu.gcode.3mf'));
  assert.deepStrictEqual(plate, fs.readFileSync(path.join(FIX, 'bambu.gcode')));
  for (const f of ['prusa.bgcode', 'cube.stl', 'model.3mf', 'notzip.3mf']) assert.throws(() => gcodeFor(path.join(FIX, f)), (e) => e.code === 'format', f);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-pr-'));
  fs.copyFileSync(path.join(FIX, 'prusa.bgcode'), path.join(dir, 'renamed.gcode'));
  assert.throws(() => gcodeFor(path.join(dir, 'renamed.gcode')), (e) => e.code === 'format');
  assert.strictEqual(remoteNameFor('/a/Деталь кронштейна v2.gcode'), 'Detal_kronshteyna_v2.gcode');
  assert.strictEqual(remoteNameFor('/a/x.gcode.3mf'), 'x.gcode');
  assert.strictEqual(remoteNameFor('/a/旋转.gcode'), 'print.gcode');
});

test('no host, a second send while one is running - refused before anything is sent', async () => {
  let release;
  const sent = [];
  const p = new Printing({ send: (o) => { sent.push(o); return new Promise((r) => { release = r; }); } });
  await assert.rejects(p.run({ file: ORCA, host: '' }), (e) => e.code === 'no-host');
  const first = p.run({ file: ORCA, host: 'h' });
  await new Promise((r) => setImmediate(r));
  await assert.rejects(p.run({ file: ORCA, host: 'h' }), (e) => e.code === 'busy-sending');
  release({ ok: true });
  await first;
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].start, false);
});

test('law R3: a token only after "Print" in the confirmation of the main process; no confirmer - never; asked every time', async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }), async (answers) => {
    const asked = [], started = [];
    let i = 0;
    const p = new Printing({ send: async (o) => { started.push(o.start); return { started: o.start }; }, confirm: async (file) => { asked.push(file); return answers[i++]; } });
    for (const yes of answers) {
      let token = null;
      try { token = await p.arm(ORCA); } catch (e) { assert.strictEqual(e.code, 'declined'); }
      assert.strictEqual(token !== null, yes);
      await p.run({ file: ORCA, host: 'h', start: true, token }).catch((e) => assert.strictEqual(e.code, 'no-button'));
    }
    assert.strictEqual(asked.length, answers.length, 'the person is asked on every arm');
    assert.strictEqual(started.filter(Boolean).length, answers.filter(Boolean).length);
  }), opts(100));
  const silent = new Printing({ send: async () => ({ started: true }) });
  await assert.rejects(silent.arm(ORCA), (e) => e.code === 'declined');
});
