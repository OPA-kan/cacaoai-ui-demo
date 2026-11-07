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
      if (!this.enabled) return { photos: [], actions: [], status: 'not-configured' };
      const results = await Promise.allSettled([
        readTable('photos', 'captured_at'),
        readTable('field_actions', 'performed_at')
      ]);
      if (results.every((result) => result.status === 'rejected')) throw new Error('Cloud tables could not be read');
      const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason?.message || 'Cloud read failed');
      return {
        photos: results[0].status === 'fulfilled' ? results[0].value : [],
        actions: results[1].status === 'fulfilled' ? results[1].value : [],
        status: errors.length ? 'partial' : 'connected',
        errors
      };
    }
  };
})();
