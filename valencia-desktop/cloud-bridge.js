(() => {
  const config = window.cacaoaiDesktopConfig || {};
  const baseUrl = String(config.supabaseUrl || '').replace(/\/$/, '');
  const headers = config.supabaseKey ? {
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`
  } : {};

  async function readTable(table, orderColumn) {
    if (!baseUrl || !config.supabaseKey) return [];
    const url = new URL(`${baseUrl}/rest/v1/${table}`);
    url.searchParams.set('select', '*');
    url.searchParams.set('order', `${orderColumn}.desc`);
    url.searchParams.set('limit', '5000');
    if (config.farmId) url.searchParams.set('farm_id', `eq.${config.farmId}`);
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`${table} read failed (${response.status})`);
    return response.json();
  }

  window.cacaoaiCloud = {
    enabled: Boolean(baseUrl && config.supabaseKey),
    async loadSnapshot() {
      if (!this.enabled) return { photos: [], actions: [], harvestRecords: [], marketPrices: [], status: 'not-configured' };
      const results = await Promise.allSettled([
        readTable('photos', 'captured_at'),
        readTable('field_actions', 'performed_at'),
        readTable('harvest_records', 'harvest_date'),
        readTable('market_prices', 'observed_on')
      ]);
      if (results.every((result) => result.status === 'rejected')) throw new Error('Cloud tables could not be read');
      const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason?.message || 'Cloud read failed');
      return {
        photos: results[0].status === 'fulfilled' ? results[0].value : [],
        actions: results[1].status === 'fulfilled' ? results[1].value : [],
        harvestRecords: results[2].status === 'fulfilled' ? results[2].value : [],
        marketPrices: results[3].status === 'fulfilled' ? results[3].value : [],
        status: errors.length ? 'partial' : 'connected',
        errors
      };
    },
    async createHarvestRecord(record) {
      if (!this.enabled) throw new Error('Supabase is not configured');
      const response = await fetch(`${baseUrl}/rest/v1/harvest_records`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type':'application/json', Prefer:'return=representation' },
        body: JSON.stringify({ farm_id:config.farmId || null, ...record })
      });
      if (!response.ok) throw new Error(`harvest_records write failed (${response.status})`);
      return response.status === 204 ? record : (await response.json())[0] || record;
    }
  };
})();
