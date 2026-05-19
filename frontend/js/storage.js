/**
 * 电商图片生成器 v3.0 - 存储模块
 * 材视 MaterialView
 * @module storage
 */

var Storage = {
    // === API Key ===
    getApiKey: function() {
        return localStorage.getItem('gpt_image_api_key') || '';
    },
    setApiKey: function(key) {
        localStorage.setItem('gpt_image_api_key', key);
    },

    // === Provider ===
    getProvider: function() {
        var p = localStorage.getItem('gpt_image_provider');
        return (p && API_PROVIDERS[p]) ? p : 'mxapi';
    },
    setProvider: function(provider) {
        localStorage.setItem('gpt_image_provider', provider);
    },

    // === Draft (P1-6: 草稿自动恢复) ===
    getDraft: function() {
        return localStorage.getItem('gpt_image_draft') || '';
    },
    setDraft: function(text) {
        if (text) {
            localStorage.setItem('gpt_image_draft', text);
        } else {
            localStorage.removeItem('gpt_image_draft');
        }
    },

    // === History ===
    getHistory: function() {
        try {
            return JSON.parse(localStorage.getItem('gpt_image_history') || '[]');
        } catch (e) {
            return [];
        }
    },
    addHistory: function(prompt, imageUrl) {
        var history = this.getHistory();
        history.unshift({
            id: Date.now(),
            prompt: prompt,
            imageUrl: imageUrl,
            aspect: currentAspectRatio,
            provider: currentProvider,
            time: new Date().toLocaleString('zh-CN')
        });
        // 最多保留50条
        if (history.length > 50) history.length = 50;
        localStorage.setItem('gpt_image_history', JSON.stringify(history));
    },
    deleteHistory: function(id) {
        var history = this.getHistory().filter(function(h) { return h.id !== id; });
        localStorage.setItem('gpt_image_history', JSON.stringify(history));
    },

    // === P1-8: API配额记录 (本地估算) ===
    getQuotaInfo: function() {
        try {
            return JSON.parse(localStorage.getItem('gpt_image_quota') || '{}');
        } catch (e) {
            return {};
        }
    },
    recordApiCall: function() {
        var today = new Date().toISOString().slice(0, 10);
        var quota = this.getQuotaInfo();
        var key = currentProvider + '_' + today;
        quota[key] = (quota[key] || 0) + 1;
        localStorage.setItem('gpt_image_quota', JSON.stringify(quota));
        return quota[key];
    }
};
