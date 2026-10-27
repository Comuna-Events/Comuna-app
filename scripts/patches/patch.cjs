// The approved Bean Counter construction as a template: fabric with fill stitches, a wrapped-thread rim, a hand-sewn
// running stitch, a raised satin icon, a ribbon with folded tails, embroidered lettering. Icons use tokens:
// {C} cream satin fill, {CS} cream thread (strokes), {D} cream detail stitch, {K} dark accent, {B} the patch color,
// {G} gold satin, {L} leaf green satin.
// rounded regular polygon: n corners, circumradius R, corner radius r, first corner at angle a0 (degrees)
const poly=(n,R,r,a0)=>{const pts=[...Array(n)].map((_,i)=>{const t=(a0+i*360/n)*Math.PI/180;return [R*Math.cos(t),R*Math.sin(t)];});
 let d='';pts.forEach((p,i)=>{const a=pts[(i+n-1)%n],b=pts[(i+1)%n];
  const u=[a[0]-p[0],a[1]-p[1]],v=[b[0]-p[0],b[1]-p[1]],lu=Math.hypot(...u),lv=Math.hypot(...v),k=r/Math.tan(Math.PI/2-Math.PI/n);
  const p1=[p[0]+u[0]/lu*k,p[1]+u[1]/lu*k],p2=[p[0]+v[0]/lv*k,p[1]+v[1]/lv*k];
  d+=(i?'L':'M')+p1.map(x=>x.toFixed(2)).join(' ')+` Q${p[0].toFixed(2)} ${p[1].toFixed(2)} ${p2.map(x=>x.toFixed(2)).join(' ')} `;});
 return d+'Z';};
