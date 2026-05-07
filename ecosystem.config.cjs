module.exports = {
  apps: [{
    name: 'product-image-server',
    script: 'server.js',
    cwd: '/var/www/crazydream.site/app/product-image-server',
    env: {
      PORT: 3010,
      // 图片生成 API Keys
      GPT_IMAGE_API_KEY: 'QXND8S1NH1wHD6aU5fveYKD9aagvvjsS', // open.mxapi.org (gpt-image-2)
      DASHSCOPE_API_KEY: 'sk-53d35ba3b420461cb1ae1504e7ac9b6b', // 阿里云百炼 (wanx-v1)
      DASHSCOPE_API_ENDPOINT: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      DASHSCOPE_MODEL: 'qwen-plus',
      // API 选择策略：auto-mxapi-first | dashscope | mxapi | auto
      // auto-mxapi-first: 优先MXAPI，失败时切换到DashScope
      // 注意：根据用户要求，积分不足时不自动切换，只改进错误处理
      API_STRATEGY: 'auto-mxapi-first', // 优先MXAPI，但失败时可切换
      NODE_ENV: 'production'
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '200M',
    error_file: '/var/log/pm2-product-image-error.log',
    out_file: '/var/log/pm2-product-image-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
