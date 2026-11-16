(() => {
  const config = window.cacaoaiDesktopConfig || {};
  const baseUrl = String(config.localAnalysisUrl || 'http://127.0.0.1:8787').replace(/\/$/, '');

  window.cacaoaiLocalAnalysis = {
    enabled: Boolean(baseUrl),
    async request(path, options = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeout || 12000);
      try {
        const response = await fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal });
        if (!response.ok) throw new Error(`Local analysis request failed (${response.status})`);
        return response.json();
      } finally {
        clearTimeout(timeout);
      }
    },
    async analyze(payload) {
      return this.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 4500
      });
    },
    async weather({ latitude, longitude, startDate, endDate, timezone = 'Asia/Manila' }) {
      const params = new URLSearchParams({ latitude, longitude, start_date:startDate, end_date:endDate, timezone });
      return this.request(`/weather?${params.toString()}`);
    },
    async marketPrices({ startDate, endDate }) {
      const params = new URLSearchParams({ start_date:startDate, end_date:endDate });
      return this.request(`/market-prices?${params.toString()}`);
    }
  };
})();
