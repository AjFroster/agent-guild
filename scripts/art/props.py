#!/usr/bin/env python3
"""
Draws the guild's own props in the Tiny Swords style: the pack's palette, a 3px navy
outline, light from the top left, at the pack's pixel scale (a Pawn is a 192px frame).
Tiny Swords has no indoor furniture, so the Library's shelves, books, lectern and orb are
drawn here. Add new props the same way and run:

    pip install pillow
    python3 scripts/art/props.py            # draw them
    python3 scripts/art/props.py --check    # CI: are the committed PNGs up to date?

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

# ---------------------------------------------------------------- the Forge
import math
S0,S1,S2,S3=(46,48,66),(78,84,108),(122,132,156),(196,204,220)        # steel: deepest to brightest
HOT=[(255,250,200),(255,214,92),(240,128,44),(176,58,34)]                # white-hot to dull red
ST1,ST2,ST3=(176,166,152),(132,122,114),(90,82,84)                      # warm grey stone, for the hearth
SA1,SA2,SA3=(214,196,160),(176,156,124),(124,108,92)                    # sandstone, for the wheel
GOLD,GOLDD=(240,200,80),(176,131,40)
LEATHER,LEATHERD=(150,92,60),(104,62,46)

def glow(img,cx,cy,r,color,alpha):
    g=Image.new('RGBA',img.size); d=ImageDraw.Draw(g)
    for k,a in ((r,alpha//3),(int(r*0.75),alpha//2),(int(r*0.5),alpha)): d.ellipse((cx-k,cy-k,cx+k,cy+k),fill=color+(a,))
    g=g.filter(ImageFilter.GaussianBlur(max(2,r//4))); g.alpha_composite(img); return g

def anvil(heat=0.0):
    """An anvil; with heat > 0 a glowing bar lies on it (the piece being forged)."""
    im=Image.new('RGBA',(110,80)); d=ImageDraw.Draw(im)
    d.polygon([(8,30),(30,22),(30,36)],fill=S2); d.line([(10,30),(30,23)],fill=S3,width=2)     # horn
    R(d,28,20,92,34,S2); R(d,28,20,92,24,S3); R(d,86,24,92,34,S1)                               # face
    R(d,44,34,76,52,S1); R(d,44,34,48,52,S2); R(d,70,34,76,52,S0)                               # waist
    R(d,34,52,86,62,S1); R(d,34,52,86,55,S2); R(d,80,55,86,62,S0)                               # foot
    R(d,30,62,90,68,WM); R(d,30,62,90,64,WL)                                                    # block it stands on
    out=outlined(im)
    if heat>0:
        c=HOT[0] if heat>0.8 else HOT[1] if heat>0.5 else HOT[2]
        b=Image.new('RGBA',out.size); bd=ImageDraw.Draw(b)
        R(bd,46,12,80,21,c); R(bd,46,12,80,14,HOT[0]); R(bd,76,12,80,21,HOT[2])
        b=outlined(b,2); out.alpha_composite(b); out=glow(out,63,16,int(18+10*heat),(255,170,60),int(110*heat))
    return out

def hearth(flicker=0):
    """A stone hearth with hot coals, a hood and a chimney; `flicker` picks the coals' glow."""
    rng=random.Random(40+flicker)
    im=Image.new('RGBA',(170,170)); d=ImageDraw.Draw(im)
    R(d,62,8,98,52,ST2); R(d,62,8,68,52,ST1); R(d,92,8,98,52,ST3); R(d,58,4,102,12,ST1)          # chimney
    d.polygon([(30,74),(130,74),(110,46),(50,46)],fill=ST2); d.line([(32,74),(52,47)],fill=ST1,width=4)  # hood
    R(d,18,74,142,160,ST2)                                                                       # body
    for y in range(80,160,14):                                                                   # stone courses
        off=0 if (y//14)%2 else 12
        for x in range(18+off,142,24): R(d,x,y,x+2,y+12,ST3)
        R(d,18,y+12,142,y+14,ST3)
    R(d,18,74,24,160,ST1)
    d.rounded_rectangle((44,98,116,152),18,fill=(40,22,26)); R(d,44,126,116,152,(40,22,26))      # mouth
    for _ in range(60):                                                                          # coals
        x=rng.randint(50,110); y=rng.randint(130,148); c=rng.choice(HOT[1:] if flicker%2 else HOT[:3])
        R(d,x,y,x+rng.randint(3,6),y+rng.randint(3,5),c)
    R(d,30,152,130,160,ST3)
    out=outlined(im)
    return glow(out,80,138,48+4*(flicker%3),(255,150,50),150+20*(flicker%2))

def bellows(squeeze=0.0):
    im=Image.new('RGBA',(100,56)); d=ImageDraw.Draw(im)
    gap=int(16-12*squeeze)
    d.polygon([(10,28-gap//2-6),(70,26),(70,30),(10,28+gap//2+6)],fill=LEATHER)                   # leather
    d.line([(14,28-gap//2-4),(68,27)],fill=LEATHERD,width=2); d.line([(14,28+gap//2+4),(68,29)],fill=LEATHERD,width=2)
    d.polygon([(4,28-gap//2-10),(72,24),(72,27),(4,28-gap//2-4)],fill=WL)                         # top board
    d.polygon([(4,28+gap//2+4),(72,29),(72,32),(4,28+gap//2+10)],fill=WM)                         # bottom board
    R(d,72,25,94,31,S1); R(d,72,25,94,27,S2)                                                     # nozzle
    R(d,0,28-gap//2-14,8,28-gap//2-6,WM); R(d,0,28+gap//2+6,8,28+gap//2+14,WM)                    # handles
    return outlined(im)

def trough(steam=0):
    im=Image.new('RGBA',(130,90)); d=ImageDraw.Draw(im)
    R(d,8,50,122,84,WM); R(d,8,50,122,54,WL)
    for x in (34,64,94): R(d,x,54,x+2,84,WD)
    R(d,4,46,126,52,WL); R(d,4,46,126,48,WH)                                                    # rim
    R(d,10,52,120,58,(80,173,164)); R(d,10,52,120,54,(160,220,214))                               # water
    out=outlined(im)
    if steam:
        s=Image.new('RGBA',out.size); sd=ImageDraw.Draw(s)
        for k,(x,y) in enumerate(((40,40),(66,30),(90,38))):
            yy=y-8*steam-4*k; r=6+3*steam
            sd.ellipse((x-r,yy-r,x+r,yy+r),fill=(240,244,250,150-30*steam))
        s=s.filter(ImageFilter.GaussianBlur(1.5)); out.alpha_composite(s)
    return out

def grindstone(angle=0.0,sparks=False):
    im=Image.new('RGBA',(100,110)); d=ImageDraw.Draw(im)
    d.polygon([(20,104),(32,104),(50,48),(44,46)],fill=WM); d.polygon([(80,104),(68,104),(50,48),(56,46)],fill=WM)   # A-frame
    R(d,16,100,84,106,WL)
    cx,cy,r=50,50,30
    d.ellipse((cx-r,cy-r,cx+r,cy+r),fill=SA3); d.ellipse((cx-r+3,cy-r+2,cx+r-5,cy+r-5),fill=SA2)
    d.ellipse((cx-r+6,cy-r+5,cx+r-12,cy+r-12),fill=SA1); d.ellipse((cx-r+12,cy-r+12,cx+r-12,cy+r-12),fill=SA2)
    for k in range(4):                                                                           # marks that turn
        a=angle+k*math.pi/2; x=cx+math.cos(a)*(r-6); y=cy+math.sin(a)*(r-6)
        R(d,int(x)-2,int(y)-2,int(x)+2,int(y)+2,SA3)
    R(d,cx-4,cy-4,cx+4,cy+4,S1)                                                                  # axle
    R(d,cx+4,cy-2,cx+26,cy+2,WM); R(d,cx+24,cy-2,cx+28,cy+14,WL)                                 # crank
    out=outlined(im)
    if sparks:
        sp=ImageDraw.Draw(out); rng=random.Random(int(angle*10))
        for _ in range(7):
            x=cx-r+rng.randint(-14,6); y=cy-rng.randint(0,18); R(sp,x,y,x+3,y+2,rng.choice(HOT[:2]))
    return out

def weapon_rack():
    im=Image.new('RGBA',(180,130)); d=ImageDraw.Draw(im)
    for x in (12,160): R(d,x,8,x+10,122,WM); R(d,x,8,x+3,122,WL)                                 # posts
    for y in (22,74): R(d,12,y,170,y+8,WL); R(d,12,y,170,y+3,WH); R(d,12,y+6,170,y+8,WM)        # bars
    for x in range(36,160,28): R(d,x,22,x+3,30,WD)                                              # pegs
    R(d,4,118,178,126,WM); R(d,4,118,178,120,WL)                                                # base
    return outlined(im)

def sword():
    im=Image.new('RGBA',(30,100)); d=ImageDraw.Draw(im)
    d.polygon([(11,72),(19,72),(19,14),(15,6),(11,14)],fill=S2); R(d,15,10,19,72,S1); R(d,11,14,13,72,S3)
    R(d,3,72,27,78,GOLD); R(d,3,76,27,78,GOLDD)
    R(d,12,78,18,92,LEATHER); R(d,12,82,18,84,LEATHERD); R(d,12,88,18,90,LEATHERD)
    d.ellipse((10,90,20,99),fill=GOLD)
    return outlined(im,2)

def axe():
    im=Image.new('RGBA',(56,100)); d=ImageDraw.Draw(im)
    R(d,24,10,31,98,WM); R(d,24,10,26,98,WL)
    d.polygon([(30,14),(48,6),(54,24),(48,42),(30,34)],fill=S2); d.polygon([(46,8),(54,24),(48,40),(50,24)],fill=S3)
    R(d,30,14,34,34,S1)
    return outlined(im,2)

def spear():
    im=Image.new('RGBA',(26,120)); d=ImageDraw.Draw(im)
    R(d,11,30,16,118,WM); R(d,11,30,12,118,WL)
    d.polygon([(13,2),(20,22),(13,32),(6,22)],fill=S2); d.polygon([(13,2),(20,22),(13,32)],fill=S1); R(d,9,30,18,34,GOLD)
    R(d,8,40,19,44,(192,69,58))                                                                  # pennant tie
    return outlined(im,2)

def shield():
    im=Image.new('RGBA',(70,80)); d=ImageDraw.Draw(im)
    d.polygon([(6,8),(64,8),(64,40),(35,74),(6,40)],fill=(192,69,58))
    d.polygon([(35,8),(64,8),(64,40),(35,74)],fill=(150,48,44))
    d.line([(6,8),(64,8)],fill=GOLD,width=4); d.line([(6,8),(6,40),(35,74),(64,40),(64,8)],fill=GOLDD,width=3)
    d.ellipse((26,26,44,44),fill=GOLD); d.ellipse((30,29,38,37),fill=(255,240,170))
    return outlined(im,2)

def broken_sword():
    im=Image.new('RGBA',(110,40)); d=ImageDraw.Draw(im)
    d.ellipse((4,20,14,30),fill=GOLD); R(d,12,21,28,29,LEATHER); R(d,28,14,34,36,GOLD)          # hilt
    d.polygon([(34,21),(64,20),(60,25),(66,29),(34,29)],fill=S2); R(d,34,21,64,23,S3)            # stub, jagged end
    d.polygon([(74,22),(98,24),(104,27),(98,30),(72,30),(76,26)],fill=S2); R(d,76,24,98,26,S3)   # the snapped tip
    return outlined(im,2)

def repair_bench():
    im=Image.new('RGBA',(170,100)); d=ImageDraw.Draw(im)
    R(d,10,40,160,52,WL); R(d,10,40,160,43,WH); R(d,10,50,160,52,WM)                              # top
    for x in (16,146): R(d,x,52,x+10,96,WM); R(d,x,52,x+3,96,WL)
    R(d,16,78,156,84,WM)                                                                         # stretcher
    R(d,128,22,150,40,S1); R(d,128,22,150,26,S2); R(d,136,14,142,24,S2); R(d,124,30,154,34,S0)   # vice
    R(d,40,32,80,36,WM); R(d,78,26,90,40,S1); R(d,78,26,90,29,S2)                                # hammer lying on it
    d.line([(96,38),(116,30)],fill=S1,width=3); d.line([(96,32),(116,38)],fill=S1,width=3)      # tongs
    return outlined(im)

def ore_pile():
    rng=random.Random(9); im=Image.new('RGBA',(90,50)); d=ImageDraw.Draw(im)
    for x,y,r in ((20,34,14),(44,30,16),(66,36,13),(34,22,11),(56,18,10),(78,40,8)):
        d.ellipse((x-r,y-r,x+r,y+r),fill=(70,64,84)); d.ellipse((x-r+3,y-r+2,x+r-5,y+r-6),fill=(100,94,118))
        for _ in range(3):
            a=rng.uniform(0,6.28); R(d,int(x+math.cos(a)*r/2),int(y+math.sin(a)*r/2),int(x+math.cos(a)*r/2)+3,int(y+math.sin(a)*r/2)+3,rng.choice((HOT[1],GOLD,(160,220,214))))
    return outlined(im)

def ingots():
    im=Image.new('RGBA',(80,46)); d=ImageDraw.Draw(im)
    for x,y,c in ((10,28,S2),(40,28,S2),(24,14,GOLD)):
        hi=S3 if c==S2 else (255,236,150); lo=S1 if c==S2 else GOLDD
        d.polygon([(x,y+14),(x+4,y),(x+28,y),(x+32,y+14)],fill=c); R(d,x+4,y,x+28,y+3,hi); R(d,x,y+11,x+32,y+14,lo)
    return outlined(im)

def sparks(frame):
    rng=random.Random(frame); im=Image.new('RGBA',(60,50)); d=ImageDraw.Draw(im)
    for _ in range(9):
        a=rng.uniform(math.pi*1.1,math.pi*1.9); dist=8+frame*6+rng.randint(0,6)
        x=30+math.cos(a)*dist; y=44+math.sin(a)*dist; c=HOT[0] if frame<2 else HOT[1]
        R(d,int(x)-1,int(y)-1,int(x)+4,int(y)+4,HOT[2]); R(d,int(x),int(y),int(x)+3,int(y)+3,c)
    return glow(im,30,36,20,(255,190,80),60 if frame<3 else 30)

def tool_stump():
    im=Image.new('RGBA',(70,70)); d=ImageDraw.Draw(im)
    d.ellipse((8,30,62,46),fill=WL); R(d,8,38,62,62,WM); d.ellipse((8,54,62,68),fill=WM); R(d,8,38,14,62,WL)
    d.ellipse((14,32,56,44),fill=WH); d.ellipse((24,35,46,41),fill=WL)                            # rings
    R(d,30,14,36,40,WM); R(d,22,6,46,16,S1); R(d,22,6,46,9,S2)                                   # hammer stuck in it
    return outlined(im)


# ---------------------------------------------------------------- the Tower
ARC=[(40,70,140),(70,110,200),(120,170,240),(200,230,255)]               # arcane blue: deep to bright
PORTALS={'blue':[(30,60,130),(60,110,210),(120,180,250),(220,240,255)],
         'purple':[(60,30,110),(110,60,180),(170,120,235),(240,220,255)],
         'green':[(20,90,70),(40,150,100),(110,215,150),(220,255,230)]}

def portal(frame=0, color='blue', open_=True):
    """A stone arch; open, a swirl turns inside it (6 frames)."""
    c=PORTALS[color]; im=Image.new('RGBA',(120,150)); d=ImageDraw.Draw(im)
    cx,cy,rx,ry=60,78,34,52
    if open_:
        d.ellipse((cx-rx,cy-ry,cx+rx,cy+ry),fill=c[0])
        d.ellipse((cx-rx+5,cy-ry+6,cx+rx-5,cy+ry-6),fill=c[1])
        d.ellipse((cx-rx+12,cy-ry+16,cx+rx-12,cy+ry-16),fill=c[2])
        for arm in range(3):                                                    # swirl arms, turning
            pts=[]
            for k in range(22):
                a=frame*math.pi/9+arm*2*math.pi/3+k*0.32; r=0.12+0.8*k/22
                pts.append((cx+math.cos(a)*rx*r, cy+math.sin(a)*ry*r))
            d.line(pts,fill=c[3],width=4); d.line(pts[:8],fill=(255,255,255),width=2)
        d.ellipse((cx-6,cy-8,cx+6,cy+8),fill=c[3])
    else:
        d.ellipse((cx-rx,cy-ry,cx+rx,cy+ry),fill=(40,44,52)); d.ellipse((cx-rx+6,cy-ry+8,cx+rx-6,cy+ry-8),fill=(58,62,72))
    # the arch: stone blocks around the opening, two pillars, a keystone
    for k in range(13):
        a=math.pi+k*math.pi/12; x=cx+math.cos(a)*(rx+10); y=cy-12+math.sin(a)*(ry-4)
        R(d,int(x)-7,int(y)-7,int(x)+7,int(y)+7,ST2); R(d,int(x)-7,int(y)-7,int(x)+7,int(y)-4,ST1)
    for x in (cx-rx-14,cx+rx+2):
        R(d,x,cy-14,x+12,146,ST2); R(d,x,cy-14,x+4,146,ST1); R(d,x+9,cy-14,x+12,146,ST3)
        for y in range(cy-4,146,14): R(d,x,y,x+12,y+2,ST3)
    R(d,cx-8,cy-ry-24,cx+8,cy-ry-8,GOLD); R(d,cx-8,cy-ry-24,cx+8,cy-ry-20,(255,236,150))
    R(d,cx-rx-18,140,cx+rx+18,148,ST2); R(d,cx-rx-18,140,cx+rx+18,142,ST1)                   # step
    out=outlined(im)
    return glow(out,cx,cy,60,c[2],70+10*(frame%2)) if open_ else out

def rune_circle(frame=0):
    im=Image.new('RGBA',(160,60)); d=ImageDraw.Draw(im)
    a=150+int(60*abs(math.sin(frame*math.pi/4)))
    d.ellipse((6,6,154,54),outline=ARC[2]+(a,),width=3); d.ellipse((24,14,136,46),outline=ARC[3]+(a,),width=2)
    for k in range(8):
        t=k*math.pi/4+frame*0.2; x=80+math.cos(t)*64; y=30+math.sin(t)*20
        R(d,int(x)-3,int(y)-2,int(x)+3,int(y)+2,ARC[3]+(a,))
    return glow(im,80,30,50,ARC[2],40+frame*8)

def telescope():
    im=Image.new('RGBA',(110,110)); d=ImageDraw.Draw(im)
    for x0,x1 in ((50,24),(56,56),(62,88)): d.line([(56,64),(x1,104)],fill=WM,width=5)      # tripod
    d.polygon([(26,52),(92,18),(98,30),(32,64)],fill=GOLD); d.polygon([(26,52),(92,18),(94,22),(28,56)],fill=(255,236,150))
    d.polygon([(30,56),(62,40),(64,48),(34,64)],fill=GOLDD)                                  # band
    R(d,90,14,102,34,S1); R(d,18,50,30,66,S1)                                               # lens ends
    return outlined(im)

def scrying_pool(frame=0):
    im=Image.new('RGBA',(130,80)); d=ImageDraw.Draw(im)
    d.ellipse((6,20,124,74),fill=ST3); d.ellipse((6,14,124,66),fill=ST2); d.ellipse((10,16,120,60),fill=ST1)
    d.ellipse((18,22,112,56),fill=ARC[1])
    for k in range(3):                                                                      # ripples
        r=8+((frame*6+k*14)%40)
        d.ellipse((65-r,39-r*0.38,65+r,39+r*0.38),outline=ARC[3],width=2)
    out=outlined(im)
    return glow(out,65,38,40,ARC[2],70)

def scroll_rack():
    rng=random.Random(4); im=Image.new('RGBA',(130,150)); d=ImageDraw.Draw(im)
    R(d,6,6,124,146,WM); R(d,6,6,124,12,WL); R(d,6,6,12,146,WL)
    for row in range(4):
        for col in range(4):
            x=14+col*27; y=16+row*31
            R(d,x,y,x+24,y+28,WD)
            if rng.random()<0.8:                                                            # a rolled scroll, end on
                d.ellipse((x+3,y+5,x+21,y+23),fill=(244,236,210)); d.ellipse((x+8,y+10,x+16,y+18),fill=(214,200,170))
                if rng.random()<0.4: R(d,x+10,y+3,x+14,y+25,(192,69,58))
    return outlined(im)

def floating_books(frame=0):
    im=Image.new('RGBA',(120,110)); d=ImageDraw.Draw(im)
    for k,(x,y,c) in enumerate(((20,40,BOOKS[0][0]),(56,20,BOOKS[2][0]),(86,46,BOOKS[1][0]))):
        bob=int(4*math.sin(frame*math.pi/2+k*1.7)); y+=bob
        d.polygon([(x,y+10),(x+16,y+4),(x+32,y+10),(x+16,y+16)],fill=(244,236,210))          # open pages
        d.line([(x+16,y+4),(x+16,y+16)],fill=(150,130,110))
        d.polygon([(x,y+10),(x+16,y+16),(x+16,y+20),(x,y+14)],fill=c); d.polygon([(x+32,y+10),(x+16,y+16),(x+16,y+20),(x+32,y+14)],fill=c)
    out=outlined(im,2)
    for k,(x,y) in enumerate(((36,78),(72,64),(102,84))):                                   # their shadows on the floor
        s=Image.new('RGBA',out.size); ImageDraw.Draw(s).ellipse((x-12,y+16,x+12,y+22),fill=(10,16,30,60)); s.alpha_composite(out); out=s
    return glow(out,60,40,46,ARC[2],50)

def crystal(frame=0):
    im=Image.new('RGBA',(80,130)); d=ImageDraw.Draw(im)
    R(d,22,100,58,112,ST2); R(d,22,100,58,103,ST1); R(d,28,80,52,100,ST2); R(d,28,80,32,100,ST1); R(d,48,80,52,100,ST3); R(d,24,76,56,82,ST1)
    lift=int(4*math.sin(frame*math.pi/2))
    pts=[(40,14-lift),(56,40-lift),(40,68-lift),(24,40-lift)]
    d.polygon(pts,fill=ARC[1]); d.polygon([(40,14-lift),(56,40-lift),(40,40-lift)],fill=ARC[2]); d.polygon([(40,14-lift),(40,40-lift),(24,40-lift)],fill=ARC[3])
    out=outlined(im)
    return glow(out,40,40-lift,40,ARC[2],90+frame*10)

def star_desk():
    im=Image.new('RGBA',(150,90)); d=ImageDraw.Draw(im)
    R(d,8,34,142,46,WL); R(d,8,34,142,37,WH); R(d,14,46,24,86,WM); R(d,126,46,136,86,WM)
    d.polygon([(24,34),(30,14),(120,14),(126,34)],fill=(40,50,96))                          # the star chart, unrolled
    rng=random.Random(2)
    for _ in range(14): x=rng.randint(36,114); y=rng.randint(17,31); R(d,x,y,x+2,y+2,(255,244,190))
    d.line([(50,20),(70,26),(92,18),(108,28)],fill=(200,220,255),width=1)
    R(d,116,22,130,34,(244,236,210)); R(d,114,26,132,30,GOLD)                                # rolled chart
    return outlined(im)

def lens():
    im=Image.new('RGBA',(90,120)); d=ImageDraw.Draw(im)
    R(d,40,60,48,112,WM); R(d,40,60,42,112,WL); R(d,24,108,66,116,WM); R(d,24,108,66,110,WL)
    d.ellipse((12,6,76,70),fill=GOLD); d.ellipse((18,12,70,64),fill=(170,215,240)); d.ellipse((24,18,46,36),fill=(235,248,255))
    return outlined(im)

def alarm_bell(swing=0.0):
    im=Image.new('RGBA',(90,130)); d=ImageDraw.Draw(im)
    R(d,10,10,18,126,WM); R(d,72,10,80,126,WM); R(d,6,8,84,18,WL); R(d,6,8,84,11,WH)          # frame
    a=swing*0.4; cx,top=45,20
    pts=[(cx-6,top),(cx+6,top),(cx+20,top+40),(cx-20,top+40)]
    rot=lambda x,y:(cx+(x-cx)*math.cos(a)-(y-top)*math.sin(a), top+(x-cx)*math.sin(a)+(y-top)*math.cos(a))
    d.polygon([rot(*p) for p in pts],fill=GOLD); d.polygon([rot(cx-6,top),rot(cx-1,top),rot(cx-10,top+40),rot(cx-20,top+40)],fill=(255,236,150))
    x,y=rot(cx,top+46); d.ellipse((x-5,y-5,x+5,y+5),fill=GOLDD)
    return outlined(im)

def wizard_hat(main=(52,82,170), band=GOLD, stars=True, tall=1.0):
    """A pointed hat to sit on a Pawn's head (the Pawn's head is about 64px wide at 1x)."""
    im=Image.new('RGBA',(90,int(90*tall)+10)); d=ImageDraw.Draw(im); h=int(80*tall)
    d.ellipse((4,h-12,86,h+6),fill=tuple(max(0,v-30) for v in main))                       # brim
    d.polygon([(18,h-4),(72,h-4),(56,h-int(46*tall)),(64,6),(40,h-int(40*tall))],fill=main)
    d.polygon([(40,h-int(40*tall)),(56,h-int(46*tall)),(64,6)],fill=tuple(min(255,v+40) for v in main))
    R(d,20,h-12,70,h-4,band)
    if stars:
        for x,y in ((34,h-26),(50,h-40)): R(d,x,y,x+4,y+4,(255,244,190)); R(d,x-2,y+1,x+6,y+3,(255,244,190))
    return outlined(im,2)

def staff():
    im=Image.new('RGBA',(30,140)); d=ImageDraw.Draw(im)
    R(d,13,26,18,138,WM); R(d,13,26,14,138,WL); d.ellipse((6,4,24,24),fill=ARC[2]); d.ellipse((10,8,16,14),fill=ARC[3])
    R(d,10,22,21,28,GOLD)
    out=outlined(im,2); return glow(out,15,14,14,ARC[2],80)

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
    # The Forge. Animated strips: anvil (0 cold, 1-4 a bar glowing), hearth (4 flickers),
    # bellows (4: open to squeezed and back), trough (0 still, 1-3 steam), grindstone
    # (4 turns, sparks), sparks (4: a burst spreading).
    'anvil': strip([anvil(0)]+[anvil(h) for h in (0.6,0.9,1.0,0.9)]),
    'hearth': strip([hearth(k) for k in range(4)]),
    'bellows': strip([bellows(q) for q in (0,0.5,1,0.5)]),
    'trough': strip([trough(k) for k in range(4)]),
    'grindstone': strip([grindstone(k*math.pi/8,sparks=True) for k in range(4)]),
    'sparks': strip([sparks(k) for k in range(4)]),
    'weapon_rack': weapon_rack(),
    'sword': sword(),
    'axe': axe(),
    'spear': spear(),
    'shield': shield(),
    'broken_sword': broken_sword(),
    'repair_bench': repair_bench(),
    'ore_pile': ore_pile(),
    'ingots': ingots(),
    'tool_stump': tool_stump(),
    # The Tower. Animated strips: portals (6: the swirl turning), the closed portal (still),
    # rune circle (4: pulsing), scrying pool (4: ripples), floating books (4: bobbing),
    # crystal (4: rising and glowing), alarm bell (4: swinging).
    'portal_blue': strip([portal(k,'blue') for k in range(6)]),
    'portal_purple': strip([portal(k,'purple') for k in range(6)]),
    'portal_green': strip([portal(k,'green') for k in range(6)]),
    'portal_closed': portal(0,'blue',open_=False),
    'rune_circle': strip([rune_circle(k) for k in range(4)]),
    'telescope': telescope(),
    'scrying_pool': strip([scrying_pool(k) for k in range(4)]),
    'scroll_rack': scroll_rack(),
    'floating_books': strip([floating_books(k) for k in range(4)]),
    'crystal': strip([crystal(k) for k in range(4)]),
    'star_desk': star_desk(),
    'lens': lens(),
    'alarm_bell': strip([alarm_bell(v) for v in (0,1,0,-1)]),
    # Hats that make a blue Pawn a wizard: the Seer, the Archmage, the Enchanter, the Lookout
    # and the Portal Keeper.
    'hat_seer': wizard_hat((52,82,170)),
    'hat_archmage': wizard_hat((70,40,120),GOLD,True,1.3),
    'hat_enchanter': wizard_hat((30,120,120),(240,240,255),False),
    'hat_lookout': wizard_hat((90,96,110),S3,False,0.8),
    'hat_portal': wizard_hat((110,60,180),(120,180,250),True),
    'staff': staff(),
}
def check():
    """CI: the committed PNGs must be exactly what this script draws, pixel for pixel."""
    import sys
    stale=[]
    for name,im in PROPS.items():
        path=os.path.join(OUT_DIR,name+'.png')
        try:
            committed=Image.open(path).convert('RGBA')
        except FileNotFoundError:
            stale.append(name+' (missing)'); continue
        if committed.size!=im.size or committed.tobytes()!=im.convert('RGBA').tobytes(): stale.append(name)
    if stale:
        print('Props out of date (run python3 scripts/art/props.py and commit):', ', '.join(stale)); sys.exit(1)
    print(f'All {len(PROPS)} props match the script.')

if __name__=='__main__':
    import sys
    if '--check' in sys.argv: check()
    else:
        os.makedirs(OUT_DIR,exist_ok=True)
        for name,im in PROPS.items():
            im.save(os.path.join(OUT_DIR,name+'.png'),optimize=True); print(name,im.size)
