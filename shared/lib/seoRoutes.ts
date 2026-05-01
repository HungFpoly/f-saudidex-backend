export type SupportedLanguage = 'en' | 'ar';

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';
export const MIN_PUBLIC_COMPANY_ID = 100001;

export const isSupportedLanguage = (value: string | null | undefined): value is SupportedLanguage =>
  value === 'en' || value === 'ar';

export const resolveRouteLanguage = (
  lang: string | null | undefined,
  fallback: string | null | undefined = DEFAULT_LANGUAGE,
): SupportedLanguage => {
  if (isSupportedLanguage(lang)) return lang;
  if (isSupportedLanguage(fallback)) return fallback;
  return DEFAULT_LANGUAGE;
};

export const getLanguageFromPathname = (
  pathname: string,
  fallback: string | null | undefined = DEFAULT_LANGUAGE,
): SupportedLanguage => {
  const match = pathname.match(/^\/(en|ar)(\/|$)/);
  return resolveRouteLanguage(match?.[1], fallback);
};

export const localizedRoute = (
  lang: string | null | undefined,
  path: string,
): string => {
  const routeLang = resolveRouteLanguage(lang);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `/${routeLang}${normalizedPath}`;
};

export const isPublicCompanyId = (value: string | null | undefined): value is string => {
  if (!value || !/^\d+$/.test(value)) {
    return false;
  }

  return Number(value) >= MIN_PUBLIC_COMPANY_ID;
};

export const buildCompanyPath = (
  id: string,
  slug: string,
  lang?: string | null,
): string => localizedRoute(lang, `/company/${id}/${slug}`);

export const buildCategoryPath = (slug: string, lang?: string | null): string =>
  localizedRoute(lang, `/category/${slug}`);

export const buildSearchPath = (lang?: string | null, query?: string): string => {
  const path = localizedRoute(lang, '/search');
  return query ? `${path}?${query}` : path;
};

export const buildLocationPath = (citySlug: string): string => `/location/${citySlug}`;

export const buildLocalizedPathForToggle = (
  pathname: string,
  nextLang: SupportedLanguage,
): string => {
  if (!pathname || pathname === '/') {
    return `/${nextLang}`;
  }

  const prefixedPath = pathname.match(/^\/(en|ar)(\/.*)?$/);
  if (prefixedPath) {
    return `/${nextLang}${prefixedPath[2] || ''}`;
  }

  const prefixableRoots = [
    '/search',
    '/category/',
    '/company/',
    '/region/',
    '/tags/',
    '/submit',
    '/privacy',
    '/admin',
    '/research',
    '/categories',
    '/regions',
  ];

  if (prefixableRoots.some((root) => pathname === root || pathname.startsWith(root))) {
    return `/${nextLang}${pathname}`;
  }

  return pathname;
};
