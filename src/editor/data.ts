import type { Album, EditState, Photo, Preset } from './types';

export const DEFAULT_EDIT: EditState = {
  temperature: 5500, tint: 0, exposure: 0, brightness: 0, contrast: 0,
  highlights: 0, shadows: 0, blacks: 0, saturation: 0, vibrance: 0,
  hue: 0, clarity: 0, sharpness: 0, grain: 0, vignette: 0, fade: 0, curve: 0,
  whiteBalanceEnabled: true, lightnessEnabled: true, colorEnabled: true,
  detailsEnabled: true, blackAndWhite: false, rotation: 0,
  flipH: false, flipV: false, straighten: 0, cropRatio: 'Original',
  retouches: [], preset: 'Original', autoEnhanced: false,
};

export const INITIAL_EDIT: EditState = {
  ...DEFAULT_EDIT,
  temperature: 5800, tint: 6, exposure: 0.15, contrast: 12,
  highlights: -28, shadows: 24, blacks: -8, saturation: 8, vibrance: 16,
  preset: 'Natural',
};

const imageUrl = (id: number, thumbnail = false) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&${thumbnail ? 'dpr=1&fit=crop&h=200&w=280' : 'fit=crop&h=627&w=1200'}`;

const sample = (
  id: number, image: number, title: string, photographer: string,
  albumId = 'dolomites', favorite = false,
): Photo => ({
  id: `photo-${id}`,
  name: `DSC_${String(1042 + id - 1).padStart(4, '0')}.${id < 11 ? 'ARW' : 'JPG'}`,
  title,
  src: imageUrl(image),
  thumbnail: imageUrl(image, true),
  albumId,
  location: albumId === 'dolomites' ? 'South Tyrol, Italy' : albumId === 'coast' ? 'Italian Riviera, Italy' : 'Black Forest, Germany',
  date: `2024-09-${String(18 + Math.floor((id - 1) / 3)).padStart(2, '0')}T07:${String(18 + id * 2).padStart(2, '0')}:00`,
  width: 6000, height: 4000,
  camera: 'Sony Alpha 7 IV', lens: 'FE 24-70mm F2.8 GM II',
  iso: id % 3 === 0 ? 200 : 100,
  aperture: 'f/8', shutter: '1/250 s', focalLength: '24 mm',
  raw: id < 11, favorite, rating: favorite ? 5 : 0, photographer,
});

export const SAMPLE_PHOTOS: Photo[] = [
  sample(1, 30201174, 'A quiet morning at Lago di Braies', 'Matej Bizjak', 'dolomites', true),
  sample(2, 3996433, 'The stillness of the mountains', 'Chavdar Lungov'),
  sample(3, 5215878, 'Boathouse at first light', 'Antonie de Kok'),
  sample(4, 35277098, 'Tre Cime in autumn', 'Ron Santini', 'dolomites', true),
  sample(5, 5215886, 'Emerald reflections', 'Antonie de Kok'),
  sample(6, 27034992, 'Clouds over the Dolomites', 'Ash Haghighi'),
  sample(7, 34328600, 'An alpine kind of autumn', 'Oskar Gross'),
  sample(8, 28217989, 'Just before the world wakes up', 'eberhard grossgasteiger'),
  sample(9, 6749324, 'Along the Sardinian coast', 'Riccardo Pitzalis', 'coast'),
  sample(10, 4317343, 'The last light in Tellaro', 'Paolo Razzauti', 'coast', true),
  sample(11, 39039994, 'A little closer to nature', 'Ruveyda Uzun', 'everyday'),
  sample(12, 35142333, 'Taking the long way home', 'Yasin Onus', 'everyday'),
];

export const SAMPLE_ALBUMS: Album[] = [
  { id: 'dolomites', name: 'Dolomites 2024', cover: imageUrl(30201174, true) },
  { id: 'coast', name: 'Coastal Escape', cover: imageUrl(6749324, true) },
  { id: 'everyday', name: 'Everyday', cover: imageUrl(35142333, true) },
];

export const PRESETS: Preset[] = [
  { id: 'original', name: 'Original', category: 'Landscape', values: {} },
  { id: 'natural', name: 'Natural', category: 'Landscape', values: INITIAL_EDIT },
  { id: 'vivid', name: 'Vivid', category: 'Landscape', values: { saturation: 30, vibrance: 28, contrast: 16, exposure: 0.05 } },
  { id: 'golden', name: 'Golden Hour', category: 'Landscape', values: { temperature: 8800, tint: 8, saturation: 15, contrast: 8, exposure: 0.12 } },
  { id: 'cool', name: 'Cool', category: 'Landscape', values: { temperature: 3000, tint: -4, saturation: -10, contrast: 10 } },
  { id: 'dramatic', name: 'Dramatic', category: 'Landscape', values: { contrast: 38, exposure: -0.12, saturation: -12, clarity: 22, vignette: 30 } },
  { id: 'soft', name: 'Soft Light', category: 'Landscape', values: { contrast: -16, exposure: 0.18, temperature: 6300, fade: 14, saturation: -8 } },
  { id: 'noir', name: 'Noir', category: 'Landscape', values: { blackAndWhite: true, contrast: 28, exposure: 0.1, vignette: 20 } },
  { id: 'teal', name: 'Teal & Orange', category: 'Cinematic', values: { temperature: 6800, tint: -15, hue: -8, contrast: 26, saturation: 12 } },
  { id: 'film', name: '35mm', category: 'Cinematic', values: { temperature: 7000, contrast: 14, saturation: -18, grain: 24, fade: 12 } },
  { id: 'faded', name: 'Faded Film', category: 'Cinematic', values: { fade: 35, temperature: 6400, contrast: -8, saturation: -26, grain: 12 } },
  { id: 'silver', name: 'Silver', category: 'Black & White', values: { blackAndWhite: true, contrast: 12, exposure: 0.1 } },
  { id: 'classic', name: 'Classic', category: 'Black & White', values: { blackAndWhite: true, contrast: 35, grain: 15, vignette: 24 } },
  { id: 'matte', name: 'Matte', category: 'Black & White', values: { blackAndWhite: true, fade: 32, contrast: -6 } },
];

export const CROP_RATIOS: Record<string, number | null> = {
  Original: null, '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '4:5': 4 / 5, '9:16': 9 / 16,
};