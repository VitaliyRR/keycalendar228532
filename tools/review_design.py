"""Create contact sheets and check SVG text extents / semantic color contrast."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import xml.etree.ElementTree as ET
import json,math
ROOT=Path(__file__).resolve().parents[1]
fontpath=ROOT/'assets/fonts/GolosText-variable.ttf'
def run():
    files=sorted((ROOT/'design/exports').glob('*.png'));out=ROOT/'design/review';out.mkdir(exist_ok=True)
    label=ImageFont.truetype(str(fontpath),17);sheets=[]
    for n in range(0,len(files),24):
        batch=files[n:n+24];canvas=Image.new('RGB',(1600,1800),'#E5E8EA');draw=ImageDraw.Draw(canvas)
        for i,p in enumerate(batch):
            im=Image.open(p).convert('RGB');im.thumbnail((384,264));x=8+(i%4)*400;y=8+(i//4)*300
            canvas.paste(im,(x,y));draw.text((x,y+268),p.stem,font=label,fill='#202B36')
        target=out/f'contact-{n//24+1:02}.png';canvas.save(target);sheets.append(str(target.relative_to(ROOT)))
    extents=[];text_count=0
    for p in sorted((ROOT/'design/source').glob('*.svg')):
        root=ET.parse(p).getroot();w,h=float(root.get('width')),float(root.get('height'))
        for t in root.findall('.//{http://www.w3.org/2000/svg}text'):
            value=t.text or '';f=ImageFont.truetype(str(fontpath),int(float(t.get('font-size','14'))));x,y=float(t.get('x','0')),float(t.get('y','0'));right=x+f.getlength(value);text_count+=1
            if x<0 or y-f.size<0 or right>w+1 or y>h+1:extents.append({'file':p.name,'x':x,'y':y,'right':round(right,1),'canvas':[w,h]})
    colors=json.loads((ROOT/'design/tokens.json').read_text(encoding='utf-8'))['color']
    def lum(c):
        rgb=[int(c[i:i+2],16)/255 for i in [1,3,5]];a=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb];return sum(v*k for v,k in zip(a,[.2126,.7152,.0722]))
    pairs=[]
    for fg,bg in [('ink','paper'),('muted','paper'),('muted','canvas'),('blue','paper'),('blue','pale'),('green','greenbg'),('amber','amberbg'),('red','redbg'),('muted','slate'),('paper','blue')]:
        a,b=lum(colors[fg]['$value']),lum(colors[bg]['$value']);ratio=(max(a,b)+.05)/(min(a,b)+.05);pairs.append({'foreground':fg,'background':bg,'ratio':round(ratio,2),'normal_text_4_5':ratio>=4.5})
    report={'as_of':'2026-09-24','png_count':len(files),'svg_text_nodes_checked':text_count,'text_outside_canvas':extents,'semantic_text_contrast':pairs,'contact_sheets':sheets,'scope':'Static artwork extents/color pairs only. Does not verify interactive accessibility or all overlaps.'}
    (out/'geometry-and-contrast.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'png':len(files),'text_nodes':text_count,'outside':extents,'contrast_pass':all(p['normal_text_4_5'] for p in pairs),'sheets':len(sheets)},ensure_ascii=False))
if __name__=='__main__':run()
