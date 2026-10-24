/* Original SVG artwork generated on the server.
   No external images are required, which keeps the site fast and self-contained.
   Each scene is deterministic: same key + variant always renders the same picture. */

const PALETTES = [
  { sky: ['#0B314D', '#17638F'], glow: '#E89A38', far: '#0A2B44', mid: '#082238', near: '#061A2A', accent: '#F2C078', water: '#0F4C70' },
  { sky: ['#123F62', '#2C7FA8'], glow: '#FFD08A', far: '#0E3450', mid: '#0B2A41', near: '#081F31', accent: '#E89A38', water: '#15597E' },
  { sky: ['#1B2E4A', '#4C7FA0'], glow: '#F6D9A8', far: '#14344C', mid: '#0F2A3E', near: '#0A1F2F', accent: '#E8B86A', water: '#1E5C7C' },
  { sky: ['#0E3A55', '#3E8FAF'], glow: '#FFE2B4', far: '#0B3048', mid: '#092639', near: '#061C2B', accent: '#F0BE79', water: '#12658B' },
];

const W = 1200;
const H = 700;

function pick(variant = 0) {
  const v = Math.abs(Number(variant) || 0);
  return PALETTES[v % PALETTES.length];
}

function sky(p, seed = 0) {
  const stars = seed % 3 === 0 ? '' : Array.from({ length: 26 }, (_, i) => {
    const x = ((i * 137 + seed * 61) % W);
    const y = ((i * 79 + seed * 37) % 260) + 20;
    const r = (i % 3 === 0 ? 1.9 : 1.2);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.18 + ((i % 5) * 0.06)}"/>`;
  }).join('');
  return `<defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${p.sky[0]}"/><stop offset="0.62" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[1]}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${p.glow}" stop-opacity="0.95"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    ${stars}`;
}

function horizonGlow(p, cx = 600, cy = 300, r = 320) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#glow)" opacity="0.55"/>`;
}

function dunes(p, y = 470) {
  return `<path d="M0 ${y} Q 180 ${y - 60} 360 ${y + 10} T 760 ${y - 10} T 1200 ${y + 20} V700 H0 Z" fill="${p.far}"/>
    <path d="M0 ${y + 70} Q 240 ${y + 10} 470 ${y + 80} T 900 ${y + 50} T 1200 ${y + 90} V700 H0 Z" fill="${p.mid}"/>
    <path d="M0 ${y + 150} Q 300 ${y + 100} 620 ${y + 160} T 1200 ${y + 140} V700 H0 Z" fill="${p.near}"/>`;
}

function minaret(x, baseY, h, w, fill, accent) {
  return `<g fill="${fill}">
      <rect x="${x - w / 2}" y="${baseY - h}" width="${w}" height="${h}"/>
      <rect x="${x - w / 2 - 4}" y="${baseY - h * 0.62}" width="${w + 8}" height="9" rx="2" fill="${accent}" opacity="0.55"/>
      <rect x="${x - w / 2 - 6}" y="${baseY - h - 6}" width="${w + 12}" height="8" rx="2"/>
      <path d="M${x - w / 2 - 2} ${baseY - h - 6} L${x} ${baseY - h - 34} L${x + w / 2 + 2} ${baseY - h - 6} Z"/>
    </g>
    <circle cx="${x}" cy="${baseY - h - 40}" r="3.4" fill="${accent}" opacity="0.9"/>`;
}

