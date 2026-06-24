import { describe, it, expect } from 'vitest';
import { expandExistingPostCreatives } from '../adCreativeHelpers';

const baseOpts = {
    ts: 1700000000000,
    previewById: { '123_456': { thumbnail: 'http://t/1.jpg' }, '789_012': { thumbnail: 'http://t/2.jpg' } },
    creativeName: 'My Ad',
    fallbackThumbnail: null,
};

describe('expandExistingPostCreatives', () => {
    it('1 id × 1 copy → 1 creative, no copy suffix', () => {
        const out = expandExistingPostCreatives(['123_456'], 1, baseOpts);
        expect(out).toHaveLength(1);
        expect(out[0].existing_post_id).toBe('123_456');
        expect(out[0].name).toBe('My Ad');
        expect(out[0].name).not.toMatch(/copy/);
    });

    it('1 id × 5 copies → 5 creatives with (copy N/5) suffix', () => {
        const out = expandExistingPostCreatives(['123_456'], 5, baseOpts);
        expect(out).toHaveLength(5);
        out.forEach((c, i) => {
            expect(c.existing_post_id).toBe('123_456');
            expect(c.name).toBe(`My Ad (copy ${i + 1}/5)`);
        });
    });

    it('3 ids × 4 copies → 12 creatives, grouped by source id in order', () => {
        const out = expandExistingPostCreatives(['a', 'b', 'c'], 4, {
            ...baseOpts, previewById: {},
        });
        expect(out).toHaveLength(12);
        // First 4 are id "a", next 4 "b", next 4 "c"
        expect(out.slice(0, 4).every(c => c.existing_post_id === 'a')).toBe(true);
        expect(out.slice(4, 8).every(c => c.existing_post_id === 'b')).toBe(true);
        expect(out.slice(8, 12).every(c => c.existing_post_id === 'c')).toBe(true);
        // Multi-ID naming includes "#N" + "(copy K/M)"
        expect(out[0].name).toBe('My Ad #1 (copy 1/4)');
        expect(out[7].name).toBe('My Ad #2 (copy 4/4)');
    });

    it('produces unique React keys across all expanded creatives', () => {
        const out = expandExistingPostCreatives(['a', 'b'], 10, baseOpts);
        const ids = out.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('clamps copies to [1, 25]', () => {
        expect(expandExistingPostCreatives(['a'], 0, baseOpts)).toHaveLength(1);
        expect(expandExistingPostCreatives(['a'], -5, baseOpts)).toHaveLength(1);
        expect(expandExistingPostCreatives(['a'], 100, baseOpts)).toHaveLength(25);
        expect(expandExistingPostCreatives(['a'], 'garbage', baseOpts)).toHaveLength(1);
        expect(expandExistingPostCreatives(['a'], null, baseOpts)).toHaveLength(1);
    });

    it('uses preview thumbnail when available, falls back otherwise', () => {
        const out = expandExistingPostCreatives(['123_456', 'unknown'], 1, {
            ...baseOpts, fallbackThumbnail: 'http://fallback.jpg',
        });
        expect(out[0].imageUrl).toBe('http://t/1.jpg');
        expect(out[1].imageUrl).toBe('http://fallback.jpg');
    });
});
