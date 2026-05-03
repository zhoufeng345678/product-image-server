const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
// Node.js 22 has native fetch support
const authRouter = require('./db/auth');
const { authenticateToken } = require('./middleware/auth');
const pool = require('./db/pool');

const app = express();
const PORT = 3010;

// ========== 双 API 配置 ==========
// 主用 API：阿里云百炼（DashScope）万相 wanx-v1（异步模式）
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const DASHSCOPE_MODEL = 'wanx-v1';
const DASHSCOPE_TASK_API = 'https://dashscope.aliyuncs.com/api/v1/tasks';

// 备用 API：open.mxapi.org gpt-image-2
const MXAPI_API_KEY = process.env.GPT_IMAGE_API_KEY || '';
const MXAPI_API_BASE = 'https://open.mxapi.org/api/v2/gpt-image-2';
const MXAPI_TASK_API = 'https://open.mxapi.org/api/v2/gpt-image/task';

// API 选择策略：dashscope | mxapi | auto（默认）
const API_STRATEGY = process.env.API_STRATEGY || 'dashscope'; // 默认使用 DashScope

// 上传目录
const UPLOAD_DIR = path.join(__dirname, '../../uploads/product-image');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 中间件
app.use(cors());
app.use(express.json());

// 认证路由
app.use('/api/auth', authRouter);

// 图片上传存储配置
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        const name = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp|gif/;
        const ext = path.extname(file.originalname).toLowerCase().slice(1);
        if (allowed.test(ext)) {
            cb(null, true);
        } else {
            cb(new Error('仅支持图片格式：JPG/PNG/WEBP/GIF'));
        }
    }
});

// ========== 路由 ==========

// 健康检查
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        time: new Date().toISOString(),
        api_strategy: API_STRATEGY,
        dashscope_available: !!DASHSCOPE_API_KEY,
        mxapi_available: !!MXAPI_API_KEY
    });
});