function palm(x, y, s = 1, fill = '#04141F') {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${fill}" stroke-width="5.5" stroke-linecap="round">
      <path d="M0 0 C 3 -24 2 -48 0 -70" stroke-width="6.5"/>
      <path d="M0 -70 q -30 -16 -54 -6"/>
      <path d="M0 -70 q -22 -26 -44 -32"/>
      <path d="M0 -70 q 22 -26 44 -32"/>
      <path d="M0 -70 q 30 -16 54 -6"/>
      <path d="M0 -70 q -6 -34 8 -48"/>
    </g>`;
}

function kaaba(p) {
  return `<g>
      <rect x="470" y="300" width="260" height="240" rx="6" fill="#0A1D2B"/>
      <rect x="470" y="300" width="260" height="240" rx="6" fill="none" stroke="${p.accent}" stroke-opacity="0.25"/>
      <rect x="470" y="404" width="260" height="26" fill="${p.accent}" opacity="0.85"/>
      <rect x="470" y="430" width="260" height="6" fill="#F7E7C8" opacity="0.35"/>
      <rect x="556" y="470" width="88" height="70" rx="4" fill="${p.accent}" opacity="0.72"/>
      <rect x="470" y="322" width="260" height="10" fill="#F7E7C8" opacity="0.18"/>
      <circle cx="600" cy="356" r="4" fill="${p.accent}" opacity="0.8"/>
    </g>`;
}

function arcade(p, y) {
  const cols = Array.from({ length: 9 }, (_, i) => {
    const x = 300 + i * 68;
    return `<rect x="${x}" y="${y}" width="16" height="90" fill="#061826"/><path d="M${x - 6} ${y} q 14 -22 28 0 z" fill="#061826"/>`;
  }).join('');
  return `<rect x="280" y="${y - 12}" width="640" height="16" fill="#061826"/>${cols}<rect x="280" y="${y + 90}" width="640" height="24" fill="${p.near}"/>`;
}

const SCENES = {
  hero(p) {
    const dome = (x, y, r) => `<path d="M${x - r} ${y} a ${r} ${r} 0 0 1 ${2 * r} 0 z" fill="#0A1D2B"/>
      <path d="M${x - r} ${y} a ${r} ${r} 0 0 1 ${2 * r} 0" fill="none" stroke="${p.accent}" stroke-opacity="0.55" stroke-width="2.4"/>
      <circle cx="${x}" cy="${y - r - 9}" r="4" fill="${p.accent}" opacity="0.85"/>`;
    return `${sky(p, 2)}
      ${horizonGlow(p, 330, 300, 330)}
      <circle cx="330" cy="262" r="62" fill="${p.glow}" opacity="0.28"/>
      ${minaret(118, 604, 330, 16, p.far, p.accent)}
      ${minaret(372, 596, 268, 13, p.far, p.accent)}
      <g fill="#0A1D2B">
        <rect x="196" y="452" width="330" height="152"/>
        ${Array.from({ length: 7 }, (_, i) => `<path d="M${212 + i * 46} 520 a 15 17 0 0 1 30 0 v 84 h -30 z" fill="#061826"/>`).join('')}
        <rect x="196" y="596" width="330" height="14" fill="${p.accent}" opacity="0.22"/>
      </g>
      ${dome(252, 452, 52)}${dome(330, 444, 70)}${dome(410, 452, 52)}
      ${palm(92, 636, 1.15)}
      ${palm(560, 648, 1.35)}
      <path d="M480 632 q 120 -26 260 -6 t 460 -8" fill="none" stroke="${p.accent}" stroke-opacity="0.18" stroke-width="3"/>
      <g fill="#ffffff" opacity="0.22">
        <path d="M840 210 q 8 -8 16 0 q 8 -8 16 0" fill="none" stroke="#fff" stroke-width="2"/>
        <path d="M900 250 q 6 -6 12 0 q 6 -6 12 0" fill="none" stroke="#fff" stroke-width="1.6"/>
      </g>
      <rect y="610" width="${W}" height="90" fill="${p.near}"/>
      <rect y="560" width="${W}" height="150" fill="url(#fade)" opacity="0.55"/>`;
  },
  haram(p) {
    const crowd = Array.from({ length: 34 }, (_, i) => {
      const x = 430 + ((i * 37) % 360);
      const y = 606 + ((i * 13) % 26);
      return `<ellipse cx="${x}" cy="${y}" rx="5" ry="8" fill="#03111B" opacity="0.7"/>`;
    }).join('');
    return `${sky(p, 1)}
      ${horizonGlow(p, 600, 330, 360)}
      <circle cx="600" cy="236" r="74" fill="${p.glow}" opacity="0.2"/>
      <path d="M600 236 L300 640 H900 Z" fill="${p.glow}" opacity="0.05"/>
      <path d="M600 236 L430 640 H770 Z" fill="${p.glow}" opacity="0.05"/>
      ${minaret(232, 600, 340, 19, p.far, p.accent)}
      ${minaret(968, 600, 340, 19, p.far, p.accent)}
      ${minaret(318, 590, 250, 15, p.far, p.accent)}
      ${minaret(882, 590, 250, 15, p.far, p.accent)}
      <g fill="#061826">
        <rect x="250" y="512" width="700" height="16"/>
        ${Array.from({ length: 11 }, (_, i) => `<rect x="${268 + i * 62}" y="528" width="14" height="84"/><path d="M${262 + i * 62} 528 q 13 -20 26 0 z"/>`).join('')}
        <rect x="250" y="612" width="700" height="18"/>
      </g>
      <g>
        <rect x="536" y="404" width="150" height="170" rx="4" fill="#0A1D2B"/>
        <rect x="536" y="404" width="150" height="170" rx="4" fill="none" stroke="${p.accent}" stroke-opacity="0.22"/>
        <rect x="536" y="492" width="150" height="20" fill="${p.accent}" opacity="0.82"/>
        <rect x="536" y="512" width="150" height="4" fill="#F7E7C8" opacity="0.3"/>
        <rect x="596" y="530" width="34" height="44" rx="2" fill="${p.accent}" opacity="0.6"/>
        <circle cx="611" cy="438" r="3.4" fill="${p.accent}" opacity="0.85"/>
      </g>
      ${crowd}
      <rect y="626" width="${W}" height="74" fill="${p.near}"/>
      <rect y="600" width="${W}" height="100" fill="url(#fade)" opacity="0.45"/>`;
  },
  madinah(p) {
    const dome = (x, y, r) => `<path d="M${x - r} ${y} a ${r} ${r} 0 0 1 ${2 * r} 0 z" fill="#0A1D2B"/>
      <path d="M${x - r} ${y} a ${r} ${r} 0 0 1 ${2 * r} 0" fill="none" stroke="${p.accent}" stroke-opacity="0.5" stroke-width="3"/>
      <circle cx="${x}" cy="${y - r - 8}" r="5" fill="${p.accent}" opacity="0.8"/>`;
    return `${sky(p, 4)}
      ${horizonGlow(p, 620, 340, 340)}
      ${minaret(330, 560, 290, 24, p.far, p.accent)}
      ${minaret(870, 560, 290, 24, p.far, p.accent)}
      <rect x="420" y="400" width="360" height="160" fill="#0A1D2B"/>
      ${dome(520, 400, 54)}${dome(600, 392, 64)}${dome(680, 400, 54)}
      <g fill="#061826">
        ${Array.from({ length: 7 }, (_, i) => `<path d="M${452 + i * 44} 470 a 18 20 0 0 1 36 0 v 90 h -36 z"/>`).join('')}
      </g>
      <rect x="420" y="556" width="360" height="10" fill="${p.accent}" opacity="0.35"/>
      <rect y="560" width="${W}" height="140" fill="${p.near}"/>
      ${palm(260, 600, 1.15)}${palm(980, 610, 1.3)}`;
  },
  istanbul(p) {
    const dome = (x, y, r) => `<path d="M${x - r} ${y} a ${r} ${r} 0 0 1 ${2 * r} 0 z" fill="#081C2B"/>`;
    return `${sky(p, 2)}
      ${horizonGlow(p, 640, 320, 330)}
      ${minaret(392, 520, 300, 22, p.far, p.accent)}
      ${minaret(700, 520, 300, 22, p.far, p.accent)}
      ${minaret(470, 520, 220, 18, p.far, p.accent)}
      ${minaret(640, 520, 220, 18, p.far, p.accent)}
      <rect x="430" y="392" width="290" height="130" fill="#081C2B"/>
      ${dome(575, 392, 86)}${dome(500, 420, 46)}${dome(650, 420, 46)}
      <rect x="300" y="480" width="520" height="42" fill="#061826"/>
      <rect y="520" width="${W}" height="180" fill="${p.water}"/>
      <g fill="${p.far}" opacity="0.9">
        ${Array.from({ length: 9 }, (_, i) => `<rect x="${80 + i * 130}" y="${470 - (i % 3) * 30}" width="${60 + (i % 4) * 22}" height="${50 + (i % 3) * 30}"/>`).join('')}
      </g>
      <rect y="520" width="${W}" height="180" fill="url(#fade)" opacity="0.55"/>
      <g stroke="${p.accent}" stroke-opacity="0.35" stroke-width="2">
        ${Array.from({ length: 14 }, (_, i) => `<path d="M${40 + i * 90} 600 q 30 -8 60 0"/>`).join('')}
      </g>
      <rect x="700" y="585" width="120" height="16" rx="8" fill="#04141F"/>`;
  },
  beach(p) {
    return `${sky(p, 6)}
      ${horizonGlow(p, 860, 250, 260)}
      <circle cx="860" cy="250" r="62" fill="${p.glow}" opacity="0.85"/>
      <rect y="420" width="${W}" height="120" fill="${p.water}"/>
      <rect y="520" width="${W}" height="180" fill="#0B4A63"/>
      <g stroke="#7FD0DE" stroke-opacity="0.25" stroke-width="3" fill="none">
        ${Array.from({ length: 9 }, (_, i) => `<path d="M${60 + i * 140} 470 q 26 -10 52 0"/>`).join('')}
      </g>
      <path d="M0 620 Q 300 560 620 640 T 1200 610 V700 H0 Z" fill="#F3E2C2" opacity="0.92"/>
      <path d="M0 660 Q 340 610 700 668 T 1200 650 V700 H0 Z" fill="#E9D3AC" opacity="0.9"/>
      ${palm(190, 660, 1.5, '#3A2A18')}${palm(300, 680, 1.1, '#3A2A18')}
      <g transform="translate(860 560)">
        <path d="M-70 0 h140" stroke="#8A6A43" stroke-width="6"/>
        <path d="M0 0 L-54 -52 L54 -52 Z" fill="#C8654A"/>
        <path d="M0 0 L-54 -52 L0 -52 Z" fill="#E89A38"/>
        <rect x="-2" y="-96" width="4" height="46" fill="#8A6A43"/>
      </g>`;
  },
  cruise(p) {
    return `${sky(p, 3)}
      ${horizonGlow(p, 760, 260, 300)}
      <circle cx="760" cy="250" r="58" fill="${p.glow}" opacity="0.8"/>
      <rect y="430" width="${W}" height="270" fill="${p.water}"/>
      <rect y="430" width="${W}" height="270" fill="url(#fade)" opacity="0.5"/>
      <g>
        <path d="M250 470 H940 L890 540 H300 Z" fill="#0A2132"/>
        <rect x="330" y="368" width="470" height="104" rx="10" fill="#F5EFE3"/>
        <rect x="330" y="404" width="470" height="14" fill="${p.accent}" opacity="0.55"/>
        <g fill="#1B4C6B" opacity="0.75">
          ${Array.from({ length: 9 }, (_, i) => `<rect x="${352 + i * 48}" y="378" width="26" height="20" rx="3"/>`).join('')}
        </g>
        <rect x="470" y="336" width="26" height="36" fill="#0A2132"/>
        <rect x="640" y="328" width="18" height="44" fill="#0A2132"/>
        <path d="M520 470 v-40 h90 v40" fill="#0A2132"/>
        <g fill="${p.accent}">
          ${Array.from({ length: 7 }, (_, i) => `<circle cx="${330 + i * 78}" cy="500" r="3"/>`).join('')}
        </g>
      </g>
      <g stroke="#8FD3E8" stroke-opacity="0.25" stroke-width="3" fill="none">
        <path d="M120 590 q 60 -12 120 0 t 120 0"/>
        <path d="M620 630 q 60 -12 120 0 t 120 0"/>
      </g>`;
  },
  plane(p) {
    return `${sky(p, 5)}
      ${horizonGlow(p, 900, 220, 300)}
      <circle cx="900" cy="210" r="54" fill="${p.glow}" opacity="0.75"/>
      <g fill="#ffffff" opacity="0.16">
        <ellipse cx="260" cy="470" rx="150" ry="42"/><ellipse cx="360" cy="440" rx="110" ry="34"/>
        <ellipse cx="940" cy="540" rx="170" ry="46"/><ellipse cx="820" cy="515" rx="110" ry="30"/>
      </g>
      <g transform="translate(560 330) rotate(-6)">
        <path d="M-210 10 L120 -6 L250 34 L250 58 L90 44 L40 96 L-20 96 L10 44 L-190 56 Z" fill="#F7FAFC"/>
        <path d="M-210 10 L120 -6 L120 6 L-206 30 Z" fill="#D8E6EF"/>
        <circle cx="120" cy="20" r="12" fill="${p.accent}" opacity="0.6"/>
        <path d="M-20 96 L40 96 L10 130 L-40 130 Z" fill="#E3EEF5"/>
      </g>
      <g stroke="#ffffff" stroke-opacity="0.18" stroke-width="2" fill="none" stroke-dasharray="14 18">
        <path d="M60 220 Q 420 120 780 200"/>
      </g>
      <rect y="600" width="${W}" height="100" fill="${p.near}" opacity="0.85"/>`;
  },
  hotel(p) {
    return `${sky(p, 7)}
      ${horizonGlow(p, 300, 320, 320)}
      <rect y="520" width="${W}" height="180" fill="${p.near}"/>
      <g>
        <rect x="360" y="150" width="480" height="400" rx="10" fill="#0B2334"/>
        <rect x="360" y="150" width="480" height="400" rx="10" fill="none" stroke="${p.accent}" stroke-opacity="0.22"/>
        ${Array.from({ length: 5 }, (_, r) => Array.from({ length: 7 }, (_, c) => {
          const on = (r * 7 + c) % 3 !== 0;
          return `<rect x="${392 + c * 62}" y="${184 + r * 66}" width="34" height="40" rx="3" fill="${on ? p.accent : '#123A52'}" opacity="${on ? 0.72 : 0.5}"/>`;
        }).join('')).join('')}
        <rect x="520" y="470" width="160" height="80" rx="4" fill="${p.glow}" opacity="0.28"/>
        <path d="M360 150 h480 l-40 -40 h-400 z" fill="#081C2B"/>
      </g>
      ${palm(280, 560, 1.1)}${palm(940, 566, 1.2)}
      <g fill="${p.accent}" opacity="0.5">
        ${Array.from({ length: 5 }, (_, i) => `<circle cx="${430 + i * 80}" cy="415" r="3"/>`).join('')}
      </g>`;
  },
  desert(p) {
    return `${sky(p, 8)}
      ${horizonGlow(p, 300, 280, 300)}
      <circle cx="300" cy="280" r="70" fill="${p.glow}" opacity="0.7"/>
      ${dunes(p, 420)}
      <g stroke="#03111B" stroke-width="9" stroke-linecap="round" fill="none" opacity="0.9">
        <path d="M700 520 q 30 -60 66 -8"/><path d="M766 512 q 26 -70 60 -12"/>
        <path d="M766 512 l 20 54 m 0 0 l -22 34 m 22 -34 l 24 34"/>
        <circle cx="764" cy="466" r="16" fill="#03111B"/>
      </g>
      <g fill="#03111B" opacity="0.8">
        <rect x="880" y="470" width="12" height="80"/><rect x="906" y="490" width="10" height="60"/>
      </g>`;
  },
  cairo(p) {
    return `${sky(p, 9)}
      ${horizonGlow(p, 780, 300, 340)}
      <circle cx="780" cy="300" r="64" fill="${p.glow}" opacity="0.75"/>
      <path d="M170 560 L340 300 L510 560 Z" fill="#0A1D2B"/>
      <path d="M420 560 L560 350 L700 560 Z" fill="#081C2B"/>
      <path d="M600 560 L720 390 L840 560 Z" fill="#061826"/>
      <g opacity="0.35" stroke="${p.accent}" stroke-width="2">
        <path d="M340 300 L340 560"/><path d="M560 350 L560 560"/><path d="M720 390 L720 560"/>
      </g>
      <rect y="560" width="${W}" height="140" fill="${p.near}"/>
      ${palm(940, 600, 1.2)}${palm(180, 610, 1)}`;
  },
  europe(p) {
    return `${sky(p, 10)}
      ${horizonGlow(p, 340, 290, 320)}
      <g fill="${p.far}">
        ${Array.from({ length: 8 }, (_, i) => `<rect x="${80 + i * 130}" y="${470 - (i % 4) * 40}" width="${90}" height="${90 + (i % 4) * 40}"/>`).join('')}
      </g>
      <g stroke="${p.far}" stroke-width="14" fill="none">
        <path d="M600 560 L600 300 M600 360 Q 700 400 740 470 M600 360 Q 500 400 460 470 M600 400 L600 470"/>
        <path d="M600 300 l -40 60 h 80 z" fill="${p.far}" stroke="none"/>
      </g>
      <rect y="560" width="${W}" height="140" fill="${p.near}"/>
      <g fill="${p.accent}" opacity="0.35">
        ${Array.from({ length: 20 }, (_, i) => `<circle cx="${(i * 61) % 1200}" cy="${610 + (i % 3) * 20}" r="2"/>`).join('')}
      </g>`;
  },
  asia(p) {
    return `${sky(p, 11)}
      ${horizonGlow(p, 300, 300, 320)}
      <g fill="#0A1D2B">
        <rect x="430" y="380" width="340" height="180"/>
        ${[0, 1, 2].map((i) => `<path d="M${380 - i * 10} ${380 - i * 60} h ${440 + i * 20} l -60 -34 h ${-320 - i * 20} z" fill="#0A1D2B"/>`).join('')}
        <rect x="560" y="300" width="80" height="90"/>
      </g>
      <rect y="560" width="${W}" height="140" fill="${p.near}"/>
      <g stroke="${p.accent}" stroke-opacity="0.4" stroke-width="3" fill="none">
        <path d="M60 640 q 60 -20 120 0 t 120 0"/><path d="M900 640 q 60 -20 120 0 t 120 0"/>
      </g>`;
  },
  gulf(p) {
    return `${sky(p, 12)}
      ${horizonGlow(p, 620, 280, 330)}
      <g fill="${p.far}">
        <rect x="240" y="330" width="90" height="230"/>
        <rect x="350" y="260" width="110" height="300"/>
        <rect x="480" y="380" width="90" height="180"/>
        <rect x="590" y="210" width="120" height="350"/>
        <rect x="730" y="320" width="100" height="240"/>
        <rect x="850" y="280" width="80" height="280"/>
      </g>
      <g fill="${p.accent}" opacity="0.45">
        ${Array.from({ length: 18 }, (_, i) => `<rect x="${600 + (i % 4) * 24}" y="${240 + Math.floor(i / 4) * 36}" width="10" height="18"/>`).join('')}
      </g>
      <rect y="560" width="${W}" height="140" fill="${p.near}"/>
      <g stroke="${p.accent}" stroke-opacity="0.25" stroke-width="3"><path d="M0 600 h1200"/></g>`;
  },
};

export const ART_KEYS = Object.keys(SCENES);

export function artSvg(key, variant = 0) {
  const fn = SCENES[key] || SCENES.haram;
  const p = pick(variant);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" role="img">
${fn(p)}
</svg>`;
}

export function artUrl(key, variant = 0) {
  const k = SCENES[key] ? key : 'haram';
  return `/art/${k}.svg?v=${Math.abs(Number(variant) || 0) % 4}`;
}

export function categoryArt(category) {
  return {
    umrah: 'haram',
    hajj: 'madinah',
    cruise: 'cruise',
    sharm: 'beach',
    istanbul: 'istanbul',
    turkey: 'istanbul',
    egypt: 'cairo',
    europe: 'europe',
    asia: 'asia',
    gulf: 'gulf',
    honeymoon: 'beach',
    family: 'hotel',
    flights: 'plane',
    hotels: 'hotel',
  }[category] || 'haram';
}