// scalloped edge: n bumps around a circle of radius R
const scallop=(n,R)=>{const r=R*Math.sin(Math.PI/n)*1.12;let d='';for(let i=0;i<=n;i++){const t=(-90+i*360/n)*Math.PI/180,x=(R*Math.cos(t)).toFixed(2),y=(R*Math.sin(t)).toFixed(2);d+=i?`A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${x} ${y} `:`M${x} ${y} `;}return d+'Z';};
const SHAPES={ circle:'M0 -86 A86 86 0 1 1 0 86 A86 86 0 1 1 0 -86 Z', hex:poly(6,94,7,-90), diamond:poly(4,104,10,-90), scallop:scallop(16,80) };
const PALETTES={
 blue:{ fill:'#2F579F', edge:'#1D3A73', thread:'#2A4F93', hi:'#7C9EDB', line:'#162E5C', tatami:'#081633', tatamiHi:'#D6E3FF', text:'#1D3A73', textHi:'#2E5199', tail:'#6B4A2E' },
 green:{ fill:'#2C5E45', edge:'#1A3D2C', thread:'#28563F', hi:'#7FB394', line:'#11291D', tatami:'#05140C', tatamiHi:'#D5F0DE', text:'#1A3D2C', textHi:'#2B5A42', tail:'#6B4A2E' },
 gold:{ fill:'#D3A33B', edge:'#8F6618', thread:'#C4952F', hi:'#F6D684', line:'#5E420C', tatami:'#3A2805', tatamiHi:'#FFF1C8', text:'#2B2620', textHi:'#4A4236', tail:'#6B4A2E', dark:true, stitch:'#3B2F1C' },
 coral:{ fill:'#D6745A', edge:'#9A4430', thread:'#C8664C', hi:'#F6B4A0', line:'#6A2819', tatami:'#3A1209', tatamiHi:'#FFE2D6', text:'#6E2617', textHi:'#8E3A27', tail:'#6B4A2E', dark:true, stitch:'#5A2214' },
 black:{ fill:'#2A2823', edge:'#8F6618', thread:'#D2A33A', hi:'#F6D684', line:'#4A340A', tatami:'#000000', tatamiHi:'#9A907C', text:'#2B2620', textHi:'#4A4236', tail:'#6B4A2E', ribbon:'gold' },
 charcoal:{ fill:'#3B3934', edge:'#1D1C19', thread:'#34322D', hi:'#7A766C', line:'#121110', tatami:'#000000', tatamiHi:'#D2CBBB', text:'#2B2620', textHi:'#4A4236', tail:'#6B4A2E' },
 red:{ fill:'#B8432F', edge:'#8C2E20', thread:'#AE3E2B', hi:'#E7826B', line:'#6E2318', tatami:'#3A0E08', tatamiHi:'#FFD9C8', text:'#6E2318', textHi:'#8E3524', tail:'#5A2416' }
};
// With no name or icon it's the category's blank patch, the stand-in when a badge has no art yet.
function patch({shape='circle', palette='red', icon='', name=''}){
 const P=PALETTES[palette], S=SHAPES[shape], txt=name.toUpperCase(), rib=P.ribbon==='gold'?'url(#ribbonGold)':'url(#satinH)';
 const fit=txt.length*10.6>150? `textLength="150" lengthAdjust="spacingAndGlyphs"` : '';
 const ic=icon.replace(/\{C\}/g,P.dark?'url(#ink)':'url(#cream)').replace(/\{CS\}/g,P.dark?'url(#inkS)':'url(#creamS)').replace(/\{D\}/g,P.dark?'#5A4D3A':'#C9B48F').replace(/#FFF8EA/g,P.dark?'#8A7A60':'#FFF8EA').replace(/\{K\}/g,P.edge)
   .replace(/\{B\}/g,P.fill).replace(/\{G\}/g,'url(#gold)').replace(/\{L\}/g,'url(#leaf)');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="-112 -112 224 224">
<defs>
 <pattern id="tatami" width="11" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><path d="M0 .9 H7.6 M5.6 2.6 H11 M-5.4 2.6 H2.2" stroke="${P.tatami}" stroke-opacity=".42" stroke-width="1.25" stroke-linecap="round"/><path d="M.5 .2 H7 M6 1.9 H10.6 M-5 1.9 H1.6" stroke="${P.tatamiHi}" stroke-opacity=".22" stroke-width=".6" stroke-linecap="round"/></pattern>
 <radialGradient id="shade" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient>
 <pattern id="cream" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-70)"><rect width="2.2" height="2.2" fill="#F5EAD6"/><rect width="2.2" height=".75" fill="#DCCBAA"/></pattern>
 <pattern id="creamS" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(20)"><rect width="2" height="2" fill="#F5EAD6"/><rect width="2" height=".6" fill="#DECDAE"/></pattern>
 <pattern id="ink" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-70)"><rect width="2.2" height="2.2" fill="#2E2A24"/><rect width="2.2" height=".75" fill="#45403A"/></pattern>
 <pattern id="inkS" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(20)"><rect width="2" height="2" fill="#2E2A24"/><rect width="2" height=".6" fill="#47423B"/></pattern>
 <pattern id="gold" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-60)"><rect width="2.2" height="2.2" fill="#E2B04A"/><rect width="2.2" height=".75" fill="#C48F2C"/></pattern>
 <pattern id="leaf" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)"><rect width="2.2" height="2.2" fill="#9DBB7E"/><rect width="2.2" height=".75" fill="#7E9E63"/></pattern>
 <pattern id="ribbonGold" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(8)"><rect width="2.4" height="2.4" fill="#DDAE45"/><rect width="2.4" height=".6" fill="#C2922C"/></pattern>
 <pattern id="satinH" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(8)"><rect width="2.4" height="2.4" fill="#F2E6CF"/><rect width="2.4" height=".6" fill="#E3D3B6"/></pattern>
 <pattern id="satinText" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)"><rect width="1.6" height="1.6" fill="${P.text}"/><rect width="1.6" height=".5" fill="${P.textHi}"/></pattern>
 <linearGradient id="ribbonShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
 <filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dy="4" dx="1"/><feComponentTransfer><feFuncA type="linear" slope=".35"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
 <filter id="cloth" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="2.4 .5" numOctaves="3" seed="4" result="n"/>
  <feDiffuseLighting in="n" surfaceScale=".85" lighting-color="#fff" result="lt"><feDistantLight azimuth="225" elevation="64"/></feDiffuseLighting>
  <feComposite in="SourceGraphic" in2="lt" operator="arithmetic" k1="1.18" k2="0" k3="0" k4="0" result="tex"/>
  <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="ab"/>
  <feSpecularLighting in="ab" surfaceScale="4" specularConstant=".5" specularExponent="16" lighting-color="#fff" result="sp"><feDistantLight azimuth="225" elevation="42"/></feSpecularLighting>
  <feComposite in="sp" in2="SourceAlpha" operator="in" result="spi"/>
  <feComposite in="tex" in2="spi" operator="arithmetic" k2="1" k3=".4" result="lit"/>
  <feComposite in="lit" in2="SourceAlpha" operator="in"/>
 </filter>
 <filter id="wobble" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="1" seed="12" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>
 <filter id="thread" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="1" seed="21" result="w"/>
  <feDisplacementMap in="SourceGraphic" in2="w" scale="1.3" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="1.3" result="b"/>
  <feSpecularLighting in="b" surfaceScale="3.4" specularConstant=".95" specularExponent="18" lighting-color="#fff" result="sp"><feDistantLight azimuth="225" elevation="36"/></feSpecularLighting>
  <feComposite in="sp" in2="d" operator="in" result="spi"/>
  <feComposite in="d" in2="spi" operator="arithmetic" k2="1" k3=".55" result="lit"/>
  <feColorMatrix in="d" type="matrix" values="0 0 0 0 .12  0 0 0 0 .04  0 0 0 0 .02  0 0 0 .6 0" result="dk"/>
  <feGaussianBlur in="dk" stdDeviation="1.1"/><feOffset dx="1" dy="2" result="sh"/>
  <feMerge><feMergeNode in="sh"/><feMergeNode in="lit"/></feMerge>
 </filter>
 <filter id="threadText" x="-10%" y="-30%" width="120%" height="160%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="5" result="w"/>
  <feDisplacementMap in="SourceGraphic" in2="w" scale=".55" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation=".7" result="b"/>
  <feSpecularLighting in="b" surfaceScale="2" specularConstant=".6" specularExponent="20" lighting-color="#fff" result="sp"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting>
  <feComposite in="sp" in2="d" operator="in" result="spi"/>
  <feComposite in="d" in2="spi" operator="arithmetic" k2="1" k3=".35" result="lit"/>
  <feColorMatrix in="d" type="matrix" values="0 0 0 0 .1  0 0 0 0 .03  0 0 0 0 .02  0 0 0 .32 0" result="dk"/>
  <feGaussianBlur in="dk" stdDeviation=".5"/><feOffset dx=".5" dy="1" result="sh"/>
  <feMerge><feMergeNode in="sh"/><feMergeNode in="lit"/></feMerge>
 </filter>
 <clipPath id="inner"><path d="${S}" transform="scale(.84)"/></clipPath>
