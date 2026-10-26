// Everyday regulars: the scene from the illustrated set, redrawn as clean satin-stitch shapes.
const cream=(d,w)=>`<path d="${d}" fill="none" stroke="{CS}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const steam=(xs,y=-30)=>xs.map(x=>`<path d="M${x} ${y} c-5 -5 5 -9 0 -15" fill="none" stroke="{CS}" stroke-width="4.2" stroke-linecap="round"/>`).join('');
module.exports={
 coffee_1:{name:'Bean Counter', icon:`
  <path d="M24 -10 H31 C41 -10 44 -3 44 3 C44 11 37 17 26 18" fill="none" stroke="{CS}" stroke-width="7.5" stroke-linecap="round"/>
  <path d="M-30 -18 H24 V8 C24 26 12 36 -3 36 C-18 36 -30 26 -30 8 Z" fill="{C}"/>
  <path d="M-30 -18 H24 V8 C24 26 12 36 -3 36 C-18 36 -30 26 -30 8 Z" fill="none" stroke="{D}" stroke-width="1.3" stroke-dasharray="2 1.2"/>
  <ellipse cx="-3" cy="-18" rx="27" ry="5.5" fill="#F4E9D4"/><ellipse cx="-3" cy="-17.2" rx="22" ry="3.6" fill="{K}"/>
  <path d="M-20 -14 V10 C-20 20 -14 27 -6 29" fill="none" stroke="{D}" stroke-width="2.2" stroke-linecap="round"/>
  ${steam([-14,-3,8])}`},
 coffee_2:{name:'Coffee Snob', icon:`<g transform="translate(0 -9) scale(1.08)">
  <ellipse cx="0" cy="27" rx="44" ry="7" fill="{C}"/><ellipse cx="0" cy="26" rx="33" ry="3.8" fill="none" stroke="{D}" stroke-width="1.5"/>
  <path d="M33 -6 C50 -9 50 13 29 12" fill="none" stroke="{CS}" stroke-width="7.5" stroke-linecap="round"/>
  <path d="M-38 -14 C-36 10 -20 24 0 24 C20 24 36 10 38 -14 Z" fill="{C}"/>
  <path d="M-38 -14 C-36 10 -20 24 0 24 C20 24 36 10 38 -14" fill="none" stroke="{D}" stroke-width="1.3" stroke-dasharray="2 1.2"/>
  <path d="M-27 -6 C-25 8 -14 16 -2 18" fill="none" stroke="{D}" stroke-width="2" stroke-linecap="round"/>
  <ellipse cx="0" cy="-14" rx="38" ry="11" fill="#F4E9D4"/>
  <ellipse cx="0" cy="-13.4" rx="33" ry="8.4" fill="{K}"/>
  <g transform="translate(0 -13.6) scale(1 .52)">
   <path d="M0 16.450000000000003 C-19 6 -17.1 -5.779999999999999 -7.9799999999999995 -5.779999999999999 C-3.42 -5.779999999999999 0 -2.5500000000000007 0 0.2999999999999998 C0 -2.5500000000000007 3.42 -5.779999999999999 7.9799999999999995 -5.779999999999999 C17.1 -5.779999999999999 19 6 0 16.450000000000003 Z" fill="#F4E9D4"/>
   <path d="M0 3.1500000000000004 C-13 -4 -11.700000000000001 -12.06 -5.46 -12.06 C-2.34 -12.06 0 -9.850000000000001 0 -7.9 C0 -9.850000000000001 2.34 -12.06 5.46 -12.06 C11.700000000000001 -12.06 13 -4 0 3.1500000000000004 Z" fill="{K}"/>
   <path d="M0 -0.5 C-10 -6 -9.0 -12.2 -4.2 -12.2 C-1.7999999999999998 -12.2 0 -10.5 0 -9.0 C0 -10.5 1.7999999999999998 -12.2 4.2 -12.2 C9.0 -12.2 10 -6 0 -0.5 Z" fill="#F4E9D4"/>
   <path d="M0 -5.975 C-5.5 -9 -4.95 -12.41 -2.31 -12.41 C-0.99 -12.41 0 -11.475 0 -10.65 C0 -11.475 0.99 -12.41 2.31 -12.41 C4.95 -12.41 5.5 -9 0 -5.975 Z" fill="{K}"/>
   <path d="M0 -13 V22" stroke="{K}" stroke-width="1.6"/>
  </g></g>`},
 market_1:{name:'Market Regular', icon:`
  <path d="M36.6 -38 C37 -10 39.6 12 42.6 30 H38.6 C35.8 12 33.6 -10 33.6 -38 Z" fill="{C}"/><path d="M34.2 -30.0 H36.6" stroke="{D}" stroke-width=".8"/><path d="M34.7 -22.4 H37.2" stroke="{D}" stroke-width=".8"/><path d="M35.2 -14.8 H37.8" stroke="{D}" stroke-width=".8"/><path d="M35.7 -7.2 H38.4" stroke="{D}" stroke-width=".8"/><path d="M36.2 0.4 H39.0" stroke="{D}" stroke-width=".8"/><path d="M36.7 8.0 H39.6" stroke="{D}" stroke-width=".8"/><path d="M37.2 15.6 H40.2" stroke="{D}" stroke-width=".8"/><path d="M37.7 23.2 H40.8" stroke="{D}" stroke-width=".8"/><path d="M38.2 30.8 H41.4" stroke="{D}" stroke-width=".8"/><path d="M35 -38 Q25.3 -44.0 21.0 -29.5 Q28.0 -39.6 35 -38 Z" fill="{C}"/><path d="M35 -38 Q26.6 -41.8 21.0 -29.5" fill="none" stroke="{D}" stroke-width=".8"/><path d="M35 -38 Q28.6 -48.4 23.1 -41.4 Q27.2 -43.5 35 -38 Z" fill="{C}"/><path d="M35 -38 Q27.9 -46.0 23.1 -41.4" fill="none" stroke="{D}" stroke-width=".8"/><path d="M35 -38 Q34.3 -49.1 29.9 -48.9 Q29.6 -46.9 35 -38 Z" fill="{C}"/><path d="M35 -38 Q32.0 -48.0 29.9 -48.9" fill="none" stroke="{D}" stroke-width=".8"/><path d="M35 -38 Q37.6 -48.1 35.0 -49.0 Q32.4 -48.1 35 -38 Z" fill="{C}"/><path d="M35 -38 Q35.0 -48.1 35.0 -49.0" fill="none" stroke="{D}" stroke-width=".8"/><path d="M35 -38 Q40.4 -46.9 40.1 -48.9 Q35.7 -49.1 35 -38 Z" fill="{C}"/><path d="M35 -38 Q38.0 -48.0 40.1 -48.9" fill="none" stroke="{D}" stroke-width=".8"/><path d="M35 -38 Q42.8 -43.5 46.9 -41.4 Q41.4 -48.4 35 -38 Z" fill="{C}"/><path d="M35 -38 Q42.1 -46.0 46.9 -41.4" fill="none" stroke="{D}" stroke-width=".8"/><path d="M35 -38 Q42.0 -39.6 49.0 -29.5 Q44.7 -44.0 35 -38 Z" fill="{C}"/><path d="M35 -38 Q43.4 -41.8 49.0 -29.5" fill="none" stroke="{D}" stroke-width=".8"/>
  <path d="M-50 -10 L-8 -46 L34 -10 Z" fill="{C}"/>
  <path d="M-8 -46 L-36 -10 M-8 -46 L-22 -10 M-8 -46 L-8 -10 M-8 -46 L6 -10 M-8 -46 L20 -10" stroke="{K}" stroke-width="1.8" fill="none"/>
  <path d="M-50 -10 ${Array.from({length:8},()=>'q5.5 7.5 10.5 0').join(' ')} L34 -10 Z" fill="{C}"/>
  ${cream('M-46 -4 V28 M-24 -4 V28 M-2 -4 V28 M20 -4 V28',2.2)}
  <path d="M-8 -46 V-53" stroke="{CS}" stroke-width="2.4" stroke-linecap="round"/><path d="M-8 -53 L0 -51 L-8 -49 Z" fill="{C}"/>
  <path d="M-45 17 H-29 L-31 27 H-43 Z" fill="{C}"/><path d="M-44.4 21 H-29.6 M-43.8 24.4 H-30.2" stroke="{K}" stroke-width="1"/><circle cx="-41.6" cy="13.2" r="4.4" fill="{C}"/><circle cx="-41.6" cy="13.2" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="-43" cy="11.8" r="1" fill="#fff" fill-opacity=".6"/><circle cx="-32.4" cy="13.2" r="4.4" fill="{C}"/><circle cx="-32.4" cy="13.2" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="-33.8" cy="11.8" r="1" fill="#fff" fill-opacity=".6"/><circle cx="-37" cy="6.4" r="4.4" fill="{C}"/><circle cx="-37" cy="6.4" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="-38.4" cy="5" r="1" fill="#fff" fill-opacity=".6"/><path d="M-23 17 H-7 L-9 27 H-21 Z" fill="{C}"/><path d="M-22.4 21 H-7.6 M-21.8 24.4 H-8.2" stroke="{K}" stroke-width="1"/><circle cx="-19.6" cy="13.2" r="4.4" fill="{C}"/><circle cx="-19.6" cy="13.2" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="-21" cy="11.8" r="1" fill="#fff" fill-opacity=".6"/><circle cx="-10.4" cy="13.2" r="4.4" fill="{C}"/><circle cx="-10.4" cy="13.2" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="-11.8" cy="11.8" r="1" fill="#fff" fill-opacity=".6"/><circle cx="-15" cy="6.4" r="4.4" fill="{C}"/><circle cx="-15" cy="6.4" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="-16.4" cy="5" r="1" fill="#fff" fill-opacity=".6"/><path d="M-1 17 H15 L13 27 H1 Z" fill="{C}"/><path d="M-0.40000000000000036 21 H14.4 M0.20000000000000018 24.4 H13.8" stroke="{K}" stroke-width="1"/><circle cx="2.4" cy="13.2" r="4.4" fill="{C}"/><circle cx="2.4" cy="13.2" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="1" cy="11.8" r="1" fill="#fff" fill-opacity=".6"/><circle cx="11.6" cy="13.2" r="4.4" fill="{C}"/><circle cx="11.6" cy="13.2" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="10.2" cy="11.8" r="1" fill="#fff" fill-opacity=".6"/><circle cx="7" cy="6.4" r="4.4" fill="{C}"/><circle cx="7" cy="6.4" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="5.6" cy="5" r="1" fill="#fff" fill-opacity=".6"/><path d="M21 17 H37 L35 27 H23 Z" fill="{C}"/><path d="M21.6 21 H36.4 M22.2 24.4 H35.8" stroke="{K}" stroke-width="1"/><circle cx="24.4" cy="13.2" r="4.4" fill="{C}"/><circle cx="24.4" cy="13.2" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="23" cy="11.8" r="1" fill="#fff" fill-opacity=".6"/><circle cx="33.6" cy="13.2" r="4.4" fill="{C}"/><circle cx="33.6" cy="13.2" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="32.2" cy="11.8" r="1" fill="#fff" fill-opacity=".6"/><circle cx="29" cy="6.4" r="4.4" fill="{C}"/><circle cx="29" cy="6.4" r="4.4" fill="none" stroke="{D}" stroke-width="1"/><circle cx="27.6" cy="5" r="1" fill="#fff" fill-opacity=".6"/>
  ${cream('M-52 29 H52',3.2)}`},
 market_2:{name:'Heirloom Hunter', icon:`<g transform="translate(0 2)">
  ${cream('M0 -12 V-44 M-2 -12 C-6 -22 -14 -30 -24 -36 M2 -12 C6 -22 14 -30 24 -36',2.8)}
  <ellipse cx="0" cy="-50" rx="4.2" ry="6.2" transform="rotate(0 0 -50)" fill="{C}"/><ellipse cx="-5.6" cy="-45" rx="4.2" ry="6.2" transform="rotate(-42 -5.6 -45)" fill="{C}"/><ellipse cx="5.6" cy="-45" rx="4.2" ry="6.2" transform="rotate(42 5.6 -45)" fill="{C}"/><ellipse cx="-5" cy="-35" rx="3.4" ry="5.4" transform="rotate(-62 -5 -35)" fill="{C}"/><ellipse cx="5" cy="-35" rx="3.4" ry="5.4" transform="rotate(62 5 -35)" fill="{C}"/><ellipse cx="-24" cy="-38" rx="4.2" ry="6.2" transform="rotate(-40 -24 -38)" fill="{C}"/><ellipse cx="-29" cy="-31" rx="4.2" ry="6.2" transform="rotate(-80 -29 -31)" fill="{C}"/><ellipse cx="-18" cy="-41" rx="3.6" ry="5.6" transform="rotate(-5 -18 -41)" fill="{C}"/><ellipse cx="-17" cy="-27" rx="3.2" ry="5" transform="rotate(-70 -17 -27)" fill="{C}"/><ellipse cx="24" cy="-38" rx="4.2" ry="6.2" transform="rotate(40 24 -38)" fill="{C}"/><ellipse cx="29" cy="-31" rx="4.2" ry="6.2" transform="rotate(80 29 -31)" fill="{C}"/><ellipse cx="18" cy="-41" rx="3.6" ry="5.6" transform="rotate(5 18 -41)" fill="{C}"/><ellipse cx="17" cy="-27" rx="3.2" ry="5" transform="rotate(70 17 -27)" fill="{C}"/>
  <path d="M0 -14 C20 -14 28 -1 26 11 C24 21 12 25 3 30 L0 34 L-3 30 C-12 25 -24 21 -26 11 C-28 -1 -20 -14 0 -14 Z" fill="{C}"/>
  <path d="M-15 -1 h7 M9 2 h8 M-12 11 h6 M7 13 h7 M-3 -6 h5 M-4 21 h7" stroke="{K}" stroke-width="1.9" stroke-linecap="round"/>
  <path d="M-20 4 C-19 13 -12 20 -4 24" fill="none" stroke="{D}" stroke-width="1.5" stroke-linecap="round"/>
  </g>`},
 market_seasons:{name:'In Season', icon:`
  <defs><clipPath id="land"><circle r="61"/></clipPath></defs>
  <circle cx="0" cy="-43" r="8" fill="{C}"/><circle cx="0" cy="-43" r="3" fill="{K}"/>
  ${cream('M0 -56 V-60 M-10 -53 L-13 -56 M10 -53 L13 -56 M-13 -43 H-18 M13 -43 H18 M-10 -33 L-13 -30 M10 -33 L13 -30',2.6)}
  <g clip-path="url(#land)">
   <path d="M-62 4 L-20 -28 L18 4 Z" fill="{C}"/>
   <path d="M-20 -28 L-10 -6 L-14 4 H18 Z" fill="{D}"/>
   <path d="M-4 6 L26 -32 L64 4 Z" fill="{C}" stroke="{B}" stroke-width="2.6" stroke-linejoin="round"/>
   <path d="M26 -32 L34 -8 L30 4 H64 Z" fill="{D}"/>
   <path d="M-20 -28 L-26 -18 L-21 -14 M26 -32 L20 -20 L25 -15" fill="none" stroke="{K}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
   <path d="M-62 6 C-20 2 20 0 62 -2 V60 H-62 Z" fill="{C}"/>
   <path d="M-62 18 C-20 8 20 4 62 6 M-62 34 C-20 20 20 12 62 16 M-40 60 C-10 34 30 24 62 28" fill="none" stroke="{B}" stroke-width="2.8" stroke-linecap="round"/>
   <path d="M-62 12 C-20 5 20 2 62 2 M-62 26 C-20 14 20 8 62 11 M-62 46 C-20 28 22 18 62 22 M-10 60 C10 42 36 34 62 36" fill="none" stroke="{K}" stroke-width="1.3" stroke-dasharray="5 3"/>
  </g>
