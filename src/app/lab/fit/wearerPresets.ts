// The house-head reference the catalog was fitted on, and the wearer presets the lab pages
// explain against (measured with lib/splatFit on real buzz-cut bases, 2026-11-04/05).

import catalog from '@/data/prebakeCatalog.json';
import { catalogFitFor, type CatalogFit } from '@/data/hairPresets';

export const CUT_ID = 'm-sidefringe';
export const HEAD_URL = '/lab/house_male_buzz.splat';
export const HAIR_URL = '/lab/sidefringe_darkbrown.splat';

export interface Wearer { crown: number; hairline: number; widthX: number; depthY: number; centerX: number }

// hairPresets reads anchor/crown/hairline/width/depth into catalogFitFor(); centerX is informational
// there, so it is read from the JSON here.
export const HOUSE_FIT: CatalogFit = catalogFitFor(CUT_ID)!;
export const HOUSE_CENTER_X: number = catalog.fit.centerX.men;
export const HOUSE_WEARER: Wearer = {
  crown: HOUSE_FIT.crownZ, hairline: HOUSE_FIT.hairlineZ ?? 0, widthX: HOUSE_FIT.widthX ?? 0, depthY: HOUSE_FIT.depthY ?? 0, centerX: HOUSE_CENTER_X,
};
export const PRESETS: Array<{ id: string; label: string; w: Wearer }> = [
  { id: 'house', label: 'house head (identity)', w: HOUSE_WEARER },
  { id: 'ethan', label: 'Ethan', w: { crown: 0.569, hairline: 0.357, widthX: 0.762, depthY: 0.854, centerX: -0.011 } },
  { id: 'jerald', label: 'Jerald', w: { crown: 0.590, hairline: 0.351, widthX: 0.792, depthY: 0.894, centerX: -0.017 } },
  { id: 'her', label: 'her', w: { crown: 0.622, hairline: 0.344, widthX: 0.767, depthY: 0.878, centerX: -0.010 } },
];
