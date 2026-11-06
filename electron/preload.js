// Единственный мост между окном и Node: window.galleryHost. Ответ главного процесса -
// {ok, value} или {ok: false, code}; здесь он превращается в значение или исключение.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => async (...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && r.ok) return r.value;
  // Простой объект, а не Error: через contextBridge у Error доходит только текст, а code теряется.
  throw { name: 'GalleryError', code: (r && r.code) || 'error', message: (r && r.message) || 'error' };
};
const listen = (channel) => (cb) => {
  const h = (_e, data) => cb(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('galleryHost', {
  state: call('state'),
  setSettings: call('settings:set'),
  chooseFolder: call('folder:choose'),
  openFolder: call('folder:open'),
  items: call('items'),
  marks: call('marks'),
  preview: call('preview'),
  view: call('view'),
  detail: call('detail'),
  saveShot: call('shot'),
  mark: call('mark'),
  reveal: call('reveal'),
  discover: call('printer:discover'),
  printArm: call('print:arm'),
  print: call('print:run'),
  cancelPrint: call('print:cancel'),
  onItems: listen('items:changed'),
  onSendStep: listen('send:step'),
});
