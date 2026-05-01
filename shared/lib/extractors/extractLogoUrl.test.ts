import { describe, expect, it } from 'vitest';

import { extractLogoUrl } from './index';

describe('extractLogoUrl', () => {
  it('reads KSA.directory-style .logo img src as absolute URL', () => {
    const html = `
      <body><div class="logo"><a href="https://www.ksa.directory/">
        <img src="/site/img/logo.svg" width="100" alt="KSA Directory" />
      </a></div></body>`;
    const r = extractLogoUrl(html, 'https://www.ksa.directory/category/foo');
    expect(r.value).toBe('https://www.ksa.directory/site/img/logo.svg');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
