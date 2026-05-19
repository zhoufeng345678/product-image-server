/**
 * 电商图片生成器 v3.0 - 主入口
 * 材视 MaterialView
 * 
 * 初始化、事件绑定、全局错误处理
 * 
 * P1-14: 错误边界 - 全局未捕获异常不白屏
 * @module main
 */

(function() {
    'use strict';

    // === P1-14: 全局错误边界 ===
    window.addEventListener('error', function(e) {
        console.error('Global error:', e.error);
        // 防止白屏：仅在生成中遇到异常时恢复 UI
        if (isGenerating) {
            isGenerating = false;
            generateMutex = false;
            Api.clearPolling();
            UI.setGenerating(false);
            UI.showError('发生意外错误，请刷新页面后重试');
            UI.showToast('出错了，请刷新页面', 'error');
        }
        // 不阻止默认行为，让浏览器正常记录
    });

    window.addEventListener('unhandledrejection', function(e) {
        console.error('Unhandled rejection:', e.reason);
        if (isGenerating) {
            isGenerating = false;
            generateMutex = false;
            Api.clearPolling();
            UI.setGenerating(false);
            UI.showError('网络异常：' + (e.reason && e.reason.message || '未知错误'));
            UI.showToast('请求失败', 'error');
        }
    });

    // === DOMContentLoaded ===
    document.addEventListener('DOMContentLoaded', function() {
        initApp();
    });

    function initApp() {
        // 初始化配置（包括分辨率设置）
        if (typeof initConfig === 'function') {
            initConfig();
        }
        
        // 恢复 API Key
        var savedKey = Storage.getApiKey();
        if (savedKey) {
            document.getElementById('apiKeyInput').value = savedKey;
        }

        // 恢复供应商
        currentProvider = Storage.getProvider();
        document.getElementById('providerSelect').value = currentProvider;

        // P1-6: 恢复草稿
        restoreDraft();

        // 加载历史
        UI.loadHistory();

        // P0-3: 健康检查
        Api.checkHealth();

        // 自动保存草稿
        var promptInput = document.getElementById('promptInput');
        promptInput.addEventListener('input', function() {
            Storage.setDraft(this.value);
        });

        // P2-6: 键盘快捷键
        promptInput.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                Api.generate(this.value.trim());
            }
        });

        // 移动端视口修复
        fixMobileViewport();
        window.addEventListener('resize', fixMobileViewport);
    }

    function restoreDraft() {
        var draft = Storage.getDraft();
        if (draft) {
            document.getElementById('promptInput').value = draft;
        }
    }

    function fixMobileViewport() {
        document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
    }

    // === 全局函数暴露（供 HTML onclick 调用） ===
    window.switchTab = function(tab) {
        // P1-2: Tab 切换时，如果在生成中则提醒
        if (isGenerating && tab !== 'generate') {
            UI.showToast('图片正在生成中，请稍候...', 'warn');
            return;
        }
        UI.switchTab(tab);
    };

    window.selectAspect = UI.selectAspect;
    window.enhancePrompt = UI.enhancePrompt;
    window.generateImage = function() {
        var prompt = document.getElementById('promptInput').value.trim();
        Api.generate(prompt);
    };
    window.saveApiKey = function() {
        var key = document.getElementById('apiKeyInput').value.trim();
        if (key) {
            Storage.setApiKey(key);
            UI.showToast('API Key 已保存', 'success');
            Api.checkHealth();
        }
    };
    window.switchProvider = function() {
        var newProvider = document.getElementById('providerSelect').value;
        Api.switchProvider(newProvider);
    };
    window.downloadImage = UI.downloadImage;
    window.copyImageUrl = UI.copyImageUrl;

    // P2-6: 全局键盘快捷键
    document.addEventListener('keydown', function(e) {
        // Esc 关闭任何打开的预览
        if (e.key === 'Escape') {
            UI.showPlaceholder();
        }
    });

})();
