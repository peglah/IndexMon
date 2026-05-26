import { normalize } from '../src/utils/normalize';

describe('normalize()', () => {
  it('should lowercase the name', () => {
    expect(normalize('TorrentLeech')).toBe('torrentleech');
  });

  it('should strip (API) suffix', () => {
    expect(normalize('TorrentLeech (API)')).toBe('torrentleech');
    expect(normalize(' MTV (API) ')).toBe('mtv');
  });

  it('should strip spaces, hyphens, underscores', () => {
    expect(normalize('My Indexer')).toBe('myindexer');
    expect(normalize('my-indexer')).toBe('myindexer');
    expect(normalize('my_indexer')).toBe('myindexer');
    expect(normalize('a - b_c')).toBe('abc');
  });

  it('should strip leading hash', () => {
    expect(normalize('#announce')).toBe('announce');
  });

  it('should handle empty or whitespace input', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   ')).toBe('');
  });

  it('should handle already-normalized names', () => {
    expect(normalize('torrentleech')).toBe('torrentleech');
  });

  it('should handle complex real-world names', () => {
    expect(normalize('HD-Space (API)')).toBe('hdspace');
    expect(normalize('MoreThanTV (API)')).toBe('morethantv');
    expect(normalize(' TorrentDay (API) ')).toBe('torrentday');
  });
});
