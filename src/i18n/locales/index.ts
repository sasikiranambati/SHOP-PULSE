import type { LanguageCode } from '../languages';
import type { Translations } from './en';
import { en } from './en';
import { te } from './te';
import { hi } from './hi';
import { ta } from './ta';
import { kn } from './kn';
import { ml } from './ml';
import { mr } from './mr';
import { bn } from './bn';
import { gu } from './gu';
import { pa } from './pa';
import { or } from './or';
import { as } from './as';
import { ur } from './ur';

export const translationsMap: Record<LanguageCode, Translations> = {
  en,
  te,
  hi,
  ta,
  kn,
  ml,
  mr,
  bn,
  gu,
  pa,
  or,
  as,
  ur,
};
