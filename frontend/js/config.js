/**
 * 电商图片生成器 v3.0 - API 配置模块
 * 材视 MaterialView
 * @module config
 */

var API_PROVIDERS = {
    mxapi: {
        name: 'MXAPI',
        submitUrl: 'https://open.mxapi.org/api/v2/gpt-image-2',
        taskUrl: 'https://open.mxapi.org/api/v2/gpt-image/task',
        healthUrl: 'https://open.mxapi.org/api/v2/gpt-image/task?task_id=health-check',
        authHeader: 'Authorization',
        submitTimeout: 30000,  // 提交超时 30s
        pollTimeout: 90000,    // 轮询超时 90s
        retryDelay: [1500, 3000],
        submitBody: function(prompt, aspectRatio) {
            return { prompt: prompt, aspect_ratio: aspectRatio };
        },
        parseResponse: function(data) {
            if (data.code !== 200 || !data.data || !data.data.task_id) {
                throw new Error(data.message || '任务提交失败');
            }
            return data.data.task_id;
        },
        parseResult: function(data) {
            if (data.code !== 200) return null;
            if (data.data && data.data.status === 'completed') {
                return (data.data.result && data.data.result.images) || [];
            }
            return { status: data.data ? data.data.status : 'unknown' };
        }
    },
    dashscope: {
        name: '阿里云百炼',
        submitUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation',
        taskUrl: 'https://dashscope.aliyuncs.com/api/v1/tasks',
        healthUrl: 'https://dashscope.aliyuncs.com/api/v1/tasks/health-check',
        authHeader: 'Authorization',
        submitTimeout: 30000,
        pollTimeout: 120000,   // 百炼稍慢，给 2 分钟
        retryDelay: [2000, 4000],
        submitBody: function(prompt, aspectRatio) {
            var sizeMap = { '1:1': '1024*1024', '3:4': '768*1024', '4:3': '1024*768', '16:9': '1280*720', '9:16': '720*1280' };
            return {
                model: 'wan2.6-t2i-plus',
                input: { prompt: prompt },
                parameters: { size: sizeMap[aspectRatio] || '1024*1024', n: 1 }
            };
        },
        parseResponse: function(data) {
            if (!data.output || !data.output.task_id) {
                throw new Error(data.message || '任务提交失败');
            }
            return data.output.task_id;
        },
        parseResult: function(data) {
            if (!data.output) return null;
            if (data.output.task_status === 'SUCCEEDED') {
                return (data.output.results || []).map(function(r) { return r.url; }).filter(Boolean);
            }
            return { status: data.output.task_status };
        }
    }
};

// 全局状态
var currentProvider = 'mxapi';
var currentAspectRatio = '1:1';
var currentTaskId = null;
var pollTimer = null;
var pollCount = 0;
var providerWarmedUp = { mxapi: false, dashscope: false };
var toastTimer = null;
var isGenerating = false;
var generateMutex = false; // P1-12: 并发控制锁
