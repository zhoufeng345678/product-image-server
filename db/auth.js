const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./pool');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'product-image-secret-2026';

// ========== 注册 ==========
router.post('/register', async (req, res) => {
    const { username, password, nickname, avatar_url, gender, age } = req.body;

    // 验证用户名
    if (!username || !password) {
        return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
    }
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ code: 400, message: '用户名长度为 3-20 个字符' });
    }
    if (password.length < 6 || password.length > 50) {
        return res.status(400).json({ code: 400, message: '密码长度为 6-50 个字符' });
    }

    // 验证昵称（必填）
    if (!nickname || nickname.length < 2 || nickname.length > 20) {
        return res.status(400).json({ code: 400, message: '昵称长度为 2-20 个字符' });
    }

    // 验证性别（可选）
    const validGenders = ['male', 'female', 'other'];
    if (gender !== undefined && gender !== null && gender !== '') {
        if (!validGenders.includes(gender)) {
            return res.status(400).json({ code: 400, message: '性别只能为 male、female 或 other' });
        }
    }

    // 验证年龄（可选）
    if (age !== undefined && age !== null && age !== '') {
        const ageNum = Number(age);
        if (!Number.isInteger(ageNum) || ageNum < 1 || ageNum > 120) {
            return res.status(400).json({ code: 400, message: '年龄必须在 1-120 之间' });
        }
    }

    try {
        // 检查用户名是否已存在
        const [existing] = await pool.query(
            'SELECT id FROM users WHERE username = ?',
            [username]
        );
        if (existing.length > 0) {
            return res.status(409).json({ code: 409, message: '用户名已存在' });
        }

        // 加密密码
        const passwordHash = await bcrypt.hash(password, 10);

        // 插入用户
        const [result] = await pool.query(
            'INSERT INTO users (username, password_hash, nickname, avatar_url, gender, age) VALUES (?, ?, ?, ?, ?, ?)',
            [username, passwordHash, nickname, avatar_url || null, gender || null, age ? Number(age) : null]
        );

        res.status(200).json({
            code: 200,
            message: '注册成功',
            data: {
                userId: result.insertId,
                username,
                nickname
            }
        });
    } catch (err) {
        console.error('注册失败:', err.message);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// ========== 登录 ==========
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    // 验证
    if (!username || !password) {
        return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
    }

    try {
        // 查询用户
        const [rows] = await pool.query(
            'SELECT id, username, password_hash FROM users WHERE username = ?',
            [username]
        );
        if (rows.length === 0) {
            return res.status(401).json({ code: 401, message: '用户名或密码错误' });
        }

        const user = rows[0];

        // 比对密码
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ code: 401, message: '用户名或密码错误' });
        }

        // 生成 JWT
        const token = jwt.sign(
            { userId: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(200).json({
            code: 200,
            message: '登录成功',
            data: { token, userId: user.id, username: user.username }
        });
    } catch (err) {
        console.error('登录失败:', err.message);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// ========== 登出 ==========
router.post('/logout', (req, res) => {
    // JWT 无状态，客户端删除 token 即可
    res.status(200).json({ code: 200, message: '登出成功' });
});

// ========== 获取当前用户信息 ==========
router.get('/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ code: 401, message: '未认证' });
    }

    const token = authHeader.slice(7);
    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ code: 401, message: 'Token 无效或已过期' });
    }

    try {
        const [rows] = await pool.query(
            'SELECT id, username, nickname, avatar_url, gender, age, created_at FROM users WHERE id = ?',
            [decoded.userId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ code: 404, message: '用户不存在' });
        }

        const user = rows[0];
        res.status(200).json({
            code: 200,
            data: {
                userId: user.id,
                username: user.username,
                nickname: user.nickname,
                avatar_url: user.avatar_url,
                gender: user.gender,
                age: user.age,
                createdAt: user.created_at
            }
        });
    } catch (err) {
        console.error('获取用户信息失败:', err.message);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

module.exports = router;
