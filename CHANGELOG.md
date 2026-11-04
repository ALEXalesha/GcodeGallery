# Changelog

## 0.1.0 - not released yet

First version of the gallery.

- A folder (with subfolders) as a grid of tiles or a strip; 3D toolpath previews from one angle, the picture
  from the file while the 3D is built; a live 3D view under the mouse.
- Print time, filament (grams, meters, cost by the spool price), filament type and temperatures, nozzle, layer
  height, printer, size, layers, fits on the bed, slicer, date, file size - from OrcaSlicer, Elegoo Slicer,
  Slicer CC, PrusaSlicer, Bambu Studio and Cura files.
- Formats: `.gcode`, `.gcode.3mf`, `.bgcode` (heatshrink, MeatPack, CRC32), `.3mf` and `.stl` models.
- Search, sort and filters; favorites, tags, notes, "printed / not printed" stored apart from the files.
- Open large: layer slider, colors by line type or filament color, legend, all file settings.
- Upload to an Elegoo printer and print only after the "Yes, print" button.
- Watching the folder, a cache by path + size + date, parsing in worker threads, visible tiles first.
- Five themes, Russian and English, narrow window, the window remembers its size and place.
- Shared code with Slicer CC in `src/shared` (see `SOURCE.md`).
- Tests: laws on random inputs with a seed, branch coverage with limits, mutation check, Playwright tests of the
  invisible window, CI.
