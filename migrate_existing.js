const mysql = require('mysql2/promise');
const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');

// 数据库配置
const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'product_image',
    password: 'ProductImage@2026',
    database: 'product_image',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
});

// 下载图片函数
function downloadImage(url, filePath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const file = require('fs').createWriteStream(filePath);
        
        protocol.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            
            // 检查内容类型
            const contentType = response.headers['content-type'];
            if (!contentType || !contentType.startsWith('image/')) {
                reject(new Error(`无效的内容类型: ${contentType}`));
                return;
            }
            
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            require('fs').unlink(filePath, () => {});
            reject(err);
        });
        
        // 设置超时
        setTimeout(() => {
            reject(new Error('下载超时'));
        }, 30000);
    });
}

async function migrateExistingData() {
    console.log('开始迁移现有历史记录数据...');
    console.log('========================================');
    
    try {
        // 1. 获取所有需要迁移的记录
        const [rows] = await pool.query(`
            SELECT id, user_id, image_url, created_at
            FROM image_history 
            WHERE image_url IS NOT NULL 
            AND image_url != '' 
            AND image_url LIKE 'http%'
            AND (oss_url IS NULL OR oss_url = '')
            ORDER BY created_at DESC
            LIMIT 50  -- 先迁移最近的50条
        `);
        
        console.log(`找到 ${rows.length} 条需要迁移的记录`);
        
        if (rows.length === 0) {
            console.log('✅ 没有需要迁移的记录');
            return;
        }
        
        const UPLOAD_DIR = '/var/www/crazydream.site/uploads/product-image';
        let successCount = 0;
        let failCount = 0;
        
        // 2. 逐条迁移
        for (const row of rows) {
            console.log(`\n--- 处理记录 ${row.id} (用户 ${row.user_id}) ---`);
            console.log(`图片URL: ${row.image_url.substring(0, 80)}...`);
            
            try {
                // 生成文件名
                const timestamp = Date.now();
                const randomStr = Math.random().toString(36).slice(2, 10);
                
                // 根据URL确定扩展名
                let ext = '.jpg';
                if (row.image_url.includes('.png')) ext = '.png';
                if (row.image_url.includes('.jpeg')) ext = '.jpeg';
                if (row.image_url.includes('.webp')) ext = '.webp';
                
                const filename = `migrate-${row.id}-${timestamp}-${randomStr}${ext}`;
                const filePath = path.join(UPLOAD_DIR, filename);
                
                // 下载图片
                console.log(`下载中...`);
                await downloadImage(row.image_url, filePath);
                
                // 检查文件大小
                const stats = await fs.stat(filePath);
                if (stats.size < 1024) { // 小于1KB可能是无效图片
                    throw new Error('文件大小异常');
                }
                
                // 更新数据库
                const ossUrl = `/uploads/product-image/${filename}`;
                await pool.query(
                    'UPDATE image_history SET oss_url = ? WHERE id = ?',
                    [ossUrl, row.id]
                );
                
                console.log(`✅ 迁移成功: ${ossUrl}`);
                console.log(`   文件大小: ${(stats.size / 1024).toFixed(1)} KB`);
                successCount++;
                
            } catch (err) {
                console.log(`❌ 迁移失败: ${err.message}`);
                failCount++;
                
                // 标记为失败，避免重复尝试
                await pool.query(
                    'UPDATE image_history SET oss_url = ? WHERE id = ?',
                    ['FAILED', row.id]
                );
            }
            
            // 延迟一下，避免请求过快
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log('\n========================================');
        console.log('迁移完成！');
        console.log(`成功: ${successCount} 条`);
        console.log(`失败: ${failCount} 条`);
        console.log(`总计: ${rows.length} 条`);
        
        // 3. 显示迁移后的统计
        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN oss_url IS NOT NULL AND oss_url != '' AND oss_url != 'FAILED' THEN 1 END) as migrated,
                COUNT(CASE WHEN oss_url = 'FAILED' THEN 1 END) as failed,
                COUNT(CASE WHEN oss_url IS NULL OR oss_url = '' THEN 1 END) as pending
            FROM image_history
            WHERE image_url IS NOT NULL AND image_url != ''
        `);
        
        console.log('\n📊 迁移统计:');
        console.log(`总记录数: ${stats[0].total}`);
        console.log(`已迁移: ${stats[0].migrated}`);
        console.log(`迁移失败: ${stats[0].failed}`);
        console.log(`待迁移: ${stats[0].pending}`);
        
    } catch (err) {
        console.error('迁移过程中出错:', err);
    } finally {
        await pool.end();
        console.log('数据库连接已关闭');
    }
}

// 运行迁移
if (require.main === module) {
    migrateExistingData().catch(console.error);
}

module.exports = { migrateExistingData };