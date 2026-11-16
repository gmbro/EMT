// Keep one generation of hashed assets available while the production alias
// propagates. Only current build assets enter the next release manifest.
const production = 'https://emt-theta.vercel.app';
const validAsset = /^assets\/[\w.-]+-[\w-]{8,}\.(?:js|css|wasm|woff2)$/;

async function previousAssets() {
  const response = await fetch(production + '/release-assets.json', {cache:'no-store',signal:AbortSignal.timeout(15000)});
  if (response.ok) {
    const files = await response.json();
    if (!Array.isArray(files) || !files.length || !files.every(file=>validAsset.test(file))) throw new Error('Invalid production asset manifest');
    return files;
  }
  if (response.status!==404) throw new Error('Cannot read production manifest: '+response.status);
  // Releases before the manifest was introduced list their entry points in HTML.
  const page = await fetch(production+'/', {cache:'no-store',signal:AbortSignal.timeout(15000)});
  if (!page.ok) throw new Error('Cannot read production HTML: '+page.status);
  const files = Array.from((await page.text()).matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g), match=>match[1]);
  if (!files.some(file=>file.endsWith('.js')) || !files.every(file=>validAsset.test(file))) throw new Error('Missing production entry points');
  return files;
}

export function retainDeploymentAssets() {
  return {
    name:'retain-production-assets',
    apply:'build',
    async generateBundle(_,bundle) {
      const current=Object.keys(bundle).filter(file=>validAsset.test(file));
      this.emitFile({type:'asset',fileName:'release-assets.json',source:JSON.stringify(current)});
      if (process.env.VERCEL_ENV!=='production') return;
      for (const file of await previousAssets()) {
        if (bundle[file]) continue;
        const response=await fetch(production+'/'+file,{signal:AbortSignal.timeout(30000)});
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Cannot retain '+file+': '+response.status);
        this.emitFile({type:'asset',fileName:file,source:new Uint8Array(await response.arrayBuffer())});
      }
    }
  };
}
