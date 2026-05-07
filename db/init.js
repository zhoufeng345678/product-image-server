const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'product_image',
    password: 'ProductImage@2026',
    database: 'product_image',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

const SQLS = [
    `CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_username (username)
    )`,

    `CREATE TABLE IF NOT EXISTS image_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        prompt TEXT NOT NULL,
        image_url VARCHAR(500) NOT NULL,
        reference_images JSON,
        aspect_ratio VARCHAR(10) DEFAULT '1:1',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_created_at (created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
];

async function init() {
    let conn;
    try {
        conn = await pool.getConnection();
        console.log('✅ 数据库连接成功');

        for (const sql of SQLS) {
            await conn.query(sql);
        }
        console.log('✅ 表创建成功: users, image_history');

        // 验证表
        const [rows] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = 'product_image'
             AND TABLE_NAME IN ('users', 'image_history')`
        );
        const names = rows.map(r => r.TABLE_NAME).sort().join(', ');
        console.log(`✅ 验证通过，当前表: ${names}`);

        if (rows.length === 2) {
            console.log('🎉 数据库初始化完成');
        } else {
            console.error('❌ 表数量不符，预期 2 张表');
            process.exitCode = 1;
        }
    } catch (err) {
        console.error('❌ 初始化失败:', err.message);
        process.exitCode = 1;
    } finally {
        if (conn) conn.release();
        await pool.end();
    }
}

init();
