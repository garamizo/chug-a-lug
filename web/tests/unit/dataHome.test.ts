import { describe, expect, it } from 'vitest';
import { dataHome } from '../../src/lib/server/dataHome';

describe('dataHome', () => {
  it('lives in ~/.chug-a-lug, outside every checkout, by default', () => {
    expect(dataHome({}, '/home/crew')).toBe('/home/crew/.chug-a-lug');
  });
  it('follows CHUG_DATA', () => {
    expect(dataHome({ CHUG_DATA: '/srv/chug' }, '/home/crew')).toBe('/srv/chug');
  });
  it('expands a leading ~ the way a shell would, since .env values are not expanded', () => {
    expect(dataHome({ CHUG_DATA: '~/chug' }, '/home/crew')).toBe('/home/crew/chug');
  });
  it('lets DATA_DIR win: the container and the tests set it', () => {
    expect(dataHome({ DATA_DIR: '/data', CHUG_DATA: '/srv/chug' }, '/home/crew')).toBe('/data');
  });
});
