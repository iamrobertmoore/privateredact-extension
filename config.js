/* Endpoints + local asset paths for the extension. No secrets here: the API key
 * that mints delegation tokens lives only on the server behind /api/token. */
window.PR_CONFIG = {
  tokenUrl: 'https://privateredact.app/api/token',
  attestUrl: 'https://privateredact.app/api/attest',
  nucBaseUrl: 'https://api.nilai.nillion.network/nuc/v1/',
  model: 'google/gemma-4-26B-A4B-it',
  clientBundle: 'lib/nilai-client.min.js',
  tess: {
    main: 'lib/tesseract/tesseract.min.js',
    worker: 'lib/tesseract/worker.min.js',
    core: 'lib/tesseract/tesseract-core-simd-lstm.wasm.js',
    lang: 'lib/tesseract/'
  }
};
