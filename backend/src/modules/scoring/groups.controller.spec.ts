import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { GroupsController } from './groups.controller.js';
import {
  GroupStandingsService,
  type GroupStanding,
} from './group-standings.service.js';

/**
 * Pure unit tests for `GroupsController`. We mock `GroupStandingsService`
 * and provide an in-memory `CACHE_MANAGER` stub so we can assert both
 * the response shape (12 group keys A..L) and the 60s cache behaviour
 * (second call within TTL must NOT hit the service).
 */

function buildStanding(teamId: string, position: number): GroupStanding {
  return {
    teamId,
    teamName: teamId.toUpperCase(),
    teamShortName: teamId.slice(0, 3).toUpperCase(),
    teamFlagUrl: `https://example.com/${teamId}.png`,
    pj: 0,
    pg: 0,
    pe: 0,
    pp: 0,
    gf: 0,
    gc: 0,
    dg: 0,
    pts: 0,
    position,
  };
}

const GROUP_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

function buildAllGroupStandings(): Record<string, GroupStanding[]> {
  const out: Record<string, GroupStanding[]> = {};
  for (const code of GROUP_CODES) {
    out[code] = [
      buildStanding(`${code.toLowerCase()}-1`, 1),
      buildStanding(`${code.toLowerCase()}-2`, 2),
      buildStanding(`${code.toLowerCase()}-3`, 3),
      buildStanding(`${code.toLowerCase()}-4`, 4),
    ];
  }
  return out;
}

interface CacheStub {
  store: Map<string, unknown>;
  get: ReturnType<typeof jest.fn>;
  set: ReturnType<typeof jest.fn>;
  del: ReturnType<typeof jest.fn>;
}

function buildCacheStub(): CacheStub {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

async function makeController(
  serviceStub: { getAllGroupStandings: ReturnType<typeof jest.fn> },
  cacheStub: CacheStub,
): Promise<GroupsController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [GroupsController],
    providers: [
      { provide: GroupStandingsService, useValue: serviceStub },
      { provide: CACHE_MANAGER, useValue: cacheStub },
    ],
  }).compile();
  return moduleRef.get(GroupsController);
}

describe('GroupsController', () => {
  describe('GET /groups/standings', () => {
    it('returns 12 group keys (A..L) each with computed standings', async () => {
      const fresh = buildAllGroupStandings();
      const service = {
        getAllGroupStandings: jest.fn<() => Promise<Record<string, GroupStanding[]>>>(
          async () => fresh,
        ),
      };
      const cache = buildCacheStub();
      const controller = await makeController(service, cache);

      const res = await controller.standings();

      expect(Object.keys(res).sort()).toEqual(GROUP_CODES);
      for (const code of GROUP_CODES) {
        expect(res[code]).toHaveLength(4);
      }
      expect(service.getAllGroupStandings).toHaveBeenCalledTimes(1);
    });

    it('serves second request from cache within TTL (service called once)', async () => {
      const fresh = buildAllGroupStandings();
      const service = {
        getAllGroupStandings: jest.fn<() => Promise<Record<string, GroupStanding[]>>>(
          async () => fresh,
        ),
      };
      const cache = buildCacheStub();
      const controller = await makeController(service, cache);

      const first = await controller.standings();
      const second = await controller.standings();

      // Two HTTP requests → one underlying service call thanks to the
      // cache hit on the second invocation.
      expect(service.getAllGroupStandings).toHaveBeenCalledTimes(1);
      expect(first).toEqual(second);
      // The set happened on first miss; both gets ran.
      expect(cache.set).toHaveBeenCalledTimes(1);
      expect(cache.get).toHaveBeenCalledTimes(2);
    });
  });
});
