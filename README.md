<div align="center">

# GcodeGallery

**Point it at a folder and see every G-code file as a 3D preview of its toolpath, with print time, filament,
printer and size under each one. Find the part you need in seconds, or just look through what you have.**

[Русский](README.ru.md)

[![Status](https://img.shields.io/badge/status-in_development-orange)](#) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript) [![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/) [![Three.js](https://img.shields.io/badge/Three.js-000000?logo=threedotjs&logoColor=white)](https://threejs.org/) [![Built with Claude Code](https://img.shields.io/badge/Built_with-Claude_Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)

Code, tests and docs are written by Claude (Anthropic) in Claude Code. Ideas, testing and decisions - Alexey.

</div>

> **Not released yet.** This file describes what the first version will do. Screenshots come with the first build.

## What it will do

- **A gallery of a folder.** Pick a folder (subfolders too) and every print file becomes a tile with its own 3D
  preview of the toolpath. Hover a tile and the model turns and the layers scroll. New files show up on their own.
- **Grid or strip.** A grid of tiles with a size slider, or a strip: one large model on top and small ones below,
  arrow keys to flip through.
- **What is under each preview:** print time, grams and meters of filament and its cost, filament type and
  temperatures, nozzle and layer height, the printer it was sliced for, size X×Y×Z and layer count, the slicer and
  the date.
- **Search, sort, filter** by name, time, weight, filament, date. Favorites, your own tags, a note per file,
  "printed / not printed yet". Files themselves are never changed.
- **Open large:** a big 3D view with a layer slider, colors by line type (walls, infill, supports, bridges) or by
  the filament color, and every setting stored in the file.
- **Send to the printer** (Elegoo Centauri Carbon over the network, the same code as in
  [Slicer CC](https://github.com/ALEXalesha/Slicer)). The print starts only after you press the button.
- **More than .gcode:** .gcode.3mf (Bambu Studio, OrcaSlicer), .bgcode (PrusaSlicer), plain .3mf and .stl.
- The model stands on the printer's own bed (PEI texture, markings, shadow), modeled in Blender.
- Five themes, Russian and English, the window remembers its size.

Later the gallery becomes a tab in Slicer CC as well.

## License

[MIT](LICENSE)
