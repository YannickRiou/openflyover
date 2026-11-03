export default ({
  root: '/home/yriou/openflyover',
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: '<dossier de travail>/out',
    emptyOutDir: true,
    lib: { entry: '<dossier de travail>/view.ts', formats: ['iife'], name: 'view', fileName: () => 'view.js' },
    minify: false,
  },
})
