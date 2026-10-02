#!/usr/bin/env python3
"""
Draws the guild's own props in the Tiny Swords style: the pack's palette, a 3px navy
outline, light from the top left, at the pack's pixel scale (a Pawn is a 192px frame).
Tiny Swords has no indoor furniture, so the Library's shelves, books, lectern and orb are
drawn here. Add new props the same way and run:

    pip install pillow
    python3 scripts/art/props.py

It writes web/public/assets/props/*.png. Animated props are horizontal strips of frames;
web/src/scene.ts (PROPS) lists their frame sizes.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageChops
OUT=(22,28,46,255)
WD,WM,WL,WH=(104,73,72),(134,99,83),(180,131,85),(218,181,112)   # wood: deepest, dark, mid, light
BOOKS=[((192,69,58),(140,44,44)),((80,173,164),(31,103,130)),((126,92,156),(88,80,118)),((124,187,78),(47,150,106)),((218,181,112),(180,131,85)),((227,181,201),(169,121,157)),((58,120,170),(31,73,120))]
def outlined(img,w=3):
    a=img.split()[3].point(lambda v:255 if v>0 else 0)
    grown=a.filter(ImageFilter.MaxFilter(2*w+1))
    edge=Image.new('RGBA',img.size,OUT); edge.putalpha(grown)
    edge.alpha_composite(img); return edge
def shadow(w,h):
    s=Image.new('RGBA',(w,h)); ImageDraw.Draw(s).ellipse((0,0,w-1,h-1),fill=(10,16,30,70)); return s
def R(d,x0,y0,x1,y1,c): d.rectangle((x0,y0,x1-1,y1-1),fill=c)
def book_row(d,x0,x1,base,maxh,rng,lean=True):
    x=x0
    while x<x1-5:
        bw=rng.choice((6,7,8,9)); bw=min(bw,x1-x)
        h=rng.randint(maxh-9,maxh); col,dark=rng.choice(BOOKS)
        if lean and rng.random()<0.12 and x1-x>16:
            # a leaning book
            pts=[(x,base),(x+8,base),(x+bw+10,base-h+3),(x+bw+2,base-h)]; d.polygon(pts,fill=col); d.line([(x+8,base),(x+bw+10,base-h+3)],fill=dark,width=2); x+=bw+11; continue
        R(d,x,base-h,x+bw,base,col); R(d,x+bw-2,base-h,x+bw,base,dark)    # right side in shadow
        R(d,x,base-h,x+bw,base-h+2,tuple(min(255,v+40) for v in col))      # top lit
        R(d,x+1,base-h+5,x+bw-2,base-h+7,(240,234,160))                     # gold band
        R(d,x+1,base-8,x+bw-2,base-6,(240,234,160))
        x+=bw+1
def bookshelf(seed=3,w=112,h=150):
    rng=random.Random(seed); im=Image.new('RGBA',(w+20,h+20)); d=ImageDraw.Draw(im); ox,oy=10,12
    R(d,ox,oy+10,ox+w,oy+h,WD)                                   # back panel
    R(d,ox,oy+10,ox+9,oy+h,WM); R(d,ox+w-9,oy+10,ox+w,oy+h,WM)   # sides
    R(d,ox+2,oy+10,ox+5,oy+h,WL)                                 # lit edge on left side
    R(d,ox-4,oy,ox+w+4,oy+12,WL); R(d,ox-4,oy,ox+w+4,oy+4,WH); R(d,ox-4,oy+10,ox+w+4,oy+12,WM)   # top plank
    shelves=[oy+12+k*((h-22)//3) for k in range(1,4)]
    for s in shelves:
        R(d,ox+9,s-6,ox+w-9,s,WM); R(d,ox+9,s-6,ox+w-9,s-4,WL)
    tops=[oy+12]+shelves[:-1]
    for t,s in zip(tops,shelves):
        R(d,ox+9,t,ox+w-9,t+4,(70,48,50))                      # shadow under the shelf above
        book_row(d,ox+11,ox+w-11,s-6,(s-6-t)-8,rng)
        R(d,ox+w-16,t,ox+w-9,s-6,(80,56,56))                   # the far side in shade
    R(d,ox-2,oy+h-6,ox+w+2,oy+h,WM); R(d,ox-2,oy+h-6,ox+w+2,oy+h-4,WL)   # plinth
    out=outlined(im); base=Image.new('RGBA',(out.width,out.height+8)); base.alpha_composite(shadow(out.width-10,16),(5,out.height-12)); base.alpha_composite(out); return base
def book_stack(seed=5):
    rng=random.Random(seed); im=Image.new('RGBA',(70,60)); d=ImageDraw.Draw(im)
    y=52
    for k,(off,bw,bh) in enumerate(((6,52,10),(10,44,9),(4,48,9),(12,38,8))):
        col,dark=BOOKS[[0,2,1,4][k]]
        R(d,off,y-bh,off+bw,y,col); R(d,off,y-2,off+bw,y,dark); R(d,off+bw-6,y-bh,off+bw,y,(240,234,214)); R(d,off+bw-6,y-bh+3,off+bw,y-bh+4,(200,190,170))  # pages on the right
        R(d,off,y-bh,off+bw-6,y-bh+2,tuple(min(255,v+40) for v in col)); y-=bh
    return outlined(im)
def open_book(d,cx,y,s=1):
    pg,pgd,ln=(244,236,210),(214,200,170),(150,130,110)
    d.polygon([(cx,y+14),(cx-26,y+10),(cx-26,y-6),(cx,y-2)],fill=pg); d.polygon([(cx,y+14),(cx+26,y+10),(cx+26,y-6),(cx,y-2)],fill=pgd)
    for k in range(3): d.line([(cx-22,y-1+k*4),(cx-4,y+2+k*4)],fill=ln); d.line([(cx+4,y+2+k*4),(cx+22,y-1+k*4)],fill=ln)
    R(d,cx-1,y-2,cx+1,y+14,(126,92,156))
def lectern(lift=0):
    im=Image.new('RGBA',(80,100)); d=ImageDraw.Draw(im)
    R(d,34,40,46,88,WM); R(d,34,40,37,88,WL)                     # post
    R(d,20,86,60,94,WM); R(d,20,86,60,88,WL)                       # foot
    d.polygon([(10,40),(70,30),(70,40),(10,50)],fill=WL); d.polygon([(10,48),(70,38),(70,42),(10,52)],fill=WM)   # slanted top
    open_book(d,40,28)
    if lift:   # a page turning about the spine, `lift` radians off the right-hand page
        import math
        dx,dy=round(24*math.cos(lift)),round(10*math.sin(lift))
        d.polygon([(40,40),(40+dx,38-dy),(40+dx,22-dy),(40,26)],fill=(255,250,236))
        d.line([(40,40),(40+dx,38-dy)],fill=(150,130,110))
    return outlined(im)
def orb(phase=0.0):
    im=Image.new('RGBA',(90,120)); d=ImageDraw.Draw(im)
    S1,S2,S3=(143,201,201),(80,173,164),(46,110,120)   # stone, like the pack's rocks
    R(d,22,96,68,108,S2); R(d,22,96,68,99,S1)                         # base
    R(d,30,64,60,96,S2); R(d,30,64,36,96,S1); R(d,54,64,60,96,S3)     # column
    R(d,24,58,66,66,S1); R(d,24,64,66,66,S2)                          # cap
    # the orb: purple glass, light from top-left, a glowing core
    cx,cy,r=45,38,20
    d.ellipse((cx-r,cy-r,cx+r,cy+r),fill=(88,80,118))
    d.ellipse((cx-r+3,cy-r+2,cx+r-2,cy+r-4),fill=(126,92,156))
    d.ellipse((cx-r+7,cy-r+5,cx+r-8,cy+r-10),fill=(169,121,157))
    g=int(4+5*phase); d.ellipse((cx-g,cy-g+2,cx+g,cy+g+2),fill=(227,181,201)); d.ellipse((cx-g//2,cy-g//2+2,cx+g//2,cy+g//2+2),fill=(255,244,250))
    d.ellipse((cx-12,cy-14,cx-6,cy-8),fill=(255,255,255))             # highlight
    out=outlined(im)
    glow=Image.new('RGBA',out.size); gd=ImageDraw.Draw(glow)
    if phase>0:
        for k,a in ((40,60),(32,90),(26,120)): gd.ellipse((cx-k,cy-k,cx+k,cy+k),fill=(214,160,255,int(a*phase)))
    glow=glow.filter(ImageFilter.GaussianBlur(7)); glow.alpha_composite(out)
    if phase>=0.8:   # sparkles at the brightest frames
        sd=ImageDraw.Draw(glow)
        for x,y in ((cx-30,cy-18),(cx+28,cy-26),(cx+20,cy+8),(cx-24,cy+14)):
            sd.rectangle((x-1,y-4,x+1,y+4),fill=(255,244,250)); sd.rectangle((x-4,y-1,x+4,y+1),fill=(255,244,250))
    return glow
def scrolls():
    im=Image.new('RGBA',(70,44)); d=ImageDraw.Draw(im)
    for k,(x,y,w) in enumerate(((6,26,44),(18,16,40),(10,6,36))):
        R(d,x,y,x+w,y+12,(244,236,210)); R(d,x,y+9,x+w,y+12,(214,200,170)); R(d,x-3,y-1,x+3,y+13,(218,181,112)); R(d,x+w-3,y-1,x+w+3,y+13,(218,181,112)); R(d,x+w//2-2,y,x+w//2+2,y+12,(192,69,58))
    return outlined(im)
def strip(frames):
    w,h=frames[0].size; out=Image.new('RGBA',(w*len(frames),h))
    for k,f in enumerate(frames): out.alpha_composite(f,(k*w,0))
    return out

OUT_DIR=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','web','public','assets','props')
PROPS={
    'bookshelf': bookshelf(3),
    'bookshelf_small': bookshelf(11,84,120),
    'book_stack': book_stack(),
    'scrolls': scrolls(),
    # 4 frames: still, then a page lifting towards the spine
    'lectern': strip([lectern(0),lectern(0.5),lectern(1.1),lectern(1.45)]),
    # 6 frames: dark, then a glow that swells and fades
    'orb': strip([orb(0.0)]+[orb(p) for p in (0.55,0.8,1.0,0.8,0.55)]),
}
if __name__=='__main__':
    os.makedirs(OUT_DIR,exist_ok=True)
    for name,im in PROPS.items():
        im.save(os.path.join(OUT_DIR,name+'.png'),optimize=True); print(name,im.size)
