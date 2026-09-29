# CSR Editor

A browser-based editor for hardware control/status register (CSR) maps.
Describe your registers once, and CSR Editor generates everything around them:
synthesizable RTL, a C header, timing constraints, a spreadsheet and a datasheet.

## Features

- **Register map editor.** Add, move, search and delete registers. Supports register arrays, and flags fields that no longer fit the data width.
- **Field editor.** Drag fields to reorder them, set bit ranges (including parameterized ones), reset values and descriptions, and name individual values or bits.
- **Access types.** `RW`, `RO`, `WO`, `W1C`, `W1S`, `W0C`, `W1P` (pulse) and `W1SC` (self-clearing with a per-field hold window).
- **Bus interfaces.** Native, AXI4-Lite and Avalon-MM, with write strobes / byte enables.
- **Generated outputs:**
  - **RTL.** A SystemVerilog CSR block, plus a package of named field values.
  - **C header.** Register addresses, field masks/shifts, reset values and a register table.
  - **SDC.** False-path constraints for fields marked quasi-static.
  - **Excel.** A register map workbook, with arrays flattened onto their own sheet.
  - **Datasheet.** A register reference document, viewable in the app and exportable as PDF.
- **Project files.** Documents are plain JSON. In Chromium-based browsers the editor links to the file on disk and autosaves as you edit. Other browsers upload and download instead.
- Light and dark themes, and resizable sidebars.

## Getting started

Requires Node.js 20+.

```sh
npm install
npm run dev       # http://localhost:3000
```

Build a static site for deployment:

```sh
npm run build     # output in dist/
npm run preview
```

## Project file format

A CSR document is a JSON file:

```json
{
  "params": {
    "dataWidth": 32,
    "addrWidth": 16,
    "interface": "Native",
    "moduleName": "pwm_controller"
  },
  "registers": {
    "0": {
      "name": "CTRL",
      "description": "Control register",
      "fields": [
        {
          "name": "cntr_en",
          "type": "RW",
          "bitRange": { "msb": 0, "lsb": 0 },
          "resetValue": 0,
          "desc": "Counter enable"
        }
      ]
    }
  }
}
```

## Tech stack

React 19, Vite, Tailwind CSS, Radix UI, Zustand, pdfmake, xlsx-js-style.

## Project credits

- **Repository owner and original contributor:**
  [chipguys2026](https://github.com/chipguys2026), also known as
  [khiemnb153](https://github.com/khiemnb153) in the commit history.
- **Contributor:** [superzeldalink](https://github.com/superzeldalink).

## License

CSR Editor is dual-licensed: choose the AGPL-3.0-only license or obtain a
separate commercial license from its copyright holders.

### Open source: AGPL-3.0

You may use, modify and distribute CSR Editor under the
[GNU Affero General Public License v3.0](LICENSE). Distribution of source or
built copies carries the license's source-code obligations. If you modify the
program and let users interact with that version over a network, section 13
requires you to offer those users its Corresponding Source. See the license for
the exact conditions.

### Commercial license

For terms to use CSR Editor outside the AGPL-3.0-only license, contact
**contact@chipguys.top**. A separate commercial license must come from
the copyright holders of the code it covers.

### Generated output

Your input remains yours. Generated RTL, C headers, SDC constraints,
spreadsheets and documents may be used under terms of your choice. Where an
output contains copyrightable material from CSR Editor, the copyright holders
grant the additional permission in [OUTPUT-EXCEPTION.md](OUTPUT-EXCEPTION.md).
That permission does not cover the editor itself or third-party material.

### Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md).
Before a pull request can be merged, its contributor must sign the
[Contributor License Agreement](CLA.md), which allows the maintainers to offer
the contribution under both open-source and commercial terms.

---

Copyright © 2026 chipguys2026 (also khiemnb153) and superzeldalink.
All rights reserved except as granted above.
