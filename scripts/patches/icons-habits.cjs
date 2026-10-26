// Habits: blue circle patches.
const cream=(d,w=3.4)=>`<path d="${d}" fill="none" stroke="{CS}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const wave=(y,x0=-40,x1=40,a=3.2,p=13)=>{let d=`M${x0} ${y}`;for(let x=x0;x<x1;x+=p)d+=` q${p/4} ${-a} ${p/2} 0 t${p/2} 0`;return d;};
const rays=(cx,cy,r1,r2,angs)=>angs.map(a=>{const t=a*Math.PI/180;return `M${(cx+Math.cos(t)*r1).toFixed(1)} ${(cy+Math.sin(t)*r1).toFixed(1)} L${(cx+Math.cos(t)*r2).toFixed(1)} ${(cy+Math.sin(t)*r2).toFixed(1)}`;}).join(' ');
const star=(x,y,r)=>{let d='';for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,q=i%2?r*.45:r;d+=(i?'L':'M')+(x+Math.cos(a)*q).toFixed(1)+' '+(y+Math.sin(a)*q).toFixed(1)+' ';}return `<path d="${d}Z" fill="{C}" stroke-linejoin="round"/>`;};
module.exports={
 early:{name:'Early Bird', palette:'blue', icon:`
  ${cream(rays(0,-4,32,45,[-165,-140,-115,-90,-65,-40,-15]),3.6)}
  <path d="M-26 -4 A26 26 0 0 1 26 -4 Z" fill="{C}"/>
  <path d="M11 -25 C18 -21 21 -14 22 -8" fill="none" stroke="#FFF8EA" stroke-width="2" stroke-linecap="round" opacity=".8"/>
  ${cream(wave(0,-46,46,3,23),4)}${cream(wave(10,-42,42,3,21),3.8)}${cream(wave(20,-36,36,3,24),3.6)}`},
 late:{name:'Night Owl', palette:'blue', icon:`
  <defs><mask id="crescent"><rect x="-60" y="-70" width="120" height="100" fill="#fff"/><circle cx="11" cy="-36" r="25" fill="#000"/></mask></defs>
  <circle cx="-5" cy="-24" r="30" fill="{C}" mask="url(#crescent)"/>
  <path d="M-27 -28 C-26 -16 -19 -6 -8 -1" fill="none" stroke="#FFF8EA" stroke-width="2" stroke-linecap="round" opacity=".75"/>
  ${star(-44,-6,6)}${star(24,-44,5.5)}${star(36,-24,6.5)}${star(40,-6,4.6)}
  ${cream(wave(12,-44,44,3,22),4)}${cream(wave(22,-38,38,3,19),3.8)}`},
 norm:{name:'Norm!', palette:'blue', icon:`<g transform="translate(-1 -3) scale(1.04 1)">
  <path d="M20 -12 H27 C36 -12 39 -6 39 1 C39 9 35 14 26 14 H20" fill="none" stroke="{CS}" stroke-width="7" stroke-linecap="round"/>
  <path d="M-28 -22 H20 V20 C20 26 16 30 10 30 H-18 C-24 30 -28 26 -28 20 Z" fill="{C}"/>
  <path d="M-28 -22 H20 V20 C20 26 16 30 10 30 H-18 C-24 30 -28 26 -28 20 Z" fill="none" stroke="{D}" stroke-width="1.3" stroke-dasharray="2 1.2"/>
  <ellipse cx="-4" cy="-22" rx="24" ry="5" fill="#F4E9D4"/><ellipse cx="-4" cy="-21.3" rx="19.5" ry="3.3" fill="{K}"/>
  <path d="M-19 -16 V18 C-19 22 -17 24 -13 25" fill="none" stroke="#FFF8EA" stroke-width="2.2" stroke-linecap="round" opacity=".75"/>
  ${[-15,-4,7].map(x=>cream(`M${x} -31 c-4 -3 -4 -6 0 -9 c4 -3 4 -6 0 -9`,3.6)).join('')}</g>`},
 double:{name:'Double Booked', palette:'blue', icon:`<g transform="translate(0 -6) scale(1.12)">
  <path d="M-36 -33 A5 5 0 0 1 -31 -38 H31 A5 5 0 0 1 36 -33 V14 L26 24 H-31 A5 5 0 0 1 -36 19 Z" fill="{C}"/>
  <path d="M-36 -33 A5 5 0 0 1 -31 -38 H31 A5 5 0 0 1 36 -33 V-22 H-36 Z" fill="{K}"/>
  <path d="M-36 -6.7 H36 M-36 8.7 H36 M-18 -22 V24 M0 -22 V24 M18 -22 V24" stroke="{D}" stroke-width="1.4"/>
  <path d="M36 14 H29 A3 3 0 0 0 26 17 V24 Z" fill="{D}"/>
  <rect x="0.7" y="-6" width="16.6" height="14" rx="1.4" fill="{B}"/>
  <circle cx="5.2" cy="1" r="3" fill="#F4E9D4"/><circle cx="12.8" cy="1" r="3" fill="#F4E9D4"/>
  <circle cx="-27" cy="-14.4" r="2.6" fill="{K}" opacity=".55"/><circle cx="-9" cy="16.4" r="2.6" fill="{K}" opacity=".55"/><circle cx="27" cy="-14.4" r="2.6" fill="{K}" opacity=".55"/>
  <circle cx="-20" cy="-30" r="3.2" fill="{B}"/><circle cx="20" cy="-30" r="3.2" fill="{B}"/>
  ${cream('M-20 -44 V-30 M20 -44 V-30',4.6)}</g>`},
 hat_trick:{name:'Triple Threat', palette:'blue', icon:`<g transform="translate(0 -6) scale(1.12)">
  <path d="M-36 -33 A5 5 0 0 1 -31 -38 H31 A5 5 0 0 1 36 -33 V14 L26 24 H-31 A5 5 0 0 1 -36 19 Z" fill="{C}"/>
  <path d="M-36 -33 A5 5 0 0 1 -31 -38 H31 A5 5 0 0 1 36 -33 V-22 H-36 Z" fill="{K}"/>
  <path d="M-36 -6.7 H36 M-36 8.7 H36 M-18 -22 V24 M0 -22 V24 M18 -22 V24" stroke="{D}" stroke-width="1.4"/>
  <path d="M36 14 H29 A3 3 0 0 0 26 17 V24 Z" fill="{D}"/>
  <rect x="0.7" y="-6" width="16.6" height="14" rx="1.4" fill="{B}"/>
  <circle cx="5.2" cy="-1.6" r="2.7" fill="#F4E9D4"/><circle cx="12.8" cy="-1.6" r="2.7" fill="#F4E9D4"/><circle cx="9" cy="4.4" r="2.7" fill="#F4E9D4"/>
  <circle cx="-27" cy="-14.4" r="2.6" fill="{K}" opacity=".55"/><circle cx="-9" cy="16.4" r="2.6" fill="{K}" opacity=".55"/><circle cx="27" cy="-14.4" r="2.6" fill="{K}" opacity=".55"/>
  <circle cx="-20" cy="-30" r="3.2" fill="{B}"/><circle cx="20" cy="-30" r="3.2" fill="{B}"/>
  ${cream('M-20 -44 V-30 M20 -44 V-30',4.6)}</g>`},
 weekend:{name:'Weekend Warrior', palette:'blue', icon:`<g transform="translate(0 5) scale(1.06)">
  <path d="M-15 -22 A15 15 0 0 1 15 -22" fill="none" stroke="{CS}" stroke-width="5" stroke-linecap="round"/>
  ${cream(rays(0,-22,22,32,[-160,-130,-105,-75,-50,-20]),3.4)}
  <path d="M-46 -14 H46 V-9 H-46 Z" fill="{C}"/>
  <path d="M-43 -12 H-5 C-5 6 -12 15 -24 15 C-37 15 -43 4 -43 -12 Z" fill="{C}"/>
  <path d="M43 -12 H5 C5 6 12 15 24 15 C37 15 43 4 43 -12 Z" fill="{C}"/>
  <path d="M-6 -11 C-3 -15 3 -15 6 -11" fill="none" stroke="{CS}" stroke-width="3"/>
  <path d="M-39 -8 H-9 C-9 4 -14 11 -24 11 C-34 11 -39 3 -39 -8 Z M39 -8 H9 C9 4 14 11 24 11 C34 11 39 3 39 -8 Z" fill="{K}"/>
  <path d="M-34 -4 L-26 -8 M-35 2 L-20 -8 M14 -4 L22 -8 M13 2 L28 -8" stroke="#F4E9D4" stroke-width="1.8" stroke-linecap="round" opacity=".7"/></g>`},
 midweek:{name:'Midweek Menace', palette:'blue', icon:`
  <path d="M4 -57 H24 L10 -27 H28 L-14 28 L-3 -6 H-21 Z" fill="{C}" stroke-linejoin="round"/>
  <path d="M10 -27 H28 L-14 28 L-3 -6 Z" fill="{D}" opacity=".5"/>
  <path d="M4 -57 H24 L10 -27 L-3 -6 H-21 Z" fill="#FFF8EA" opacity=".25"/>
  <path d="M4 -57 H24 L10 -27 H28 L-14 28 L-3 -6 H-21 Z" fill="none" stroke="{D}" stroke-width="1.2" stroke-dasharray="2 1.2" stroke-linejoin="round"/>
  ${cream('M-36 -34 L-27 -29 M-40 -18 H-31 M34 -6 L42 -10 M32 8 L41 10',3)}`},
 streak_4:{name:'On a Roll', palette:'blue', icon:`<g transform="translate(0 -2)">
  ${[[-14],[14]].map(([r])=>`<g transform="rotate(${r} 0 16)"><rect x="-33" y="12.5" width="66" height="8" rx="4" fill="{C}" stroke="{B}" stroke-width="1.6"/><ellipse cx="${r<0?-29:29}" cy="16.5" rx="2.2" ry="2.6" fill="{D}"/><path d="M-20 15 H-8 M6 18 H18" stroke="{D}" stroke-width="1.3" stroke-linecap="round"/></g>`).join('')}
  <path d="M0 10 C-18 10 -27 0 -26 -12 C-25 -20 -20 -24 -19 -32 C-14 -27 -13 -22 -12 -18 C-12 -28 -8 -36 -2 -42 C-3 -34 -1 -30 1 -27 C3 -38 8 -48 6 -58 C16 -50 22 -40 21 -28 C24 -31 25 -35 25 -38 C30 -30 30 -18 28 -8 C26 3 16 10 0 10 Z" fill="{C}"/>
  <path d="M0 7 C-9 7 -13 1 -12 -6 C-11 -12 -7 -14 -6 -20 C-3 -16 -2 -13 -1 -11 C1 -18 5 -24 6 -30 C11 -22 13 -14 12 -6 C11 2 7 7 0 7 Z" fill="{B}"/>
  <path d="M-20 -14 C-21 -8 -20 -3 -16 1 M12 -44 C16 -38 18 -32 18 -26" fill="none" stroke="#FFF8EA" stroke-width="2" stroke-linecap="round" opacity=".7"/>
  ${cream('M-30 -42 L-27 -38 M30 -50 L27 -45 M34 -32 L30 -30',2.6)}</g>`},
 streak_12:{name:'Creature of Habit', palette:'blue', icon:`<g transform="translate(0 -1)">
  ${[[-14],[14]].map(([r])=>`<g transform="rotate(${r} 0 16)"><rect x="-33" y="12.5" width="66" height="8" rx="4" fill="{C}" stroke="{B}" stroke-width="1.6"/><ellipse cx="${r<0?-29:29}" cy="16.5" rx="2.2" ry="2.6" fill="{D}"/><path d="M-20 15 H-8 M6 18 H18" stroke="{D}" stroke-width="1.3" stroke-linecap="round"/></g>`).join('')}
  <g transform="translate(0 9) scale(1.1) translate(0 -4)"><path d="M0 10 C-18 10 -27 0 -26 -12 C-25 -20 -20 -24 -19 -32 C-14 -27 -13 -22 -12 -18 C-12 -28 -8 -36 -2 -42 C-3 -34 -1 -30 1 -27 C3 -38 8 -48 6 -58 C16 -50 22 -40 21 -28 C24 -31 25 -35 25 -38 C30 -30 30 -18 28 -8 C26 3 16 10 0 10 Z" fill="{C}"/><path d="M0 7 C-9 7 -13 1 -12 -6 C-11 -12 -7 -14 -6 -20 C-3 -16 -2 -13 -1 -11 C1 -18 5 -24 6 -30 C11 -22 13 -14 12 -6 C11 2 7 7 0 7 Z" fill="{B}"/><path d="M-20 -14 C-21 -8 -20 -3 -16 1 M12 -44 C16 -38 18 -32 18 -26" fill="none" stroke="#FFF8EA" stroke-width="2" stroke-linecap="round" opacity=".7"/></g>
  ${cream('M-34 -46 L-30 -41 M-40 -28 L-35 -26 M32 -52 L29 -47 M38 -34 L33 -32 M-22 -58 L-21 -53',2.6)}</g>`},
};
