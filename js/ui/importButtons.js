// Кнопки «Добавить фото» и «Добавить папку».
import { h, icon } from './dom.js';
import { importFiles } from '../data/importer.js';

const supportsFolders = () => {
  const i = document.createElement('input');
  return 'webkitdirectory' in i && !matchMedia('(pointer: coarse)').matches;
};

export function importButtons({ compact = false } = {}) {
  const files = h('input', { type: 'file', multiple: true, accept: 'image/*,.heic,.heif', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  files.addEventListener('change', () => { if (files.files.length) importFiles(files.files); files.value = ''; });
  const wrap = h('div', { class: `import-buttons${compact ? ' compact' : ''}` }, files,
    h('button', { class: 'btn primary', type: 'button', onClick: () => files.click() }, icon('image', 20), 'Добавить фото'));
  if (supportsFolders()) {
    const folder = h('input', { type: 'file', webkitdirectory: true, multiple: true, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    folder.webkitdirectory = true;
    folder.addEventListener('change', () => { if (folder.files.length) importFiles(folder.files); folder.value = ''; });
    wrap.append(folder, h('button', { class: 'btn', type: 'button', onClick: () => folder.click() }, icon('folder', 20), 'Добавить папку'));
  }
  return wrap;
}
