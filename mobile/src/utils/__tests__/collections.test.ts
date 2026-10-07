import { chunk, uniqueById } from '@/utils/collections';

describe('collections', () => {
  it('chunks into groups of at most `size`, with no empty groups', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it('de-duplicates by id, keeping the first copy', () => {
    expect(uniqueById([{ id: 1, v: 'a' }, { id: 1, v: 'b' }, { id: 2, v: 'c' }])).toEqual([
      { id: 1, v: 'a' },
      { id: 2, v: 'c' },
    ]);
  });
});
