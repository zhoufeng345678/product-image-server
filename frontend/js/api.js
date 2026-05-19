/**
 * 电商图片生成器 v3.0 - API 模块
 * 材视 MaterialView
 * 
 * 包含: 健康检查、供应商预热、图片生成、任务轮询
 * 
 * P1-1: "一直生成中"修复 - 明确超时/失败处理
 * P1-2: Tab切换状态残留 - clearPolling()
 * P1-7: 智能重试 - 递增间隔重试
 * P1-10: 超时分级 - submit超时 vs poll超时
 * @module api
 */

var Api = {
    /**
     * P0-3: API 健康检查
     */
    checkHealth: async function() {
        var apiKey = Storage.getApiKey();
        if (!apiKey) {
            UI.updateApiStatus('error', '未配置 Key');
            return false;
        }

        UI.updateApiStatus('checking', '检测中...');
        var cfg = API_PROVIDERS[currentProvider];

        try {
            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, 8000);

            var headers = {};
            headers[cfg.authHeader] = 'Bearer ' + apiKey;

            var response = await fetch(cfg.healthUrl, {
                headers: headers,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.status < 500) {
                UI.updateApiStatus('ok', cfg.name + ' 正常');
                return true;
            } else {
                UI.updateApiStatus('error', cfg.name + ' 异常 (' + response.status + ')');
                return false;
            }
        } catch (e) {
            UI.updateApiStatus('error', cfg.name + ' 不可达');
            return false;
        }
    },

    /**
     * P0-2: 供应商预热 - 发送轻量 OPTIONS 建立连接
     */
    warmup: async function(provider) {
        if (providerWarmedUp[provider]) return;
        var cfg = API_PROVIDERS[provider];
        var apiKey = Storage.getApiKey();
        if (!apiKey) {
            providerWarmedUp[provider] = true;
            return;
        }
        try {
            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, 5000);
            await fetch(cfg.submitUrl, {
                method: 'OPTIONS',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            providerWarmedUp[provider] = true;
        } catch (e) {
            providerWarmedUp[provider] = true;
            console.log('Provider warmup silent:', e.message);
        }
    },

    /**
     * 供应商切换
     */
    switchProvider: async function(newProvider) {
        if (newProvider === currentProvider) return;

        UI.showSwitching(true);

        // 清理当前轮询
        this.clearPolling();

        currentProvider = newProvider;
        providerWarmedUp[currentProvider] = false;
        Storage.setProvider(currentProvider);

        // 预热
        await this.warmup(currentProvider);

        UI.showSwitching(false);
        UI.updateApiStatus('checking', '检测中...');

        // 健康检查
        await this.checkHealth();

        UI.showToast('已切换到 ' + API_PROVIDERS[currentProvider].name, 'success');
    },

    /**
     * P0-2 + P1-7: 生成图片（带预热、重试、超时控制）
     */
    generate: async function(prompt) {
        var apiKey = Storage.getApiKey();
        if (!apiKey) {
            UI.showError('请先设置 API Key');
            return;
        }
        if (!prompt) {
            UI.showError('请输入商品描述');
            return;
        }

        // P1-12: 并发控制 - 同一时间只能一个生成任务
        if (generateMutex) {
            UI.showToast('已有任务正在生成，请等待完成', 'warn');
            return;
        }

        UI.clearError();
        generateMutex = true;
        isGenerating = true;
        UI.setGenerating(true);
        UI.showLoading('提交任务中...', 0);

        // 预热
        if (!providerWarmedUp[currentProvider]) {
            UI.showLoading('正在连接服务器...', 10);
            await this.warmup(currentProvider);
        }

        var cfg = API_PROVIDERS[currentProvider];
        var maxRetries = 2;
        var lastError = null;

        for (var attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    var delay = cfg.retryDelay[attempt - 1] || 3000;
                    UI.showLoading('重试中 (' + attempt + '/' + maxRetries + ')...', 15);
                    await sleep(delay);
                    providerWarmedUp[currentProvider] = false;
                    await this.warmup(currentProvider);
                }

                UI.showLoading('正在提交生成任务...', 20);

                var headers = {};
                headers[cfg.authHeader] = 'Bearer ' + apiKey;
                headers['Content-Type'] = 'application/json';

                // P1-10: 提交超时控制
                var controller = new AbortController();
                var timeoutId = setTimeout(function() { controller.abort(); }, cfg.submitTimeout);

                var response = await fetch(cfg.submitUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(cfg.submitBody(prompt, currentAspectRatio, currentResolution)),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                var data = await response.json();
                currentTaskId = cfg.parseResponse(data);

                // 记录 API 调用
                Storage.recordApiCall();

                // P1-4: 开始阶段式轮询
                UI.showLoading('AI 正在生成...', 30);
                this.startPolling(apiKey);
                return; // 成功

            } catch (err) {
                lastError = err;
                if (attempt >= maxRetries) {
                    isGenerating = false;
                    generateMutex = false;
                    UI.setGenerating(false);
                    var reason = err.name === 'AbortError' ? '提交超时（网络慢或服务无响应）' : err.message;
                    UI.showError('生成失败：' + reason);
                    UI.showPlaceholder();
                    UI.showToast('生成失败，可点击重试或切换供应商', 'error');
                }
            }
        }
    },

    /**
     * 轮询任务状态
     * P1-1: "一直生成中"修复 - 添加超时处理和进度反馈
     * P1-4: 进度可视化 - 分阶段显示
     */
    startPolling: function(apiKey) {
        this.clearPolling();

        var cfg = API_PROVIDERS[currentProvider];
        var maxPolls = Math.ceil(cfg.pollTimeout / 2000); // 自动计算
        pollCount = 0;

        // P1-4: 阶段映射
        var stages = [
            { threshold: 0.05, text: '已提交，排队中...', progress: 35 },
            { threshold: 0.30, text: 'AI 正在构思画面...', progress: 45 },
            { threshold: 0.55, text: '生成中，请耐心等待...', progress: 55 },
            { threshold: 0.75, text: '即将完成...', progress: 70 },
            { threshold: 0.90, text: '最后处理中...', progress: 85 }
        ];

        pollTimer = setInterval(async function() {
            pollCount++;

            // P1-4: 更新阶段信息
            var ratio = pollCount / maxPolls;
            for (var i = stages.length - 1; i >= 0; i--) {
                if (ratio >= stages[i].threshold) {
                    UI.showLoading(stages[i].text, stages[i].progress);
                    break;
                }
            }

            try {
                var headers = {};
                headers[cfg.authHeader] = 'Bearer ' + apiKey;

                var url = cfg.taskUrl;
                if (currentProvider === 'mxapi') {
                    url += '?task_id=' + currentTaskId;
                } else {
                    url += '/' + currentTaskId;
                }

                var response = await fetch(url, { headers: headers });
                var data = await response.json();
                var result = cfg.parseResult(data);

                if (Array.isArray(result)) {
                    // 完成！
                    Api.clearPolling();
                    isGenerating = false;
                    generateMutex = false;
                    UI.setGenerating(false);
                    var images = result;
                    if (images.length > 0) {
                        UI.showImage(images[0]);
                        Storage.addHistory(
                            document.getElementById('promptInput').value,
                            images[0]
                        );
                        Storage.setDraft('');
                        UI.showToast('生成成功！', 'success');
                    }
                } else if (result && (result.status === 'failed' || result.status === 'FAILED')) {
                    Api.clearPolling();
                    isGenerating = false;
                    generateMutex = false;
                    UI.setGenerating(false);
                    UI.showError('图片生成失败，请尝试调整提示词后重试');
                    UI.showRetryBtn();
                    UI.showPlaceholder();
                    UI.showToast('生成失败', 'error');
                }

                // P1-10: 轮询超时
                if (pollCount >= maxPolls) {
                    Api.clearPolling();
                    isGenerating = false;
                    generateMutex = false;
                    UI.setGenerating(false);
                    UI.showError('生成超时（已等待 ' + Math.round(cfg.pollTimeout/1000) + ' 秒），请检查网络后重试');
                    UI.showRetryBtn();
                    UI.showPlaceholder();
                    UI.showToast('生成超时', 'warn');
                }

            } catch (err) {
                // 连续失败超过1/3总次数才放弃
                if (pollCount >= maxPolls) {
                    Api.clearPolling();
                    isGenerating = false;
                    UI.setGenerating(false);
                    UI.showError('网络异常，请检查连接后重试');
                    UI.showRetryBtn();
                    UI.showPlaceholder();
                }
            }
        }, 2000);
    },

    /**
     * 清理轮询 (P1-2: Tab切换状态残留)
     */
    clearPolling: function() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        currentTaskId = null;
        pollCount = 0;
    },

    /**
     * 重试生成 (P1-5)
     */
    retry: function() {
        var prompt = document.getElementById('promptInput').value.trim();
        if (prompt) {
            this.generate(prompt);
        }
    }
};

// 辅助函数
function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}
