// 主题调色板：每个主题定义浅色/深色两套完整颜色变量，
// 与 `:root` / `:root[data-theme="dark"]` 定义的变量范围一致（surface/sidebar/raised/text/muted/line/accent/accent-soft/hover）。
export interface Palette {
  surface: string; sidebar: string; raised: string; text: string; muted: string; line: string; accent: string; 'accent-soft': string; hover: string;
}
export interface Theme { id: string; name: string; light: Palette; dark: Palette; }

// 青绿（默认）沿用现有 CSS 中的暖白/墨色 + 青绿强调色。
const BASE_LIGHT: Palette = { surface: '#fcfaf6', sidebar: '#f2efe9', raised: '#fffdf9', text: '#2d3732', muted: '#59655c', line: '#e5e5dc', accent: '#356b59', 'accent-soft': '#e3ece4', hover: '#e9e8df' };
const BASE_DARK: Palette = { surface: '#222925', sidebar: '#1c231f', raised: '#2a322d', text: '#e2e8df', muted: '#adb8ac', line: '#39433b', accent: '#a0c6b3', 'accent-soft': '#34473b', hover: '#303a32' };

const toRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const fromRgb = ([r, g, b]: [number, number, number]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, t: number) => { const ra = toRgb(a), rb = toRgb(b); return fromRgb([ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t]); };

// 由强调色派生整套调色板：背景/边框做轻量染色，文字/次要文字做明显染色，强调色精确使用给定值。
const derive = (base: Palette, accent: string): Palette => ({
  surface: mix(base.surface, accent, 0.04),
  sidebar: mix(base.sidebar, accent, 0.06),
  raised: mix(base.raised, accent, 0.04),
  text: mix(base.text, accent, 0.22),
  muted: mix(base.muted, accent, 0.25),
  line: mix(base.line, accent, 0.12),
  hover: mix(base.hover, accent, 0.08),
  accent,
  'accent-soft': mix(base.surface, accent, 0.14),
});

const DEFS: { id: string; name: string; light: string; dark: string }[] = [
  { id: 'teal', name: '青绿', light: '#356b59', dark: '#a0c6b3' },
  { id: 'brick', name: '砖红', light: '#9c352a', dark: '#d99a8a' },
  { id: 'indigo', name: '靛蓝', light: '#3a5a8c', dark: '#a5bad8' },
  { id: 'amber', name: '琥珀', light: '#8a5a20', dark: '#d6b383' },
  { id: 'rose', name: '玫瑰', light: '#a03a5a', dark: '#d99ab0' },
  { id: 'pine', name: '松绿', light: '#2f5a4a', dark: '#93bfa8' },
  { id: 'violet', name: '黛紫', light: '#6b4a8f', dark: '#c2a6d8' },
  { id: 'navy', name: '墨蓝', light: '#35536f', dark: '#a3bdd6' },
];

export const THEMES: Theme[] = DEFS.map(def => ({
  id: def.id, name: def.name,
  light: def.id === 'teal' ? BASE_LIGHT : derive(BASE_LIGHT, def.light),
  dark: def.id === 'teal' ? BASE_DARK : derive(BASE_DARK, def.dark),
}));
