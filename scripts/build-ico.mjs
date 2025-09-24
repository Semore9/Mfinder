import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const svgSource = readFileSync('mfinder_icon.svg', 'utf8');
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

const pngBuffers = icoSizes.map((size) => {
  const renderer = new Resvg(svgSource, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)'
  });
  return renderer.render().asPng();
});

const icoData = await pngToIco(pngBuffers);
writeFileSync('mfinder_icon.ico', icoData);
console.log('Generated mfinder_icon.ico');
