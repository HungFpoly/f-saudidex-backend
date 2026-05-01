import { describe, expect, it } from 'vitest';

import './index';
import { parserRegistry } from './DirectoryParserAdapter';

describe('adapter ordering', () => {
  it('prefers GenericDirectoryParser over UniversalAIParser for arbitrary URLs', async () => {
    const adapter = await parserRegistry.getAdapter('https://example.com/directory/vendors');

    expect(adapter?.id).toBe('generic-directory');
  });
});
