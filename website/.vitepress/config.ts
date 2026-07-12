import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'fordb',
  description: 'A lean, keyboard-first, open-source desktop database client.',
  base: '/fordb/',
  head: [['link', { rel: 'icon', href: '/fordb/icon.png' }]],
  themeConfig: {
    logo: '/icon.png',
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Reference', link: '/reference/engines' },
      { text: 'Download', link: 'https://github.com/forinda/fordb/releases' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Install', link: '/guide/install' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Connections', link: '/guide/connections' },
            { text: 'Query Workbench', link: '/guide/query-workbench' },
            { text: 'Schema & Structure', link: '/guide/schema-structure' },
            { text: 'MongoDB', link: '/guide/mongodb' },
            { text: 'Keyboard & Palette', link: '/guide/keyboard' }
          ]
        }
      ],
      '/reference/': [
        { text: 'Reference', items: [{ text: 'Engines', link: '/reference/engines' }] }
      ]
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/forinda/fordb' }],
    footer: { message: 'MIT Licensed', copyright: '© fordb contributors' }
  }
})
