const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'product-image-secret-2026';

/**
 * JWT 认证中间件工厂
 * @param {Object} options
 * @param {boolean} options.optional - 是否允许匿名访问（token 可选）
 * @returns {Function} Express 中间件
 */
function authenticateToken(options = {}) {
    const { optional = false } = options;

    return (req, res, next) => {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            if (optional) {
                req.user = null;
                return next();
            }
            return res.status(401).json({ code: 401, message: '未认证，请先登录' });
        }

        const token = authHeader.slice(7);

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = { userId: decoded.userId, username: decoded.username };
            next();
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ code: 401, message: 'Token 已过期，请重新登录' });
            }
            return res.status(401).json({ code: 401, message: 'Token 无效' });
        }
    };
}

module.exports = { authenticateToken };
