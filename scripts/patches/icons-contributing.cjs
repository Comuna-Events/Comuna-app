// Contributing: coral hexagon patches with dark thread icons.
const cream=(d,w=3.4)=>`<path d="${d}" fill="none" stroke="{CS}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const star=(x,y,r)=>{let d='';for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,q=i%2?r*.44:r;d+=(i?'L':'M')+(x+Math.cos(a)*q).toFixed(1)+' '+(y+Math.sin(a)*q).toFixed(1)+' ';}return d+'Z';};
module.exports={
 scout:{name:'Scout', shape:'hex', palette:'coral', icon:`<g transform="translate(4 25) scale(1.14) translate(0 -25)">
  ${cream('M-14 -44 V24',5)}<circle cx="-14" cy="-48" r="4.6" fill="{C}"/>
  <path d="M-12 -42 C0 -46 10 -38 24 -42 L16 -27 L26 -12 C12 -8 2 -16 -12 -12 Z" fill="{C}"/>
  <path d="M-8 -36 C2 -39 10 -33 18 -35" fill="none" stroke="#8A7A60" stroke-width="1.6" stroke-linecap="round"/>
  ${cream('M-26 25 H-2',4)}</g>`},
 tastemaker:{name:'Tastemaker', shape:'hex', palette:'coral', icon:`<g transform="translate(-4 -14)">
  <path d="M-30 -8 H-20 V12 H-30 C-33 12 -35 10 -35 7 V-3 C-35 -6 -33 -8 -30 -8 Z" fill="{C}"/>
  <path d="M-20 -8 L14 -26 V30 L-20 12 Z" fill="{C}"/>
  <path d="M14 -28 C19 -28 21 -14 21 2 C21 18 19 32 14 32 C11 32 10 18 10 2 C10 -14 11 -28 14 -28 Z" fill="{C}"/>
  <path d="M-16 -4 L10 -18" stroke="#8A7A60" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M-22 12 L-17 26 H-10 L-14 14" fill="{C}" stroke="{C}" stroke-width="2" stroke-linejoin="round"/>
  ${cream('M28 -12 C33 -6 33 10 28 16 M35 -20 C43 -9 43 13 35 24',3.6)}</g>`},
 critic:{name:'Local Critic', shape:'hex', palette:'coral', icon:`<g transform="translate(0 -4)">
  ${cream('M-34 -44 H34 A4 4 0 0 1 38 -40 V6 A4 4 0 0 1 34 10 H-14 L-26 22 V10 H-34 A4 4 0 0 1 -38 6 V-40 A4 4 0 0 1 -34 -44 Z',5)}
  <path d="${star(0,-17,19.5)}" fill="{C}" stroke-linejoin="round"/>
  <path d="M0 -30 L-3 -21" stroke="#8A7A60" stroke-width="1.4" stroke-linecap="round"/></g>`},
 founding:{name:'Founding Local', shape:'hex', palette:'coral', icon:`<g transform="translate(-3 -14) scale(1.22)">
  <circle cx="-24" cy="0" r="14" fill="none" stroke="{CS}" stroke-width="6"/>
  <circle cx="-24" cy="0" r="4" fill="{C}"/>
  <path d="M-10 -3.4 H38 V3.4 H-10 Z" fill="{C}"/>
  <path d="M24 3 V13 H30 V3 M32 3 V10 H38 V3" fill="{C}"/>
  <path d="M-30 -11 C-26 -13 -21 -12 -18 -9" fill="none" stroke="#8A7A60" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M-4 -1 H34" stroke="#8A7A60" stroke-width="1.2" stroke-dasharray="3 2.5"/></g>`},
};
