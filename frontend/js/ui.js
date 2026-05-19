/**
 * 电商图片生成器 v3.0 - UI 模块
 * 材视 MaterialView
 * 
 * 包含: Toast、Tab、加载状态、图片展示、历史记录渲染、错误显示
 * 
 * P1-3: 下载稳定性 - blob URL 清理
 * P1-11: 图片懒加载基础
 * P1-5: 错误恢复引导 - 重试按钮
 * @module ui
 */

var UI = {
    // === Toast ===
    showToast: function(msg, type) {
        type = type || '';
        var t = document.getElementById('toast');
        t.textContent = msg;
        t.className = 'toast ' + type + ' show';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function() {
            t.classList.remove('show');
        }, 2500);
    },

    // === API 状态指示 ===
    updateApiStatus: function(state, text) {
        var dot = document.getElementById('apiStatusDot');
        var txt = document.getElementById('apiStatusText');
        dot.className = 'api-status-dot ' + state;
        txt.textContent = text;
        // P1-8: 同时更新配额
        UI.updateQuotaDisplay();
    },

    // === P1-8: API配额监控 ===
    updateQuotaDisplay: function() {
        var el = document.getElementById('quotaInfo');
        if (!el) return;
        var quota = Storage.getQuotaInfo();
        var today = new Date().toISOString().slice(0, 10);
        var key = currentProvider + '_' + today;
        var count = quota[key] || 0;
        var providerName = API_PROVIDERS[currentProvider] ? API_PROVIDERS[currentProvider].name : currentProvider;
        el.textContent = '今日调用: ' + count + ' 次';
        el.title = providerName + ' · ' + today;
    },

    // === 供应商切换 ===
    showSwitching: function(show) {
        document.getElementById('providerSwitching').style.display = show ? 'inline' : 'none';
    },

    // === Tab 切换 (P1-2: 清理状态) ===
    switchTab: function(tabName) {
        document.querySelectorAll('.panel-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.panel-content').forEach(function(c) { c.style.display = 'none'; });
        document.getElementById('tab-' + tabName).style.display = 'block';

        // 激活对应 tab 按钮
        var tabs = document.querySelectorAll('.panel-tab');
        if (tabName === 'generate') tabs[0].classList.add('active');
        else if (tabName === 'history') tabs[1].classList.add('active');

        if (tabName === 'history') UI.loadHistory();

        // P1-2: 切换 tab 不清除生成任务，但暂停 UI 更新
    },

    // === 比例选择 ===
    selectAspect: function(btn) {
        document.querySelectorAll('.aspect-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentAspectRatio = btn.dataset.ratio;
    },

    // === 提示词增强 ===
    enhancePrompt: function() {
        var input = document.getElementById('promptInput');
        var text = input.value.trim();
        if (!text) {
            UI.showError('请先输入商品描述');
            return;
        }

        var hasStyle = /简约|北欧|现代|复古|工业|日式|中式|奢华|高端|ins风|ins风/.test(text);
        var hasScene = /桌面|背景|场景|放置|台上|架上|旁边/.test(text);
        var hasLight = /光线|灯光|自然光|暖光|冷光|阴影|氛围/.test(text);

        var enhanced = text;
        if (!hasStyle) enhanced += '，简约风格';
        if (!hasScene) enhanced += '，纯色背景';
        if (!hasLight) enhanced += '，柔和自然光';
        enhanced += '，电商产品主图，专业摄影，高清细节';

        input.value = enhanced;
        input.focus();
    },

    // === 生成按钮 ===
    setGenerating: function(active) {
        var btn = document.getElementById('generateBtn');
        btn.disabled = active;
        if (active) {
            btn.textContent = '⏳ 生成中...';
        } else {
            btn.textContent = '🚀 生成主图';
        }
    },

    // === 加载状态 (P1-4: 进度可视化) ===
    showLoading: function(text, progress) {
        document.getElementById('imageDisplay').innerHTML =
            '<div class="loading">' +
                '<div class="spinner"></div>' +
                '<div class="loading-text">' + (text || 'AI 正在生成图片，请稍候...') + '</div>' +
                '<div class="progress-bar"><div class="progress-fill" style="animation:none;width:' + (progress || 0) + '%"></div></div>' +
                '<div style="font-size:12px;color:#86868b;margin-top:4px;">大约需要 30-60 秒</div>' +
            '</div>';
    },

    // === 占位 ===
    showPlaceholder: function() {
        document.getElementById('imageDisplay').innerHTML =
            '<div class="placeholder">' +
                '<div class="placeholder-icon">🖼️</div>' +
                '<div class="placeholder-text">输入商品描述，点击生成<br>AI 将为你创建电商主图</div>' +
            '</div>';
    },

    // === 图片展示 ===
    showImage: function(url) {
        var escapedUrl = url.replace(/'/g, "\\'");
        document.getElementById('imageDisplay').innerHTML =
            '<img src="' + url + '" alt="生成的商品主图" loading="lazy" />' +
            '<div class="image-actions">' +
                '<button class="action-btn primary" onclick="UI.downloadImage(\'' + escapedUrl + '\')">💾 下载图片</button>' +
                '<button class="action-btn" onclick="UI.copyImageUrl(\'' + escapedUrl + '\')">📋 复制链接</button>' +
            '</div>';
    },

    // === P1-3: 下载 - 使用 blob 确保稳定性 ===
    downloadImage: async function(url) {
        try {
            UI.showToast('下载中...', '');
            var response = await fetch(url);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            var blob = await response.blob();
            var blobUrl = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = blobUrl;
            a.download = 'product-image-' + Date.now() + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // 延迟清理 blob URL
            setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 1000);
            UI.showToast('下载成功', 'success');
        } catch (err) {
            // 降级: 直接打开
            window.open(url, '_blank');
            UI.showToast('已在新标签页打开图片', '');
        }
    },

    // === 复制链接 ===
    copyImageUrl: function(url) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function() {
                UI.showToast('图片链接已复制到剪贴板', 'success');
            }).catch(function() {
                prompt('复制图片链接：', url);
            });
        } else {
            prompt('复制图片链接：', url);
        }
    },

    // === 错误 ===
    showError: function(msg) {
        document.getElementById('errorMsg').innerHTML =
            '<div class="error-msg">' +
                msg +
                '<button onclick="Api.retry()" style="margin-left:12px;padding:4px 12px;background:#d32f2f;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;" id="retryBtn">🔄 重试</button>' +
            '</div>';
    },

    showRetryBtn: function() {
        // 已在 showError 中默认添加
    },

    clearError: function() {
        document.getElementById('errorMsg').innerHTML = '';
    },

    // === 历史记录 (P1-11: 懒加载缩略图) ===
    loadHistory: function() {
        var history = Storage.getHistory();
        var list = document.getElementById('historyList');

        if (history.length === 0) {
            list.innerHTML = '<div class="empty-state">暂无历史记录</div>';
            return;
        }

        list.innerHTML = history.map(function(item) {
            var escapedUrl = (item.imageUrl || '').replace(/'/g, "\\'");
            return '<div class="history-item" onclick="UI.loadHistoryItem(' + item.id + ')">' +
                '<div class="history-item-row">' +
                    (item.imageUrl ? '<img class="history-thumb" data-src="' + escapedUrl + '" src="" alt="" loading="lazy" style="width:60px;height:60px;object-fit:cover;border-radius:8px;background:#e5e5e7;flex-shrink:0;" />' : '') +
                    '<div class="history-item-info">' +
                        '<div class="history-prompt">' + escapeHtml(item.prompt) + '</div>' +
                        '<div class="history-meta">' +
                            '<span>' + item.time + ' · ' + item.aspect + ' · ' + (item.provider || 'mxapi') + '</span>' +
                            '<span class="history-delete" onclick="event.stopPropagation(); UI.deleteHistoryItem(' + item.id + ')">删除</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');

        // P1-11: IntersectionObserver 懒加载缩略图
        UI.lazyLoadThumbnails();
    },

    // === P1-11: 懒加载缩略图 ===
    lazyLoadThumbnails: function() {
        var thumbs = document.querySelectorAll('.history-thumb[data-src]');
        if (!thumbs.length) return;

        if ('IntersectionObserver' in window) {
            var observer = new IntersectionObserver(function(entries) {
                entries.forEach(function(entry) {
                    if (entry.isIntersecting) {
                        var img = entry.target;
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        observer.unobserve(img);
                    }
                });
            }, { rootMargin: '100px' });
            thumbs.forEach(function(img) { observer.observe(img); });
        } else {
            // 降级：直接加载
            thumbs.forEach(function(img) {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            });
        }
    },

    loadHistoryItem: function(id) {
        var history = Storage.getHistory();
        var item = history.find(function(h) { return h.id === id; });
        if (item) {
            document.getElementById('promptInput').value = item.prompt;
            if (item.provider && item.provider !== currentProvider) {
                currentProvider = item.provider;
                document.getElementById('providerSelect').value = item.provider;
            }
            UI.switchTab('generate');
        }
    },

    deleteHistoryItem: function(id) {
        Storage.deleteHistory(id);
        UI.loadHistory();
        UI.showToast('已删除', '');
    }
};

// HTML 转义
function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
