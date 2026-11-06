# Покрытие тестами по ветвям

Обновлено: 2026-11-06. Команда: `npm run coverage` (c8, ветви).

| группа | ветви | порог |
| --- | --- | --- |
| ядро: разбор, сведения, кэш, фильтры, форматы | **94.3 %** (1040/1103) | 90 % |
| весь код без окон | **91.8 %** (2053/2237) | 80 % |

| файл | ветви | строки | ядро |
| --- | --- | --- | --- |
| electron/library.js | 94.44 % | 98.02 % |  |
| electron/window-state.js | 93.75 % | 100 % |  |
| electron/worker.js | 87.5 % | 100 % |  |
| src/core/beds.js | 100 % | 100 % | да |
| src/core/bgcode.js | 95.16 % | 98.94 % | да |
| src/core/cache.js | 96.22 % | 100 % | да |
| src/core/formats.js | 90.82 % | 100 % | да |
| src/core/heatshrink.js | 92 % | 100 % | да |
| src/core/item.js | 87.09 % | 100 % | да |
| src/core/marks.js | 96.07 % | 100 % |  |
| src/core/meatpack.js | 98 % | 98.59 % | да |
| src/core/meta.js | 94.97 % | 99.18 % | да |
| src/core/printing.js | 97.72 % | 100 % |  |
| src/core/scan.js | 82.05 % | 100 % | да |
| src/core/settings.js | 97.82 % | 100 % |  |
| src/core/thumbs.js | 96.7 % | 100 % | да |
| src/core/toolpath.js | 97.05 % | 100 % | да |
| src/gallery/filter.js | 95.34 % | 100 % | да |
| src/gallery/format.js | 94.06 % | 100 % |  |
| src/gallery/i18n.js | 92.3 % | 100 % |  |
| src/gallery/queue.js | 100 % | 100 % |  |
| src/shared/discovery.js | 83.33 % | 100 % |  |
| src/shared/gcode-info.js | 84 % | 100 % |  |
| src/shared/gcode-preview.js | 99.25 % | 100 % | да |
| src/shared/geom.js | 95.65 % | 100 % |  |
| src/shared/mesh.js | 77.93 % | 99.31 % |  |
| src/shared/names.js | 96 % | 100 % |  |
| src/shared/printer-client.js | 75.82 % | 100 % |  |
| src/shared/printer-control.js | 96.69 % | 100 % |  |
| src/shared/sdcp.js | 89.65 % | 100 % |  |
| src/shared/send.js | 85.55 % | 99.32 % |  |
| src/shared/upload.js | 94.11 % | 96.47 % |  |
| src/shared/zip.js | 77.27 % | 87.5 % |  |

Окно (src/gallery/gallery.js, viewer.js, render3d.js, src/renderer, electron/main.js, ipc.js, preload.js) проверяется тестами Playwright (tests/app), в этот счёт не входит.
