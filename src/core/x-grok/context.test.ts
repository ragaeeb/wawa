import { describe, expect, it } from 'bun:test';
import { captureXGrokGraphqlContext, isXGrokDetailUrl, isXGrokHistoryUrl } from '@/core/x-grok/context';

describe('x-grok context', () => {
    it('should detect x-grok detail urls', () => {
        expect(
            isXGrokDetailUrl(
                'https://x.com/i/api/graphql/n2bhau0B2DSY6R_bLolgSg/GrokConversationItemsByRestId?variables=%7B%7D',
            ),
        ).toBeTrue();
        expect(isXGrokDetailUrl('https://x.com/i/api/graphql/abc/UserTweets')).toBeFalse();
    });

    it('should detect x-grok history urls', () => {
        expect(
            isXGrokHistoryUrl('https://x.com/i/api/graphql/9Hyh5D4-WXLnExZkONSkZg/GrokHistory?variables=%7B%7D'),
        ).toBe(true);
        expect(isXGrokHistoryUrl('https://x.com/i/api/graphql/abc/UserTweets')).toBeFalse();
    });

    it('should capture detail query id, features, and field toggles', () => {
        const result = captureXGrokGraphqlContext(
            null,
            'https://x.com/i/api/graphql/n2bhau0B2DSY6R_bLolgSg/GrokConversationItemsByRestId?variables=%7B%22restId%22%3A%221%22%7D&features=%7B%22responsive_web_grok_annotations_enabled%22%3Atrue%7D&fieldToggles=%7B%22withGrok%22%3Atrue%7D',
            123,
        );

        expect(result).toEqual({
            detailQueryId: 'n2bhau0B2DSY6R_bLolgSg',
            detailFeatures: '{"responsive_web_grok_annotations_enabled":true}',
            detailFieldToggles: '{"withGrok":true}',
            updatedAt: 123,
        });
    });

    it('should capture history query id while preserving existing detail context', () => {
        const result = captureXGrokGraphqlContext(
            {
                detailQueryId: 'detail-id',
                detailFeatures: '{"a":true}',
                detailFieldToggles: '{"b":false}',
                updatedAt: 10,
            },
            'https://x.com/i/api/graphql/9Hyh5D4-WXLnExZkONSkZg/GrokHistory?variables=%7B%7D',
            456,
        );

        expect(result).toEqual({
            detailQueryId: 'detail-id',
            historyQueryId: '9Hyh5D4-WXLnExZkONSkZg',
            detailFeatures: '{"a":true}',
            detailFieldToggles: '{"b":false}',
            updatedAt: 456,
        });
    });

    it('should ignore unrelated urls', () => {
        const existing = {
            detailQueryId: 'detail-id',
            historyQueryId: 'history-id',
            detailFeatures: '{"a":true}',
            detailFieldToggles: '{"b":false}',
            updatedAt: 99,
        };
        expect(captureXGrokGraphqlContext(existing, 'https://x.com/i/api/graphql/abc/UserTweets', 777)).toEqual(
            existing,
        );
    });

    it('should preserve existing detail settings when query params are blank', () => {
        const result = captureXGrokGraphqlContext(
            {
                detailQueryId: 'detail-id',
                historyQueryId: 'history-id',
                detailFeatures: '{"a":true}',
                detailFieldToggles: '{"b":false}',
                updatedAt: 10,
            },
            'https://x.com/i/api/graphql/new-detail/GrokConversationItemsByRestId?features=&field_toggles=',
            888,
        );

        expect(result).toEqual({
            detailQueryId: 'new-detail',
            historyQueryId: 'history-id',
            detailFeatures: '{"a":true}',
            detailFieldToggles: '{"b":false}',
            updatedAt: 888,
        });
    });

    it('should return existing context when the url cannot be parsed', () => {
        const existing = {
            detailQueryId: 'detail-id',
            updatedAt: 99,
        };

        expect(isXGrokDetailUrl('http://[::1')).toBeFalse();
        expect(isXGrokHistoryUrl('http://[::1')).toBeFalse();
        expect(captureXGrokGraphqlContext(existing, 'http://[::1', 777)).toEqual(existing);
    });
});
