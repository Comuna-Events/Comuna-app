// Kinds: gold diamond patches with dark thread icons.
const cream=(d,w=3.4)=>`<path d="${d}" fill="none" stroke="{CS}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
module.exports={
 gem:{name:'Gem Hunter', shape:'diamond', palette:'gold', icon:`
  ${cream('M-18 -42 H18 L36 -24 L0 20 L-36 -24 Z M-36 -24 H36 M-18 -42 L-10 -24 L0 20 L10 -24 L18 -42 M0 -42 L-10 -24 M0 -42 L10 -24',4.4)}
  <path d="M-10 -24 L0 -42 L10 -24 Z" fill="{C}" opacity=".3"/>`},
 popup:{name:'I Was There', shape:'diamond', palette:'gold', icon:`<g transform="translate(0 20) scale(1.16) translate(0 -18)">
  <path d="M-36 -14 L-30.240000000000002 -2.0 H-33.48 L-28.44 7.0 H-32.4 L-27.0 13.6 H-45.0 L-39.6 7.0 H-43.56 L-38.52 -2.0 H-41.76 Z M-37.6 13.0 H-34.4 V16 H-37.6 Z M36 -14 L41.76 -2.0 H38.52 L43.56 7.0 H39.6 L45.0 13.6 H27.0 L32.4 7.0 H28.44 L33.48 -2.0 H30.240000000000002 Z M34.4 13.0 H37.6 V16 H34.4 Z" fill="{C}"/>
  ${cream('M-24 18 L0 -38 L24 18 Z M-8 18 L0 0 L8 18 M-4 -46 L0 -38 L4 -46 M-30 18 H30',4.4)}
  <path d="M-8 18 L0 0 L8 18 Z" fill="{C}" opacity=".35"/>
  <path d="M-22 -24 l1.4 3.6 l3.6 1.4 l-3.6 1.4 l-1.4 3.6 l-1.4 -3.6 l-3.6 -1.4 l3.6 -1.4 Z M22 -30 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2 Z" fill="{C}"/></g>`},
 headliner:{name:'Headliner', shape:'diamond', palette:'gold', icon:`<g transform="translate(0 5) scale(1.08)">
  <path d="M-38 -38 H38 V-22 A6 6 0 0 0 38 -10 V6 H-38 V-10 A6 6 0 0 0 -38 -22 Z" fill="{C}"/>
  <path d="M-31 -32 H31 V-24 M31 -8 V0 H-31 V-8 M-31 -24 V-32" fill="none" stroke="#C4952F" stroke-width="1.2" stroke-dasharray="2.4 1.8" opacity=".85"/>
  <path d="M-22 -32 V0 M22 -32 V0" stroke="#C4952F" stroke-width="1.2" stroke-dasharray="1.6 2" opacity=".6"/>
  <path d="M0.0 -29.0 L3.3 -20.5 L12.4 -20.0 L5.3 -14.3 L7.6 -5.5 L0.0 -10.4 L-7.6 -5.5 L-5.3 -14.3 L-12.4 -20.0 L-3.3 -20.5 Z" fill="{G}" stroke-linejoin="round"/>
  <path d="M0 -29 L-3 -19 M-12 -20 L-4 -19" stroke="#FFF1C8" stroke-width="1.2" stroke-linecap="round" opacity=".7"/></g>`},
 all_kinds:{name:'Well-Rounded', shape:'diamond', palette:'gold', icon:`
  <circle cx="0" cy="-10" r="32" fill="none" stroke="{CS}" stroke-width="8.5"/>
  <circle cx="0" cy="-10" r="32" fill="none" stroke="#5A4D3A" stroke-width="1" stroke-dasharray="2 4.5"/>
  <path d="M6.9 -6.0 L24.2 4.0 M0.0 -2.0 L0.0 18.0 M-6.9 -6.0 L-24.2 4.0 M-6.9 -14.0 L-24.2 -24.0 M-0.0 -18.0 L-0.0 -38.0 M6.9 -14.0 L24.2 -24.0" stroke="{CS}" stroke-width="5.6" stroke-linecap="round"/>
  <circle cx="0" cy="-10" r="9" fill="{C}"/><circle cx="0" cy="-10" r="3.6" fill="{G}"/>`},
};
