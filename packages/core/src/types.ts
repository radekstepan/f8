export interface Photo {
  id: string;
  name: string;
  title: string;
  src: string;
  thumbnail: string;
  albumId: string;
  location: string;
  date: string;
  width: number;
  height: number;
  camera: string;
  lens: string;
  iso: number;
  aperture: string;
  shutter: string;
  focalLength: string;
  raw: boolean;
  favorite: boolean;
  rating: number;
  photographer?: string;
  /** Server library only: the referenced original is unreachable at its recorded path. */
  missing?: boolean;
  /** Server library only: a non-default edit recipe is stored for this photo. */
  edited?: boolean;
  /** Server library only: ISO timestamp of the last saved non-default edit. Null/absent when unedited. */
  editedAt?: string | null;
  /** Server library only: absolute path of a referenced original, when it has one. */
  path?: string | null;
  /** Server library only: ISO timestamp of the import (`created_at`). Absent on demo/legacy records. */
  importedAt?: string | null;
}

export interface Album {
  id: string;
  name: string;
  cover: string;
}

export type Tool = 'adjust' | 'crop' | 'repair';
export type ViewMode = 'editor' | 'library';
export type DialogType = 'export' | 'info' | 'shortcuts' | 'about' | 'album' | 'preset' | 'remove' | 'remove-album' | null;

/** Scenes the ML subject-aware enhance classifier distinguishes. */
export type SceneLabel = 'portrait' | 'landscape' | 'night' | 'document';

/** The scene an ML enhance was applied with, plus classifier confidence 0..1. */
export interface SceneEnhanceResult {
  scene: SceneLabel;
  confidence: number;
}

/** Normalized box in 0..1 image coordinates (x0 <= x1, y0 <= y1). */
export interface FaceBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Normalized point in 0..1 image coordinates. */
export interface FacePoint {
  x: number;
  y: number;
}

/** One red-eye fix: normalized center + x-normalized radius. */
export interface RedEyeSpot {
  x: number;
  y: number;
  radius: number;
}

/** Which detector served the faces: neural weights or the classical fallback. */
export type FaceDetectSource = 'onnx' | 'classic';

/** Which segmenter served the subject mask: neural weights or the classical fallback. */
export type SelectiveMaskSource = 'onnx' | 'classic';

/** Which side of the subject mask the masked adjustments apply to. */
export type SelectiveTarget = 'subject' | 'background';

/**
 * ML selective (masked) adjustments: a soft subject mask plus masked
 * exposure/contrast/saturation over the subject or the background.
 * Null/absent when no selective adjust is applied.
 */
export interface SelectiveAdjustState {
  /** Base64 8-bit subject mask (1 = subject), resampled at render. */
  maskB64: string;
  maskWidth: number;
  maskHeight: number;
  target: SelectiveTarget;
  /** Masked exposure in EV (-3..3), same response as the global slider. */
  exposure: number;
  /** Masked contrast (-100..100), same pivot as the global slider. */
  contrast: number;
  /** Masked saturation (-100..100), same chroma scale as the global slider. */
  saturation: number;
  /** Which segmenter found the subject (drives the UI's ML badge). */
  source: SelectiveMaskSource;
}

/**
 * ML face-aware exposure state: softly masked lift ellipses over detected
 * faces plus red-eye fix discs. Null/absent when no face enhance is applied.
 */
export interface FaceAdjustState {
  /** One lift ellipse per face (normalized boxes). */
  boxes: FaceBox[];
  /** Exposure lift in EV applied inside the face ellipses (0..1). */
  amount: number;
  /** Red-eye fix discs (normalized). */
  redEye: RedEyeSpot[];
  /** Which detector found the faces (drives the UI's ML badge). */
  source: FaceDetectSource;
}

export interface RetouchPoint {
  x: number;
  y: number;
  size: number;
  strength: number;
  kind: 'repair';
  /** Paint stroke id: every stamp in one drag shares it. Absent on legacy edits. */
  stroke?: number;
}

export interface EditState {
  temperature: number;
  tint: number;
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  blacks: number;
  saturation: number;
  vibrance: number;
  hue: number;
  clarity: number;
  sharpness: number;
  grain: number;
  vignette: number;
  fade: number;
  curve: number;
  whiteBalanceEnabled: boolean;
  lightnessEnabled: boolean;
  colorEnabled: boolean;
  detailsEnabled: boolean;
  blackAndWhite: boolean;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  straighten: number;
  cropRatio: string;
  retouches: RetouchPoint[];
  preset: string;
  autoEnhanced: boolean;
  /**
   * Set when ML scene enhance applied this recipe (the detected scene +
   * confidence for the UI badge). Null/absent for classic enhances and
   * legacy server recipes. Shown only while autoEnhanced is true.
   */
  sceneEnhance?: SceneEnhanceResult | null;
  /**
   * Set when ML face enhance applied masked exposure lift and/or red-eye
   * fixes. Null/absent otherwise (including legacy server recipes). The
   * skin-anchored white balance rides the plain temperature/tint sliders.
   */
  faceAdjust?: FaceAdjustState | null;
  /**
   * Set when ML selective segmentation applied masked adjustments to the
   * subject or background. Null/absent otherwise (including legacy server
   * recipes).
   */
  selectiveAdjust?: SelectiveAdjustState | null;
}

export type NumericAdjustment = {
  // -? keeps optional EditState fields (e.g. sceneEnhance) from leaking
  // `undefined` into the indexed union via preserved optionality.
  [K in keyof EditState]-?: EditState[K] extends number ? K : never;
}[keyof EditState];

export interface Preset {
  id: string;
  name: string;
  category: 'Essentials' | 'Cinematic' | 'Black & White' | 'My Presets';
  values: Partial<EditState>;
}

export interface HistoryState {
  past: EditState[];
  present: EditState;
  future: EditState[];
}

export type ChangeEdit = (patch: Partial<EditState>, mergeKey?: string) => void;