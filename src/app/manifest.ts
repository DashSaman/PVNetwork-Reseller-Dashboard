import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'پنل نمایندگی PvNetWork', short_name: 'PvNetWork', lang: 'fa', dir: 'rtl', start_url: '/', scope: '/', display: 'standalone', background_color: '#0b1119', theme_color: '#0b1119', icons: [
    { src: '/icons/panel-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/panel-512.png', sizes: '512x512', type: 'image/png' },
  ] };
}
