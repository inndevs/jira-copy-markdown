import { readFile, writeFile } from 'node:fs/promises';
import { temporaryPage } from './cdp.mjs';
const svg = await readFile(new URL('../icons/icon.svg', import.meta.url), 'utf8');
await temporaryPage(async (page) => {
  for (const size of [16, 32, 48, 128]) {
    const data = await page.evaluate(`(async () => {
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)});
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = ${size};
      canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size});
      return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    await writeFile(new URL(`../icons/icon${size}.png`, import.meta.url), Buffer.from(data, 'base64'));
  }
});
console.log('Rendered original SVG at 16, 32, 48 and 128 pixels.');
