import { HelixCache } from './helix-cache.js';
const cache = await new HelixCache().init();
console.log('Artifacts:', cache.list().length);
console.log('Placement changes:', await cache.optimize());
console.log('Prefetch:', await cache.prefetch('Compare address agents using the 2024 evaluation dataset'));
