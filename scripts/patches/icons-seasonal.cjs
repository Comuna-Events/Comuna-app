// Seasonal: black scalloped patches with a gold rim and ribbon.
const cream=(d,w=3.4)=>`<path d="${d}" fill="none" stroke="{CS}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const gold=(d,w=3.4)=>`<path d="${d}" fill="none" stroke="{G}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const wave=(y,x0,x1,a,p)=>{let d=`M${x0} ${y}`;for(let x=x0;x<x1-.1;x+=p)d+=` q${p/4} ${-a} ${p/2} 0 t${p/2} 0`;return d;};
const spark=(x,y,r)=>`<path d="M${x} ${y-r} L${x+r*.28} ${y-r*.28} L${x+r} ${y} L${x+r*.28} ${y+r*.28} L${x} ${y+r} L${x-r*.28} ${y+r*.28} L${x-r} ${y} L${x-r*.28} ${y-r*.28} Z" fill="{G}"/>`;
module.exports={
 spooky:{name:'Boo Crew', shape:'scallop', palette:'black', icon:`
  <path d="M-25 22 C-25 4 -24 -12 -24 -22 C-24 -38 -13 -48 0 -48 C13 -48 24 -38 24 -22 C24 -12 25 4 25 22 L17 14 L8.5 22 L0 14 L-8.5 22 L-17 14 Z" fill="{C}" stroke-linejoin="round"/>
  <path d="M-15 -34 C-12 -39 -7 -42 -2 -42" fill="none" stroke="#FFF8EA" stroke-width="2.2" stroke-linecap="round" opacity=".8"/>
  <ellipse cx="-8" cy="-22" rx="3.4" ry="4.6" fill="{K}"/><ellipse cx="8" cy="-22" rx="3.4" ry="4.6" fill="{K}"/>
  <path d="M-5 -10 C-2 -6 2 -6 5 -10" fill="none" stroke="{K}" stroke-width="2.4" stroke-linecap="round"/>
  ${spark(-36,-34,5)}${spark(34,-16,4)}`},
 festive:{name:'Holiday Hopper', shape:'scallop', palette:'black', icon:`
  <rect x="-26" y="-14" width="52" height="36" rx="2" fill="{C}"/>
  <rect x="-30" y="-24" width="60" height="12" rx="2" fill="{C}" stroke="{B}" stroke-width="1.6"/>
  <path d="M-5 -24 H5 V22 H-5 Z" fill="{G}"/>
  <path d="M0 -24 C-8 -40 -26 -38 -20 -28 C-16 -23 -6 -24 0 -24 Z M0 -24 C8 -40 26 -38 20 -28 C16 -23 6 -24 0 -24 Z" fill="{G}"/>
  <circle cx="0" cy="-24" r="4" fill="{G}"/>
  <path d="M-26 -8 H26" stroke="{D}" stroke-width="1.4" opacity=".7"/>
  ${spark(-38,-36,5)}${spark(36,-40,4)}${spark(38,6,3.4)}`},
 summer:{name:'Night Swimmer', shape:'scallop', palette:'black', icon:`
  <path d="M-24 -6 A24 24 0 0 1 24 -6 Z" fill="{G}"/>
  <path d="M10 -26 C16 -22 19 -16 20 -10" fill="none" stroke="#FFF1C8" stroke-width="2" stroke-linecap="round" opacity=".7"/>
  ${cream(wave(2,-40,40,3,20),4)}${cream(wave(12,-34,34,3,17),3.8)}${cream(wave(22,-26,26,3,17.33),3.6)}
  ${spark(-30,-34,4)}${spark(32,-40,3.4)}${spark(38,-22,2.8)}`},
};
