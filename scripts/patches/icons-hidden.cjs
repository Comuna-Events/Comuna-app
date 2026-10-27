// Hidden: charcoal circle patches, cream icons with gold arrowheads and flames.
const cream=(d,w=3.4)=>`<path d="${d}" fill="none" stroke="{CS}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
module.exports={
 plot_twist:{name:'Plot Twist', shape:'circle', palette:'charcoal', icon:`<g transform="translate(-2 -12)">
  ${cream('M-36 -14 H-20 C-6 -14 2 14 16 14 H24 M-36 14 H-20 C-12 14 -8 8 -4 2 M4 -8 C8 -12 12 -14 16 -14 H24',6.4)}
  <path d="M22 -24 L38 -14 L22 -4 Z M22 4 L38 14 L22 24 Z" fill="{G}" stroke-linejoin="round"/></g>`},
 full_send:{name:'Full Send', shape:'circle', palette:'charcoal', icon:`<g transform="translate(2 -12) rotate(40) scale(1.2)">
  <path d="M-7 18 C-14 26 -10 36 0 46 C10 36 14 26 7 18 Z" fill="{G}"/><path d="M-3 20 C-6 26 -4 32 0 38 C4 32 6 26 3 20 Z" fill="#F6D684"/>
  <path d="M-11 6 L-22 20 V26 L-10 18 Z M11 6 L22 20 V26 L10 18 Z" fill="{G}" stroke-linejoin="round"/>
  <path d="M0 -40 C12 -28 13 -10 11 18 H-11 C-13 -10 -12 -28 0 -40 Z" fill="{C}"/>
  <path d="M0 -40 C5 -35 8 -29 9 -24 H-9 C-8 -29 -5 -35 0 -40 Z" fill="{G}"/>
  <circle cx="0" cy="-6" r="5.6" fill="{K}"/><circle cx="0" cy="-6" r="5.6" fill="none" stroke="{G}" stroke-width="2"/>
  <path d="M-11 18 V10 M11 18 V10" stroke="{D}" stroke-width="1.2"/>
  <path d="M5 -30 C8 -22 9 -10 8 4" fill="none" stroke="#FFF8EA" stroke-width="1.8" stroke-linecap="round" opacity=".7"/></g>`},
 comeback:{name:'Comeback Kid', shape:'circle', palette:'charcoal', icon:`<g transform="translate(0 -10)">
  ${cream('M20 26 V-14 C20 -30 -14 -30 -14 -14 V8',7)}
  <path d="M-27 4 H-1 L-14 22 Z" fill="{G}" stroke-linejoin="round"/>
  <path d="M15 -22 C9 -25 2 -25 -4 -23" fill="none" stroke="#FFF8EA" stroke-width="1.8" stroke-linecap="round" opacity=".7"/></g>`},
};