</defs>
<g filter="url(#drop)">
 <g filter="url(#cloth)">
  <path d="${S}" fill="${P.fill}"/>
  <g clip-path="url(#inner)"><rect x="-90" y="-90" width="180" height="180" fill="url(#tatami)"/></g>
  <path d="${S}" fill="url(#shade)"/>
  <path d="${S}" transform="scale(.93)" fill="none" stroke="${P.edge}" stroke-width="13"/>
  <path d="${S}" transform="scale(.93)" fill="none" stroke="${P.thread}" stroke-width="13" stroke-dasharray="1.15 .85"/>
  <path d="${S}" transform="scale(.93)" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="13" stroke-dasharray="0.45 1.55"/>
  <path d="${S}" transform="scale(.93)" fill="none" stroke="${P.hi}" stroke-opacity=".35" stroke-width="13" stroke-dasharray="0.35 1.65" stroke-dashoffset="-1"/>
  <path d="${S}" transform="scale(.872)" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="2.4"/>
  <path d="${S}" transform="scale(.988)" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="2"/>
  <path d="${S}" fill="none" stroke="${P.line}" stroke-width="1.2"/>
 </g>
 <g filter="url(#wobble)">
  <path d="${S}" transform="scale(.767)" fill="none" stroke="${P.tatami}" stroke-opacity=".45" stroke-width="4.7" stroke-dasharray="0 13.35" stroke-dashoffset="-.4" stroke-linecap="round"/>
  <path d="${S}" transform="translate(.7 1.1) scale(.767)" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="3.65" stroke-dasharray="8.1 5.25" stroke-linecap="round"/>
  <path d="${S}" transform="scale(.767)" fill="none" stroke="${P.stitch||'#EADCC0'}" stroke-width="3.65" stroke-dasharray="8.1 5.25" stroke-linecap="round"/>
  <path d="${S}" transform="translate(-.4 -.5) scale(.767)" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.3" stroke-dasharray="6 7.35" stroke-dashoffset="-.8" stroke-linecap="round"/>
 </g>
 <g filter="url(#thread)">${ic}</g>
 ${txt?` <g filter="url(#thread)">
  <path d="M-80 44 L-104 47 L-97 58 L-104 70 L-80 66 Z" fill="${rib}" stroke="${P.edge}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M80 44 L104 47 L97 58 L104 70 L80 66 Z" fill="${rib}" stroke="${P.edge}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M-80 44 L-104 47 L-97 58 L-104 70 L-80 66 Z M80 44 L104 47 L97 58 L104 70 L80 66 Z" fill="${P.tail}" fill-opacity=".3"/>
  <path d="M-84 62 L-80 66 L-80 62 Z M84 62 L80 66 L80 62 Z" fill="${P.line}"/>
  <rect x="-84" y="35" width="168" height="27" rx="1" fill="${rib}" stroke="${P.edge}" stroke-width="2.4"/>
  <rect x="-84" y="35" width="168" height="27" fill="url(#ribbonShade)"/>
  <path d="M-80 38.5 H80 M-80 58.5 H80" stroke="${P.edge}" stroke-opacity=".35" stroke-width=".8" stroke-dasharray="3 2"/>
 </g>
 <g filter="url(#threadText)"><text y="55.8" text-anchor="middle" font-family="Oswald" font-weight="600" font-size="17" letter-spacing="1.6" fill="url(#satinText)" ${fit}>${txt.replace(/&/g,'&amp;')}</text></g>
`:''}
</g></svg>`;
}
module.exports={patch,PALETTES,SHAPES};