// 上传图片 → 返回 OSS URL
app.post('/api/upload', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请选择要上传的图片' });
        }
        const url = `/uploads/product-image/${req.file.filename}`;
        res.json({
            code: 200,
            data: {
                url: url,
                filename: req.file.filename,
                size: req.file.size
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 批量上传图片
app.post('/api/upload-multiple', upload.array('images', 5), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: '请选择要上传的图片' });
        }
        const urls = req.files.map(f => `/uploads/product-image/${f.filename}`);
        res.json({
            code: 200,
            data: urls.map((url, i) => ({
                url,
                filename: req.files[i].filename,
                size: req.files[i].size
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 从 API 响应中提取图片 URL
function extractImageUrl(data) {
    if (!data) return '';
    return data.image_url || data.imageUrl ||
           (data.images && data.images[0] && (data.images[0].url || data.images[0].image_url)) ||
           (data.results && data.results[0] && (data.results[0].url || data.results[0].image_url)) ||
           (data.output && data.output.results && data.output.results[0] && (data.output.results[0].url || data.output.results[0].img_url)) ||
           (data.data && data.data[0] && data.data[0].url) || '';
}

// 保存历史记录
async function saveHistory(userId, prompt, imageUrl, referenceImages, aspectRatio) {
    if (!userId) return;
    try {
        await pool.query(
            'INSERT INTO image_history (user_id, prompt, image_url, reference_images, aspect_ratio) VALUES (?, ?, ?, ?, ?)',
            [userId, prompt, imageUrl || '', referenceImages ? JSON.stringify(referenceImages) : null, aspectRatio || '1:1']
        );
    } catch (err) {
        console.error('保存历史记录失败:', err.message);
    }
}

// 补全参考图 URL（相对路径 → 完整公网 URL）
function normalizeReferenceImages(urls) {
    if (!urls || urls.length === 0) return [];
    return urls.map(url => {
        if (url.startsWith('/')) {
            return `https://crazydream.site${url}`;
        }
        return url;
    });
}

// 尺寸映射
function aspectToSize(aspect) {
    const map = {
        '1:1': '1024*1024',
        '3:4': '768*1024',
        '4:3': '1024*768',
        '16:9': '1024*576',
        '9:16': '576*1024',
    };
    return map[aspect] || '1024*1024';
}

// ========== 双 API 调用逻辑 ==========

// 使用 DashScope 生成图片（异步模式，返回 task_id）
async function generateWithDashScope(prompt, aspect_ratio, reference_images) {
    const size = aspectToSize(aspect_ratio || '1:1');
    const requestBody = {
        model: DASHSCOPE_MODEL,
        input: {
            prompt: prompt
        },
        parameters: {
            size: size,
            n: 1
        }
    };
    if (reference_images && reference_images.length > 0) {
        requestBody.input.image = reference_images[0]; // DashScope 支持单张参考图
    }

    const response = await fetch(DASHSCOPE_API_BASE, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
            'Content-Type': 'application/json',
            'X-DashScope-Async': 'enable' // 异步模式
        },
        body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    console.log('[DashScope] Response:', JSON.stringify(data).substring(0, 500));

    if (data.output?.task_id) {
        return {
            code: 200,
            message: 'success',
            data: {
                task_id: data.output.task_id,
                status: 'pending',
                provider: 'dashscope'
            }
        };
    }

    throw new Error(data.message || data.code || 'DashScope 未返回 task_id');
}

// 使用 MXAPI 生成图片（异步模式，返回 task_id）
async function generateWithMxapi(prompt, aspect_ratio, reference_images) {
    const requestBody = { 
        prompt, 
        aspect_ratio: aspect_ratio || '1:1' 
    };
    const normalizedRefs = normalizeReferenceImages(reference_images);
    if (normalizedRefs.length > 0) {
        requestBody.reference_images = normalizedRefs;
    }

    const response = await fetch(MXAPI_API_BASE, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${MXAPI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    console.log('[MXAPI] Response:', JSON.stringify(data).substring(0, 500));

    if (data.data?.task_id) {
        return {
            code: 200,
            message: 'success',
            data: {
                task_id: data.data.task_id,
                status: 'pending',
                provider: 'mxapi'
            }
        };
    }

    // 如果直接返回了图片
    const imageUrl = extractImageUrl(data.data || data);
    if (imageUrl) {
        return {
            code: 200,
            message: 'success',
            output: { image_url: imageUrl },
            data: { image_url: imageUrl },
            provider: 'mxapi'
        };
    }

    throw new Error(data.message || 'MXAPI 未返回有效响应');
}

// 智能选择 API 并生成
async function generateImage(prompt, aspect_ratio, reference_images, preferredProvider = 'mxapi') {
    let provider = preferredProvider;
    
    // 自动选择策略：默认 MXAPI
    if (provider === 'auto') {
        provider = MXAPI_API_KEY ? 'mxapi' : 'dashscope';
    }

    try {
        if (provider === 'dashscope' && DASHSCOPE_API_KEY) {
            return await generateWithDashScope(prompt, aspect_ratio, reference_images);
        } else if (provider === 'mxapi' && MXAPI_API_KEY) {
            return await generateWithMxapi(prompt, aspect_ratio, reference_images);
        } else {
            throw new Error('没有可用的 API Key');
        }
    } catch (err) {
        console.error(`[${provider}] 生成失败:`, err.message);
        
        // 自动故障切换（仅 auto 模式）
        if (provider === 'dashscope' && MXAPI_API_KEY) {
            console.log('[AUTO-FAILBACK] 切换到 MXAPI...');
            try {
                return await generateWithMxapi(prompt, aspect_ratio, reference_images);
            } catch (err2) {
                console.error('[MXAPI] 也失败了:', err2.message);
            }
        }
        
        throw err;
    }
}

// 提交生成任务（后端代理，隐藏 API Key）
app.post('/api/generate', authenticateToken({ optional: true }), async (req, res) => {
    const { prompt, aspect_ratio, reference_images, provider, save_history_only, image_url } = req.body;

    // 仅保存历史记录模式（前端已生成图片，只需保存到数据库）
    if (save_history_only) {
        if (!req.user?.userId) {
            return res.status(401).json({ error: '请先登录' });
        }
        if (!image_url) {
            return res.status(400).json({ error: '缺少图片 URL' });
        }
        try {
            await saveHistory(
                req.user.userId, prompt || '', image_url,
                reference_images, aspect_ratio || '1:1'
            );
            res.json({ code: 200, message: '保存成功' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
        return;
    }

    if (!prompt) {
        return res.status(400).json({ error: '请输入商品描述' });
    }

    // 检查 API Key
    if (!DASHSCOPE_API_KEY && !MXAPI_API_KEY) {
        return res.status(500).json({ error: 'API Key 未配置' });
    }

    try {
        // 选择 API：请求参数 > 环境变量 > 自动
        const preferredProvider = provider || API_STRATEGY || 'auto';
        
        const result = await generateImage(prompt, aspect_ratio, reference_images, preferredProvider);

        // 保存历史记录
        const imageUrl = result.output?.image_url || result.data?.image_url || '';
        if (imageUrl) {
            await saveHistory(
                req.user?.userId, prompt, imageUrl,
                reference_images, aspect_ratio
            );
        }

        res.json(result);
    } catch (err) {
        console.error('[GENERATE] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 查询任务状态（支持双 API）
app.get('/api/status', async (req, res) => {
    const { task_id, provider } = req.query;
    
    if (!task_id) {
        return res.status(400).json({ error: '缺少 task_id' });
    }

    // 根据 task_id 格式或显式参数判断 provider
    let apiProvider = provider;
    if (!apiProvider) {
        // 使用配置的默认策略
        apiProvider = API_STRATEGY || 'mxapi';
    }

    try {
        if (apiProvider === 'dashscope') {
            const response = await fetch(`${DASHSCOPE_TASK_API}/${task_id}`, {
                headers: {
                    'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
                }
            });
            const data = await response.json();
            console.log('[STATUS-DashScope] Response:', JSON.stringify(data).substring(0, 300));

            // DashScope 返回：{ output: { task_status: 'SUCCEEDED'/'RUNNING'/'FAILED', results: [{ url: '...' }] } }
            if (data.output?.task_status === 'SUCCEEDED') {
                const imageUrl = data.output.results?.[0]?.url || '';
                return res.json({
                    code: 200,
                    message: 'success',
                    data: {
                        status: 'completed',
                        result: { images: [imageUrl] },
                        provider: 'dashscope'
                    },
                    output: { image_url: imageUrl }
                });
            } else if (data.output?.task_status === 'FAILED' || data.output?.task_status === 'CANCELED') {
                return res.json({
                    code: 200,
                    message: data.message || '生成失败',
                    data: { status: 'failed', provider: 'dashscope' }
                });
            } else {
                // PENDING / RUNNING
                return res.json({
                    code: 200,
                    message: 'success',
                    data: {
                        status: 'pending',
                        task_status: data.output?.task_status || 'PENDING',
                        provider: 'dashscope'
                    }
                });
            }
        } else {
            // MXAPI
            const response = await fetch(`${MXAPI_TASK_API}?task_id=${task_id}`, {
                headers: {
                    'Authorization': `Bearer ${MXAPI_API_KEY}`
                }
            });
            const data = await response.json();
            console.log('[STATUS-MXAPI] Response:', JSON.stringify(data).substring(0, 300));

            if (data.data?.status === 'completed') {
                const imageUrl = data.data?.result?.images?.[0] || data.output?.image_url || '';
                return res.json({
                    code: 200,
                    message: 'success',
                    data: {
                        status: 'completed',
                        result: { images: [imageUrl] },
                        provider: 'mxapi'
                    },
                    output: { image_url: imageUrl }
                });
            } else if (data.data?.status === 'failed') {
                return res.json({
                    code: 200,
                    message: data.message || '生成失败',
                    data: { status: 'failed', provider: 'mxapi' }
                });
            } else {
                return res.json({
                    code: 200,
                    message: 'success',
                    data: {
                        status: 'pending',
                        provider: 'mxapi'
                    }
                });
            }
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== 千问 API 配置（提示词增强） ==========
const QWEN_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const QWEN_API_ENDPOINT = process.env.DASHSCOPE_API_ENDPOINT || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const QWEN_MODEL = process.env.DASHSCOPE_MODEL || 'qwen-plus';

// ========== 历史记录 ==========

// GET /api/history?limit=50&offset=0
app.get('/api/history', authenticateToken(), async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.user.userId;

    try {
        const [totalRows] = await pool.query(
            'SELECT COUNT(*) AS total FROM image_history WHERE user_id = ?',
            [userId]
        );
        const total = totalRows[0].total;

        const [rows] = await pool.query(
            'SELECT * FROM image_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [userId, limit, offset]
        );

        res.json({ code: 200, data: { total, history: rows } });
    } catch (err) {
        console.error('查询历史记录失败:', err.message);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// 提示词增强（调用千问 API）
app.post('/api/enhance', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt || !prompt.trim()) {
        return res.status(400).json({ error: '请输入商品描述' });
    }
    if (!QWEN_API_KEY) {
        return res.status(500).json({ error: '千问 API Key 未配置' });
    }

    try {
        const systemPrompt = `你是一个专业的电商商品主图提示词优化专家。你的任务是：
1. 分析用户输入的商品描述，识别已有维度（品类、材质、颜色、风格、场景、光线等）
2. 针对缺失的维度，智能补全适合电商主图的描述词
3. 输出增强后的完整 prompt，保持简洁专业

规则：
- 只补全缺失维度，不要重复已有内容
- 根据品类推断最合适的场景和光线
- 食品类：木质餐桌、暖色背景、柔和自然光
- 数码类：科技展台、深色背景、专业冷光
- 服饰类：时尚秀场、纯色背景、柔和自然光
- 家居类：温馨室内、自然摆放、柔和均匀光线
- 传统工艺类：古典背景、暖色调、侧光
- 始终补充：电商产品主图、专业摄影、高清细节
- 输出格式：直接输出增强后的 prompt，不要加解释
- 语言：中文
- 长度：控制在 80 字以内`;

        const response = await fetch(QWEN_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${QWEN_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: QWEN_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 200
            })
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0]) {
            const enhanced = data.choices[0].message.content.trim();
            res.json({ code: 200, data: { enhanced, original: prompt } });
        } else {
            res.status(500).json({ error: data.message || '千问 API 返回异常' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 生成详情页 prompt 序列（调用千问 API）
app.post('/api/detail-prompts', authenticateToken({ optional: true }), async (req, res) => {
    const { productName, category, sellingPoints, material, size, style, referenceStyle } = req.body;
    if (!productName || !productName.trim()) {
        return res.status(400).json({ error: '请输入商品名称' });
    }
    if (!QWEN_API_KEY) {
        return res.status(500).json({ error: '千问 API Key 未配置' });
    }

    try {
        const systemPrompt = `你是一个专业的电商详情页策划专家。根据用户提供的商品信息，生成一张完整详情页图片的 prompt。

输出格式：严格返回 JSON 对象，包含以下字段：
{
  "title": "详情页",
  "prompt": "...",
  "aspect": "3:4"
}

要求：
生成一张完整的电商详情页图片，类似淘宝/京东详情页风格，包含以下信息区块：
1. 首屏区域：产品主图展示，大气吸睛
2. 产品细节：材质、工艺、纹理等细节展示
3. 使用场景：产品在真实场景中的效果
4. 核心卖点：突出 3-5 个核心优势
5. 规格参数：尺寸、材质、重量等参数

整体风格要求：
- 专业电商详情页风格，信息层次清晰
- 各区块用线条或色块分隔
- 产品图片占主要视觉区域
- 背景干净，光线专业
- 适合手机端浏览（3:4 竖版比例）

prompt 要求：
- 80-150 字
- 中文
- 不要包含文字排版说明，只描述画面内容
- 强调专业摄影风格、高清细节

只返回 JSON 对象，不要任何其他文字。`;

        const userInfo = `商品名称：${productName}
品类：${category || '未指定'}
核心卖点：${sellingPoints || '未指定'}
材质：${material || '未指定'}
尺寸：${size || '未指定'}
风格：${style || '未指定'}
${referenceStyle ? '参考风格：' + referenceStyle : ''}`;

        const response = await fetch(QWEN_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${QWEN_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: QWEN_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userInfo }
                ],
                temperature: 0.8,
                max_tokens: 800
            })
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0]) {
            let content = data.choices[0].message.content.trim();
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const prompt = JSON.parse(jsonMatch[0]);
                    await saveHistory(
                        req.user?.userId,
                        `${productName} - 详情页`,
                        prompt.prompt || '',
                        null,
                        prompt.aspect || '3:4'
                    );
                    res.json({ code: 200, data: { prompts: prompt } });
                } catch (e) {
                    res.status(500).json({ error: 'AI 返回格式解析失败' });
                }
            } else {
                res.status(500).json({ error: 'AI 未返回有效 JSON' });
            }
        } else {
            res.status(500).json({ error: data.message || '千问 API 返回异常' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 模版生图提示词（调用千问 API）
app.post('/api/template-prompts', authenticateToken({ optional: true }), async (req, res) => {
    const { labels, mode, referenceCount } = req.body;
    if (!labels || !labels.trim()) {
        return res.status(400).json({ error: '请输入标签内容' });
    }
    if (!QWEN_API_KEY) {
        return res.status(500).json({ error: '千问 API Key 未配置' });
    }

    try {
        let systemPrompt;
        if (mode === 'with-ref' && referenceCount >= 2) {
            systemPrompt = `你是一个专业的电商主图策划专家。根据用户提供的标签内容，生成一张商品主图的 prompt。

输出格式：严格返回 JSON 对象：
{
  "prompt": "...",
  "aspect": "1:1"
}

要求：
1. 基于第 1 张配件图片生成商品主图
2. 打上用户指定的标签（可开发票、耐高温高压/耐腐蚀、厂家直销量大优惠等）
3. 标签设计要合理，符合淘宝商品详情页主图风格
4. 主图不要带边框
5. 整体图片风格参考第 2 张商品主图
6. 专业摄影风格，高清细节，光线均匀

prompt 要求：
- 80-120 字
- 中文
- 不要包含文字排版说明，只描述画面内容

只返回 JSON 对象，不要任何其他文字。`;
        } else {
            systemPrompt = `你是一个专业的电商主图策划专家。根据用户提供的标签内容，生成一张商品主图的 prompt。

输出格式：严格返回 JSON 对象：
{
  "prompt": "...",
  "aspect": "1:1"
}

要求：
1. 基于配件图片生成商品主图
2. 打上用户指定的标签（可开发票、耐高温高压/耐腐蚀、厂家直销量大优惠等）
3. 标签设计要合理，符合淘宝商品详情页主图风格
4. 主图不要带边框
5. 专业摄影风格，高清细节，光线均匀

prompt 要求：
- 80-120 字
- 中文
- 不要包含文字排版说明，只描述画面内容

只返回 JSON 对象，不要任何其他文字。`;
        }

        const userInfo = `标签内容：${labels}
模式：${mode === 'with-ref' ? '有风格参考（第 1 张配件图，第 2 张风格参考）' : '无风格参考'}
参考图数量：${referenceCount || 1}张`;

        const response = await fetch(QWEN_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${QWEN_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: QWEN_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userInfo }
                ],
                temperature: 0.7,
                max_tokens: 300
            })
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0]) {
            let content = data.choices[0].message.content.trim();
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const prompt = JSON.parse(jsonMatch[0]);
                    await saveHistory(
                        req.user?.userId,
                        `${labels} - 模版主图`,
                        prompt.prompt || '',
                        null,
                        prompt.aspect || '1:1'
                    );
                    res.json({ code: 200, data: { prompt: prompt.prompt, aspect: prompt.aspect || '1:1' } });
                } catch (e) {
                    res.status(500).json({ error: 'AI 返回格式解析失败' });
                }
            } else {
                res.status(500).json({ error: 'AI 未返回有效 JSON' });
            }
        } else {
            res.status(500).json({ error: data.message || '千问 API 返回异常' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(`Product Image Server running on port ${PORT}`);
    console.log(`DashScope API: ${DASHSCOPE_API_KEY ? '✅ Loaded' : '❌ Missing'}`);
    console.log(`MXAPI API: ${MXAPI_API_KEY ? '✅ Loaded' : '❌ Missing'}`);
    console.log(`API Strategy: ${API_STRATEGY}`);
    console.log(`千问 API: ${QWEN_API_KEY ? '✅ Loaded' : '❌ Missing'}`);
});
