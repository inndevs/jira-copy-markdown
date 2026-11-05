import { readFile, writeFile } from 'node:fs/promises';
import { launchChrome } from './cdp.mjs';

const svg = await readFile(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const { page, close } = await launchChrome(['--disable-extensions']);
try {
  for (const size of [16, 32, 48, 128]) {
    const result = await page.evaluate(`(async () => {
      const size = ${size};
      const source = new DOMParser().parseFromString(${JSON.stringify(svg)}, 'image/svg+xml');
      const root = source.documentElement;
      if (source.querySelector('parsererror')) throw new Error('Invalid icon SVG.');
      root.setAttribute('width', size);
      root.setAttribute('height', size);
      // Crop the store margin away at toolbar and extension-management sizes.
      if (size < 128) root.setAttribute('viewBox', '16 16 96 96');
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(source));
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      let left = size, top = size, right = -1, bottom = -1;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (!pixels[(y * size + x) * 4 + 3]) continue;
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
      return { size, bounds: { left, top, right, bottom }, png: canvas.toDataURL('image/png').split(',')[1] };
    })()`);
    const margin = size === 128 ? 16 : 0;
    if (result.bounds.left !== margin || result.bounds.top !== margin ||
      result.bounds.right !== size - margin - 1 || result.bounds.bottom !== size - margin - 1) {
      throw new Error(`Unexpected icon padding: ${JSON.stringify({ size, bounds: result.bounds })}`);
    }
    await writeFile(new URL(`../icons/icon${size}.png`, import.meta.url), Buffer.from(result.png, 'base64'));
    console.log(`icon${size}.png: alpha bounds ${JSON.stringify(result.bounds)}`);
  }

} finally {
  await close();
}
