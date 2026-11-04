// Тексты окна: русский и английский. t('ключ', {n: 3}) - подстановка {n}; plural - формы
// числа для русского (1 слой, 2 слоя, 5 слоёв).

export const DICT = {
  ru: {
    'app.title': 'Галерея G-code',
    'top.folder': 'Папка…', 'top.folderTitle': 'Выбрать папку с файлами печати', 'top.noFolder': 'Папка не выбрана',
    'top.search': 'Поиск: имя, пластик, принтер, метка', 'top.sub': 'С подпапками', 'top.rescan': 'Обновить',
    'top.grid': 'Сетка', 'top.strip': 'Лента', 'top.size': 'Размер плиток', 'top.filters': 'Фильтры', 'top.settings': 'Настройки',
    'top.sort': 'Сортировка', 'top.dir.asc': 'По возрастанию', 'top.dir.desc': 'По убыванию',
    'sort.name': 'Имя', 'sort.date': 'Дата файла', 'sort.sliced': 'Дата нарезки', 'sort.time': 'Время печати', 'sort.weight': 'Вес', 'sort.size': 'Размер файла',
    'f.types': 'Пластик', 'f.kinds': 'Вид файла', 'f.favorite': 'Только избранное', 'f.printed': 'Печать', 'f.printed.any': 'Все', 'f.printed.yes': 'Напечатано',
    'f.printed.no': 'Не печаталось', 'f.tag': 'Метка', 'f.tag.any': 'Любая', 'f.time': 'Время, ч', 'f.weight': 'Вес, г', 'f.date': 'Дата', 'f.from': 'от', 'f.to': 'до',
    'f.reset': 'Сбросить', 'f.count': '{n} из {m}',
    'empty.noFolder': 'Выберите папку с файлами G-code - каждый файл станет плиткой с 3D-видом.',
    'empty.none': 'В этой папке нет файлов печати (.gcode, .gcode.3mf, .bgcode, .3mf, .stl).',
    'empty.filtered': 'Под фильтр ничего не подходит.',
    'status.scanning': 'Читаю папку…', 'status.files': '{n} {files}', 'status.queue': 'Превью: осталось {n}',
    'files.1': 'файл', 'files.2': 'файла', 'files.5': 'файлов',
    'layers.1': 'слой', 'layers.2': 'слоя', 'layers.5': 'слоёв',
    'u.h': 'ч', 'u.m': 'мин', 'u.s': 'с', 'u.d': 'д', 'u.g': 'г', 'u.kg': 'кг', 'u.mm': 'мм', 'u.m_': 'м', 'u.kb': 'КБ', 'u.mb': 'МБ', 'u.b': 'Б',
    'card.time': 'Время печати', 'card.filament': 'Пластик', 'card.cost': 'Стоимость', 'card.temps': 'Сопло / стол', 'card.nozzle': 'Сопло, слой',
    'card.printer': 'Принтер', 'card.dims': 'Габариты', 'card.fits': 'влезает на стол', 'card.nofit': 'НЕ влезает на стол', 'card.slicer': 'Нарезано',
    'card.file': 'Файл', 'card.error': 'Не удалось прочитать файл', 'card.model': 'Модель без нарезки', 'card.triangles': '{n} треугольников',
    'card.plates': 'пластин: {n}, показана 1-я', 'card.estimated': '≈ по длине нити', 'card.open': 'Открыть крупно', 'card.fav': 'Избранное',
    'card.printedYes': 'Напечатано', 'card.printedNo': 'Не печаталось', 'card.loading': 'Считаю 3D…',
    'kind.gcode': 'G-code', 'kind.gcode3mf': '.gcode.3mf', 'kind.bgcode': '.bgcode', 'kind.3mf': '3MF', 'kind.stl': 'STL',
    'v.close': 'Закрыть', 'v.prev': 'Предыдущий', 'v.next': 'Следующий', 'v.layer': 'Слой {n} из {m} · Z {z} мм', 'v.only': 'Только этот слой',
    'v.color': 'Цвет', 'v.color.type': 'По типу линий', 'v.color.filament': 'Цветом пластика', 'v.info': 'Сведения', 'v.settings': 'Все настройки файла ({n})',
    'v.marks': 'Отметки', 'v.tags': 'Метки (через запятую)', 'v.note': 'Заметка', 'v.printed': 'Печать', 'v.printed.none': 'Не отмечено', 'v.reset': 'Вид сначала', 'v.loading': 'Загружаю полный путь сопла…',
    'v.folder': 'Показать в папке', 'v.noSettings': 'В файле нет настроек слайсера.',
    'g.walls': 'Стенки', 'g.infill': 'Заполнение', 'g.support': 'Поддержки', 'g.adhesion': 'Юбка и кайма', 'g.other': 'Прочее',
    'k.outer': 'Внешняя стенка', 'k.inner': 'Внутренняя стенка', 'k.overhang': 'Нависание', 'k.sparse': 'Заполнение', 'k.solid': 'Сплошное заполнение',
    'k.top': 'Верх', 'k.bottom': 'Низ', 'k.bridge': 'Мост', 'k.gap': 'Щели', 'k.ironing': 'Разглаживание', 'k.support': 'Поддержка',
    'k.supportIf': 'Контакт поддержки', 'k.skirt': 'Юбка / кайма', 'k.tower': 'Башня очистки', 'k.custom': 'Прочее',
    'p.title': 'Печать на принтере', 'p.send': 'На принтер…', 'p.host': 'Адрес принтера (IP)', 'p.find': 'Найти в сети', 'p.found': 'Найдено: {n}',
    'p.upload': 'Только загрузить файл', 'p.print': 'Загрузить и печатать…', 'p.confirm': 'Начать печать «{name}» на {host}?',
    'p.confirmHint': 'Печать начнётся сразу после загрузки. Проверьте, что стол чист и пластик заправлен.', 'p.yes': 'Да, печатать', 'p.no': 'Отмена',
    'p.cancel': 'Остановить отправку', 'p.notGcode': 'На принтер Elegoo уходит только .gcode и .gcode.3mf.', 'p.foreign': 'Файл нарезан для «{printer}», не для Elegoo - проверьте.',
    'p.step.connect': 'Подключаюсь…', 'p.step.check-idle': 'Проверяю, свободен ли принтер…', 'p.step.upload': 'Загружаю: {pct} %',
    'p.step.verify': 'Жду файл в списке принтера ({s} с)…', 'p.step.start': 'Даю команду печати…', 'p.step.started': 'Печать началась.',
    'p.ok.upload': 'Файл загружен на принтер как {name}. Печать не начиналась.', 'p.ok.print': 'Печать началась: {name}.',
    'p.err': 'Не получилось: {code}', 'p.noHost': 'Укажите адрес принтера в настройках.',
    's.title': 'Настройки', 's.theme': 'Тема', 's.lang': 'Язык', 's.price': 'Цена катушки', 's.grams': 'Вес катушки, г', 's.currency': 'Валюта',
    's.printer': 'Принтер Elegoo (адрес)', 's.close': 'Готово', 's.cache': 'Кэш: {n} файлов',
    'theme.dark': 'Стеклянная', 'theme.light': 'Светлая', 'theme.formal': 'Строгая', 'theme.night': 'Ночная', 'theme.warm': 'Тёплая',
  },
  en: {
    'app.title': 'G-code Gallery',
    'top.folder': 'Folder…', 'top.folderTitle': 'Choose a folder with print files', 'top.noFolder': 'No folder chosen',
    'top.search': 'Search: name, filament, printer, tag', 'top.sub': 'Subfolders', 'top.rescan': 'Refresh',
    'top.grid': 'Grid', 'top.strip': 'Strip', 'top.size': 'Tile size', 'top.filters': 'Filters', 'top.settings': 'Settings',
    'top.sort': 'Sort', 'top.dir.asc': 'Ascending', 'top.dir.desc': 'Descending',
    'sort.name': 'Name', 'sort.date': 'File date', 'sort.sliced': 'Sliced date', 'sort.time': 'Print time', 'sort.weight': 'Weight', 'sort.size': 'File size',
    'f.types': 'Filament', 'f.kinds': 'File type', 'f.favorite': 'Favorites only', 'f.printed': 'Printed', 'f.printed.any': 'All', 'f.printed.yes': 'Printed',
    'f.printed.no': 'Not printed', 'f.tag': 'Tag', 'f.tag.any': 'Any', 'f.time': 'Time, h', 'f.weight': 'Weight, g', 'f.date': 'Date', 'f.from': 'from', 'f.to': 'to',
    'f.reset': 'Reset', 'f.count': '{n} of {m}',
    'empty.noFolder': 'Choose a folder with G-code files - every file becomes a tile with a 3D view.',
    'empty.none': 'No print files in this folder (.gcode, .gcode.3mf, .bgcode, .3mf, .stl).',
    'empty.filtered': 'Nothing matches the filters.',
    'status.scanning': 'Reading the folder…', 'status.files': '{n} {files}', 'status.queue': 'Previews left: {n}',
    'files.1': 'file', 'files.2': 'files', 'files.5': 'files',
    'layers.1': 'layer', 'layers.2': 'layers', 'layers.5': 'layers',
    'u.h': 'h', 'u.m': 'm', 'u.s': 's', 'u.d': 'd', 'u.g': 'g', 'u.kg': 'kg', 'u.mm': 'mm', 'u.m_': 'm', 'u.kb': 'KB', 'u.mb': 'MB', 'u.b': 'B',
    'card.time': 'Print time', 'card.filament': 'Filament', 'card.cost': 'Cost', 'card.temps': 'Nozzle / bed', 'card.nozzle': 'Nozzle, layer',
    'card.printer': 'Printer', 'card.dims': 'Size', 'card.fits': 'fits the bed', 'card.nofit': 'does NOT fit the bed', 'card.slicer': 'Sliced',
    'card.file': 'File', 'card.error': 'Could not read the file', 'card.model': 'Model, not sliced', 'card.triangles': '{n} triangles',
    'card.plates': '{n} plates, showing the 1st', 'card.estimated': '≈ from filament length', 'card.open': 'Open large', 'card.fav': 'Favorite',
    'card.printedYes': 'Printed', 'card.printedNo': 'Not printed', 'card.loading': 'Building 3D…',
    'kind.gcode': 'G-code', 'kind.gcode3mf': '.gcode.3mf', 'kind.bgcode': '.bgcode', 'kind.3mf': '3MF', 'kind.stl': 'STL',
    'v.close': 'Close', 'v.prev': 'Previous', 'v.next': 'Next', 'v.layer': 'Layer {n} of {m} · Z {z} mm', 'v.only': 'This layer only',
    'v.color': 'Color', 'v.color.type': 'By line type', 'v.color.filament': 'Filament color', 'v.info': 'Details', 'v.settings': 'All file settings ({n})',
    'v.marks': 'Marks', 'v.tags': 'Tags (comma separated)', 'v.note': 'Note', 'v.printed': 'Printed', 'v.printed.none': 'Not marked', 'v.reset': 'Reset view', 'v.loading': 'Loading the full toolpath…',
    'v.folder': 'Show in folder', 'v.noSettings': 'No slicer settings in the file.',
    'g.walls': 'Walls', 'g.infill': 'Infill', 'g.support': 'Supports', 'g.adhesion': 'Skirt and brim', 'g.other': 'Other',
    'k.outer': 'Outer wall', 'k.inner': 'Inner wall', 'k.overhang': 'Overhang', 'k.sparse': 'Infill', 'k.solid': 'Solid infill',
    'k.top': 'Top', 'k.bottom': 'Bottom', 'k.bridge': 'Bridge', 'k.gap': 'Gap fill', 'k.ironing': 'Ironing', 'k.support': 'Support',
    'k.supportIf': 'Support interface', 'k.skirt': 'Skirt / brim', 'k.tower': 'Prime tower', 'k.custom': 'Other',
    'p.title': 'Print on the printer', 'p.send': 'To printer…', 'p.host': 'Printer address (IP)', 'p.find': 'Find on network', 'p.found': 'Found: {n}',
    'p.upload': 'Upload the file only', 'p.print': 'Upload and print…', 'p.confirm': 'Start printing "{name}" on {host}?',
    'p.confirmHint': 'Printing starts right after the upload. Make sure the bed is clear and filament is loaded.', 'p.yes': 'Yes, print', 'p.no': 'Cancel',
    'p.cancel': 'Stop sending', 'p.notGcode': 'Only .gcode and .gcode.3mf go to an Elegoo printer.', 'p.foreign': 'The file was sliced for "{printer}", not for Elegoo - check it.',
    'p.step.connect': 'Connecting…', 'p.step.check-idle': 'Checking that the printer is free…', 'p.step.upload': 'Uploading: {pct} %',
    'p.step.verify': 'Waiting for the file in the printer list ({s} s)…', 'p.step.start': 'Sending the print command…', 'p.step.started': 'Printing started.',
    'p.ok.upload': 'Uploaded to the printer as {name}. Printing has not started.', 'p.ok.print': 'Printing started: {name}.',
    'p.err': 'Failed: {code}', 'p.noHost': 'Set the printer address in Settings.',
    's.title': 'Settings', 's.theme': 'Theme', 's.lang': 'Language', 's.price': 'Spool price', 's.grams': 'Spool weight, g', 's.currency': 'Currency',
    's.printer': 'Elegoo printer (address)', 's.close': 'Done', 's.cache': 'Cache: {n} files',
    'theme.dark': 'Glass', 'theme.light': 'Light', 'theme.formal': 'Formal', 'theme.night': 'Night', 'theme.warm': 'Warm',
  },
};

let lang = 'ru';
export function setLang(l) { lang = DICT[l] ? l : 'ru'; }
export function getLang() { return lang; }

export function t(key, vars = {}, l = lang) {
  const d = DICT[l] || DICT.ru;
  const s = d[key] !== undefined ? d[key] : DICT.ru[key] !== undefined ? DICT.ru[key] : key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** Форма слова по числу: 1 / 2-4 / 5+ (русские правила; в английском 1 / остальное). */
export function plural(n, base, l = lang) {
  const a = Math.abs(Math.trunc(n));
  const d = a % 10, h = a % 100;
  const form = l === 'ru' ? (d === 1 && h !== 11 ? 1 : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 2 : 5) : a === 1 ? 1 : 5;
  return t(`${base}.${form}`, {}, l);
}
