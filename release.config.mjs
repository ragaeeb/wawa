export default {
    branches: ['main'],
    plugins: [
        ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits', presetConfig: {} }],
        ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits', presetConfig: {} }],
        [
            '@semantic-release/exec',
            {
                prepareCmd:
                    // biome-ignore lint/suspicious/noTemplateCurlyInString: Needed for semantic release
                    "rm -f dist/*.zip && node -e \"const fs=require('node:fs');const path=require('node:path');const pkgPath=path.resolve('package.json');const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));pkg.version='${nextRelease.version}';fs.writeFileSync(pkgPath, JSON.stringify(pkg,null,4)+'\\\\n');\" && bun run build && bun run zip",
            },
        ],
        [
            '@semantic-release/github',
            {
                assets: [
                    {
                        path: 'dist/wawa-minimal-*.zip',
                        // biome-ignore lint/suspicious/noTemplateCurlyInString: Needed for semantic release
                        name: 'wawa-minimal-${nextRelease.version}-chrome.zip',
                        label: 'Chrome extension build',
                    },
                ],
            },
        ],
    ],
};
