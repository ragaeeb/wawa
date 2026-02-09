import { bootstrapContentScript } from '../src/content/index';

export default defineContentScript({
    matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
    runAt: 'document_idle',
    async main() {
        await bootstrapContentScript();
    },
});
