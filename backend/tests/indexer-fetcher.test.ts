import { isChannelUp, buildAutobrrMap, breakerIsOpen, breakerOnSuccess, breakerOnFailure } from '../src/services/indexer-fetcher';
import { AutobrrStatus } from '../src/services/indexer-types';

describe('indexer-fetcher', () => {
  describe('isChannelUp', () => {
    it('returns true when connected and monitoring', () => {
      const status: AutobrrStatus = {
        enabled: true,
        connected: true,
        monitoring: true,
        lastAnnounce: null,
      };
      expect(isChannelUp(status)).toBe(true);
    });

    it('returns false when not connected', () => {
      const status: AutobrrStatus = {
        enabled: true,
        connected: false,
        monitoring: true,
        lastAnnounce: null,
      };
      expect(isChannelUp(status)).toBe(false);
    });

    it('returns false when not monitoring', () => {
      const status: AutobrrStatus = {
        enabled: true,
        connected: true,
        monitoring: false,
        lastAnnounce: null,
      };
      expect(isChannelUp(status)).toBe(false);
    });

    it('returns false when both are false', () => {
      const status: AutobrrStatus = {
        enabled: true,
        connected: false,
        monitoring: false,
        lastAnnounce: null,
      };
      expect(isChannelUp(status)).toBe(false);
    });

    it('ignores enabled field', () => {
      const status: AutobrrStatus = {
        enabled: false,
        connected: true,
        monitoring: true,
        lastAnnounce: null,
      };
      expect(isChannelUp(status)).toBe(true);
    });
  });

  describe('buildAutobrrMap', () => {
    it('builds map from networks with channels', () => {
      const networks = [
        {
          id: 1,
          name: 'Test Network',
          enabled: true,
          connected: true,
          channels: [
            {
              id: 1,
              name: 'announce',
              enabled: true,
              monitoring: true,
              detached: false,
              last_announce: '',
            },
          ],
        },
      ];

      const map = buildAutobrrMap(networks);
      expect(map.size).toBe(1);
      expect(map.has('testnetwork')).toBe(true);
    });

    it('normalizes channel names', () => {
      const networks = [
        {
          id: 1,
          name: 'Network',
          enabled: true,
          connected: true,
          channels: [
            {
              id: 1,
              name: '#Test-Indexer',
              enabled: true,
              monitoring: true,
              detached: false,
              last_announce: '',
            },
          ],
        },
      ];

      const map = buildAutobrrMap(networks);
      expect(map.has('testindexer')).toBe(true);
    });

    it('applies CHANNEL_ALIASES', () => {
      const networks = [
        {
          id: 1,
          name: 'Network',
          enabled: true,
          connected: true,
          channels: [
            {
              id: 1,
              name: '#mtv',
              enabled: true,
              monitoring: true,
              detached: false,
              last_announce: '',
            },
          ],
        },
      ];

      const map = buildAutobrrMap(networks);
      expect(map.has('morethantv')).toBe(true);
    });

    it('prefers up channel when duplicates exist', () => {
      const networks = [
        {
          id: 1,
          name: 'Network',
          enabled: true,
          connected: true,
          channels: [
            {
              id: 1,
              name: 'announce',
              enabled: true,
              monitoring: false,
              detached: false,
              last_announce: '',
            },
            {
              id: 2,
              name: 'announce',
              enabled: true,
              monitoring: true,
              detached: false,
              last_announce: '',
            },
          ],
        },
      ];

      const map = buildAutobrrMap(networks);
      const status = map.get('network');
      expect(status?.monitoring).toBe(true);
    });

    it('handles networks with no channels', () => {
      const networks = [
        {
          id: 1,
          name: 'Network',
          enabled: true,
          connected: true,
          channels: [],
        },
      ];

      const map = buildAutobrrMap(networks);
      expect(map.size).toBe(0);
    });

    it('sets lastAnnounce to null for zero date', () => {
      const networks = [
        {
          id: 1,
          name: 'Network',
          enabled: true,
          connected: true,
          channels: [
            {
              id: 1,
              name: 'announce',
              enabled: true,
              monitoring: true,
              detached: false,
              last_announce: '0001-01-01T00:00:00Z',
            },
          ],
        },
      ];

      const map = buildAutobrrMap(networks);
      const status = map.get('network');
      expect(status?.lastAnnounce).toBeNull();
    });
  });

  describe('circuit breaker', () => {
    beforeEach(() => {
      breakerOnSuccess('prowlarr');
      breakerOnSuccess('autobrr');
    });

    it('starts closed', () => {
      expect(breakerIsOpen('prowlarr')).toBe(false);
      expect(breakerIsOpen('autobrr')).toBe(false);
    });

    it('opens after 3 failures', () => {
      breakerOnFailure('prowlarr');
      expect(breakerIsOpen('prowlarr')).toBe(false);

      breakerOnFailure('prowlarr');
      expect(breakerIsOpen('prowlarr')).toBe(false);

      breakerOnFailure('prowlarr');
      expect(breakerIsOpen('prowlarr')).toBe(true);
    });

    it('closes on success', () => {
      breakerOnFailure('prowlarr');
      breakerOnFailure('prowlarr');
      breakerOnFailure('prowlarr');
      expect(breakerIsOpen('prowlarr')).toBe(true);

      breakerOnSuccess('prowlarr');
      expect(breakerIsOpen('prowlarr')).toBe(false);
    });

    it('tracks prowlarr and autobrr independently', () => {
      breakerOnFailure('prowlarr');
      breakerOnFailure('prowlarr');
      breakerOnFailure('prowlarr');

      expect(breakerIsOpen('prowlarr')).toBe(true);
      expect(breakerIsOpen('autobrr')).toBe(false);
    });
  });
});
