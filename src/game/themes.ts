import type { CardColor } from './types.ts';

export type TableThemeId =
  | 'emerald'
  | 'burgundy'
  | 'obsidian'
  | 'sakura'
  | 'pharaoh'
  | 'aurora';

export type CardDesignStyle =
  | 'classic'
  | 'deco'
  | 'obsidian'
  | 'crest'
  | 'sunburst'
  | 'prism';

export interface TableTheme {
  id: TableThemeId;
  label: string;
  cardDesign: CardDesignStyle;
  bgTop: string;
  bgMid: string;
  bgBottom: string;
  railDark: string;
  railLight: string;
  railTrim: string;
  feltCenter: string;
  feltMid: string;
  feltEdge: string;
  cardFrame: string;
  cardFrameOutline: string;
  cardCenterBg: string;
  cardBackBg: string;
  cardBackMedallion: string;
  cardBackMedallionShadow: string;
  cardBackBorder: string;
  suitHex: Record<CardColor, string>;
  accent: string;
  surface: string;
  surfaceBorder: string;
}

export const TABLE_THEMES: Record<TableThemeId, TableTheme> = {
  emerald: {
    id: 'emerald',
    label: 'Monte Carlo',
    cardDesign: 'classic',
    bgTop: '#070b14',
    bgMid: '#0d1626',
    bgBottom: '#132033',
    railDark: '#2c1910',
    railLight: '#593622',
    railTrim: '#dfb356',
    feltCenter: '#166c56',
    feltMid: '#0e4d3d',
    feltEdge: '#072c22',
    cardFrame: '#fbf9f1',
    cardFrameOutline: 'rgba(255,255,255,0.92)',
    cardCenterBg: '#fffdf4',
    cardBackBg: '#171d33',
    cardBackMedallion: '#df394c',
    cardBackMedallionShadow: '#7b1824',
    cardBackBorder: '#ff96a1',
    suitHex: {
      Red: '#ee3f4f',
      Blue: '#2f86f0',
      Green: '#16b07a',
      Yellow: '#f6c030',
      Wild: '#1c2133',
    },
    accent: '#f5c84b',
    surface: '#101d28',
    surfaceBorder: '#284452',
  },
  burgundy: {
    id: 'burgundy',
    label: 'Velvet Noir',
    cardDesign: 'deco',
    bgTop: '#0d070a',
    bgMid: '#180d13',
    bgBottom: '#24121b',
    railDark: '#261310',
    railLight: '#4d261e',
    railTrim: '#eec774',
    feltCenter: '#751f33',
    feltMid: '#4f1322',
    feltEdge: '#2c0912',
    cardFrame: '#f5ebd6',
    cardFrameOutline: '#d8b467',
    cardCenterBg: '#fbf4e4',
    cardBackBg: '#1d1218',
    cardBackMedallion: '#c98827',
    cardBackMedallionShadow: '#643d09',
    cardBackBorder: '#ffe29c',
    suitHex: {
      Red: '#c8263b',
      Blue: '#3554bf',
      Green: '#1c865f',
      Yellow: '#d99a1e',
      Wild: '#25171d',
    },
    accent: '#f3cf7a',
    surface: '#1b1117',
    surfaceBorder: '#472836',
  },
  obsidian: {
    id: 'obsidian',
    label: 'Cyber Eclipse',
    cardDesign: 'obsidian',
    bgTop: '#05080e',
    bgMid: '#0a111d',
    bgBottom: '#111c2d',
    railDark: '#161f2b',
    railLight: '#2b3b4e',
    railTrim: '#38bdf8',
    feltCenter: '#193d5a',
    feltMid: '#10293e',
    feltEdge: '#071422',
    cardFrame: '#141c29',
    cardFrameOutline: '#3a4d66',
    cardCenterBg: '#0c121b',
    cardBackBg: '#0c121c',
    cardBackMedallion: '#0284c7',
    cardBackMedallionShadow: '#073659',
    cardBackBorder: '#7dd3fc',
    suitHex: {
      Red: '#ff4766',
      Blue: '#0ea5e9',
      Green: '#10b981',
      Yellow: '#f59e0b',
      Wild: '#1e293b',
    },
    accent: '#38bdf8',
    surface: '#0e1723',
    surfaceBorder: '#273c52',
  },
  sakura: {
    id: 'sakura',
    label: 'Kyoto Dusk',
    cardDesign: 'crest',
    bgTop: '#0d0914',
    bgMid: '#171024',
    bgBottom: '#221633',
    railDark: '#1e1120',
    railLight: '#3c213f',
    railTrim: '#ff8ab0',
    feltCenter: '#3d2254',
    feltMid: '#2a163b',
    feltEdge: '#170b22',
    cardFrame: '#fdf4f7',
    cardFrameOutline: '#f2b8cb',
    cardCenterBg: '#fffafc',
    cardBackBg: '#1c1229',
    cardBackMedallion: '#e6507d',
    cardBackMedallionShadow: '#6b1834',
    cardBackBorder: '#ffb8ce',
    suitHex: {
      Red: '#f43f6e',
      Blue: '#4f7cff',
      Green: '#1ec89a',
      Yellow: '#f5a623',
      Wild: '#2a1c3d',
    },
    accent: '#ff8ab0',
    surface: '#191224',
    surfaceBorder: '#3e2954',
  },
  pharaoh: {
    id: 'pharaoh',
    label: "Pharaoh's Vault",
    cardDesign: 'sunburst',
    bgTop: '#0a0906',
    bgMid: '#14120c',
    bgBottom: '#1c1810',
    railDark: '#2b200a',
    railLight: '#5c4616',
    railTrim: '#f5c242',
    feltCenter: '#1b3e4b',
    feltMid: '#112a34',
    feltEdge: '#08181f',
    cardFrame: '#16130d',
    cardFrameOutline: '#d4a63a',
    cardCenterBg: '#1d1911',
    cardBackBg: '#110f0a',
    cardBackMedallion: '#d49e2a',
    cardBackMedallionShadow: '#5e430b',
    cardBackBorder: '#fde08d',
    suitHex: {
      Red: '#e8483c',
      Blue: '#3b82f6',
      Green: '#14b8a6',
      Yellow: '#f5c242',
      Wild: '#241e12',
    },
    accent: '#f5c242',
    surface: '#17140d',
    surfaceBorder: '#47391a',
  },
  aurora: {
    id: 'aurora',
    label: 'Nordic Aurora',
    cardDesign: 'prism',
    bgTop: '#040c10',
    bgMid: '#08171e',
    bgBottom: '#0d222c',
    railDark: '#102129',
    railLight: '#1e3c4a',
    railTrim: '#2ee6a6',
    feltCenter: '#14525c',
    feltMid: '#0d3942',
    feltEdge: '#062026',
    cardFrame: '#eef8fc',
    cardFrameOutline: '#8be8d5',
    cardCenterBg: '#f6fcff',
    cardBackBg: '#0a1c24',
    cardBackMedallion: '#18b88a',
    cardBackMedallionShadow: '#084c39',
    cardBackBorder: '#7ff5d0',
    suitHex: {
      Red: '#ec4899',
      Blue: '#0ea5e9',
      Green: '#10b981',
      Yellow: '#eab308',
      Wild: '#132834',
    },
    accent: '#2ee6a6',
    surface: '#0b1c24',
    surfaceBorder: '#1f4754',
  },
};

export const THEME_LIST: TableTheme[] = [
  TABLE_THEMES.emerald,
  TABLE_THEMES.burgundy,
  TABLE_THEMES.obsidian,
  TABLE_THEMES.sakura,
  TABLE_THEMES.pharaoh,
  TABLE_THEMES.aurora,
];
