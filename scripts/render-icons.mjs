import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svgSource = readFileSync('mfinder_icon.svg', 'utf8');
const sizes = [128, 512];

for (const size of sizes) {
  const renderer = new Resvg(svgSource, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)'
  });

  const pngData = renderer.render();
  writeFileSync(`mfinder_icon_${size}.png`, pngData.asPng());
  console.log(`Generated mfinder_icon_${size}.png`);
}
