<div align="center">

# GcodeGallery

**Укажите папку - и каждый G-code в ней видно 3D-превью пути сопла, а под ним время печати, пластик, принтер и
размер. Нужная деталь находится за секунды, а можно и просто осмотреть, что лежит.**

[English](README.md)

[![Status](https://img.shields.io/badge/status-in_development-orange)](#) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript) [![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/) [![Three.js](https://img.shields.io/badge/Three.js-000000?logo=threedotjs&logoColor=white)](https://threejs.org/) [![Built with Claude Code](https://img.shields.io/badge/Built_with-Claude_Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)

Код, тесты и документацию пишет Claude (Anthropic) в Claude Code. Идеи, проверка и решения - Алексея.

</div>

> **Ещё не выпущено.** Здесь описано, что будет уметь первая версия. Снимки появятся с первой сборкой.

## Что будет уметь

- **Галерея папки.** Выбираете папку (с подпапками), и каждый файл печати становится плиткой со своим 3D-превью
  пути сопла. Наведёте мышь - модель поворачивается, слои прокручиваются. Новые файлы появляются сами.
- **Сетка или лента.** Сетка плиток с ползунком размера или лента: одна крупная модель сверху, маленькие снизу,
  листать стрелками.
- **Что под превью:** время печати, граммы и метры пластика и стоимость, тип пластика и температуры, сопло и высота
  слоя, для какого принтера нарезано, габариты X×Y×Z и число слоёв, чем нарезано и когда.
- **Поиск, сортировка, фильтры** по имени, времени, весу, пластику, дате. Избранное, свои метки, заметка к файлу,
  «напечатано / ещё не печаталось». Сами файлы не меняются.
- **Открыть крупно:** большое 3D с ползунком слоёв, цвета по типу линий (стенки, заполнение, поддержки, мосты) или
  цветом пластика, все настройки из файла.
- **Отправить на принтер** (Elegoo Centauri Carbon по сети, тот же код, что в
  [Slicer CC](https://github.com/ALEXalesha/Slicer)). Печать начинается только по вашей кнопке.
- **Не только .gcode:** .gcode.3mf (Bambu Studio, OrcaSlicer), .bgcode (PrusaSlicer), обычные .3mf и .stl.
- Модель стоит на столе своего принтера (текстура PEI, разметка, тень), стол сделан в Blender.
- Пять тем, русский и английский, окно запоминает размер.

Потом галерея станет и вкладкой в Slicer CC.

## Лицензия

[MIT](LICENSE)
