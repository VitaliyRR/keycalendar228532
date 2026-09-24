// Rasterize the static SVG handoff. No app or browser automation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Resvg} from '../.artifact-tools/node_modules/@resvg/resvg-js/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'design/source'), target=path.join(root,'design/exports');
await fs.mkdir(target,{recursive:true});
for(const name of (await fs.readdir(source)).filter(n=>n.endsWith('.svg'))){
  const svg=await fs.readFile(path.join(source,name),'utf8');
  const raster=new Resvg(svg,{font:{fontFiles:[path.join(root,'assets/fonts/GolosText-variable.ttf')],loadSystemFonts:false,defaultFontFamily:'Golos Text'},background:'#FFFFFF'});
  await fs.writeFile(path.join(target,name.replace('.svg','.png')),raster.render().asPng());
}
const favicon=await fs.readFile(path.join(root,'assets/brand/favicon.svg'),'utf8');
for(const size of [32,180]){
  const r=new Resvg(favicon,{fitTo:{mode:'width',value:size}});
  await fs.writeFile(path.join(root,`assets/brand/favicon-${size}.png`),r.render().asPng());
}
console.log('Rendered all editable SVGs to PNG.');
