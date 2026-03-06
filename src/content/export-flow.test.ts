import { afterEach, describe, expect, it, mock } from 'bun:test';
import { extractSearchUser, resolveSearchQueryForProfile } from '@/content/export-flow';

const RealDate = Date;

const freezeDate = (iso: string) => {
    const frozen = new RealDate(iso);

    class FakeDate extends RealDate {
        constructor(value?: string | number | Date) {
            if (value === undefined) {
                super(frozen);
                return;
            }

            super(value);
        }

        static override now() {
            return frozen.getTime();
        }
    }

    globalThis.Date = FakeDate as typeof Date;
};

afterEach(() => {
    globalThis.Date = RealDate;
});

describe('resolveSearchQueryForProfile', () => {
    it('should add stable since and until bounds for profile search queries', async () => {
        freezeDate('2026-01-31T12:00:00.000Z');

        const query = await resolveSearchQueryForProfile({
            username: 'tester',
            getCsrfToken: () => 'csrf-token',
            getUserByScreenName: async () => ({
                id: 'user-1',
                legacy: {
                    created_at: '2020-01-15T08:00:00.000Z',
                },
            }),
            loggers: {
                logInfo: mock(() => {}),
                logWarn: mock(() => {}),
            },
        });

        expect(query).toBe('from:tester since:2020-01-15 until:2026-03-04');
    });

    it('should keep the base query when csrf is unavailable', async () => {
        const query = await resolveSearchQueryForProfile({
            username: 'tester',
            getCsrfToken: () => null,
            getUserByScreenName: async () => {
                throw new Error('should not run');
            },
            loggers: {
                logInfo: mock(() => {}),
                logWarn: mock(() => {}),
            },
        });

        expect(query).toBe('from:tester');
    });
});

describe('extractSearchUser', () => {
    it('should extract the from: username from a search query', () => {
        expect(extractSearchUser('from:Test_User since:2020-01-01', 'fallback')).toBe('Test_User');
    });

    it('should fall back to the route username when query is missing', () => {
        expect(extractSearchUser(null, 'fallback')).toBe('fallback');
    });
});