`},
 flea:{name:'Treasure Hunter', icon:`<g transform="translate(0 -3) scale(1.12)">
  <path d="M-36 -34 C-20 -38 20 -30 38 -34 L36 18 C20 22 -20 14 -36 18 Z" fill="{C}"/>
  <path d="M-44 -35 C-44 -40 -34 -40 -34 -35 L-34 17 C-34 22 -44 22 -44 17 Z" fill="{C}" stroke="{B}" stroke-width="2.2"/>
  <path d="M36 -35 C36 -40 46 -40 46 -35 L46 17 C46 22 36 22 36 17 Z" fill="{C}" stroke="{B}" stroke-width="2.2"/>
  <path d="M-39 -36 V19 M41 -36 V19" stroke="{D}" stroke-width="1.6"/>
  <path d="M-26 -22 C-20 -28 -12 -20 -16 -12 C-20 -4 -10 2 -16 10 M10 -6 C16 -12 22 -4 18 2 C14 8 22 12 26 8" fill="none" stroke="{K}" stroke-width="1.7" opacity=".55" stroke-linecap="round"/>
  <path d="M-24 8 C-14 -4 -6 6 2 -4 C8 -12 6 -18 14 -20" fill="none" stroke="{K}" stroke-width="2.4" stroke-dasharray="3.6 2.8" stroke-linecap="round"/>
  <circle cx="-24" cy="8" r="2.6" fill="{K}"/>
  <path d="M16 -24 l8 8 M24 -24 l-8 8" stroke="{K}" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M28 4 L29.6 9.4 L35 11 L29.6 12.6 L28 18 L26.4 12.6 L21 11 L26.4 9.4 Z" fill="{K}"/>
  <path d="M-6 -26 l3 -4 l3 4 Z M-1 -24 l3 -4 l3 4 Z" fill="{K}"/></g>`},
 run_club:{name:'Will Run for Coffee', icon:`<g transform="translate(0 2)">
  <ellipse cx="-24" cy="20" rx="23" ry="4.6" fill="{C}"/><ellipse cx="-24" cy="19" rx="12" ry="1.8" fill="{D}"/>
  <path d="M-6 -3 C4 -4 6 10 -9 11" fill="none" stroke="{CS}" stroke-width="4.6" stroke-linecap="round"/>
  <path d="M-43 -8 H-5 C-5 8 -12 18 -24 18 C-36 18 -43 8 -43 -8 Z" fill="{C}"/>
  <ellipse cx="-24" cy="-8" rx="19" ry="4.6" fill="#F4E9D4"/><ellipse cx="-24" cy="-7.6" rx="15.5" ry="3.1" fill="{K}"/>
  ${steam([-30,-18],-17)}
  <path d="M34 -36 C44 -36 44 -24 34 -23" fill="none" stroke="{CS}" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M6 -40 H38 L27 -16 H17 Z" fill="{C}"/>
  <path d="M6 -40 H38" stroke="#F4E9D4" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M12 -32 L19 -18 M32 -32 L25 -18" stroke="{D}" stroke-width="1.6" stroke-linecap="round"/>
  <rect x="15" y="-16" width="14" height="5" rx="1" fill="{C}" stroke="{B}" stroke-width="1.6"/>
  <path d="M33 2 C42 2 42 14 34 15" fill="none" stroke="{CS}" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M17 -11 H27 V-6 L38 16 C38 20 36 22 32 22 H12 C8 22 6 20 6 16 L17 -6 Z" fill="{C}"/>
  <path d="M10 9 H34 L37.4 16 C37.4 19.4 35.6 20.6 32 20.6 H12 C8.4 20.6 6.6 19.4 6.6 16 Z" fill="{K}"/>
  <path d="M17 -4 H27" stroke="{D}" stroke-width="1.6"/></g>`},
 trivia:{name:'Know-It-All', icon:`<g transform="translate(0 -2)">
  <path d="M0 -48 C18 -48 28 -34 28 -21 C28 -7 16 -1 13 8 H-13 C-16 -1 -28 -7 -28 -21 C-28 -34 -18 -48 0 -48 Z" fill="{C}"/>
  <path d="M8 -40 C16 -37 20 -30 20 -22" fill="none" stroke="{D}" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M-4 7 L-9 -11 L-5 -16 L-1 -11 L1 -11 L5 -16 L9 -11 L4 7" fill="none" stroke="{K}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
  <rect x="-13" y="10" width="26" height="5.4" rx="2.4" fill="{C}"/><rect x="-12" y="17" width="24" height="5.4" rx="2.4" fill="{C}"/>
  <path d="M-8 24 H8 L4 29 H-4 Z" fill="{C}"/>
  ${cream('M-32 -40 L-36 -44 M32 -40 L36 -44 M-37 -21 H-44 M37 -21 H44 M-33 -2 L-39 2 M33 -2 L39 2',2.8)}</g>`},
 mic:{name:'Mic Hog', icon:`
  <defs><clipPath id="micHead"><rect x="-15" y="-56" width="30" height="52" rx="15"/></clipPath></defs>
  ${cream('M-21 -28 V-20 C-21 4 21 4 21 -20 V-28',4.6)}${cream('M0 4 V20',4.8)}
  <path d="M-19 25 C-19 21 -12 19 0 19 C12 19 19 21 19 25 Z" fill="{C}"/>
  <rect x="-15" y="-56" width="30" height="52" rx="15" fill="{C}" stroke="{B}" stroke-width="2"/>
  <g clip-path="url(#micHead)" stroke="{K}" stroke-width="1.6" fill="none" stroke-linecap="round">
   ${[-47,-42,-37,-32].map(y=>`<path d="M-9 ${y} H9"/>`).join('')}
  </g>
  <path d="M-15 -25 H15" stroke="{K}" stroke-width="2.4"/>
  <path d="M-20 -22 H-15 M15 -22 H20" stroke="{CS}" stroke-width="4" stroke-linecap="round"/>
  <path d="M8 -50 C11 -47 12 -44 12 -40" fill="none" stroke="#FFF8EA" stroke-width="2" stroke-linecap="round" opacity=".8"/>`},
 wellness:{name:'Namaste Local', icon:`
  ${cream('M0 31 C0 16 1 -4 0 -20',4.2)}${cream('M0 16 C-5 14 -8 12 -11 9 M0 16 C5 14 8 12 11 9 M0 -2 C-4 -4 -7 -6 -9 -9 M0 -2 C4 -4 7 -6 9 -9',3.4)}
  ${[[0,-20,0,40,14],[-9,-9,-46,37,13.5],[9,-9,46,37,13.5],[-11,9,-60,45,15],[11,9,60,45,15]].map(([x,y,r,L,W])=>`<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0 0 C${W} ${-L*.18} ${W*.62} ${-L*.72} 0 ${-L} C${-W*.62} ${-L*.72} ${-W} ${-L*.18} 0 0 Z" fill="{C}" stroke="{B}" stroke-width="1.6"/><path d="M0 -2 V${-L*.86}" stroke="{D}" stroke-width="1.6" stroke-linecap="round"/></g>`).join('')}`},
 books:{name:'Bookworm', icon:`<g transform="translate(0 -6) scale(.96 1.18)">
  <path d="M-48 -26 V20 C-30 16 -12 17 0 24 C12 17 30 16 48 20 V-26 Z" fill="{C}" stroke="{B}" stroke-width="2"/>
  <path d="M-48 18 C-30 14 -12 15 0 22 C12 15 30 14 48 18" fill="none" stroke="{D}" stroke-width="1.4"/>
  <path d="M0 -28 C-12 -35 -28 -35 -43 -31 V15 C-28 11 -12 11 0 18 Z" fill="{C}" stroke="{B}" stroke-width="2"/>
  <path d="M0 -28 C12 -35 28 -35 43 -31 V15 C28 11 12 11 0 18 Z" fill="{C}" stroke="{B}" stroke-width="2"/>
  <path d="M0 -26 V16" stroke="{D}" stroke-width="2"/>
  ${[-22,-15,-8,-1,6].map(y=>`<path d="M-36 ${y} C-26 ${y-3} -15 ${y-3} -7 ${y} M7 ${y} C15 ${y-3} 26 ${y-3} 36 ${y}" stroke="{K}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`).join('')}</g>`},
 tasting:{name:'Sommelier', icon:`
  ${cream('M-23 -12 V18',3.8)}
  <path d="M-36 24 C-36 19 -30 17 -23 17 C-16 17 -10 19 -10 24 Z" fill="{C}"/>
  <path d="M-40 -48 H-6 C-5 -24 -12 -11 -23 -11 C-34 -11 -41 -24 -40 -48 Z" fill="{C}"/>
  <path d="M-37 -44 H-9" stroke="{D}" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M-36.6 -34 C-28 -32 -18 -36 -9.4 -34" fill="none" stroke="{K}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M-15 -26 C-15 -21 -17 -17 -20 -15" fill="none" stroke="#FFF8EA" stroke-width="2" stroke-linecap="round" opacity=".8"/>
  ${cream('M22 -22 V-46 M17 -40 H27',3)}${cream('M22 -27 C30 -33 37 -29 35 -22',2.4)}
  ${[[-17,[6.4,17.1,27.8,38.5]],[-7.8,[11.7,22.4,33.1]],[1.4,[6.4,17.1,27.8,38.5].slice(0,3).map(x=>x+5.3)],[10.6,[17.1,27.8]],[19.8,[22.4]]].flatMap(([y,xs])=>xs.map(x=>`<circle cx="${x}" cy="${y}" r="5.5" fill="{C}" stroke="{B}" stroke-width="1.4"/><circle cx="${x-1.8}" cy="${y-1.8}" r="1.4" fill="#FFF8EA" opacity=".8"/>`)).join('')}`},
 outdoor_movie:{name:'Blanket Claimer', icon:`
  <defs><clipPath id="blanket"><path d="M-30 -12 H30 L48 22 H-48 Z"/></clipPath></defs><g transform="translate(0 -6) scale(1.1)">
  ${cream('M-44 23 V28 M-38 23 V28 M-32 23 V28 M-26 23 V28 M-20 23 V28 M-14 23 V28 M-8 23 V28 M-2 23 V28 M4 23 V28 M10 23 V28 M16 23 V28 M22 23 V28 M28 23 V28 M34 23 V28 M40 23 V28',2)}
  <path d="M-30 -12 H30 L48 22 H-48 Z" fill="{C}"/>
  <g clip-path="url(#blanket)" fill="none" stroke="{K}" stroke-opacity=".42">
   <g stroke-width="5.6"><path d="M-25.0 -12 L-40.0 22"/><path d="M-15.0 -12 L-24.0 22"/><path d="M-5.0 -12 L-8.0 22"/><path d="M5.0 -12 L8.0 22"/><path d="M15.0 -12 L24.0 22"/><path d="M25.0 -12 L40.0 22"/></g><g stroke-width="5"><path d="M-31.8 -8.6 H31.8"/><path d="M-36.5 0.2 H36.5"/><path d="M-41.5 9.8 H41.5"/><path d="M-46.2 18.6 H46.2"/></g>
  </g>
  <path d="M-30 -12 H30 L48 22 H-48 Z" fill="none" stroke="{B}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M-10 -26 C-10 -44 16 -44 16 -26" fill="none" stroke="{CS}" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M-15 -26 H21 L17 -4 H-11 Z" fill="{C}" stroke="{B}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M-16 -26 H22 V-21 H-16 Z" fill="{C}" stroke="{B}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M-13 -15 H19 M-12 -9 H18" stroke="{D}" stroke-width="1.6"/>
  <path d="M-6 -21 V-4 M3 -21 V-4 M12 -21 V-4" stroke="{D}" stroke-width="1.3" stroke-dasharray="2.4 2"/></g>`},
 dog:{name:'Good Boy', icon:`<g transform="translate(0 -2)">
  <path d="M0 -10 C13 -10 29 6 29 17 C29 26 20 29 13 26.5 C7 24.5 -7 24.5 -13 26.5 C-20 29 -29 26 -29 17 C-29 6 -13 -10 0 -10 Z" fill="{C}"/>
  <path d="M0 -4 C10 -4 22 8 22 16 C22 21 17 22 12 20.5 C6 19 -6 19 -12 20.5 C-17 22 -22 21 -22 16 C-22 8 -10 -4 0 -4 Z" fill="none" stroke="{D}" stroke-width="1.6"/>
  ${[[-32,-16,-28],[-12,-34,-8],[12,-34,8],[32,-16,28]].map(([x,y,r])=>`<ellipse cx="${x}" cy="${y}" rx="8" ry="10.6" transform="rotate(${r} ${x} ${y})" fill="{C}"/><path d="M${x+3} ${y-6} C${x+5} ${y-3} ${x+5.6} ${y} ${x+5} ${y+3}" transform="rotate(${r} ${x} ${y})" fill="none" stroke="#FFF8EA" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`).join('')}
  <path d="M10 -5 C16 -2 21 3 24 9" fill="none" stroke="#FFF8EA" stroke-width="2" stroke-linecap="round" opacity=".7"/></g>`},
 free:{name:'Free Spirit', icon:`
  ${cream('M-10 -18 C-9 -2 -11 14 -8 30',3.8)}
  <path d="M-9 16 C-2 7 7 5 14 7 C8 11 1 14 -9 20 Z" fill="{C}"/>
  <path d="M-10 -22 L-10.0 -44.0 M-10 -22 L-3.8 -43.1 M-10 -22 L1.9 -40.5 M-10 -22 L6.6 -36.4 M-10 -22 L10.0 -31.1 M-10 -22 L11.8 -25.1 M-10 -22 L11.8 -18.9 M-10 -22 L10.0 -12.9 M-10 -22 L6.6 -7.6 M-10 -22 L1.9 -3.5 M-10 -22 L-3.8 -0.9 M-10 -22 L-16.2 -0.9 M-10 -22 L-21.9 -3.5 M-10 -22 L-26.6 -7.6 M-10 -22 L-30.0 -12.9 M-10 -22 L-31.8 -18.9 M-10 -22 L-31.8 -25.1 M-10 -22 L-30.0 -31.1 M-10 -22 L-26.6 -36.4 M-10 -22 L-21.9 -40.5 M-10 -22 L-16.2 -43.1" stroke="{CS}" stroke-width="1.8" stroke-linecap="round"/><ellipse cx="-10.0" cy="-44.0" rx="3.4" ry="2.1" transform="rotate(-90 -10.0 -44.0)" fill="{C}"/><ellipse cx="-3.8" cy="-43.1" rx="3.4" ry="2.1" transform="rotate(-74 -3.8 -43.1)" fill="{C}"/><ellipse cx="1.9" cy="-40.5" rx="3.4" ry="2.1" transform="rotate(-57 1.9 -40.5)" fill="{C}"/><ellipse cx="6.6" cy="-36.4" rx="3.4" ry="2.1" transform="rotate(-41 6.6 -36.4)" fill="{C}"/><ellipse cx="10.0" cy="-31.1" rx="3.4" ry="2.1" transform="rotate(-25 10.0 -31.1)" fill="{C}"/><ellipse cx="11.8" cy="-25.1" rx="3.4" ry="2.1" transform="rotate(-8 11.8 -25.1)" fill="{C}"/><ellipse cx="11.8" cy="-18.9" rx="3.4" ry="2.1" transform="rotate(8 11.8 -18.9)" fill="{C}"/><ellipse cx="10.0" cy="-12.9" rx="3.4" ry="2.1" transform="rotate(25 10.0 -12.9)" fill="{C}"/><ellipse cx="6.6" cy="-7.6" rx="3.4" ry="2.1" transform="rotate(41 6.6 -7.6)" fill="{C}"/><ellipse cx="1.9" cy="-3.5" rx="3.4" ry="2.1" transform="rotate(57 1.9 -3.5)" fill="{C}"/><ellipse cx="-3.8" cy="-0.9" rx="3.4" ry="2.1" transform="rotate(74 -3.8 -0.9)" fill="{C}"/><ellipse cx="-16.2" cy="-0.9" rx="3.4" ry="2.1" transform="rotate(106 -16.2 -0.9)" fill="{C}"/><ellipse cx="-21.9" cy="-3.5" rx="3.4" ry="2.1" transform="rotate(123 -21.9 -3.5)" fill="{C}"/><ellipse cx="-26.6" cy="-7.6" rx="3.4" ry="2.1" transform="rotate(139 -26.6 -7.6)" fill="{C}"/><ellipse cx="-30.0" cy="-12.9" rx="3.4" ry="2.1" transform="rotate(155 -30.0 -12.9)" fill="{C}"/><ellipse cx="-31.8" cy="-18.9" rx="3.4" ry="2.1" transform="rotate(172 -31.8 -18.9)" fill="{C}"/><ellipse cx="-31.8" cy="-25.1" rx="3.4" ry="2.1" transform="rotate(188 -31.8 -25.1)" fill="{C}"/><ellipse cx="-30.0" cy="-31.1" rx="3.4" ry="2.1" transform="rotate(205 -30.0 -31.1)" fill="{C}"/><ellipse cx="-26.6" cy="-36.4" rx="3.4" ry="2.1" transform="rotate(221 -26.6 -36.4)" fill="{C}"/><ellipse cx="-21.9" cy="-40.5" rx="3.4" ry="2.1" transform="rotate(237 -21.9 -40.5)" fill="{C}"/><ellipse cx="-16.2" cy="-43.1" rx="3.4" ry="2.1" transform="rotate(254 -16.2 -43.1)" fill="{C}"/>
  <circle cx="-10" cy="-22" r="5" fill="{C}"/><circle cx="-10" cy="-22" r="2.2" fill="{D}"/>
  <path d="M20.0 -27.1 L24.0 -34.0 M24.0 -34.0 L22.4 -39.8 M24.0 -34.0 L24.7 -40.0 M24.0 -34.0 L27.0 -39.2 M24.0 -34.0 L28.8 -37.6 M24.0 -34.0 L29.8 -35.5 M30.2 -13.1 L36.0 -18.0 M36.0 -18.0 L36.4 -23.7 M36.0 -18.0 L38.6 -23.1 M36.0 -18.0 L40.4 -21.7 M36.0 -18.0 L41.4 -19.7 M36.0 -18.0 L41.7 -17.4 M24.1 1.4 L30.0 -2.0 M30.0 -2.0 L31.2 -6.9 M30.0 -2.0 L33.1 -6.1 M30.0 -2.0 L34.4 -4.5 M30.0 -2.0 L35.1 -2.6 M30.0 -2.0 L34.9 -0.6" stroke="{CS}" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="20.0" cy="-27.1" rx="2" ry="1.3" transform="rotate(-60 20.0 -27.1)" fill="{C}"/><ellipse cx="30.2" cy="-13.1" rx="2" ry="1.3" transform="rotate(-40 30.2 -13.1)" fill="{C}"/><ellipse cx="24.1" cy="1.4" rx="2" ry="1.3" transform="rotate(-30 24.1 1.4)" fill="{C}"/>
  <path d="M16 -44 C24 -50 32 -50 38 -46 M22 -10 C30 -12 36 -8 42 -10" fill="none" stroke="{D}" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="3 2.6"/>`},
 volunteer:{name:'Good Neighbor', icon:`
  <g transform="translate(-15 -12) rotate(-8) scale(1.36)"><path d="M0 21 C-11 11 -23 1 -23 -11 C-23 -19 -18 -24 -12 -24 C-6 -24 -2 -20 0 -15 C2 -20 6 -24 12 -24 C18 -24 23 -19 23 -11 C23 1 11 11 0 21 Z" fill="{C}"/><path d="M-16 -17 C-16 -11 -13 -6 -9 -3" fill="none" stroke="#FFF8EA" stroke-width="1.6" stroke-linecap="round" opacity=".75"/></g>
  <g transform="translate(23 1) rotate(9) scale(1.02)"><path d="M0 21 C-11 11 -23 1 -23 -11 C-23 -19 -18 -24 -12 -24 C-6 -24 -2 -20 0 -15 C2 -20 6 -24 12 -24 C18 -24 23 -19 23 -11 C23 1 11 11 0 21 Z" fill="{C}" stroke="{B}" stroke-width="2.6" paint-order="stroke"/><path d="M-16 -17 C-16 -11 -13 -6 -9 -3" fill="none" stroke="#FFF8EA" stroke-width="1.8" stroke-linecap="round" opacity=".75"/></g>
`}
};
