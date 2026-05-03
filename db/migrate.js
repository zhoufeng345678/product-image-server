const pool = require('./pool');

const SQLS = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500) DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS gender ENUM('male', 'female', 'other') DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS age INT DEFAULT NULL`,
];

async function migrate() {
    let conn;
    try {
        conn = await pool.getConnection();
        console.log('✅ 数据库连接成功');

        // 检查已存在的列，避免重复添加
        const [columns] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = 'product_image' AND TABLE_NAME = 'users'`
        );
        const existing = new Set(columns.map(c => c.COLUMN_NAME));

        const colMap = {
            'nickname': SQLS[0],
            'avatar_url': SQLS[1],
            'gender': SQLS[2],
            'age': SQLS[3],
        };

        for (const [col, sql] of Object.entries(colMap)) {
            if (existing.has(col)) {
                console.log(`⏭️  字段 ${col} 已存在，跳过`);
            } else {
                await conn.query(sql);
                console.log(`✅ 字段 ${col} 添加成功`);
            }
        }

        // 验证
        const [finalCols] = await conn.query(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = 'product_image' AND TABLE_NAME = 'users'
             ORDER BY ORDINAL_POSITION`
        );
        console.log('\n📋 users 表结构:');
        finalCols.forEach(c => {
            console.log(`   ${c.COLUMN_NAME} (${c.COLUMN_TYPE}) nullable=${c.IS_NULLABLE} default=${c.COLUMN_DEFAULT ?? 'NULL'}`);
        });

        const required = ['nickname', 'avatar_url', 'gender', 'age'];
        const allPresent = required.every(c => existing.has(c) || finalCols.some(f => f.COLUMN_NAME === c));
        if (allPresent) {
            console.log('\n🎉 迁移完成');
        } else {
            console.error('\n❌ 部分字段缺失');
            process.exitCode = 1;
        }
    } catch (err) {
        console.error('❌ 迁移失败:', err.message);
        process.exitCode = 1;
    } finally {
        if (conn) conn.release();
        await pool.end();
    }
}

migrate();
